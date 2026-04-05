import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import type { BleError, Device, State, Subscription } from 'react-native-ble-plx';
import bleManager from './bleManager';
import type {
  BleCharacteristicSummary,
  BleDeviceIdentity,
  BleDiscoveredDevice,
  BleGattDetails,
  BleServiceSummary,
} from './types';
import { Buffer } from 'buffer';
import { decodeBase64ToUtf8, encodeUtf8ToBase64 } from './base64';

type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error';

const DEVICE_INFORMATION_SERVICE_UUID = '180a';
const MANUFACTURER_NAME_UUID = '2a29';
const MODEL_NUMBER_UUID = '2a24';
const SERIAL_NUMBER_UUID = '2a25';
const FIRMWARE_REVISION_UUID = '2a26';
const HARDWARE_REVISION_UUID = '2a27';
const SOFTWARE_REVISION_UUID = '2a28';

const GENERIC_ACCESS_SERVICE_UUID = '1800';
const DEVICE_NAME_UUID = '2a00';

const BATTERY_SERVICE_UUID = '180f';
const BATTERY_LEVEL_UUID = '2a19';

// Nordic UART Service (NUS)
const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // write from central
const NUS_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // notify to central

function toLowerUuid(uuid?: string | null): string | undefined {
  if (!uuid) return undefined;
  return uuid.toLowerCase();
}

async function requestAndroidBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  // Android 12+ requires runtime permissions for BLE scan/connect.
  const permissions =
    Platform.Version >= 31
      ? (['android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT'] as const)
      : (['android.permission.ACCESS_FINE_LOCATION'] as const);

  try {
    const result = await PermissionsAndroid.requestMultiple(permissions as any);
    return Object.values(result).every(v => v === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

export function useBleDeviceManager() {
  const [bleState, setBleState] = useState<State | 'Unknown'>('Unknown');
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [devices, setDevices] = useState<BleDiscoveredDevice[]>([]);

  const [connectionStates, setConnectionStates] = useState<Record<string, ConnectionState>>({});
  const [gattDetailsById, setGattDetailsById] = useState<Record<string, BleGattDetails>>({});
  const [deviceIdentityById, setDeviceIdentityById] = useState<Record<string, BleDeviceIdentity>>({});

  const connectedDeviceRefs = useRef<Record<string, Device>>({});
  const disconnectedSubRefs = useRef<Record<string, { remove: () => void }>>({});
  const notificationSubsRef = useRef<Record<string, Subscription[]>>({});
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const devicesByIdRef = useRef<Record<string, BleDiscoveredDevice>>({});

  const managerStateString = useMemo(() => bleState, [bleState]);

  const connectedDeviceIds = useMemo(
    () =>
      Object.entries(connectionStates)
        .filter(([, state]) => state === 'connected')
        .map(([id]) => id),
    [connectionStates],
  );

  const primaryConnectedId = useMemo(
    () => connectedDeviceIds[0] ?? null,
    [connectedDeviceIds],
  );

  const aggregateConnectionState = useMemo<ConnectionState>(() => {
    const states = Object.values(connectionStates);
    if (states.includes('connecting')) return 'connecting';
    if (states.includes('connected')) return 'connected';
    if (states.includes('disconnecting')) return 'disconnecting';
    if (states.includes('error')) return 'error';
    return 'disconnected';
  }, [connectionStates]);

  useEffect(() => {
    const sub = bleManager.onStateChange(
      state => setBleState(state),
      true,
    );
    return () => {
      sub.remove();
    };
  }, []);

  const cleanupDeviceState = useCallback((deviceId: string) => {
    try {
      if (disconnectedSubRefs.current[deviceId]) {
        disconnectedSubRefs.current[deviceId]?.remove();
        delete disconnectedSubRefs.current[deviceId];
      }
    } catch {
      // Best-effort
    }

    delete connectedDeviceRefs.current[deviceId];

    try {
      (notificationSubsRef.current[deviceId] || []).forEach(sub => sub?.remove?.());
    } catch {
      // ignore
    }
    delete notificationSubsRef.current[deviceId];

    setConnectionStates(prev => {
      const next = { ...prev };
      delete next[deviceId];
      return next;
    });

    setGattDetailsById(prev => {
      const next = { ...prev };
      delete next[deviceId];
      return next;
    });

    setDeviceIdentityById(prev => {
      const next = { ...prev };
      delete next[deviceId];
      return next;
    });
  }, []);

  const stopScan = useCallback(async () => {
    setIsScanning(false);
    setScanError(null);
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }

    try {
      await bleManager.stopDeviceScan();
    } catch {
      // Best-effort
    }
  }, []);

  const startScan = useCallback(
    async (scanDurationMs: number = 10000) => {
      setScanError(null);

      if (bleState !== 'PoweredOn') {
        setScanError('Bluetooth is not powered on.');
        return;
      }

      const hasPermissions = await requestAndroidBlePermissions();
      if (!hasPermissions) {
        setScanError('Bluetooth permissions not granted.');
        return;
      }

      // iOS: library will typically prompt automatically when needed.
      // Android: we requested permissions above.

      try {
        devicesByIdRef.current = {};
        setDevices([]);
        setIsScanning(true);

        await bleManager.startDeviceScan(
          null,
          { allowDuplicates: false },
          (error: BleError | null, scannedDevice: Device | null) => {
            if (error) {
              setScanError(error.message ?? 'BLE scan failed.');
              setIsScanning(false);
              bleManager.stopDeviceScan().catch(() => {});
              return;
            }

            if (!scannedDevice) return;

            const id = scannedDevice.id;
            const prev = devicesByIdRef.current[id];

            const next: BleDiscoveredDevice = {
              id,
              name: scannedDevice.name ?? prev?.name ?? null,
              localName: scannedDevice.localName ?? prev?.localName ?? null,
              rssi: scannedDevice.rssi ?? prev?.rssi ?? null,
              isConnectable: (scannedDevice as any).isConnectable ?? prev?.isConnectable ?? null,
              serviceUUIDs: scannedDevice.serviceUUIDs ?? prev?.serviceUUIDs ?? null,
            };

            devicesByIdRef.current[id] = next;
            setDevices(Object.values(devicesByIdRef.current));
          },
        );

        scanTimerRef.current = setTimeout(() => {
          // Trigger stop from outside callback, to avoid stopping inside callback.
          stopScan().catch(() => {});
        }, scanDurationMs);
      } catch (e: any) {
        setScanError(e?.message ?? 'Failed to start BLE scan.');
        setIsScanning(false);
      }
    },
    [stopScan, bleState],
  );

  const disconnect = useCallback(
    async (deviceId?: string) => {
      const targetIds = deviceId ? [deviceId] : Object.keys(connectionStates);

      if (targetIds.length === 0) return;

      setConnectionStates(prev => {
        const next = { ...prev };
        targetIds.forEach(id => {
          if (next[id]) next[id] = 'disconnecting';
        });
        return next;
      });

      await Promise.all(
        targetIds.map(async id => {
          try {
            if (connectedDeviceRefs.current[id]) {
              await connectedDeviceRefs.current[id].cancelConnection();
            } else {
              await bleManager.cancelDeviceConnection(id);
            }
          } catch {
            // Best-effort disconnect.
          } finally {
            cleanupDeviceState(id);
          }
        }),
      );
    },
    [cleanupDeviceState, connectionStates],
  );

  const readDeviceInformation = useCallback(async (device: Device) => {
    const deviceId = device.id;

    try {
      const characteristics = await device.characteristicsForService(DEVICE_INFORMATION_SERVICE_UUID);

      const byUuid = characteristics.reduce<Record<string, any>>((acc, c: any) => {
        const uuid = toLowerUuid(c.uuid);
        if (uuid) acc[uuid] = c;
        return acc;
      }, {});

      const identity: BleDeviceIdentity = {};

      const manufacturerChar = byUuid[MANUFACTURER_NAME_UUID];
      if (manufacturerChar?.isReadable) {
        const c = await device.readCharacteristicForService(
          DEVICE_INFORMATION_SERVICE_UUID,
          MANUFACTURER_NAME_UUID,
        );
        if (c?.value) identity.manufacturer = decodeBase64ToUtf8(c.value);
      }

      const modelChar = byUuid[MODEL_NUMBER_UUID];
      if (modelChar?.isReadable) {
        const c = await device.readCharacteristicForService(
          DEVICE_INFORMATION_SERVICE_UUID,
          MODEL_NUMBER_UUID,
        );
        if (c?.value) identity.model = decodeBase64ToUtf8(c.value);
      }

      const serialChar = byUuid[SERIAL_NUMBER_UUID];
      if (serialChar?.isReadable) {
        const c = await device.readCharacteristicForService(
          DEVICE_INFORMATION_SERVICE_UUID,
          SERIAL_NUMBER_UUID,
        );
        if (c?.value) identity.serialNumber = decodeBase64ToUtf8(c.value);
      }

      const firmwareChar = byUuid[FIRMWARE_REVISION_UUID];
      if (firmwareChar?.isReadable) {
        const c = await device.readCharacteristicForService(
          DEVICE_INFORMATION_SERVICE_UUID,
          FIRMWARE_REVISION_UUID,
        );
        if (c?.value) identity.firmwareRevision = decodeBase64ToUtf8(c.value);
      }

      const hardwareChar = byUuid[HARDWARE_REVISION_UUID];
      if (hardwareChar?.isReadable) {
        const c = await device.readCharacteristicForService(
          DEVICE_INFORMATION_SERVICE_UUID,
          HARDWARE_REVISION_UUID,
        );
        if (c?.value) identity.hardwareRevision = decodeBase64ToUtf8(c.value);
      }

      const softwareChar = byUuid[SOFTWARE_REVISION_UUID];
      if (softwareChar?.isReadable) {
        const c = await device.readCharacteristicForService(
          DEVICE_INFORMATION_SERVICE_UUID,
          SOFTWARE_REVISION_UUID,
        );
        if (c?.value) identity.softwareRevision = decodeBase64ToUtf8(c.value);
      }

      setDeviceIdentityById(prev => {
        const next = { ...prev };
        if (Object.keys(identity).length) {
          next[deviceId] = identity;
        } else {
          delete next[deviceId];
        }
        return next;
      });
    } catch {
      // Device info service may not exist or characteristics may not be readable.
      setDeviceIdentityById(prev => {
        const next = { ...prev };
        delete next[deviceId];
        return next;
      });
    }
  }, []);

  const connectToDevice = useCallback(
    async (deviceId: string) => {
      setScanError(null);
      setConnectionStates(prev => ({ ...prev, [deviceId]: 'connecting' }));

      try {
        await stopScan();

        const hasPermissions = await requestAndroidBlePermissions();
        if (!hasPermissions && Platform.OS === 'android') {
          throw new Error('Bluetooth permissions not granted.');
        }

        const device = await bleManager.connectToDevice(deviceId, { autoConnect: false, timeout: 10000 });
        connectedDeviceRefs.current[deviceId] = device;

        const sub = bleManager.onDeviceDisconnected(deviceId, () => {
          cleanupDeviceState(deviceId);
        });
        disconnectedSubRefs.current[deviceId] = sub;

        await device.discoverAllServicesAndCharacteristics();

        const services = await device.services();

        const serviceSummaries: BleServiceSummary[] = [];
        for (const service of services) {
          const characteristics = await device.characteristicsForService(service.uuid);
          const charSummaries: BleCharacteristicSummary[] = characteristics.map((c: any) => ({
            uuid: c.uuid,
            isReadable: !!c.isReadable,
            isWritableWithResponse: !!c.isWritableWithResponse,
            isWritableWithoutResponse: !!c.isWritableWithoutResponse,
            isNotifiable: !!c.isNotifiable,
            isIndicatable: !!c.isIndicatable,
          }));

          serviceSummaries.push({
            uuid: service.uuid,
            characteristics: charSummaries,
          });
        }

        setGattDetailsById(prev => ({ ...prev, [deviceId]: { services: serviceSummaries } }));

        // Read Device Name from Generic Access if available.
        const gaService = serviceSummaries.find(
          s => toLowerUuid(s.uuid) === GENERIC_ACCESS_SERVICE_UUID,
        );
        if (gaService) {
          const deviceNameChar = gaService.characteristics.find(
            c => toLowerUuid(c.uuid) === DEVICE_NAME_UUID && c.isReadable,
          );
          if (deviceNameChar) {
            try {
              const nameChar = await device.readCharacteristicForService(
                GENERIC_ACCESS_SERVICE_UUID,
                DEVICE_NAME_UUID,
              );
              if (nameChar?.value) {
                const decoded = decodeBase64ToUtf8(nameChar.value);
                const existing = devicesByIdRef.current[deviceId] ?? { id: deviceId };
                devicesByIdRef.current[deviceId] = {
                  ...existing,
                  name: decoded || existing.name || device.name || null,
                };
                // Also store as model fallback in identity for UI display.
                if (decoded) {
                  setDeviceIdentityById(prev => ({
                    ...prev,
                    [deviceId]: {
                      ...(prev[deviceId] ?? {}),
                      model: decoded,
                    },
                  }));
                }
              }
            } catch {
              // ignore if not readable
            }
          }
        }

        // Battery level if present.
        const batteryService = serviceSummaries.find(
          s => toLowerUuid(s.uuid) === BATTERY_SERVICE_UUID,
        );
        if (batteryService) {
          const batteryChar = batteryService.characteristics.find(
            c => toLowerUuid(c.uuid) === BATTERY_LEVEL_UUID && c.isReadable,
          );
          if (batteryChar) {
            try {
              const levelChar = await device.readCharacteristicForService(
                BATTERY_SERVICE_UUID,
                BATTERY_LEVEL_UUID,
              );
              const lvl = levelChar?.value
                ? Buffer.from(levelChar.value, 'base64')[0]
                : null;
              if (!Number.isNaN(lvl) && lvl !== null) {
                setDeviceIdentityById(prev => ({
                  ...prev,
                  [deviceId]: {
                    ...(prev[deviceId] ?? {}),
                    batteryLevel: lvl,
                  },
                }));
              }
            } catch {
              // ignore read errors
            }
          }

          // Subscribe if notifiable
          const batteryNotifyChar = batteryService.characteristics.find(
            c => toLowerUuid(c.uuid) === BATTERY_LEVEL_UUID && (c.isNotifiable || c.isIndicatable),
          );
          if (batteryNotifyChar) {
            try {
              const sub = device.monitorCharacteristicForService(
                BATTERY_SERVICE_UUID,
                BATTERY_LEVEL_UUID,
                (error, characteristic) => {
                  if (error || !characteristic?.value) return;
                  const lvl = Buffer.from(characteristic.value, 'base64')[0];
                  if (!Number.isNaN(lvl)) {
                    setDeviceIdentityById(prev => ({
                      ...prev,
                      [deviceId]: {
                        ...(prev[deviceId] ?? {}),
                        batteryLevel: lvl,
                      },
                    }));
                  }
                },
              );
              notificationSubsRef.current[deviceId] = [
                ...(notificationSubsRef.current[deviceId] ?? []),
                sub,
              ];
            } catch {
              // ignore
            }
          }
        }

        // Auto-subscribe to Nordic UART TX if present for notify stream.
        const nusService = serviceSummaries.find(
          s => toLowerUuid(s.uuid) === NUS_SERVICE_UUID,
        );
        if (nusService) {
          const txChar = nusService.characteristics.find(
            c =>
              toLowerUuid(c.uuid) === NUS_TX_UUID ||
              c.isNotifiable ||
              c.isIndicatable,
          );
          if (txChar && (txChar.isNotifiable || txChar.isIndicatable)) {
            try {
              const sub = device.monitorCharacteristicForService(
                nusService.uuid,
                txChar.uuid,
                (error, characteristic) => {
                  if (error) {
                    return;
                  }
                  // For now, we only log. Consumers can extend to route data.
                  if (characteristic?.value) {
                    // eslint-disable-next-line no-console
                    console.log(
                      `[BLE][${deviceId}] NUS notify ${txChar.uuid}:`,
                      decodeBase64ToUtf8(characteristic.value),
                    );
                  }
                },
              );
              notificationSubsRef.current[deviceId] = [
                ...(notificationSubsRef.current[deviceId] ?? []),
                sub,
              ];
            } catch {
              // ignore monitor errors
            }
          }
        }

        await readDeviceInformation(device);

        // If identity is still empty, at least surface deviceId as serial placeholder.
        setDeviceIdentityById(prev => {
          const current = prev[deviceId] ?? {};
          if (current.serialNumber || current.model || current.manufacturer) return prev;
          return {
            ...prev,
            [deviceId]: { ...current, serialNumber: deviceId, model: devicesByIdRef.current[deviceId]?.name ?? device.name ?? null },
          };
        });

        // Ensure the connected device shows up in the list even if it was not seen in the current scan.
        const existing = devicesByIdRef.current[deviceId] ?? { id: deviceId };
        devicesByIdRef.current[deviceId] = {
          ...existing,
          name: device.name ?? existing.name ?? null,
          localName: device.localName ?? existing.localName ?? null,
        };
        setDevices(Object.values(devicesByIdRef.current));

        setConnectionStates(prev => ({ ...prev, [deviceId]: 'connected' }));
      } catch (e: any) {
        Alert.alert('BLE Connection Failed', e?.message ?? 'Unable to connect to device.');
        setConnectionStates(prev => ({ ...prev, [deviceId]: 'error' }));
      }
    },
    [cleanupDeviceState, readDeviceInformation, stopScan],
  );

  const writeUtf8ToCharacteristic = useCallback(
    async (
      serviceUuid: string,
      characteristicUuid: string,
      valueUtf8: string,
      targetDeviceId?: string,
    ) => {
      const activeDeviceId = targetDeviceId ?? primaryConnectedId ?? connectedDeviceIds[0];
      if (!activeDeviceId) {
        throw new Error('No connected device.');
      }

      const base64Value = encodeUtf8ToBase64(valueUtf8);

      await bleManager.writeCharacteristicWithResponseForDevice(
        activeDeviceId,
        serviceUuid,
        characteristicUuid,
        base64Value,
      );
    },
    [connectedDeviceIds, primaryConnectedId],
  );

  useEffect(() => {
    return () => {
      // Cleanup scan timer, subscriptions, etc.
      if (scanTimerRef.current) {
        clearTimeout(scanTimerRef.current);
      }

      Object.keys(disconnectedSubRefs.current).forEach(id => {
        try {
          disconnectedSubRefs.current[id]?.remove();
        } catch {
          // ignore
        }
      });

      Object.keys(notificationSubsRef.current).forEach(id => {
        try {
          notificationSubsRef.current[id]?.forEach(sub => sub?.remove?.());
        } catch {
          // ignore
        }
      });

      Object.keys(connectedDeviceRefs.current).forEach(id => {
        try {
          connectedDeviceRefs.current[id]?.cancelConnection();
        } catch {
          // ignore
        }
      });
    };
  }, []);

  return {
    bleState: managerStateString,
    isScanning,
    devices,
    scanError,
    connectionState: aggregateConnectionState,
    connectionStates,
    connectedDeviceIds,
    primaryConnectedId,
    gattDetails: primaryConnectedId ? gattDetailsById[primaryConnectedId] ?? null : null,
    gattDetailsById,
    deviceIdentity: primaryConnectedId ? deviceIdentityById[primaryConnectedId] ?? null : null,
    deviceIdentityById,
    startScan,
    stopScan,
    connectToDevice,
    disconnect,
    writeUtf8ToCharacteristic,
  };
}
