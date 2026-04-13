import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, PermissionsAndroid, Platform } from 'react-native';
import type { BleError, Device, State, Subscription } from 'react-native-ble-plx';
import bleManager from './bleManager';
import type {
  BleCharacteristicSummary,
  BleDeviceIdentity,
  BleDiscoveredDevice,
  BleDataSnapshot,
  BleGattDetails,
  BleServiceSummary,
} from './types';
import { Buffer } from 'buffer';
import { decodeBase64ToUtf8, encodeUtf8ToBase64 } from './base64';
import { buildConfigFrame, parseEv07bFrame } from './ev07bProtocol';
import {
  decodeEv07bAlarmClock,
  decodeEv07bAsciiSetting,
  decodeEv07bAuthorizedPhone,
  decodeEv07bFallDownAlert,
  decodeEv07bFlagMask,
  decodeEv07bGeoAlert,
  decodeEv07bNoMotionAlert,
  decodeEv07bNoDisturb,
  decodeEv07bTiltAlert,
  hasEv07bFlag,
} from './ev07bConfigCodec';

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

// Maximum bytes per BLE write packet (conservative; negotiated MTU - 3)
const BLE_MTU_PAYLOAD = 20;

const EV07B_ERROR_MESSAGES: Record<number, string> = {
  0x00: 'Device reported success',
  0x11: 'Protocol version is not supported',
  0x12: 'Encryption method is not supported',
  0x13: 'Protocol length is invalid',
  0x14: 'Checksum failed',
  0x15: 'Command is not supported',
  0x16: 'One of the requested keys is invalid',
  0x17: 'Key length is invalid',
  0x21: 'Data format is invalid',
  0x22: 'Data size is invalid',
  0x23: 'Device is not in the right state for this command',
  0x24: 'One of the parameters is invalid',
  0x25: 'Device storage is full',
  0x26: 'Sub-function is not supported',
  0x27: 'GPS is not ready yet',
  0x28: 'Address response error',
  0x30: 'Device is out of service',
  0x40: 'BLE password handshake is required before this command',
  0xf0: 'Battery is too low for this command',
  0xf1: 'Device failed to open the requested file',
};

function readUint32Le(bytes: Uint8Array, offset: number = 0): number {
  return (
    ((bytes[offset] ?? 0)) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

function formatMacAddress(bytes?: Uint8Array | null): string | undefined {
  if (!bytes || bytes.length < 6) return undefined;
  return Array.from(bytes.slice(0, 6))
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

function formatEv07bError(code?: number): string {
  if (code === undefined) return 'Device rejected the request';
  const message = EV07B_ERROR_MESSAGES[code] ?? 'Unknown device error';
  return `${message} (0x${code.toString(16).padStart(2, '0')})`;
}

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
  const [isResolvingScanIdentities, setIsResolvingScanIdentities] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [devices, setDevices] = useState<BleDiscoveredDevice[]>([]);

  const [connectionStates, setConnectionStates] = useState<Record<string, ConnectionState>>({});
  const [gattDetailsById, setGattDetailsById] = useState<Record<string, BleGattDetails>>({});
  const [deviceIdentityById, setDeviceIdentityById] = useState<Record<string, BleDeviceIdentity>>({});
  const [dataSnapshotById, setDataSnapshotById] = useState<Record<string, BleDataSnapshot>>({});
  const [bleLogById, setBleLogById] = useState<Record<string, string[]>>({});

  const pushLog = useCallback((deviceId: string, entry: string) => {
    setBleLogById(prev => {
      const arr = prev[deviceId] ?? [];
      // Keep last 50 entries
      const next = [...arr, `[${new Date().toLocaleTimeString()}] ${entry}`].slice(-50);
      return { ...prev, [deviceId]: next };
    });
  }, []);

  const connectedDeviceRefs = useRef<Record<string, Device>>({});
  const disconnectedSubRefs = useRef<Record<string, { remove: () => void }>>({});
  const notificationSubsRef = useRef<Record<string, Subscription[]>>({});
  // pendingEv07b: keyed by seqId OR -1 for wildcard (accept any 0x02 response)
  const pendingEv07b = useRef<Record<number, (frame: Uint8Array) => void>>({});
  const seqRef = useRef<number>(0x0100);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Reassembly buffer per device for fragmented NUS frames
  const reassemblyBuf = useRef<Record<string, { data: number[]; expectedLen: number }>>({});
  const disconnectBehaviorRef = useRef<Record<string, { preserveIdentity?: boolean }>>({});
  const shouldResolveAfterScanRef = useRef(false);
  const probingDeviceIdsRef = useRef<Record<string, true>>({});

  const devicesByIdRef = useRef<Record<string, BleDiscoveredDevice>>({});

  const managerStateString = useMemo(() => bleState, [bleState]);
  const applyEv07bKeys = useCallback(
    (
      deviceId: string,
      keys: Record<number, Uint8Array>,
      blocks?: Array<{ key: number; value: Uint8Array }>,
    ) => {
      let changed = false;
      const nextIdentity: BleDeviceIdentity = { ...(deviceIdentityById[deviceId] ?? {}) };

      const setText = (
        field: keyof BleDeviceIdentity,
        val?: Uint8Array,
        options?: { allowEmpty?: boolean },
      ) => {
        if (!val) return;
        const str = decodeEv07bAsciiSetting(val);
        if (str === null) return;
        if (str || options?.allowEmpty) {
          (nextIdentity as any)[field] = str;
          changed = true;
        }
      };

      // Identity keys
      if (keys[0x03]) setText('imei', keys[0x03]);
      if (keys[0x04]) setText('iccid', keys[0x04]);
      if (keys[0x05]) {
        const mac = formatMacAddress(keys[0x05]);
        if (mac) {
          nextIdentity.bluetoothMacAddress = mac;
          changed = true;
        }
      }

      // Firmware & software
      if (keys[0x02]) setText('firmwareRevision', keys[0x02]);
      if (keys[0x1A]) setText('versionInfo', keys[0x1A]);
      if (keys[0x1B]) setText('softwareRevision', keys[0x1B]);

      // Firmware build info (key 0x08 — date/time block stored as ASCII)
      if (keys[0x08]) {
        const raw = keys[0x08];
        // Often structured as: 2 bytes flags + ASCII date + null + ASCII time
        const fullStr = Buffer.from(raw).toString('ascii').replace(/\0/g, ' ').trim();
        if (fullStr) {
          nextIdentity.firmwareBuildInfo = fullStr;
          changed = true;
        }
      }

      // Device name / model
      if (keys[0x13]) {
        setText('model', keys[0x13]);
        const decoded = Buffer.from(keys[0x13]).toString('ascii').replace(/\0+$/, '').trim();
        if (decoded) {
          const existing = devicesByIdRef.current[deviceId] ?? { id: deviceId };
          devicesByIdRef.current[deviceId] = { ...existing, name: decoded };
          setDevices(Object.values(devicesByIdRef.current));
        }
      }

      // Battery (key 0x14): byte0 = level%, byte1-2 = voltage mV LE
      if (keys[0x14] && keys[0x14].length >= 3) {
        const level = keys[0x14][0];
        const voltage = keys[0x14][1] | (keys[0x14][2] << 8);
        nextIdentity.batteryLevel = level;
        nextIdentity.batteryVoltage = voltage;
        changed = true;
      }

      // Timezone (key 0x0E): signed 8-bit, units of 15 minutes
      if (keys[0x0E] && keys[0x0E].length >= 1) {
        const tz = (keys[0x0E][0] << 24) >> 24; // sign-extend
        nextIdentity.timezone = tz;
        changed = true;
      }

      // SOS / Authorized numbers.
      const phoneBlocks = (blocks ?? []).filter(block => block.key >= 0x30 && block.key <= 0x39);
      if (phoneBlocks.length > 0) {
        const decodedPhones = phoneBlocks
          .map(block => {
          const fallbackSlot = block.key - 0x30;
            return decodeEv07bAuthorizedPhone(block.value, fallbackSlot);
          })
          .filter((decoded): decoded is NonNullable<typeof decoded> => !!decoded)
          .slice(0, 3);

        const [phone1, phone2, phone3] = decodedPhones;

        if (phone1) {
          nextIdentity.sosNumber = phone1.number;
          nextIdentity.sosSlot = phone1.slot;
          changed = true;
        }
        if (phone2) {
          nextIdentity.sosNumber2 = phone2.number;
          nextIdentity.sosSlot2 = phone2.slot;
          changed = true;
        }
        if (phone3) {
          nextIdentity.sosNumber3 = phone3.number;
          nextIdentity.sosSlot3 = phone3.slot;
          changed = true;
        }
      } else if (keys[0x30] && keys[0x30].length >= 1) {
        const decoded = decodeEv07bAuthorizedPhone(keys[0x30], 0);
        if (decoded) {
          nextIdentity.sosNumber = decoded.number;
          nextIdentity.sosSlot = decoded.slot;
          changed = true;
        }
      }

      // APN (key 0x40)
      if (keys[0x40]) setText('apn', keys[0x40], { allowEmpty: true });

      // APN Username (key 0x41)
      if (keys[0x41]) setText('apnUsername', keys[0x41], { allowEmpty: true });

      // APN Password (key 0x42)
      if (keys[0x42]) setText('apnPassword', keys[0x42], { allowEmpty: true });

      // Server address (key 0x43) — flag + port (BE) + host/domain
      if (keys[0x43] && keys[0x43].length > 3) {
        const port = (keys[0x43][1] << 8) | keys[0x43][2];
        const serverStr = Buffer.from(keys[0x43].slice(3)).toString('ascii').replace(/\0+$/, '').trim();
        if (serverStr) {
          nextIdentity.serverAddress = serverStr;
          nextIdentity.serverPort = port;
          changed = true;
        }
      }

      // Reporting intervals (key 0x44) — heartbeat + upload + lazy upload, u32le each
      if (keys[0x44] && keys[0x44].length >= 12) {
        nextIdentity.heartbeatInterval = readUint32Le(keys[0x44], 0) & 0x7fffffff;
        nextIdentity.uploadInterval = readUint32Le(keys[0x44], 4);
        nextIdentity.lazyUploadInterval = readUint32Le(keys[0x44], 8);
        changed = true;
      }

      // Initialize Mileage (key 0x09) — u32le, meters
      if (keys[0x09] && keys[0x09].length >= 4) {
        const mileage = readUint32Le(keys[0x09]);
        nextIdentity.initMileage = mileage;
        changed = true;
      }

      // Working Mode (key 0x0A) — 3-byte interval + 1-byte mode
      if (keys[0x0A] && keys[0x0A].length >= 1) {
        const rawMode = keys[0x0A][keys[0x0A].length >= 4 ? 3 : 0];
        nextIdentity.workingMode = rawMode >= 1 ? rawMode - 1 : rawMode;
        changed = true;
      }

      // Alarm Clock (key 0x0B) — index/enable + hour + minute + workday + duration + ring
      const alarmClock = decodeEv07bAlarmClock(keys[0x0B]);
      if (alarmClock) {
        nextIdentity.alarmClockIndex = alarmClock.index;
        nextIdentity.alarmClockEnabled = alarmClock.enabled;
        nextIdentity.alarmClockHour = alarmClock.hour;
        nextIdentity.alarmClockMinute = alarmClock.minute;
        nextIdentity.alarmClockWorkdayMask = alarmClock.workdayMask;
        nextIdentity.alarmClockDurationSec = alarmClock.durationSec;
        nextIdentity.alarmClockRing = alarmClock.ring;
        changed = true;
      }

      // No Disturb (key 0x0C) — byte0=enable, byte1=startHour, byte2=startMin, byte3=endHour, byte4=endMin
      const noDisturb = decodeEv07bNoDisturb(keys[0x0C]);
      if (noDisturb) {
        nextIdentity.noDisturbEnabled = noDisturb.enabled;
        nextIdentity.noDisturbStart = noDisturb.startHour * 60 + noDisturb.startMinute;
        nextIdentity.noDisturbEnd = noDisturb.endHour * 60 + noDisturb.endMinute;
        changed = true;
      }

      // Enable Control (key 0x0F) — 32-bit bitmask
      const ctrl = decodeEv07bFlagMask(keys[0x0F]);
      if (ctrl !== null) {
        nextIdentity.enableControl = ctrl;
        nextIdentity.bleLocating = hasEv07bFlag(ctrl, 8);
        changed = true;
      }

      // Ring-Tone Volume (key 0x10) — byte 0-100
      if (keys[0x10] && keys[0x10].length >= 1) {
        nextIdentity.ringtoneVolume = keys[0x10][0];
        changed = true;
      }

      // Mic Volume (key 0x11) — byte 0-15
      if (keys[0x11] && keys[0x11].length >= 1) {
        nextIdentity.micVolume = keys[0x11][0];
        changed = true;
      }

      // Speaker Volume (key 0x12) — byte 0-100
      if (keys[0x12] && keys[0x12].length >= 1) {
        nextIdentity.speakerVolume = keys[0x12][0];
        changed = true;
      }

      // Whitelist Device (key 0x16) — flag + 6-byte MAC
      if (keys[0x16] && keys[0x16].length >= 7) {
        const mac = formatMacAddress(keys[0x16].slice(1));
        if (mac) {
          nextIdentity.whitelistDevice = mac;
          changed = true;
        }
      }

      // SMS GPS URL (key 0x17) — ASCII URL
      if (keys[0x17]) setText('smsGpsUrl', keys[0x17], { allowEmpty: true });

      // SMS WiFi/LBS URL (key 0x18) — ASCII URL
      if (keys[0x18]) setText('smsWifiLbsUrl', keys[0x18], { allowEmpty: true });

      // Voice Prompt (key 0x19) — 32-bit bitmask
      const voicePromptMask = decodeEv07bFlagMask(keys[0x19]);
      if (voicePromptMask !== null) {
        nextIdentity.voicePromptMask = voicePromptMask;
        changed = true;
      }

      // GEO Alert (key 0x51) — keep the first enabled fence, or the first decoded one
      const geoAlertBlocks = (blocks ?? []).filter(block => block.key === 0x51);
      const geoAlertCandidates = geoAlertBlocks.length
        ? geoAlertBlocks.map(block => decodeEv07bGeoAlert(block.value)).filter(Boolean)
        : [decodeEv07bGeoAlert(keys[0x51])].filter(Boolean);
      const geoAlert = (geoAlertCandidates.find(candidate => candidate?.enabled) ??
        geoAlertCandidates[0]) ?? null;
      if (geoAlert) {
        nextIdentity.geoAlertIndex = geoAlert.index;
        nextIdentity.geoAlertEnabled = geoAlert.enabled;
        nextIdentity.geoAlertDirection = geoAlert.direction;
        nextIdentity.geoAlertType = geoAlert.type;
        nextIdentity.geoAlertRadiusMeters = geoAlert.radiusMeters;
        nextIdentity.geoAlertPoints = geoAlert.points;
        changed = true;
      }

      // No-Motion Alert (key 0x53)
      const noMotionAlert = decodeEv07bNoMotionAlert(keys[0x53]);
      if (noMotionAlert) {
        nextIdentity.noMotionAlertEnabled = noMotionAlert.enabled;
        nextIdentity.noMotionAlertDial = noMotionAlert.dial;
        nextIdentity.noMotionAlertStaticPeriodSec = noMotionAlert.staticPeriodSec;
        changed = true;
      }

      // Tilt Alert (key 0x55)
      const tiltAlert = decodeEv07bTiltAlert(keys[0x55]);
      if (tiltAlert) {
        nextIdentity.tiltAlertEnabled = tiltAlert.enabled;
        nextIdentity.tiltAlertDial = tiltAlert.dial;
        nextIdentity.tiltAlertAngleDeg = tiltAlert.angleDeg;
        nextIdentity.tiltAlertDurationSec = tiltAlert.durationSec;
        changed = true;
      }

      // Fall-Down Alert (key 0x56)
      const fallDownAlert = decodeEv07bFallDownAlert(keys[0x56]);
      if (fallDownAlert) {
        nextIdentity.fallDownAlertEnabled = fallDownAlert.enabled;
        nextIdentity.fallDownAlertDial = fallDownAlert.dial;
        nextIdentity.fallDownAlertSensitivity = fallDownAlert.sensitivity;
        changed = true;
      }

      if (changed) {
        setDeviceIdentityById(prev => ({
          ...prev,
          [deviceId]: { ...(prev[deviceId] ?? {}), ...nextIdentity },
        }));
      }
    },
    [deviceIdentityById],
  );

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

  const cleanupDeviceState = useCallback((deviceId: string, options?: { preserveIdentity?: boolean }) => {
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

    if (!options?.preserveIdentity) {
      setDeviceIdentityById(prev => {
        const next = { ...prev };
        delete next[deviceId];
        return next;
      });
    }

    delete disconnectBehaviorRef.current[deviceId];
    delete probingDeviceIdsRef.current[deviceId];
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
        shouldResolveAfterScanRef.current = true;

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
        shouldResolveAfterScanRef.current = false;
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
          disconnectBehaviorRef.current[id] = { preserveIdentity: true };
          try {
            if (connectedDeviceRefs.current[id]) {
              await connectedDeviceRefs.current[id].cancelConnection();
            } else {
              await bleManager.cancelDeviceConnection(id);
            }
          } catch {
            // Best-effort disconnect.
          } finally {
            if (disconnectBehaviorRef.current[id]) {
              cleanupDeviceState(id, disconnectBehaviorRef.current[id]);
            }
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
    async (
      deviceId: string,
      options?: {
        silent?: boolean;
        autoStopScan?: boolean;
        trackConnectionState?: boolean;
      },
    ) => {
      const {
        silent = false,
        autoStopScan = true,
        trackConnectionState = true,
      } = options ?? {};

      setScanError(null);
      if (trackConnectionState) {
        setConnectionStates(prev => ({ ...prev, [deviceId]: 'connecting' }));
      }

      try {
        if (autoStopScan) {
          shouldResolveAfterScanRef.current = false;
          await stopScan();
        }

        const hasPermissions = await requestAndroidBlePermissions();
        if (!hasPermissions && Platform.OS === 'android') {
          throw new Error('Bluetooth permissions not granted.');
        }

        const device = await bleManager.connectToDevice(deviceId, { autoConnect: false, timeout: 10000 });
        connectedDeviceRefs.current[deviceId] = device;

        const sub = bleManager.onDeviceDisconnected(deviceId, () => {
          cleanupDeviceState(deviceId, disconnectBehaviorRef.current[deviceId]);
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
                  if (error || !characteristic?.value) return;
          try {
            const chunk = Buffer.from(characteristic.value, 'base64');
            pushLog(deviceId, `RX chunk (${chunk.length}B): ${chunk.toString('hex').slice(0, 40)}...`);

            // --- Frame reassembly ---
            let buf = reassemblyBuf.current[deviceId];

            if (chunk[0] === 0xAB && chunk.length >= 4) {
              // New frame start
              const bodyLen = chunk[2] | (chunk[3] << 8);
              const expectedLen = bodyLen + 8; // header(1)+props(1)+len(2)+crc(2)+seq(2)+body
              buf = { data: Array.from(chunk), expectedLen };
              reassemblyBuf.current[deviceId] = buf;
              pushLog(deviceId, `FRAME START: expecting ${expectedLen}B, got ${chunk.length}B`);
            } else if (buf) {
              // Continuation fragment
              buf.data.push(...chunk);
              pushLog(deviceId, `FRAME CONT: ${buf.data.length}/${buf.expectedLen}B`);
            } else {
              // Orphan chunk — no active reassembly
              console.warn('[BLE NUS RX] orphan chunk, no reassembly in progress');
              pushLog(deviceId, `ORPHAN chunk (${chunk.length}B) — ignored`);
              return;
            }

            // Check if frame is complete
            if (buf.data.length < buf.expectedLen) {
              return; // wait for more chunks
            }

            // Frame complete — parse it
            const fullFrame = Uint8Array.from(buf.data);
            delete reassemblyBuf.current[deviceId];

            const rawHex = Buffer.from(fullFrame).toString('hex');
            console.log(`[BLE NUS RX] assembled frame (${fullFrame.length}B)`);
            pushLog(deviceId, `ASSEMBLED (${fullFrame.length}B)`);

            let parsed = parseEv07bFrame(fullFrame);
            if (!parsed) {
              // try ascii-hex fallback
              const ascii = Buffer.from(fullFrame).toString('ascii').trim();
              if (/^[0-9a-fA-F]+$/.test(ascii) && ascii.length % 2 === 0) {
                const hexBytes = Uint8Array.from(
                  ascii.match(/.{1,2}/g)!.map(h => parseInt(h, 16)),
                );
                parsed = parseEv07bFrame(hexBytes);
              }
            }
            if (parsed) {
              const keyList = Object.keys(parsed.keys).map(k => `0x${Number(k).toString(16)}`).join(',');
              console.log(`[BLE NUS RX] parsed cmd=0x${parsed.command.toString(16)} seq=0x${parsed.seqId.toString(16)} keys=[${keyList}]`);
              pushLog(deviceId, `PARSED cmd=0x${parsed.command.toString(16)} seq=0x${parsed.seqId.toString(16)} keys=[${keyList}]`);
              if (parsed.command === 0x02) {
                applyEv07bKeys(deviceId, parsed.keys, parsed.blocks);
                // Try exact seqId match first, then fall back to wildcard (-1)
                if (pendingEv07b.current[parsed.seqId]) {
                  pendingEv07b.current[parsed.seqId]?.(fullFrame);
                  delete pendingEv07b.current[parsed.seqId];
                } else if (pendingEv07b.current[-1]) {
                  pendingEv07b.current[-1]?.(fullFrame);
                  delete pendingEv07b.current[-1];
                }
              }
              if (parsed.command === 0x7f) {
                pushLog(deviceId, `DEVICE ERROR: ${formatEv07bError(parsed.errorCode)}`);
                if (pendingEv07b.current[parsed.seqId]) {
                  pendingEv07b.current[parsed.seqId]?.(fullFrame);
                  delete pendingEv07b.current[parsed.seqId];
                } else if (pendingEv07b.current[-1]) {
                  pendingEv07b.current[-1]?.(fullFrame);
                  delete pendingEv07b.current[-1];
                }
              }
              if (parsed.command === 0x01) {
                setDataSnapshotById(prev => ({
                  ...prev,
                  [deviceId]: { keys: parsed.keys, receivedAt: Date.now() },
                }));
                // Also populate identity from data packet keys
                applyEv07bKeys(deviceId, parsed.keys, parsed.blocks);
              }
            } else {
              console.warn(`[BLE NUS RX] frame parse FAILED (${fullFrame.length}B) — hex: ${rawHex.slice(0, 80)}...`);
              pushLog(deviceId, `PARSE FAIL (${fullFrame.length}B): ${rawHex.slice(0, 60)}...`);
            }
          } catch (err) {
            console.error('[BLE NUS RX] exception:', err);
            pushLog(deviceId, `RX ERROR: ${err}`);
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

        // Surface the device name as the model if identity has no model yet.
        setDeviceIdentityById(prev => {
          const current = prev[deviceId] ?? {};
          if (current.model) return prev;
          const nameFromScan = devicesByIdRef.current[deviceId]?.name ?? device.name ?? null;
          if (!nameFromScan) return prev;
          return {
            ...prev,
            [deviceId]: { ...current, model: nameFromScan },
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

        if (trackConnectionState) {
          setConnectionStates(prev => ({ ...prev, [deviceId]: 'connected' }));
        }
        return true;
      } catch (e: any) {
        if (!silent) {
          Alert.alert('BLE Connection Failed', e?.message ?? 'Unable to connect to device.');
        }
        if (trackConnectionState) {
          setConnectionStates(prev => ({ ...prev, [deviceId]: 'error' }));
        } else {
          cleanupDeviceState(deviceId);
        }
        return false;
      }
    },
    [applyEv07bKeys, cleanupDeviceState, pushLog, readDeviceInformation, stopScan],
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

  const sendEv07bConfig = useCallback(
    async (
      deviceId: string,
      options: { readKeys?: number[]; writeBlocks?: { key: number; value: Uint8Array }[] },
      timeoutMs: number = 12000,
    ) => {
      const device = connectedDeviceRefs.current[deviceId];
      if (!device) throw new Error('Device not connected');
      const seq = (seqRef.current = (seqRef.current + 1) & 0xffff);
      const frame = buildConfigFrame({ seqId: seq, ...options });

      // Use wildcard key (-1) for write-only frames since the device may
      // respond with seqId=0 or another value instead of echoing ours back.
      const isWriteOnly = !options.readKeys?.length;
      const pendingKey = isWriteOnly ? -1 : seq;
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const clearPendingWait = () => {
        if (settled) return;
        settled = true;
        delete pendingEv07b.current[pendingKey];
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      };

      try {
        const waitForResponse = new Promise<Uint8Array>((resolve, reject) => {
          timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            delete pendingEv07b.current[pendingKey];
            timer = null;
            reject(new Error('Timeout waiting for device response'));
          }, timeoutMs);
          pendingEv07b.current[pendingKey] = resp => {
            if (settled) return;
            settled = true;
            if (timer) {
              clearTimeout(timer);
              timer = null;
            }
            resolve(resp);
          };
        });

        const txHex = Buffer.from(frame).toString('hex');
        console.log(`[BLE NUS TX] frame ${frame.length}B, seq=0x${seq.toString(16)}, isWriteOnly=${isWriteOnly}`);
        pushLog(deviceId, `TX (${frame.length}B): ${txHex.slice(0, 60)}...`);

        // ── Chunk frame into MTU-sized packets ──────────────────────────────
        // BLE characteristics are limited to ~20 bytes per write by default.
        // We split the frame and send each chunk sequentially.
        const chunks: Uint8Array[] = [];
        for (let offset = 0; offset < frame.length; offset += BLE_MTU_PAYLOAD) {
          chunks.push(frame.slice(offset, offset + BLE_MTU_PAYLOAD));
        }
        pushLog(deviceId, `TX chunking into ${chunks.length} packet(s) of ≤${BLE_MTU_PAYLOAD}B`);

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          const chunkB64 = Buffer.from(chunk).toString('base64');
          try {
            await bleManager.writeCharacteristicWithResponseForDevice(
              deviceId,
              NUS_SERVICE_UUID,
              NUS_RX_UUID,
              chunkB64,
            );
          } catch (writeWithRespErr: any) {
            // Fallback to write-without-response
            console.warn(`[BLE NUS TX] chunk ${i} writeWithResponse failed:`, writeWithRespErr?.message);
            try {
              await bleManager.writeCharacteristicWithoutResponseForDevice(
                deviceId,
                NUS_SERVICE_UUID,
                NUS_RX_UUID,
                chunkB64,
              );
            } catch (writeWithoutRespErr: any) {
              pushLog(deviceId, `TX chunk ${i} FAILED: ${writeWithoutRespErr?.message}`);
              // Clean up pending promise and rethrow
              clearPendingWait();
              throw writeWithoutRespErr;
            }
          }
          // Small inter-chunk delay to avoid flooding the device's receive buffer
          if (i < chunks.length - 1) {
            await new Promise<void>(r => setTimeout(r, 20));
          }
        }
        pushLog(deviceId, `TX all ${chunks.length} chunk(s) sent, waiting for ACK...`);

        const respBytes = await waitForResponse;
        const parsed = parseEv07bFrame(respBytes);
        if (!parsed) throw new Error('Invalid response frame');
        if (parsed.command === 0x7f) {
          throw new Error(formatEv07bError(parsed.errorCode));
        }
        if (parsed.command === 0x02) {
          applyEv07bKeys(deviceId, parsed.keys, parsed.blocks);
        }
        return parsed;
      } catch (error) {
        clearPendingWait();
        throw error;
      }
    },
    [applyEv07bKeys, pushLog],
  );

  const probeDiscoveredDevicesForIdentity = useCallback(
    async (deviceIds?: string[]) => {
      const idsToProbe = (deviceIds ?? Object.keys(devicesByIdRef.current)).filter(deviceId => {
        if (probingDeviceIdsRef.current[deviceId]) return false;
        if (connectedDeviceRefs.current[deviceId]) return false;
        return !deviceIdentityById[deviceId]?.imei;
      });

      if (idsToProbe.length === 0) {
        return;
      }

      setIsResolvingScanIdentities(true);

      try {
        for (const deviceId of idsToProbe) {
          probingDeviceIdsRef.current[deviceId] = true;

          const connected = await connectToDevice(deviceId, {
            silent: true,
            autoStopScan: false,
            trackConnectionState: false,
          });

          if (!connected) {
            delete probingDeviceIdsRef.current[deviceId];
            continue;
          }

          try {
            await sendEv07bConfig(deviceId, { readKeys: [0x03] }, 2500);
          } catch {
            // Some nearby devices may not support the EV07B config read flow.
          }

          disconnectBehaviorRef.current[deviceId] = { preserveIdentity: true };
          try {
            if (connectedDeviceRefs.current[deviceId]) {
              await connectedDeviceRefs.current[deviceId].cancelConnection();
            } else {
              await bleManager.cancelDeviceConnection(deviceId);
            }
          } catch {
            // Best-effort disconnect after probing.
          } finally {
            if (disconnectBehaviorRef.current[deviceId]) {
              cleanupDeviceState(deviceId, disconnectBehaviorRef.current[deviceId]);
            }
          }
        }
      } finally {
        setIsResolvingScanIdentities(false);
      }
    },
    [cleanupDeviceState, connectToDevice, deviceIdentityById, sendEv07bConfig],
  );

  useEffect(() => {
    if (isScanning || !shouldResolveAfterScanRef.current) {
      return;
    }

    shouldResolveAfterScanRef.current = false;
    const scannedIds = Object.keys(devicesByIdRef.current);
    if (scannedIds.length === 0) {
      return;
    }

    probeDiscoveredDevicesForIdentity(scannedIds).catch(() => {
      // Best-effort scan enrichment.
    });
  }, [isScanning, probeDiscoveredDevicesForIdentity]);

  useEffect(() => {
    const disconnectedSubs = disconnectedSubRefs.current;
    const notificationSubs = notificationSubsRef.current;
    const connectedDevices = connectedDeviceRefs.current;
    return () => {
      // Cleanup scan timer, subscriptions, etc.
      if (scanTimerRef.current) {
        clearTimeout(scanTimerRef.current);
      }

      Object.keys(disconnectedSubs).forEach(id => {
        try {
          disconnectedSubs[id]?.remove();
        } catch {
          // ignore
        }
      });

      Object.keys(notificationSubs).forEach(id => {
        try {
          notificationSubs[id]?.forEach(sub => sub?.remove?.());
        } catch {
          // ignore
        }
      });

      Object.keys(connectedDevices).forEach(id => {
        try {
          connectedDevices[id]?.cancelConnection();
        } catch {
          // ignore
        }
      });
    };
  }, []);

  return {
    bleState: managerStateString,
    isScanning,
    isResolvingScanIdentities,
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
    dataSnapshotById,
    bleLogById,
    startScan,
    stopScan,
    connectToDevice,
    disconnect,
    writeUtf8ToCharacteristic,
    sendEv07bConfig,
  };
}
