import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { useAuth } from '../context/AuthContext';
import type { V8ConnectionState, V8Device } from './types';
import { requestHandBandPermissions } from './permissions';
import { isV8NativeAvailable, v8Emitter, v8Native } from './nativeV8';
import type {
  V8DailyVitalSummary,
  V8DeviceInfo,
  V8EcgSession,
  V8HistoryBucket,
  V8VitalSample,
  V8WaveformSource,
  V8WebVitalSummary,
  V8WebVitalsSyncPayload,
  V8VitalsUploadPhase,
} from './models';
import { parseV8Payload } from './parser';
import { todayLocalDayKey } from '../utils/vitalsDay';
import { parseMeasurementTimestamp } from '../utils/sampleDay';
import { aggregateVitals, mergeLatestVitals, vitalSampleKey } from './vitals';
import { V8HistoryReader, idleHistoryReadStatus } from './historyReader';
import type { HistoryRequest, V8HistoryReadStatus } from './historyReader';
import { selectTodayVitalSummary } from './todayVitalsRow';
import {
  ECG_RECORDING_DURATION_MS,
  analyzeWaveformHeartRate,
  createV8EcgSession,
  estimateObservedSampleRateHz,
  parseV8EcgPayload,
} from './ecg';
import {
  getAssignedHandBandMacAddress,
  normalizeMacAddress,
  resolveHandBandIdentity,
  resolveConnectedHandBandMac,
} from '../utils/deviceAssignments';
import {
  V8_HAND_BAND_AUTO_SYNC_INTERVAL_MS,
  getV8HandBandSyncEntry,
  recordV8HandBandSynced,
} from '../utils/v8HandBandSyncCache';

type ParsedData = {
  type: 'parsed' | 'raw';
  payload?: Record<string, unknown>;
  payloadHex?: string;
};

type V8BleState =
  | 'PoweredOn'
  | 'PoweredOff'
  | 'Unauthorized'
  | 'Unsupported'
  | 'Resetting'
  | 'Unknown';

export type V8AutoSyncStatus = {
  enabled: boolean;
  phase: 'disabled' | 'waiting' | 'scheduled' | 'syncing' | 'error';
  lastSyncedAt: number | null;
  nextSyncAt: number | null;
  error: string | null;
};

type V8BleContextValue = {
  bleState: V8BleState;
  devices: V8Device[];
  isScanning: boolean;
  scanError: string | null;
  connectionStates: Record<string, V8ConnectionState>;
  activeDeviceId: string | null;
  dataEvents: ParsedData[];
  latestLiveData: V8VitalSample | null;
  historyByType: Record<string, V8HistoryBucket>;
  deviceInfo: V8DeviceInfo;
  liveModeEnabled: boolean;
  ecgSession: V8EcgSession | null;
  autoSyncStatus: V8AutoSyncStatus;
  historyReadStatus: V8HistoryReadStatus;
  openBluetoothSettings: () => Promise<void>;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  connect: (deviceId: string) => Promise<void>;
  disconnect: (deviceId: string) => Promise<void>;
  requestDeviceVersion: () => Promise<void>;
  requestBattery: () => Promise<void>;
  requestDeviceMac: () => Promise<void>;
  ensureDeviceMac: (timeoutMs?: number) => Promise<string | null>;
  requestDeviceName: () => Promise<void>;
  requestDeviceTime: () => Promise<void>;
  syncDeviceTime: () => Promise<void>;
  requestPersonalInfo: () => Promise<void>;
  setRealtimeStepEnabled: (
    enabled: boolean,
    includeTemperature: boolean,
  ) => Promise<void>;
  startEcgMeasurement: (mode?: V8WaveformSource) => Promise<void>;
  finishEcgMeasurement: () => Promise<void>;
  cancelEcgMeasurement: () => Promise<void>;
  resetEcgMeasurement: () => void;
  buildTodayVitals: (bandDay: string) => Promise<V8DailyVitalSummary[]>;
  syncTodayVitalsToBackend: (
    bandDay: string,
    days: V8DailyVitalSummary[],
    onProgress?: (phase: V8VitalsUploadPhase) => void,
  ) => Promise<{ days: number; partial: boolean; missingTypes: string[] }>;
  requestLiveSnapshot: () => Promise<void>;
  clearSavedData: () => Promise<void>;
  clearSavedSession: () => Promise<void>;
  ensureAutoConnect: () => Promise<void>;
};

const V8BleContext = createContext<V8BleContextValue | null>(null);
const V8_SESSION_SERVICE = 'healthsoft.v8.session';
const V8_SESSION_USER = 'v8-session';
const V8_HISTORY_SERVICE = 'healthsoft.v8.history.v2';
const V8_HISTORY_USER = 'v8-history';
const V8_ECG_SERVICE = 'healthsoft.v8.ecg.latest';
const V8_ECG_USER = 'v8-ecg';
const MAX_ECG_SAMPLES = 120_000;
// Retain a full 30-second recording even when the device supplies the
// preferred 500 Hz stream, with headroom for trailing packets, so reopening
// the report cannot shorten its trace.
const MAX_PERSISTED_ECG_SAMPLES = 20_000;
const MIN_ECG_SAMPLE_RATE_HZ = 250;
const LATE_ECG_RESULT_WINDOW_MS = 5_000;
const normalizeId = (id?: string | null) => (id ?? '').trim().toLowerCase();
const normalizeBluetoothState = (value: unknown): V8BleState => {
  switch (value) {
    case 'PoweredOn':
    case 'PoweredOff':
    case 'Unauthorized':
    case 'Unsupported':
    case 'Resetting':
    case 'Unknown':
      return value;
    default:
      return 'Unknown';
  }
};
const isBluetoothAvailabilityError = (message: string | null): boolean => {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('bluetooth is off') ||
    normalized.includes('bluetooth is unsupported') ||
    normalized.includes('bluetooth is resetting') ||
    normalized.includes('bluetooth state is unknown') ||
    normalized.includes('bluetooth is unavailable')
  );
};
const logV8Debug = (label: string, value?: unknown) => {
  if (!__DEV__) return;
  if (value === undefined) {
    console.log(`[V8 Debug] ${label}`);
    return;
  }
  console.log(`[V8 Debug] ${label}`, value);
};

// The band replies to one command at a time; anything written while it is still
// answering is dropped without an error.
const DEVICE_COMMAND_SPACING_MS = 400;
// iOS never exposes a peripheral's MAC through CoreBluetooth, so it has to be
// read back over the vendor protocol. native connect() resolves as soon as the
// connection is *requested*, so an immediate request lands before the write
// characteristic exists and is rejected as NOT_CONNECTED.
const DEVICE_MAC_ATTEMPT_WINDOW_MS = 1500;

const snapshotHistory = (buckets: Record<string, V8HistoryBucket>) =>
  Object.fromEntries(Object.entries(buckets).map(([key, bucket]) => [key, { ...bucket, entries: [...bucket.entries] }]));

const useV8BleManagerInternal = (): V8BleContextValue => {
  const {
    user,
    selectedSenior,
    syncV8VitalsByDevice,
    getAssignedDevicesForSenior,
    refreshHandBandAssignments,
    selectedSeniorHandBandMacs,
  } = useAuth();
  const [bleState, setBleState] = useState<V8BleState>(
    isV8NativeAvailable ? 'Unknown' : 'Unsupported',
  );
  const [devicesById, setDevicesById] = useState<Record<string, V8Device>>({});
  const [connectionStates, setConnectionStates] = useState<
    Record<string, V8ConnectionState>
  >({});
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [dataEvents, setDataEvents] = useState<ParsedData[]>([]);
  const [latestLiveData, setLatestLiveData] = useState<V8VitalSample | null>(
    null,
  );
  const [historyByType, setHistoryByType] = useState<
    Record<string, V8HistoryBucket>
  >({});
  const historyByTypeRef = useRef<Record<string, V8HistoryBucket>>({});
  const historyBuffersRef = useRef<Record<string, V8VitalSample[]>>({});
  const historyIndexRef = useRef<Record<string, Set<string>>>({});
  const historyReaderRef = useRef(new V8HistoryReader());
  const [historyReadStatus, setHistoryReadStatus] = useState(idleHistoryReadStatus);
  const historyReadStatusRef = useRef(idleHistoryReadStatus);
  const historyReadInFlightRef = useRef<{ day: string; promise: Promise<void> } | null>(null);
  const connectionGenerationRef = useRef(0);
  const completedReadRef = useRef<{
    day: string; deviceId: string; generation: number; seniorId: string;
    rows: V8DailyVitalSummary[];
    live: V8VitalSample | null;
    // A read that lost some categories is still uploaded; the metrics it
    // could not collect go up as null rather than holding back the rest.
    partial: boolean;
    missingTypes: string[];
  } | null>(null);
  const connectedDeviceRef = useRef<string | null>(null);
  const devicePrimingRef = useRef<Promise<void> | null>(null);
  const latestLiveDataRef = useRef<V8VitalSample | null>(null);
  const deviceInfoRef = useRef<V8DeviceInfo | null>(null);
  const devicesByIdRef = useRef<Record<string, V8Device>>({});
  const [reportedDeviceInfo, setDeviceInfo] = useState<V8DeviceInfo>({
    imei: null,
    deviceName: null,
    mac: null,
    batteryPercent: null,
    firmwareVersion: null,
    deviceTime: null,
    updatedAt: null,
  });
  const [lastConnectedDeviceId, setLastConnectedDeviceId] = useState<
    string | null
  >(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [verifiedConnection, setVerifiedConnection] = useState<{
    id: string;
    mac: string;
  } | null>(null);
  const [lastConnectedDevice, setLastConnectedDevice] =
    useState<V8Device | null>(null);
  const deviceInfo = useMemo(
    () => ({
      ...reportedDeviceInfo,
      // Never treat a cached identity as belonging to a new connection.
      mac: activeDeviceId
        ? resolveHandBandIdentity(
            devicesById[normalizeId(activeDeviceId)] ?? { id: activeDeviceId },
            selectedSeniorHandBandMacs,
            reportedDeviceInfo.mac ??
              (verifiedConnection?.id === activeDeviceId
                ? verifiedConnection.mac
                : null),
          )
        : null,
    }),
    [
      activeDeviceId,
      devicesById,
      reportedDeviceInfo,
      selectedSeniorHandBandMacs,
      verifiedConnection,
    ],
  );
  const connectionAttemptRef = useRef(false);
  const pendingConnectionRef = useRef<{
    id: string;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const [suppressAutoConnectUntil, setSuppressAutoConnectUntil] =
    useState<number>(0);
  const [liveModeEnabled, setLiveModeEnabled] = useState(false);
  const [ecgSession, setEcgSession] = useState<V8EcgSession | null>(null);
  const ecgSessionRef = useRef<V8EcgSession | null>(null);
  const [autoSyncStatus, setAutoSyncStatus] = useState<V8AutoSyncStatus>({
    enabled: false,
    phase: 'disabled',
    lastSyncedAt: null,
    nextSyncAt: null,
    error: null,
  });
  const ecgSeniorId = useMemo(() => {
    if (user?.role === 'SENIOR') {
      return user.user_id?.trim() ?? '';
    }
    if (user?.role === 'CARE_TAKER' || user?.role === 'GUARDIAN') {
      return selectedSenior?.userId?.trim() ?? '';
    }
    return '';
  }, [selectedSenior?.userId, user?.role, user?.user_id]);
  const syncContextRef = useRef({ seniorId: ecgSeniorId, role: user?.role, macs: selectedSeniorHandBandMacs });
  syncContextRef.current = { seniorId: ecgSeniorId, role: user?.role, macs: selectedSeniorHandBandMacs };
  const scanStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const automaticSyncInFlightRef = useRef(false);
  const automaticSyncCacheKeyRef = useRef<string | null>(null);
  const lastVitalsSyncedAtRef = useRef<number | null>(null);
  const nextAutomaticSyncAttemptAtRef = useRef<number>(0);
  const ecgCompletionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const ecgCleanupSessionIdRef = useRef<string | null>(null);

  const refreshBluetoothState = useCallback(async (): Promise<V8BleState> => {
    const settleBluetoothOffUi = (state: V8BleState) => {
      if (state === 'PoweredOn') return;
      if (scanStopTimerRef.current) {
        clearTimeout(scanStopTimerRef.current);
        scanStopTimerRef.current = null;
      }
      setIsScanning(false);
      setActiveDeviceId(null);
      setLiveModeEnabled(false);
      setConnectionStates(prev => {
        let changed = false;
        const next = Object.fromEntries(
          Object.entries(prev).map(([deviceId, currentState]) => {
            if (
              currentState === 'connected' ||
              currentState === 'connecting' ||
              currentState === 'disconnecting'
            ) {
              changed = true;
              return [deviceId, 'disconnected' as V8ConnectionState];
            }
            return [deviceId, currentState];
          }),
        );
        return changed ? next : prev;
      });
    };

    if (!v8Native?.getBluetoothState) {
      setBleState('Unsupported');
      settleBluetoothOffUi('Unsupported');
      return 'Unsupported';
    }
    try {
      const state = normalizeBluetoothState(await v8Native.getBluetoothState());
      setBleState(prev => (prev === state ? prev : state));
      settleBluetoothOffUi(state);
      return state;
    } catch {
      setBleState(prev => (prev === 'Unknown' ? prev : 'Unknown'));
      settleBluetoothOffUi('Unknown');
      return 'Unknown';
    }
  }, []);

  const openBluetoothSettings = useCallback(async () => {
    if (!v8Native?.openBluetoothSettings) {
      throw new Error('Bluetooth settings are unavailable on this platform.');
    }
    await v8Native.openBluetoothSettings();
    await refreshBluetoothState();
  }, [refreshBluetoothState]);

  useEffect(
    () => () => {
      const pending = pendingConnectionRef.current;
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Hand band manager closed.'));
        pendingConnectionRef.current = null;
      }
      if (scanStopTimerRef.current) {
        clearTimeout(scanStopTimerRef.current);
        scanStopTimerRef.current = null;
      }
      if (ecgCompletionTimerRef.current) {
        clearTimeout(ecgCompletionTimerRef.current);
        ecgCompletionTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    let appIsActive = AppState.currentState === 'active';
    const checkBluetoothState = () => {
      if (active && appIsActive) {
        refreshBluetoothState().catch(() => {});
      }
    };

    checkBluetoothState();
    const interval = setInterval(checkBluetoothState, 3_000);
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        appIsActive = nextState === 'active';
        if (appIsActive) {
          checkBluetoothState();
        }
      },
    );

    return () => {
      active = false;
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, [refreshBluetoothState]);

  useEffect(() => {
    deviceInfoRef.current = deviceInfo;
  }, [deviceInfo]);

  useEffect(() => {
    devicesByIdRef.current = devicesById;
  }, [devicesById]);

  useEffect(() => {
    if (bleState !== 'PoweredOn') return;
    setScanError(prev => (isBluetoothAvailabilityError(prev) ? null : prev));
  }, [bleState]);

  useEffect(() => {
    ecgSessionRef.current = ecgSession;
  }, [ecgSession]);

  useEffect(() => {
    if (!ecgSeniorId) {
      setEcgSession(null);
      return;
    }
    let active = true;
    Keychain.getGenericPassword({ service: V8_ECG_SERVICE })
      .then(value => {
        if (!active || !value) return;
        try {
          const parsed = JSON.parse(value.password) as V8EcgSession;
          if (
            parsed?.id &&
            parsed.seniorId === ecgSeniorId &&
            parsed.phase === 'completed' &&
            Array.isArray(parsed.samples)
          ) {
            setEcgSession({
              ...parsed,
              requestedMode: parsed.requestedMode ?? 'ecg',
              waveformField: parsed.waveformField ?? null,
              waveformDataType: parsed.waveformDataType ?? null,
              sampleRateSource: parsed.sampleRateSource ?? null,
              heartRateSource:
                parsed.heartRateSource ??
                (parsed.heartRate != null ? 'device' : null),
              heartRateConfidence: parsed.heartRateConfidence ?? null,
            });
          }
        } catch {
          // Ignore an unreadable previous preview.
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [ecgSeniorId]);

  useEffect(() => {
    if (
      !ecgSeniorId ||
      ecgSession?.seniorId !== ecgSeniorId ||
      ecgSession.phase !== 'completed'
    )
      return;
    const persisted: V8EcgSession = {
      ...ecgSession,
      samples: ecgSession.samples.slice(-MAX_PERSISTED_ECG_SAMPLES),
    };
    Keychain.setGenericPassword(V8_ECG_USER, JSON.stringify(persisted), {
      service: V8_ECG_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }).catch(() => {});
  }, [ecgSeniorId, ecgSession]);

  useEffect(() => {
    if (
      !ecgSession ||
      !['completed', 'failed'].includes(ecgSession.phase) ||
      ecgCleanupSessionIdRef.current === ecgSession.id ||
      Date.now() - ecgSession.startedAt > 10 * 60 * 1000
    ) {
      return;
    }
    ecgCleanupSessionIdRef.current = ecgSession.id;
    if (ecgSession.requestedMode === 'ppg') {
      v8Native?.stopPpgMeasurement().catch(() => {});
      v8Native?.exitPpgMeasurement().catch(() => {});
    } else {
      v8Native?.stopEcgMeasurement().catch(() => {});
      v8Native?.exitEcgMeasurement().catch(() => {});
    }
  }, [ecgSession]);

  useEffect(() => {
    let active = true;
    Keychain.getGenericPassword({ service: V8_SESSION_SERVICE })
      .then(value => {
        if (!active || !value) return;
        try {
          const parsed = JSON.parse(value.password) as {
            lastConnectedDeviceId?: string;
            device?: V8Device;
          };
          if (parsed.device?.id === parsed.lastConnectedDeviceId) setLastConnectedDevice(parsed.device ?? null);
          if (parsed.lastConnectedDeviceId)
            setLastConnectedDeviceId(parsed.lastConnectedDeviceId);
        } catch {
          // ignore
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    Keychain.getGenericPassword({ service: V8_HISTORY_SERVICE })
      .then(value => {
        if (!active || !value || connectedDeviceRef.current) return;
        try {
          const parsed = JSON.parse(value.password) as {
            historyByType?: Record<string, V8HistoryBucket>;
            latestLiveData?: V8VitalSample | null;
            deviceInfo?: V8DeviceInfo;
          };
          if (
            parsed.historyByType &&
            typeof parsed.historyByType === 'object'
          ) {
            historyByTypeRef.current = parsed.historyByType;
            setHistoryByType(parsed.historyByType);
          }
          if (parsed.latestLiveData) {
            latestLiveDataRef.current = parsed.latestLiveData;
            setLatestLiveData(parsed.latestLiveData);
          }
          if (parsed.deviceInfo && typeof parsed.deviceInfo === 'object') {
            setDeviceInfo(prev => ({ ...prev, ...parsed.deviceInfo, mac: null }));
          }
        } catch {
          // ignore invalid cache
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!v8Emitter) return;
    const historyReader = historyReaderRef.current;

    const scanSub = v8Emitter.addListener('V8ScanResult', evt => {
      logV8Debug('Scan result received', {
        receivedAt: new Date().toISOString(),
        event: evt,
      });
      const id = evt?.id as string | undefined;
      if (!id) return;
      const normalizedId = normalizeId(id);
      setDevicesById(prev => ({
        ...prev,
        [normalizedId]: {
          id,
          name: (evt?.name as string | undefined) ?? null,
          localName: (evt?.localName as string | undefined) ?? null,
          rssi: typeof evt?.rssi === 'number' ? evt.rssi : null,
          manufacturerData: null,
          isConnectable: null,
        },
      }));
    });

    const stateSub = v8Emitter.addListener('V8ConnectionState', evt => {
      logV8Debug('Connection state received', {
        receivedAt: new Date().toISOString(),
        event: evt,
      });
      const rawDeviceId = (evt?.deviceId as string | undefined) ?? 'default';
      const normalizedDeviceId = normalizeId(rawDeviceId || 'default');
      const state =
        (evt?.state as V8ConnectionState | undefined) ?? 'disconnected';
      setConnectionStates(prev => ({ ...prev, [normalizedDeviceId]: state }));
      if (state === 'connected') {
        if (connectedDeviceRef.current !== normalizedDeviceId) {
          connectionGenerationRef.current += 1;
          completedReadRef.current = null;
          historyReaderRef.current.cancel('The connected hand band changed during the read.');
          historyIndexRef.current = {};
          historyBuffersRef.current = {};
          historyByTypeRef.current = {};
          latestLiveDataRef.current = null;
          setHistoryByType({});
          setLatestLiveData(null);
          historyReadStatusRef.current = idleHistoryReadStatus;
          setHistoryReadStatus(idleHistoryReadStatus);
        }
        connectedDeviceRef.current = normalizedDeviceId;
        setActiveDeviceId(normalizedDeviceId);
      } else if (state === 'disconnected' || state === 'error') {
        connectionGenerationRef.current += 1;
        completedReadRef.current = null;
        connectedDeviceRef.current = null;
        const gattStatus = typeof evt?.gattStatus === 'number' && evt.gattStatus !== 0 ? ` (Bluetooth status ${evt.gattStatus})` : '';
        historyReaderRef.current.cancel(state === 'disconnected'
          ? `The hand band disconnected during the read${gattStatus}.`
          : `The hand band reported a Bluetooth connection error${gattStatus}.`);
        latestLiveDataRef.current = null;
        setLatestLiveData(null);
        setActiveDeviceId(prev => (prev === normalizedDeviceId ? null : prev));
        setLiveModeEnabled(false);
        setEcgSession(prev => {
          if (
            !prev ||
            !['starting', 'measuring', 'processing'].includes(prev.phase)
          )
            return prev;
          const now = Date.now();
          const modeLabel = prev.requestedMode === 'ppg' ? 'PPG' : 'ECG';
          return {
            ...prev,
            phase: 'failed',
            completedAt: now,
            durationMs: now - prev.startedAt,
            error: `The hand band disconnected during the ${modeLabel} measurement.`,
            statusMessage: 'Hand band disconnected',
          };
        });
      }
      if (state === 'connected' && rawDeviceId && rawDeviceId !== 'default') {
        // Prime visible device info after successful connection. The band
        // answers one command at a time and silently drops anything that
        // arrives while it is still replying, so these must be spaced out
        // rather than fired as a burst - the MAC used to be lost this way.
        const primeDeviceInfo = async () => {
          const native = v8Native;
          if (!native) return;
          const primers: Array<() => Promise<unknown>> = [
            () => native.requestDeviceMac(),
            () => native.requestBattery(),
            () => native.requestDeviceVersion(),
            // Android answers with dicData.deviceName; the iOS vendor build
            // does not expose GetDeviceName and rejects, which is ignored here.
            () => native.requestDeviceName(),
            () => native.requestDeviceTime(),
            () => native.requestPersonalInfo(),
          ];
          for (const primer of primers) {
            await primer().catch(() => {});
            await new Promise<void>(resolve =>
              setTimeout(resolve, DEVICE_COMMAND_SPACING_MS),
            );
          }
        };
        devicePrimingRef.current = primeDeviceInfo().catch(() => {});
      }
    });

    let renderTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingEvents: ParsedData[] = [];
    const scheduleVitalsRender = () => {
      if (renderTimer) return;
      renderTimer = setTimeout(() => {
        renderTimer = null;
        setHistoryByType(snapshotHistory(historyByTypeRef.current));
        setLatestLiveData(latestLiveDataRef.current);
        if (pendingEvents.length) setDataEvents(prev => [...pendingEvents, ...prev].slice(0, 50));
        pendingEvents = [];
      }, 100);
    };
    const dataSub = v8Emitter.addListener('V8Data', evt => {
      const event = evt as ParsedData;
      logV8Debug('Data packet received', {
        receivedAt: new Date().toISOString(),
        event,
      });
      pendingEvents = [event, ...pendingEvents].slice(0, 50);
      scheduleVitalsRender();
      if (event.type !== 'parsed' || !event.payload) return;
      setEcgSession(prev => {
        if (!prev) return prev;
        const ecgPlatform =
          Platform.OS === 'ios'
            ? 'ios'
            : Platform.OS === 'android'
            ? 'android'
            : undefined;
        const requestedMode = prev.requestedMode ?? 'ecg';
        const requestedLabel = requestedMode === 'ecg' ? 'ECG' : 'PPG';
        const otherLabel = requestedMode === 'ecg' ? 'PPG' : 'ECG';
        const ecgEvent = parseV8EcgPayload(
          event.payload!,
          ecgPlatform,
          requestedMode,
        );
        if (ecgEvent.kind === 'unknown') return prev;
        const now = Date.now();
        const activeEcgPhase = ['starting', 'measuring', 'processing'].includes(
          prev.phase,
        );
        const acceptsLateDeviceResult =
          prev.phase === 'completed' &&
          prev.completedAt != null &&
          now - prev.completedAt <= LATE_ECG_RESULT_WINDOW_MS &&
          ecgEvent.heartRateSource === 'device' &&
          ecgEvent.heartRate != null;
        if (!activeEcgPhase && !acceptsLateDeviceResult) return prev;
        if (acceptsLateDeviceResult) {
          return {
            ...prev,
            heartRate: ecgEvent.heartRate,
            heartRateSource: 'device',
            heartRateConfidence: null,
            signalQuality: ecgEvent.signalQuality ?? prev.signalQuality,
          };
        }
        const sourceMismatch =
          ecgEvent.waveformSource != null &&
          ecgEvent.waveformSource !== requestedMode;
        const incomingSamples = sourceMismatch ? [] : ecgEvent.samples;
        const combinedSamples =
          incomingSamples.length > 0
            ? [...prev.samples, ...incomingSamples].slice(-MAX_ECG_SAMPLES)
            : prev.samples;
        const firstSampleAt =
          incomingSamples.length > 0
            ? prev.firstSampleAt ?? now
            : prev.firstSampleAt;
        const firstSampleCount =
          incomingSamples.length > 0 && prev.firstSampleAt == null
            ? combinedSamples.length
            : prev.firstSampleCount;
        const lastSampleAt =
          incomingSamples.length > 0 ? now : prev.lastSampleAt;
        const observedSampleRate = estimateObservedSampleRateHz(
          combinedSamples.length,
          firstSampleCount,
          firstSampleAt,
          lastSampleAt,
        );
        logV8Debug('ECG packet parsed', {
          sessionId: prev.id,
          requestedMode,
          packet: ecgEvent,
          sourceMismatch,
          packetSampleCount: incomingSamples.length,
          totalSampleCount: combinedSamples.length,
          observedSampleRateHz: observedSampleRate,
          firstSampleAt,
          lastSampleAt,
        });
        const completed = ecgEvent.kind === 'completed';
        const failed = ecgEvent.kind === 'failed';
        const acceptedWaveform = incomingSamples.length > 0;
        const waveformSource = acceptedWaveform
          ? ecgEvent.waveformSource
          : prev.waveformSource;
        const incomingSampleRateHz = sourceMismatch
          ? null
          : ecgEvent.sampleRateHz;
        const incomingSampleRateSource = sourceMismatch
          ? null
          : ecgEvent.sampleRateSource;
        const nextSampleRate =
          incomingSampleRateSource === 'device' && incomingSampleRateHz != null
            ? { value: incomingSampleRateHz, source: 'device' as const }
            : prev.sampleRateSource === 'device' && prev.sampleRateHz != null
            ? { value: prev.sampleRateHz, source: 'device' as const }
            : incomingSampleRateSource === 'protocol' &&
              incomingSampleRateHz != null
            ? {
                value: incomingSampleRateHz,
                source: 'protocol' as const,
              }
            : prev.sampleRateSource === 'protocol' && prev.sampleRateHz != null
            ? { value: prev.sampleRateHz, source: 'protocol' as const }
            : observedSampleRate != null
            ? { value: observedSampleRate, source: 'observed' as const }
            : {
                value: prev.sampleRateHz,
                source: prev.sampleRateSource,
              };
        const nextSampleRateHz = nextSampleRate.value;
        const waveformAnalysis =
          completed &&
          ecgEvent.heartRate == null &&
          prev.heartRate == null &&
          combinedSamples.length > 0
            ? analyzeWaveformHeartRate(
                combinedSamples,
                nextSampleRateHz,
                waveformSource ?? requestedMode,
              )
            : null;
        const nextHeartRate =
          ecgEvent.heartRate ??
          prev.heartRate ??
          waveformAnalysis?.heartRate ??
          null;
        const nextHeartRateSource =
          ecgEvent.heartRate != null
            ? 'device'
            : prev.heartRate != null
            ? prev.heartRateSource
            : waveformAnalysis?.heartRate != null
            ? 'waveform'
            : null;
        const nextPhase = completed
          ? 'completed'
          : failed
          ? 'failed'
          : prev.phase === 'processing'
          ? 'processing'
          : ecgEvent.kind === 'stopped'
          ? 'processing'
          : ecgEvent.kind === 'started' || ecgEvent.kind === 'samples'
          ? 'measuring'
          : prev.phase;
        const defaultStatus = completed
          ? combinedSamples.length === 0
            ? `No ${requestedLabel} waveform was received.`
            : nextHeartRate == null && waveformAnalysis?.quality === 'poor'
            ? `${requestedLabel} recording completed; heart rate unavailable because signal quality was insufficient.`
            : waveformSource === 'ecg' &&
              nextSampleRateHz != null &&
              nextSampleRateHz < MIN_ECG_SAMPLE_RATE_HZ
            ? 'Recording completed with insufficient ECG sample frequency.'
            : `${requestedLabel} recording completed`
          : failed
          ? `${requestedLabel} measurement failed`
          : ecgEvent.kind === 'samples'
          ? sourceMismatch
            ? `Ignoring ${otherLabel} data — waiting for ${requestedLabel} waveform…`
            : `Receiving ${requestedLabel} waveform…`
          : prev.statusMessage;
        return {
          ...prev,
          phase: nextPhase,
          completedAt: completed || failed ? now : prev.completedAt,
          durationMs:
            completed || failed
              ? requestedMode === 'ecg'
                ? Math.min(ECG_RECORDING_DURATION_MS, now - prev.startedAt)
                : now - prev.startedAt
              : prev.durationMs,
          samples: combinedSamples,
          waveformSource,
          waveformField: acceptedWaveform
            ? ecgEvent.waveformField
            : prev.waveformField,
          waveformDataType: acceptedWaveform
            ? ecgEvent.dataType
            : prev.waveformDataType,
          sampleRateHz: nextSampleRateHz,
          sampleRateSource: nextSampleRate.source,
          firstSampleAt,
          firstSampleCount,
          lastSampleAt,
          heartRate: nextHeartRate,
          heartRateSource: nextHeartRateSource,
          heartRateConfidence:
            nextHeartRateSource === 'waveform'
              ? waveformAnalysis?.confidence ?? prev.heartRateConfidence
              : null,
          signalQuality:
            ecgEvent.signalQuality ??
            prev.signalQuality ??
            waveformAnalysis?.quality ??
            null,
          classification: ecgEvent.classification ?? prev.classification,
          statusMessage: ecgEvent.statusMessage ?? defaultStatus,
          error: failed
            ? ecgEvent.statusMessage ??
              `The hand band could not complete this ${requestedLabel}.`
            : prev.error,
        };
      });
      const dataPlatform =
        Platform.OS === 'ios'
          ? 'ios'
          : Platform.OS === 'android'
          ? 'android'
          : undefined;
      // One malformed packet must not tear down the listener and stall the
      // categories still queued behind it.
      let parsed: ReturnType<typeof parseV8Payload>;
      try {
        parsed = parseV8Payload(event.payload, dataPlatform);
      } catch (error) {
        logV8Debug('Data packet could not be parsed', { error: String(error) });
        return;
      }
      const { history, infoPatch } = parsed;

      const infoValues = Object.fromEntries(Object.entries(infoPatch).filter(
        ([key, value]) => key !== 'updatedAt' && value != null,
      ));
      if (Object.keys(infoValues).length) {
        setDeviceInfo(prev => ({ ...prev, ...infoValues, updatedAt: Date.now() }));
      }

      if (history && connectedDeviceRef.current) {
        if (history.source === 'live') {
          for (const entry of history.entries) {
            latestLiveDataRef.current = mergeLatestVitals(latestLiveDataRef.current, entry);
          }
        }
        const key = history.source === 'live' ? `${history.dataType}:live` : history.dataType!;
        const existing = historyByTypeRef.current[key];
        const seen = historyIndexRef.current[key] ?? new Set((existing?.entries ?? []).map(vitalSampleKey));
        historyIndexRef.current[key] = seen;
        const entries = historyBuffersRef.current[key] ?? [...(existing?.entries ?? [])];
        historyBuffersRef.current[key] = entries;
        for (const entry of history.entries) {
          const marker = vitalSampleKey(entry);
          if (!seen.has(marker)) { seen.add(marker); entries.push(entry); }
        }
        const nextBucket: V8HistoryBucket = { ...history, entries };
        historyByTypeRef.current = { ...historyByTypeRef.current, [key]: nextBucket };
        scheduleVitalsRender();
        historyReaderRef.current.accept(history);
      }
    });

    return () => {
      scanSub.remove();
      stateSub.remove();
      dataSub.remove();
      if (renderTimer) clearTimeout(renderTimer);
      historyReader.cancel('The hand band manager closed during the read.');
    };
  }, []);

  const startScan = useCallback(async () => {
    const native = v8Native;
    if (!native) {
      setScanError('Vendor V8 native module is unavailable on this platform.');
      return;
    }
    if (scanStopTimerRef.current) {
      clearTimeout(scanStopTimerRef.current);
      scanStopTimerRef.current = null;
    }
    try {
      await requestHandBandPermissions();
      const currentBluetoothState = await refreshBluetoothState();
      if (currentBluetoothState !== 'PoweredOn') {
        setScanError(
          currentBluetoothState === 'Unauthorized'
            ? 'Bluetooth permission is not granted.'
            : currentBluetoothState === 'Unsupported'
              ? 'Bluetooth is unsupported on this device.'
              : currentBluetoothState === 'Resetting'
                ? 'Bluetooth is resetting. Try again in a moment.'
                : 'Bluetooth is off.',
        );
        return;
      }
      await refreshHandBandAssignments();
      logV8Debug('Starting scan', {
        filters: ['v8', 'jstyle', 'band'],
        startedAt: new Date().toISOString(),
      });
      setScanError(null);
      setIsScanning(true);
      await native.startScan(['v8', 'jstyle', 'band']);
      scanStopTimerRef.current = setTimeout(() => {
        logV8Debug('Stopping scan after timeout');
        native.stopScan().catch(() => {});
        setIsScanning(false);
        scanStopTimerRef.current = null;
      }, 12000);
    } catch (error) {
      logV8Debug('Scan failed', error);
      await refreshBluetoothState();
      setIsScanning(false);
      setScanError(
        error instanceof Error
          ? error.message
          : 'Failed to scan for V8 devices.',
      );
    }
  }, [refreshBluetoothState, refreshHandBandAssignments]);

  const stopScan = useCallback(async () => {
    logV8Debug('Stopping scan manually');
    if (scanStopTimerRef.current) {
      clearTimeout(scanStopTimerRef.current);
      scanStopTimerRef.current = null;
    }
    if (!v8Native) {
      setIsScanning(false);
      return;
    }
    await v8Native.stopScan().catch(() => {});
    setIsScanning(false);
  }, []);

  const connect = useCallback(
    async (deviceId: string) => {
      if (!v8Native) return;
      const normalizedTargetId = normalizeId(deviceId);
      const assignedMacs = new Set(
        selectedSeniorHandBandMacs
          .map(value => normalizeMacAddress(value))
          .filter((value): value is string => !!value),
      );
      if (connectionAttemptRef.current)
        throw new Error('A hand band connection is already in progress.');
      if (assignedMacs.size === 0) {
        throw new Error(
          'No Hand Band MAC address is assigned to the selected senior.',
        );
      }
      const candidateMac = resolveHandBandIdentity(
        devicesByIdRef.current[normalizedTargetId] ?? { id: deviceId },
        selectedSeniorHandBandMacs,
      );
      if (candidateMac && !assignedMacs.has(candidateMac)) {
        throw new Error(
          'This hand band is not assigned to the selected senior.',
        );
      }
      connectionAttemptRef.current = true;
      try {
        await requestHandBandPermissions();
        if (scanStopTimerRef.current) {
          clearTimeout(scanStopTimerRef.current);
          scanStopTimerRef.current = null;
        }
        await v8Native.stopScan().catch(() => {});
        setIsScanning(false);
        const currentlyActive = activeDeviceId
          ? normalizeId(activeDeviceId)
          : null;
        if (currentlyActive && currentlyActive !== normalizedTargetId) {
          try {
            await v8Native.disconnect();
          } catch {
            // best effort
          }
          setConnectionStates(prev => ({
            ...prev,
            [currentlyActive]: 'disconnected',
          }));
          setActiveDeviceId(null);
        }
        setVerifiedConnection(null);
        setConnectionStates(prev => ({
          ...prev,
          [normalizedTargetId]: 'connecting',
        }));
        // Never carry a previously connected band's identity into verification
        // of a newly selected scan result.
        setDeviceInfo({
          imei: null,
          deviceName: null,
          mac: null,
          batteryPercent: null,
          firmwareVersion: null,
          deviceTime: null,
          updatedAt: null,
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              pendingConnectionRef.current = null;
              v8Native?.disconnect().catch(() => {});
              reject(
                new Error(
                  'Could not connect and identify your assigned hand band. Keep it nearby and disconnect it from other phones, then scan again.',
                ),
              );
            }, 20000);
            pendingConnectionRef.current = {
              id: normalizedTargetId,
              resolve,
              reject,
              timer,
            };
            v8Native!.connect(deviceId).catch(error => {
              clearTimeout(timer);
              pendingConnectionRef.current = null;
              reject(error);
            });
          });
        } catch (error) {
          await v8Native.disconnect().catch(() => {});
          setActiveDeviceId(current =>
            current === normalizedTargetId ? null : current,
          );
          setScanError(
            error instanceof Error
              ? error.message
              : 'Hand band connection failed.',
          );
          await refreshBluetoothState();
          setConnectionStates(prev => ({
            ...prev,
            [normalizedTargetId]: 'error',
          }));
          throw error;
        }
      } finally {
        connectionAttemptRef.current = false;
      }
    },
    [activeDeviceId, refreshBluetoothState, selectedSeniorHandBandMacs],
  );

  const disconnect = useCallback(
    async (deviceId: string) => {
      if (!v8Native) return;
      const normalizedTargetId = normalizeId(deviceId);
      setSuppressAutoConnectUntil(Date.now() + 60_000);
      setLastConnectedDeviceId(null);
      setLastConnectedDevice(null);
      Keychain.resetGenericPassword({ service: V8_SESSION_SERVICE }).catch(
        () => {},
      );
      setConnectionStates(prev => ({
        ...prev,
        [normalizedTargetId]: 'disconnecting',
      }));
      try {
        await v8Native.disconnect();
      } finally {
        setConnectionStates(prev => ({
          ...prev,
          [normalizedTargetId]: 'disconnected',
        }));
        if (activeDeviceId === normalizedTargetId) {
          setActiveDeviceId(null);
        }
      }
    },
    [activeDeviceId],
  );

  useEffect(() => {
    const pending = pendingConnectionRef.current;
    if (!pending) return;
    const state = connectionStates[pending.id];
    const mac = activeDeviceId === pending.id ? deviceInfo.mac : null;
    const assigned = !!mac && selectedSeniorHandBandMacs.includes(mac);
    if (state === 'connected' && assigned) {
      clearTimeout(pending.timer);
      pendingConnectionRef.current = null;
      pending.resolve();
    } else if (
      state === 'error' ||
      state === 'disconnected' ||
      (state === 'connected' && mac && !assigned)
    ) {
      clearTimeout(pending.timer);
      pendingConnectionRef.current = null;
      pending.reject(
        new Error(
          mac && !assigned
            ? 'This hand band is not assigned to the selected senior.'
            : 'The hand band connection failed. Keep it nearby and try again.',
        ),
      );
    }
  }, [
    activeDeviceId,
    connectionStates,
    deviceInfo.mac,
    selectedSeniorHandBandMacs,
  ]);

  useEffect(() => {
    if (
      !activeDeviceId ||
      connectionStates[activeDeviceId] !== 'connected' ||
      !deviceInfo.mac ||
      !selectedSeniorHandBandMacs.includes(deviceInfo.mac)
    )
      return;
    const device = devicesById[activeDeviceId];
    if (!device) return;
    const mac = deviceInfo.mac;
    setVerifiedConnection(prev =>
      prev?.id === activeDeviceId && prev.mac === mac
        ? prev
        : { id: activeDeviceId, mac },
    );
    setLastConnectedDeviceId(device.id);
    setLastConnectedDevice(device);
    Keychain.setGenericPassword(
      V8_SESSION_USER,
      JSON.stringify({ lastConnectedDeviceId: device.id, device }),
      {
        service: V8_SESSION_SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    ).catch(() => {});
  }, [
    activeDeviceId,
    connectionStates,
    deviceInfo.mac,
    devicesById,
    selectedSeniorHandBandMacs,
  ]);

  useEffect(() => {
    if (!activeDeviceId || connectionStates[activeDeviceId] !== 'connected')
      return;
    const connectedMac = resolveConnectedHandBandMac(
      deviceInfo.mac,
      activeDeviceId,
    );
    if (!connectedMac && selectedSeniorHandBandMacs.length > 0) {
      const timer = setTimeout(() => {
        setScanError(
          'Unable to verify that this hand band belongs to the selected senior. Please scan again.',
        );
        v8Native?.disconnect().catch(() => {});
      }, 10000);
      return () => clearTimeout(timer);
    }

    const assignedMacs = new Set(
      selectedSeniorHandBandMacs
        .map(value => normalizeMacAddress(value))
        .filter((value): value is string => !!value),
    );
    if (connectedMac && assignedMacs.has(connectedMac)) {
      setScanError(null);
      return;
    }

    setScanError(
      'Connected Hand Band MAC is not assigned to the selected senior. It was disconnected.',
    );
    setConnectionStates(prev => ({
      ...prev,
      [activeDeviceId]: 'disconnecting',
    }));
    setLastConnectedDeviceId(null);
    setLastConnectedDevice(null);
    Keychain.resetGenericPassword({ service: V8_SESSION_SERVICE }).catch(
      () => {},
    );
    v8Native
      ?.disconnect()
      .catch(() => {})
      .finally(() => {
        setConnectionStates(prev => ({
          ...prev,
          [activeDeviceId]: 'disconnected',
        }));
        setActiveDeviceId(current =>
          current === activeDeviceId ? null : current,
        );
        setDeviceInfo(prev => ({ ...prev, mac: null, updatedAt: Date.now() }));
      });
  }, [
    activeDeviceId,
    connectionStates,
    deviceInfo.mac,
    selectedSeniorHandBandMacs,
  ]);

  const requestDeviceVersion = useCallback(async () => {
    await historyReadInFlightRef.current?.promise.catch(() => {});
    if (!v8Native) return;
    await v8Native.requestDeviceVersion();
  }, []);
  const requestBattery = useCallback(async () => {
    await historyReadInFlightRef.current?.promise.catch(() => {});
    if (!v8Native) return;
    await v8Native.requestBattery();
  }, []);
  const requestDeviceMac = useCallback(async () => {
    await historyReadInFlightRef.current?.promise.catch(() => {});
    if (!v8Native) return;
    await v8Native.requestDeviceMac();
  }, []);
  // Ask for the MAC and wait for the reply packet, retrying until the timeout.
  // Covers both failure modes: the request being sent before the peripheral is
  // writable, and the band dropping a command it was too busy to answer.
  const ensureDeviceMac = useCallback(
    async (timeoutMs = 10000): Promise<string | null> => {
      if (!v8Native) return null;
      const readMac = () =>
        normalizeMacAddress(deviceInfoRef.current?.mac ?? null);

      const deadline = Date.now() + timeoutMs;
      let existing = readMac();
      // Distinguish the two failures: the command never reaching the band, and
      // the band never answering it. They need different fixes, so the caller
      // gets a real error for the first and null for the second.
      let sendError: Error | null = null;
      let everSent = false;
      while (!existing && Date.now() < deadline) {
        try {
          await v8Native.requestDeviceMac();
          everSent = true;
          sendError = null;
        } catch (error) {
          sendError =
            error instanceof Error ? error : new Error(String(error));
        }
        const attemptDeadline = Math.min(
          deadline,
          Date.now() + DEVICE_MAC_ATTEMPT_WINDOW_MS,
        );
        while (Date.now() < attemptDeadline) {
          existing = readMac();
          if (existing) break;
          await new Promise<void>(resolve => setTimeout(resolve, 100));
        }
      }
      if (!existing && !everSent && sendError) {
        throw sendError;
      }
      return existing;
    },
    [],
  );
  const requestDeviceName = useCallback(async () => {
    await historyReadInFlightRef.current?.promise.catch(() => {});
    if (!v8Native) return;
    await v8Native.requestDeviceName();
  }, []);
  const requestDeviceTime = useCallback(async () => {
    await historyReadInFlightRef.current?.promise.catch(() => {});
    if (!v8Native) return;
    await v8Native.requestDeviceTime();
  }, []);
  const syncDeviceTime = useCallback(async () => {
    await historyReadInFlightRef.current?.promise.catch(() => {});
    if (!v8Native) return;
    await v8Native.syncDeviceTime();
  }, []);
  const requestPersonalInfo = useCallback(async () => {
    await historyReadInFlightRef.current?.promise.catch(() => {});
    if (!v8Native) return;
    await v8Native.requestPersonalInfo();
  }, []);
  const setRealtimeStepEnabled = useCallback(
    async (enabled: boolean, includeTemperature: boolean) => {
      if (!v8Native) return;
      await v8Native.setRealtimeStepEnabled(enabled, includeTemperature);
      setLiveModeEnabled(enabled);
    },
    [],
  );

  const startEcgMeasurement = useCallback(
    async (mode: V8WaveformSource = 'ecg') => {
      const native = v8Native;
      const modeLabel = mode === 'ecg' ? 'ECG' : 'PPG';
      if (!ecgSeniorId) {
        throw new Error(
          `Select a senior before starting a ${modeLabel} measurement.`,
        );
      }
      if (selectedSeniorHandBandMacs.length === 0) {
        throw new Error('No hand band is assigned to the selected senior.');
      }
      if (!native) {
        throw new Error(
          'The hand band waveform module is unavailable on this device.',
        );
      }
      if (
        !activeDeviceId ||
        connectionStates[normalizeId(activeDeviceId)] !== 'connected'
      ) {
        throw new Error(
          `Connect the assigned hand band before starting ${modeLabel}.`,
        );
      }
      const connectedMac = resolveConnectedHandBandMac(
        deviceInfo.mac,
        activeDeviceId,
      );
      const assignedMacs = selectedSeniorHandBandMacs
        .map(value => normalizeMacAddress(value))
        .filter((value): value is string => !!value);
      if (!connectedMac || !assignedMacs.includes(connectedMac)) {
        throw new Error(
          'The connected hand band is not assigned to the selected senior.',
        );
      }
      if (ecgCompletionTimerRef.current) {
        clearTimeout(ecgCompletionTimerRef.current);
        ecgCompletionTimerRef.current = null;
      }

      const session = createV8EcgSession(
        ecgSeniorId,
        connectedMac,
        deviceInfo.firmwareVersion,
        Date.now(),
        mode,
      );
      logV8Debug(`Starting ${modeLabel} measurement`, {
        session,
        connectedMac,
        assignedMacs,
        startedAt: new Date().toISOString(),
      });
      setEcgSession(session);
      try {
        if (mode === 'ecg') {
          await native.startEcgMeasurement();
        } else {
          await native.startPpgMeasurement();
        }
        logV8Debug(`${modeLabel} native start flow sent`);
        setEcgSession(prev =>
          prev?.id === session.id
            ? {
                ...prev,
                phase: 'measuring',
                statusMessage: `${modeLabel} measurement is running…`,
              }
            : prev,
        );
      } catch (error) {
        logV8Debug(`${modeLabel} start failed`, error);
        if (mode === 'ecg') {
          await native.stopEcgMeasurement().catch(() => {});
        } else {
          await native.stopPpgMeasurement().catch(() => {});
          await native.exitPpgMeasurement().catch(() => {});
        }
        ecgCleanupSessionIdRef.current = session.id;
        const message =
          error instanceof Error
            ? error.message
            : `Unable to start ${modeLabel} measurement.`;
        const now = Date.now();
        setEcgSession(prev =>
          prev?.id === session.id
            ? {
                ...prev,
                phase: 'failed',
                completedAt: now,
                durationMs: now - prev.startedAt,
                statusMessage: `${modeLabel} could not start`,
                error: message,
              }
            : prev,
        );
        throw error;
      }
    },
    [
      connectionStates,
      activeDeviceId,
      deviceInfo.firmwareVersion,
      deviceInfo.mac,
      ecgSeniorId,
      selectedSeniorHandBandMacs,
    ],
  );

  const finishEcgMeasurement = useCallback(async () => {
    const native = v8Native;
    if (!native)
      throw new Error(
        'The hand band waveform module is unavailable on this device.',
      );
    const finishingSession = ecgSessionRef.current;
    const finishingSessionId = finishingSession?.id ?? null;
    const mode = finishingSession?.requestedMode ?? 'ecg';
    const modeLabel = mode === 'ecg' ? 'ECG' : 'PPG';
    const recordingStoppedAt = Date.now();
    logV8Debug(`Finishing ${modeLabel} measurement`);
    setEcgSession(prev =>
      prev &&
      prev.id === finishingSessionId &&
      ['starting', 'measuring'].includes(prev.phase)
        ? {
            ...prev,
            phase: 'processing',
            statusMessage: `Finishing ${modeLabel} recording…`,
          }
        : prev,
    );
    let stopError: unknown = null;
    try {
      if (mode === 'ecg') {
        await native.stopEcgMeasurement();
      } else {
        await native.stopPpgMeasurement();
      }
      logV8Debug(`${modeLabel} stop flow sent`);
    } catch (error) {
      logV8Debug('ECG stop command failed', error);
      stopError = error;
    }
    try {
      if (mode === 'ecg') {
        await native.exitEcgMeasurement();
      } else {
        await native.exitPpgMeasurement();
      }
      logV8Debug(`${modeLabel} exit flow sent`);
    } catch (error) {
      logV8Debug('ECG exit command failed', error);
    }

    if (stopError) {
      const message =
        stopError instanceof Error
          ? stopError.message
          : `Unable to finish ${modeLabel} measurement.`;
      setEcgSession(prev =>
        prev
          ? { ...prev, phase: 'failed', error: message, statusMessage: message }
          : prev,
      );
      throw stopError;
    }
    if (finishingSessionId) {
      ecgCleanupSessionIdRef.current = finishingSessionId;
    }

    if (ecgCompletionTimerRef.current)
      clearTimeout(ecgCompletionTimerRef.current);
    ecgCompletionTimerRef.current = setTimeout(() => {
      setEcgSession(prev => {
        if (
          !prev ||
          prev.id !== finishingSessionId ||
          !['processing', 'measuring'].includes(prev.phase)
        ) {
          return prev;
        }
        const now = Date.now();
        const waveformAnalysis =
          prev.heartRate == null && prev.samples.length > 0
            ? analyzeWaveformHeartRate(
                prev.samples,
                prev.sampleRateHz,
                prev.waveformSource ?? mode,
              )
            : null;
        const completedSession: V8EcgSession = {
          ...prev,
          phase: 'completed',
          completedAt: now,
          durationMs:
            mode === 'ecg'
              ? Math.min(
                  ECG_RECORDING_DURATION_MS,
                  recordingStoppedAt - prev.startedAt,
                )
              : recordingStoppedAt - prev.startedAt,
          heartRate: prev.heartRate ?? waveformAnalysis?.heartRate ?? null,
          heartRateSource:
            prev.heartRate != null
              ? prev.heartRateSource
              : waveformAnalysis?.heartRate != null
              ? 'waveform'
              : null,
          heartRateConfidence:
            prev.heartRate != null
              ? prev.heartRateConfidence
              : waveformAnalysis?.heartRate != null
              ? waveformAnalysis.confidence
              : null,
          signalQuality:
            prev.signalQuality ??
            (waveformAnalysis == null ? null : waveformAnalysis.quality),
          statusMessage:
            prev.samples.length === 0
              ? `Recording completed; no ${modeLabel} waveform was returned by this firmware.`
              : prev.heartRate == null && waveformAnalysis?.quality === 'poor'
              ? `${modeLabel} recording completed; heart rate unavailable because signal quality was insufficient.`
              : prev.waveformSource === 'ecg' &&
                prev.sampleRateHz != null &&
                prev.sampleRateHz < MIN_ECG_SAMPLE_RATE_HZ
              ? 'Recording completed with insufficient ECG sample frequency.'
              : `${modeLabel} recording completed`,
        };
        logV8Debug('ECG session completed locally', completedSession);
        return completedSession;
      });
      ecgCompletionTimerRef.current = null;
    }, 1000);
  }, []);

  const cancelEcgMeasurement = useCallback(async () => {
    if (ecgCompletionTimerRef.current) {
      clearTimeout(ecgCompletionTimerRef.current);
      ecgCompletionTimerRef.current = null;
    }
    const native = v8Native;
    if (native) {
      const mode = ecgSessionRef.current?.requestedMode ?? 'ecg';
      if (mode === 'ecg') {
        await native.stopEcgMeasurement().catch(() => {});
        await native.exitEcgMeasurement().catch(() => {});
      } else {
        await native.stopPpgMeasurement().catch(() => {});
        await native.exitPpgMeasurement().catch(() => {});
      }
    }
    setEcgSession(null);
  }, []);

  const resetEcgMeasurement = useCallback(() => {
    setEcgSession(null);
    Keychain.resetGenericPassword({ service: V8_ECG_SERVICE }).catch(() => {});
  }, []);


  const readVitalsHistory = useCallback(async (bandDay: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bandDay) || parseMeasurementTimestamp(bandDay) == null) {
      throw new Error('Use a valid YYYY-MM-DD date.');
    }
    const pending = historyReadInFlightRef.current;
    if (pending) {
      if (pending.day !== bandDay) throw new Error('Wait for the current history read to finish.');
      return pending.promise;
    }
    const native = v8Native;
    if (!native || !connectedDeviceRef.current) throw new Error('Connect the hand band before reading vitals.');
    const start = Platform.OS === 'ios' ? parseMeasurementTimestamp(bandDay)! : `${bandDay} 00:00:00`;
    const requests: HistoryRequest[] = [
      { type: 'totalActivity', request: mode => native.requestTotalActivity(mode, start) },
      { type: 'detailActivity', request: mode => native.requestDetailActivity(mode, start) },
      { type: 'dynamicHR', request: mode => native.requestDynamicHR(mode, start) },
      { type: 'staticHR', request: mode => native.requestStaticHR(mode, start) },
      { type: 'hrv', request: mode => native.requestHRV(mode, start) },
    ];
    requests.push({ type: 'spo2', request: native.requestSpo2 ? mode => native.requestSpo2!(mode, start) : undefined });
    requests.push({ type: 'temperature', request: native.requestTemperature ? mode => native.requestTemperature!(mode, start) : undefined });
    completedReadRef.current = null;
    // Rebuild this download from fresh responses. Cached records must not make a
    // missing response look complete or retain a previous revision of today's total.
    historyByTypeRef.current = Object.fromEntries(Object.entries(historyByTypeRef.current).filter(([, bucket]) => bucket.source === 'live'));
    historyIndexRef.current = {};
    historyBuffersRef.current = {};
    setHistoryByType(snapshotHistory(historyByTypeRef.current));
    historyReadStatusRef.current = { ...idleHistoryReadStatus, phase: 'reading', day: bandDay };
    setHistoryReadStatus(historyReadStatusRef.current);
    const deviceId = connectedDeviceRef.current;
    const generation = connectionGenerationRef.current;
    const seniorId = syncContextRef.current.seniorId;
    const assertReadConnection = () => {
      if (connectedDeviceRef.current !== deviceId || connectionGenerationRef.current !== generation ||
        syncContextRef.current.seniorId !== seniorId) {
        throw new Error('The hand band connection or senior changed. Retry the read.');
      }
    };
    const promise = (async () => {
      await devicePrimingRef.current;
      assertReadConnection();
      const status = await historyReaderRef.current.readAll(bandDay, requests, progress => {
        historyReadStatusRef.current = progress;
        setHistoryReadStatus(progress);
      });
      assertReadConnection();
      // Every category is attempted and whatever arrived is aggregated, so a
      // failed or unsupported category never blocks the rest of the day.
      completedReadRef.current = {
        day: bandDay, deviceId, generation, seniorId,
        partial: status.phase === 'partial',
        missingTypes: Object.entries(status.categories)
          .filter(([, category]) => category.outcome !== 'downloaded' && category.outcome !== 'empty')
          .map(([type]) => type),
        rows: aggregateVitals(historyByTypeRef.current, bandDay),
        live: latestLiveDataRef.current ? {
          ...latestLiveDataRef.current,
          metricTimestamps: { ...latestLiveDataRef.current.metricTimestamps },
        } : null,
      };
    })();
    historyReadInFlightRef.current = { day: bandDay, promise };
    try { await promise; }
    catch (error) {
      completedReadRef.current = null;
      historyReadStatusRef.current = { ...historyReadStatusRef.current, phase: 'partial', currentType: null };
      setHistoryReadStatus(historyReadStatusRef.current);
      throw error;
    }
    finally {
      historyReadInFlightRef.current = null;
      setHistoryByType(snapshotHistory(historyByTypeRef.current));
    }
  }, []);

  const requestLiveSnapshot = useCallback(async () => {
    await readVitalsHistory(todayLocalDayKey());
  }, [readVitalsHistory]);

  const buildTodayVitals = useCallback(async (bandDay: string): Promise<V8DailyVitalSummary[]> => {
    await readVitalsHistory(bandDay);
    const read = completedReadRef.current;
    if (!read || read.day !== bandDay) throw new Error('History is incomplete. Retry the read before uploading vitals.');
    return read.rows.map(row => ({ ...row }));
  }, [readVitalsHistory]);

  // The app only ever syncs the day the band is filling in now. There is no
  // backfill path: a missed day stays missed rather than being reconstructed
  // from a history read the band may no longer hold.
  const syncTodayVitalsToBackend = useCallback(
    async (
      bandDay: string,
      days: V8DailyVitalSummary[],
      onProgress?: (phase: V8VitalsUploadPhase) => void,
    ): Promise<{ days: number; partial: boolean; missingTypes: string[] }> => {
      onProgress?.('verifying');
      if (user?.role !== 'SENIOR') {
        throw new Error('Only senior users can sync Hand Band health data.');
      }
      const seniorId = user.user_id.trim();
      if (!seniorId) {
        throw new Error('Senior ID is required before syncing vitals.');
      }
      const read = completedReadRef.current;
      const assertUploadRead = () => {
        if (!read || completedReadRef.current !== read ||
          !['complete', 'partial'].includes(historyReadStatusRef.current.phase) ||
          read.day !== bandDay || read.deviceId !== connectedDeviceRef.current ||
          read.generation !== connectionGenerationRef.current ||
          read.seniorId !== seniorId || syncContextRef.current.seniorId !== seniorId ||
          syncContextRef.current.role !== 'SENIOR') {
          throw new Error('No current hand band read matches this day, band and senior. Read the hand band again before uploading vitals.');
        }
      };
      assertUploadRead();
      if (JSON.stringify(days) !== JSON.stringify(read!.rows)) {
        throw new Error('Readings do not match the completed history read. Build vitals again before uploading.');
      }
      const connectedMac = deviceInfo.mac ?? (await ensureDeviceMac().catch(() => null));
      if (!connectedMac) {
        throw new Error(
          'Connected Hand Band MAC is unavailable. Keep the band close to the phone and try again.',
        );
      }

      const seniorAssignedMacs = selectedSeniorHandBandMacs
        .map(value => normalizeMacAddress(value))
        .filter((value): value is string => !!value);
      const ownsConnectedMac = seniorAssignedMacs.includes(connectedMac);
      if (!ownsConnectedMac) {
        throw new Error(
          'This Hand Band is not assigned to the selected senior. Sync is blocked.',
        );
      }

      const assignedDevices = await getAssignedDevicesForSenior(seniorId);
      const assignedMacDebug = assignedDevices.map(device => ({
        deviceId: device.deviceId,
        deviceIdentifier: device.deviceIdentifier,
        assignedMac: getAssignedHandBandMacAddress(device),
        status: device.status,
      }));
      console.log(
        '[V8 Sync Debug] Candidate assigned devices:',
        assignedMacDebug,
      );

      const matchedAssigned = assignedDevices.find(
        device => getAssignedHandBandMacAddress(device) === connectedMac,
      );
      const deviceUUID = matchedAssigned?.deviceId?.trim();
      if (!deviceUUID) {
        throw new Error(
          'Assigned Hand Band device UUID was not found for selected senior.',
        );
      }

      const allVitalSummaries: V8WebVitalSummary[] = read!.rows.map(day => ({
        recordDate: day.date,
        steps: day.steps,
        distanceKm: day.distanceKm,
        caloriesKcal: day.caloriesKcal,
        exerciseMinutes: day.exerciseMinutes,
        activeMinutes: day.activeMinutes,
        goalPercent: day.goalPercent,
        hrMin: day.heartRateMin,
        hrMax: day.heartRateMax,
        hrAvg: day.heartRateAvg,
        hrLatest: day.heartRateLatest,
        spo2Min: day.spo2Min,
        spo2Max: day.spo2Max ?? null,
        spo2Avg: day.spo2Avg,
        spo2Latest: day.spo2Latest,
        hrvMin: day.hrvMin ?? null,
        hrvMax: day.hrvMax ?? null,
        hrvAvg: day.hrvAvg,
        hrvLatest: day.hrvLatest,
        systolicBpMin: day.systolicBpMin ?? null,
        systolicBpMax: day.systolicBpMax ?? null,
        systolicBpAvg: day.systolicBpAvg,
        systolicBpLatest: day.systolicBpLatest,
        diastolicBpMin: day.diastolicBpMin ?? null,
        diastolicBpMax: day.diastolicBpMax ?? null,
        diastolicBpAvg: day.diastolicBpAvg,
        diastolicBpLatest: day.diastolicBpLatest,
        tempMin: day.temperatureMinC ?? null,
        tempMax: day.temperatureMaxC ?? null,
        tempAvg: day.temperatureAvgC,
        tempLatest: day.temperatureLatestC,
        stressMin: day.stressMin ?? null,
        stressMax: day.stressMax ?? null,
        stressAvg: day.stressAvg,
        stressLatest: day.stressLatest ?? null,
      }));

      const row = selectTodayVitalSummary(allVitalSummaries, bandDay, read!.live);
      if (!Object.entries(row).some(([key, value]) => key !== 'recordDate' && value != null)) {
        throw new Error('No readings recorded for this day. Nothing was uploaded.');
      }
      const normalizedSummaries = [row];

      // syncFrom/syncTo/syncDays describe a one-day window because that is the
      // only window there is; the backend still requires all three.
      const webPayload: V8WebVitalsSyncPayload = {
        deviceUUID,
        syncDays: 1,
        syncFrom: bandDay,
        syncTo: bandDay,
        vitalSummaries: normalizedSummaries,
      };

      console.log('[V8 Sync Debug] Sync request info:', {
        endpoint: '/api/v1/vitals/sync',
        seniorId,
        connectedMac,
        selectedSeniorHandBandMacs,
        resolvedDeviceUUID: deviceUUID,
        syncDays: webPayload.syncDays,
        syncFrom: webPayload.syncFrom,
        syncTo: webPayload.syncTo,
        recordDate: webPayload.vitalSummaries[0]?.recordDate ?? null,
        partialRead: read!.partial,
        missingCategories: read!.missingTypes,
        source: 'dated readings; missing metrics remain null',
      });

      // Assignment lookup can yield long enough for a disconnect, new download,
      // or account change. Recheck immediately before the POST.
      assertUploadRead();
      if (!syncContextRef.current.macs.some(mac => normalizeMacAddress(mac) === connectedMac)) {
        throw new Error('This Hand Band is no longer assigned to the selected senior. Sync is blocked.');
      }
      onProgress?.('uploading');
      await syncV8VitalsByDevice(webPayload);
      onProgress?.('finishing');
      if (user?.role === 'SENIOR') {
        const syncedAt = Date.now();
        await recordV8HandBandSynced(
          seniorId,
          deviceUUID,
          connectedMac,
          syncedAt,
        );
        lastVitalsSyncedAtRef.current = syncedAt;
        nextAutomaticSyncAttemptAtRef.current =
          syncedAt + V8_HAND_BAND_AUTO_SYNC_INTERVAL_MS;
        setAutoSyncStatus({
          enabled: true,
          phase: 'scheduled',
          lastSyncedAt: syncedAt,
          nextSyncAt: nextAutomaticSyncAttemptAtRef.current,
          error: null,
        });
      }
      return {
        days: 1,
        partial: read!.partial,
        missingTypes: [...read!.missingTypes],
      };
    },
    [
      deviceInfo.mac,
      ensureDeviceMac,
      getAssignedDevicesForSenior,
      selectedSeniorHandBandMacs,
      syncV8VitalsByDevice,
      user?.role,
      user?.user_id,
    ],
  );


  const clearSavedData = useCallback(async () => {
    connectionGenerationRef.current += 1;
    completedReadRef.current = null;
    historyReadStatusRef.current = idleHistoryReadStatus;
    setHistoryReadStatus(idleHistoryReadStatus);
    historyReaderRef.current.cancel('Saved band data was cleared during the read.');
    historyByTypeRef.current = {};
    historyIndexRef.current = {};
    historyBuffersRef.current = {};
    latestLiveDataRef.current = null;
    setHistoryByType({});
    setLatestLiveData(null);
    setDataEvents([]);
    setDeviceInfo({
      imei: null,
      deviceName: null,
      mac: null,
      batteryPercent: null,
      firmwareVersion: null,
      deviceTime: null,
      updatedAt: null,
    });
    setEcgSession(null);
    try {
      await Keychain.resetGenericPassword({ service: V8_HISTORY_SERVICE });
      await Keychain.resetGenericPassword({ service: V8_ECG_SERVICE });
    } catch {
      // ignore
    }
  }, []);

  const clearSavedSession = useCallback(async () => {
    try {
      if (v8Native && activeDeviceId) {
        await v8Native.disconnect().catch(() => {});
      }
    } catch {
      // ignore
    }
    setActiveDeviceId(null);
    setVerifiedConnection(null);
    setLiveModeEnabled(false);
    setConnectionStates({});
    setDevicesById({});
    setLastConnectedDeviceId(null);
    setLastConnectedDevice(null);
    setSuppressAutoConnectUntil(Date.now() + 60_000);
    if (scanStopTimerRef.current) {
      clearTimeout(scanStopTimerRef.current);
      scanStopTimerRef.current = null;
    }
    setIsScanning(false);
    try {
      if (v8Native) {
        await v8Native.stopScan().catch(() => {});
      }
      await Keychain.resetGenericPassword({ service: V8_SESSION_SERVICE });
    } catch {
      // ignore
    }
  }, [activeDeviceId]);

  const ensureAutoConnect = useCallback(async () => {
    if (Date.now() < suppressAutoConnectUntil) return;
    if (!v8Native || !lastConnectedDeviceId) return;
    if (bleState !== 'PoweredOn') return;
    if (isScanning || pendingConnectionRef.current || activeDeviceId) return;
    const rememberedMac = resolveHandBandIdentity(
      devicesByIdRef.current[normalizeId(lastConnectedDeviceId)] ?? lastConnectedDevice ?? { id: lastConnectedDeviceId },
      selectedSeniorHandBandMacs,
    );
    const assignedMacs = selectedSeniorHandBandMacs
      .map(value => normalizeMacAddress(value))
      .filter((value): value is string => !!value);
    if (!rememberedMac || !assignedMacs.includes(rememberedMac)) return;
    const state = connectionStates[normalizeId(lastConnectedDeviceId)];
    if (state === 'connected' || state === 'connecting') return;
    try {
      if (lastConnectedDevice && !devicesByIdRef.current[normalizeId(lastConnectedDeviceId)]) {
        setDevicesById(prev => ({ ...prev, [normalizeId(lastConnectedDeviceId)]: lastConnectedDevice }));
      }
      await connect(lastConnectedDeviceId);
    } catch {
      try {
        await startScan();
      } catch {
        // ignore
      }
    }
  }, [
    connect,
    bleState,
    connectionStates,
    activeDeviceId,
    lastConnectedDevice,
    isScanning,
    lastConnectedDeviceId,
    selectedSeniorHandBandMacs,
    startScan,
    suppressAutoConnectUntil,
  ]);

  useEffect(() => {
    if (!lastConnectedDeviceId || !v8Native) return;
    const timer = setTimeout(() => {
      ensureAutoConnect().catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [ensureAutoConnect, lastConnectedDeviceId]);

  const runAutomaticVitalsSync = useCallback(async () => {
    const seniorId = user?.role === 'SENIOR' ? user.user_id?.trim() : '';
    if (!seniorId || selectedSeniorHandBandMacs.length === 0) {
      setAutoSyncStatus({
        enabled: false,
        phase: 'disabled',
        lastSyncedAt: null,
        nextSyncAt: null,
        error: null,
      });
      return;
    }

    if (bleState !== 'PoweredOn') {
      setAutoSyncStatus(prev => ({
        ...prev,
        enabled: true,
        phase: 'waiting',
        nextSyncAt: null,
        error: null,
      }));
      return;
    }

    const connected = Object.values(connectionStates).some(
      state => state === 'connected',
    );
    if (!connected) {
      setAutoSyncStatus(prev => ({
        ...prev,
        enabled: true,
        phase: 'waiting',
        nextSyncAt: null,
        error: null,
      }));
      await ensureAutoConnect().catch(() => {});
      return;
    }

    const connectedMac = resolveConnectedHandBandMac(
      deviceInfo.mac,
      activeDeviceId,
    );
    if (!connectedMac) {
      setAutoSyncStatus(prev => ({
        ...prev,
        enabled: true,
        phase: 'waiting',
        nextSyncAt: null,
        error: null,
      }));
      await requestDeviceMac().catch(() => {});
      return;
    }

    if (automaticSyncInFlightRef.current) {
      return;
    }
    automaticSyncInFlightRef.current = true;

    try {
      const cacheKey = `${seniorId}::${connectedMac}`;
      if (automaticSyncCacheKeyRef.current !== cacheKey) {
        const cachedEntry = await getV8HandBandSyncEntry(
          seniorId,
          connectedMac,
        );
        automaticSyncCacheKeyRef.current = cacheKey;
        lastVitalsSyncedAtRef.current = cachedEntry?.lastSyncedAt ?? null;
        nextAutomaticSyncAttemptAtRef.current = cachedEntry?.lastSyncedAt
          ? cachedEntry.lastSyncedAt + V8_HAND_BAND_AUTO_SYNC_INTERVAL_MS
          : Date.now();
      }

      const now = Date.now();
      if (now < nextAutomaticSyncAttemptAtRef.current) {
        setAutoSyncStatus({
          enabled: true,
          phase: 'scheduled',
          lastSyncedAt: lastVitalsSyncedAtRef.current,
          nextSyncAt: nextAutomaticSyncAttemptAtRef.current,
          error: null,
        });
        return;
      }

      setAutoSyncStatus({
        enabled: true,
        phase: 'syncing',
        lastSyncedAt: lastVitalsSyncedAtRef.current,
        nextSyncAt: null,
        error: null,
      });
      // The band's own day is the day the row is stored under, start to end.
      const bandDay = todayLocalDayKey();
      const todayRows = await buildTodayVitals(bandDay);
      const bandRows = todayRows.filter(row => row.date === bandDay);
      await syncTodayVitalsToBackend(bandDay, bandRows);
    } catch (error) {
      const retryAt = Date.now() + 60_000;
      nextAutomaticSyncAttemptAtRef.current = retryAt;
      setAutoSyncStatus({
        enabled: true,
        phase: 'error',
        lastSyncedAt: lastVitalsSyncedAtRef.current,
        nextSyncAt: retryAt,
        error:
          error instanceof Error
            ? error.message
            : 'Automatic health sync failed.',
      });
    } finally {
      automaticSyncInFlightRef.current = false;
    }
  }, [
    activeDeviceId,
    bleState,
    buildTodayVitals,
    connectionStates,
    deviceInfo.mac,
    ensureAutoConnect,
    requestDeviceMac,
    selectedSeniorHandBandMacs.length,
    syncTodayVitalsToBackend,
    user?.role,
    user?.user_id,
  ]);

  useEffect(() => {
    let active = true;
    let appIsActive = AppState.currentState === 'active';
    const checkAutomaticSync = () => {
      if (active && appIsActive) {
        runAutomaticVitalsSync().catch(() => {});
      }
    };

    checkAutomaticSync();
    const interval = setInterval(checkAutomaticSync, 30_000);
    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        appIsActive = nextState === 'active';
        if (appIsActive) {
          checkAutomaticSync();
        }
      },
    );

    return () => {
      active = false;
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, [runAutomaticVitalsSync]);

  useEffect(() => {
    const cappedHistoryByType: Record<string, V8HistoryBucket> =
      Object.fromEntries(
        Object.entries(historyByType).map(([key, bucket]) => [
          key,
          {
            ...bucket,
            entries: bucket.entries.slice(-120),
          },
        ]),
      );
    const snapshot = {
      historyByType: cappedHistoryByType,
      latestLiveData,
      deviceInfo,
    };
    Keychain.setGenericPassword(V8_HISTORY_USER, JSON.stringify(snapshot), {
      service: V8_HISTORY_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }).catch(() => {});
  }, [deviceInfo, historyByType, latestLiveData]);

  const devices = useMemo(() => Object.values(devicesById), [devicesById]);

  return {
    bleState,
    devices,
    isScanning,
    scanError,
    connectionStates,
    activeDeviceId,
    dataEvents,
    latestLiveData,
    historyByType,
    deviceInfo,
    liveModeEnabled,
    ecgSession,
    autoSyncStatus,
    historyReadStatus,
    openBluetoothSettings,
    startScan,
    stopScan,
    connect,
    disconnect,
    requestDeviceVersion,
    requestBattery,
    requestDeviceMac,
    ensureDeviceMac,
    requestDeviceName,
    requestDeviceTime,
    syncDeviceTime,
    requestPersonalInfo,
    setRealtimeStepEnabled,
    startEcgMeasurement,
    finishEcgMeasurement,
    cancelEcgMeasurement,
    resetEcgMeasurement,
    buildTodayVitals,
    syncTodayVitalsToBackend,
    requestLiveSnapshot,
    clearSavedData,
    clearSavedSession,
    ensureAutoConnect,
  };
};

export const V8BleProvider = ({ children }: { children: React.ReactNode }) => {
  const value = useV8BleManagerInternal();
  return (
    <V8BleContext.Provider value={value}>{children}</V8BleContext.Provider>
  );
};

export const useV8Ble = () => {
  const ctx = useContext(V8BleContext);
  if (!ctx) {
    throw new Error('useV8Ble must be used within V8BleProvider');
  }
  return ctx;
};
