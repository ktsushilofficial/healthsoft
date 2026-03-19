import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import type { BleError, Device, State } from 'react-native-ble-plx';
import bleManager from './bleManager';
import type {
  BleCharacteristicSummary,
  BleDeviceIdentity,
  BleDiscoveredDevice,
  BleGattDetails,
  BleServiceSummary,
} from './types';
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

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(null);
  const [gattDetails, setGattDetails] = useState<BleGattDetails | null>(null);
  const [deviceIdentity, setDeviceIdentity] = useState<BleDeviceIdentity | null>(null);

  const connectedDeviceRef = useRef<Device | null>(null);
  const disconnectedSubRef = useRef<{ remove: () => void } | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const devicesByIdRef = useRef<Record<string, BleDiscoveredDevice>>({});

  const managerStateString = useMemo(() => bleState, [bleState]);

  useEffect(() => {
    const sub = bleManager.onStateChange(
      state => setBleState(state),
      true,
    );
    return () => {
      sub.remove();
    };
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

  const disconnect = useCallback(async () => {
    setConnectionState('disconnecting');

    try {
      if (disconnectedSubRef.current) {
        disconnectedSubRef.current.remove();
        disconnectedSubRef.current = null;
      }

      if (connectedDeviceRef.current) {
        await connectedDeviceRef.current.cancelConnection();
      } else if (connectedDeviceId) {
        await bleManager.cancelDeviceConnection(connectedDeviceId);
      }
    } catch {
      // Best-effort disconnect.
    } finally {
      connectedDeviceRef.current = null;
      setConnectedDeviceId(null);
      setGattDetails(null);
      setDeviceIdentity(null);
      setConnectionState('disconnected');
    }
  }, [connectedDeviceId]);

  const readDeviceInformation = useCallback(async (device: Device) => {
    // Read standard GATT Device Information characteristics if the peripheral exposes them.
    try {
      const characteristics = await device.characteristicsForService(DEVICE_INFORMATION_SERVICE_UUID);

      const byUuid = characteristics.reduce<Record<string, any>>((acc, c: any) => {
        const uuid = toLowerUuid(c.uuid);
        if (uuid) acc[uuid] = c;
        return acc;
      }, {});

      const identity: BleDeviceIdentity = {};

      // Read each explicitly so we don't rely on function name hacks.
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

      setDeviceIdentity(Object.keys(identity).length ? identity : null);
    } catch {
      // Device info service may not exist or characteristics may not be readable.
      setDeviceIdentity(null);
    }
  }, []);

  const connectToDevice = useCallback(async (deviceId: string) => {
    setScanError(null);
    setConnectionState('connecting');

    try {
      // Make sure scan is not running while connecting.
      await stopScan();

      const hasPermissions = await requestAndroidBlePermissions();
      if (!hasPermissions && Platform.OS === 'android') {
        throw new Error('Bluetooth permissions not granted.');
      }

      const device = await bleManager.connectToDevice(deviceId, { autoConnect: false, timeout: 10000 });
      connectedDeviceRef.current = device;
      setConnectedDeviceId(deviceId);

      // Track disconnection.
      const sub = bleManager.onDeviceDisconnected(deviceId, (error, dev) => {
        // Only react if this device disconnected.
        if (error || dev) {
          setConnectionState('disconnected');
          connectedDeviceRef.current = null;
          setConnectedDeviceId(null);
          setGattDetails(null);
          setDeviceIdentity(null);
        }
      });
      disconnectedSubRef.current = sub;

      // Discover services/characteristics.
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

      setGattDetails({ services: serviceSummaries });

      await readDeviceInformation(device);

      setConnectionState('connected');
    } catch (e: any) {
      Alert.alert('BLE Connection Failed', e?.message ?? 'Unable to connect to device.');
      setConnectionState('error');
    }
  }, [readDeviceInformation, stopScan]);

  const writeUtf8ToCharacteristic = useCallback(
    async (serviceUuid: string, characteristicUuid: string, valueUtf8: string) => {
      if (!connectedDeviceId) {
        throw new Error('No connected device.');
      }

      const base64Value = encodeUtf8ToBase64(valueUtf8);

      // Prefer manager-level API (works regardless of whether we kept a Device ref).
      await bleManager.writeCharacteristicWithResponseForDevice(
        connectedDeviceId,
        serviceUuid,
        characteristicUuid,
        base64Value,
      );
    },
    [connectedDeviceId],
  );

  useEffect(() => {
    return () => {
      // Cleanup scan timer, subscriptions, etc.
      if (scanTimerRef.current) {
        clearTimeout(scanTimerRef.current);
      }
    };
  }, []);

  return {
    bleState: managerStateString,
    isScanning,
    devices,
    scanError,
    connectionState,
    connectedDeviceId,
    gattDetails,
    deviceIdentity,
    startScan,
    stopScan,
    connectToDevice,
    disconnect,
    writeUtf8ToCharacteristic,
  };
}

