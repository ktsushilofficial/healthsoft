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
} from './models';
import { parseV8Payload } from './parser';
import { toLocalDayKey, todayLocalDayKey } from '../utils/vitalsDay';
import { sampleDayKey } from '../utils/sampleDay';
import {
  emptyVitalSummary,
  fillTodayVitalSummaryGaps,
} from './todayVitalsRow';
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
  ) => Promise<{ days: number }>;
  requestLiveSnapshot: () => Promise<void>;
  clearSavedData: () => Promise<void>;
  clearSavedSession: () => Promise<void>;
  ensureAutoConnect: () => Promise<void>;
};

const V8BleContext = createContext<V8BleContextValue | null>(null);
const V8_SESSION_SERVICE = 'healthsoft.v8.session';
const V8_SESSION_USER = 'v8-session';
const V8_HISTORY_SERVICE = 'healthsoft.v8.history';
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

// The band reports 0 for heart rate, SpO2, blood pressure and temperature while
// it is off the wrist. Those are "no reading", not measurements, and counting
// them sinks the day's min and average (a real day came back as hrMin 0 /
// hrAvg 15 against an hrMax of 58).
const isPositiveVital = (value: number | null | undefined): value is number =>
  value != null && Number.isFinite(value) && value > 0;

// The band replies to one command at a time; anything written while it is still
// answering is dropped without an error.
const DEVICE_COMMAND_SPACING_MS = 400;
// iOS never exposes a peripheral's MAC through CoreBluetooth, so it has to be
// read back over the vendor protocol. native connect() resolves as soon as the
// connection is *requested*, so an immediate request lands before the write
// characteristic exists and is rejected as NOT_CONNECTED.
const DEVICE_MAC_ATTEMPT_WINDOW_MS = 1500;

// Today's row must never reach the backend with nulls: fall back to the latest
// live sample for any gap the history aggregation left open, then to 0.
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
  const liveSnapshotInFlightRef = useRef(false);
  const liveSnapshotPromiseRef = useRef<Promise<void> | null>(null);
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
    historyByTypeRef.current = historyByType;
  }, [historyByType]);

  useEffect(() => {
    latestLiveDataRef.current = latestLiveData;
  }, [latestLiveData]);

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
        if (!active || !value) return;
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
        setActiveDeviceId(normalizedDeviceId);
      } else if (state === 'disconnected') {
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
        primeDeviceInfo().catch(() => {});
      }
    });

    const dataSub = v8Emitter.addListener('V8Data', evt => {
      const event = evt as ParsedData;
      logV8Debug('Data packet received', {
        receivedAt: new Date().toISOString(),
        event,
      });
      setDataEvents(prev => [event, ...prev].slice(0, 50));
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
      const { history, infoPatch } = parseV8Payload(
        event.payload,
        dataPlatform,
      );

      setDeviceInfo(prev => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(infoPatch).filter(
            ([, value]) => value !== null && value !== undefined,
          ),
        ),
        updatedAt: Date.now(),
      }));

      if (history) {
        // Always update latestLiveData with any incoming entries before dedup,
        // so the Activity screen sees fresh data immediately.
        if (history.entries.length > 0) {
          const newest = history.entries[history.entries.length - 1];
          setLatestLiveData(prev => {
            if (!prev) return newest;
            // Simple latest-wins merge: for every field, prefer the newest
            // non-null value, falling back to the previous value.
            return {
              timestamp: newest.timestamp ?? prev.timestamp,
              receivedAt: newest.receivedAt ?? prev.receivedAt,
              heartRate: newest.heartRate ?? prev.heartRate,
              hrv: newest.hrv ?? prev.hrv,
              stress: newest.stress ?? prev.stress,
              systolicBp: newest.systolicBp ?? prev.systolicBp,
              diastolicBp: newest.diastolicBp ?? prev.diastolicBp,
              spo2: newest.spo2 ?? prev.spo2,
              temperatureC: newest.temperatureC ?? prev.temperatureC,
              steps: newest.steps ?? prev.steps,
              distanceKm: newest.distanceKm ?? prev.distanceKm,
              caloriesKcal: newest.caloriesKcal ?? prev.caloriesKcal,
              exerciseMinutes: newest.exerciseMinutes ?? prev.exerciseMinutes,
              activeMinutes: newest.activeMinutes ?? prev.activeMinutes,
              goalPercent: newest.goalPercent ?? prev.goalPercent,
            };
          });
        }

        const key = history.dataType ?? 'unknown';
        const existing = historyByTypeRef.current[key];
        const mergedEntries = [
          ...(existing?.entries ?? []),
          ...history.entries,
        ];
        // O(n) dedup using a Set instead of O(n²) filter+findIndex.
        const seen = new Set<string>();
        const deduped: V8VitalSample[] = [];
        for (const entry of mergedEntries) {
          const marker = `${entry.timestamp ?? ''}-${entry.heartRate ?? ''}-${
            entry.hrv ?? ''
          }-${entry.systolicBp ?? ''}-${entry.diastolicBp ?? ''}-${
            entry.steps ?? ''
          }-${entry.distanceKm ?? ''}-${entry.temperatureC ?? ''}-${
            entry.caloriesKcal ?? ''
          }-${entry.exerciseMinutes ?? ''}-${entry.activeMinutes ?? ''}-${
            entry.goalPercent ?? ''
          }`;
          if (!seen.has(marker)) {
            seen.add(marker);
            deduped.push(entry);
          }
        }

        const nextBucket: V8HistoryBucket = {
          dataType: history.dataType,
          completed: history.completed,
          updatedAt: history.updatedAt,
          entries: deduped,
        };
        const next = { ...historyByTypeRef.current, [key]: nextBucket };
        historyByTypeRef.current = next;
        setHistoryByType(next);
      }
    });

    return () => {
      scanSub.remove();
      stateSub.remove();
      dataSub.remove();
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
    if (!v8Native) return;
    await v8Native.requestDeviceVersion();
  }, []);
  const requestBattery = useCallback(async () => {
    if (!v8Native) return;
    await v8Native.requestBattery();
  }, []);
  const requestDeviceMac = useCallback(async () => {
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
    if (!v8Native) return;
    await v8Native.requestDeviceName();
  }, []);
  const requestDeviceTime = useCallback(async () => {
    if (!v8Native) return;
    await v8Native.requestDeviceTime();
  }, []);
  const syncDeviceTime = useCallback(async () => {
    if (!v8Native) return;
    await v8Native.syncDeviceTime();
  }, []);
  const requestPersonalInfo = useCallback(async () => {
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


  const requestLiveSnapshot = useCallback(async () => {
    if (!v8Native) return;
    if (liveSnapshotInFlightRef.current && liveSnapshotPromiseRef.current) {
      await liveSnapshotPromiseRef.current;
      return;
    }
    liveSnapshotInFlightRef.current = true;
    const snapshotPromise = (async () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const start =
        Platform.OS === 'ios'
          ? oneDayAgo.getTime()
          : `${toLocalDayKey(oneDayAgo)} ${oneDayAgo
              .toTimeString()
              .slice(0, 8)}`;

      // Request vital data types so steps, BP, SpO2, temperature, and HR are populated.
      // NOTE: requestTotalActivity is intentionally excluded — it returns
      // inflated/stale daily totals that overwrite the accurate interval
      // values from requestStaticHR / requestDetailActivity.
      await Promise.all([
        v8Native.requestStaticHR(0, start),
        v8Native.requestDynamicHR(0, start),
        v8Native.requestHRV(0, start),
        v8Native.requestSpo2
          ? v8Native.requestSpo2(0, start)
          : Promise.resolve(true),
      ]);
      await Promise.all([
        v8Native.requestTemperature
          ? v8Native.requestTemperature(0, start)
          : Promise.resolve(true),
        v8Native.requestDetailActivity(0, start),
      ]);
    })();
    liveSnapshotPromiseRef.current = snapshotPromise;
    try {
      await snapshotPromise;
    } finally {
      liveSnapshotInFlightRef.current = false;
      liveSnapshotPromiseRef.current = null;
    }
  }, []);


  // Reads the band for one day only - the day it is filling in now. The band
  // is asked for samples since that day's local midnight and nothing earlier.
  const buildTodayVitals = useCallback(
    async (bandDay: string): Promise<V8DailyVitalSummary[]> => {
      const dayStart = new Date(`${bandDay}T00:00:00`);
      if (Number.isNaN(dayStart.getTime())) {
        throw new Error('Use YYYY-MM-DD date format.');
      }
      const native = v8Native;
      if (!native) return [];

      const start =
        Platform.OS === 'ios' ? dayStart.getTime() : `${bandDay} 00:00:00`;

      const initialUpdatedAt: Record<string, number> = Object.fromEntries(
        Object.entries(historyByTypeRef.current).map(([k, b]) => [
          k,
          b.updatedAt,
        ]),
      );
      const targetKeys = [
        'totalActivity',
        'detailActivity',
        'dynamicHR',
        'staticHR',
        'hrv',
        'spo2',
        'temperature',
      ];
      const androidTimeouts: Record<string, number> = {};
      const maxPages = 12;
      for (let page = 0; page < maxPages; page += 1) {
        const mode = page === 0 ? 0 : 2;
        const requests: Array<[string, () => Promise<unknown>]> = [
          ['totalActivity', () => native.requestTotalActivity(mode, start)],
          ['detailActivity', () => native.requestDetailActivity(mode, start)],
          ['dynamicHR', () => native.requestDynamicHR(mode, start)],
          ['staticHR', () => native.requestStaticHR(mode, start)],
          ['hrv', () => native.requestHRV(mode, start)],
        ];
        if (native.requestSpo2) {
          requests.push(['spo2', () => native.requestSpo2!(mode, start)]);
        }
        if (native.requestTemperature) {
          requests.push([
            'temperature',
            () => native.requestTemperature!(mode, start),
          ]);
        }

        if (Platform.OS === 'android') {
          // Android native promises resolve after queueing the command, not after
          // the band finishes its multi-packet response. Keep history requests
          // serialized so a new command cannot interrupt the previous response.
          for (const [key, request] of requests) {
            if ((androidTimeouts[key] ?? 0) >= 2) continue;
            const previousUpdatedAt =
              historyByTypeRef.current[key]?.updatedAt ?? 0;
            await request();
            const deadline = Date.now() + 1500;
            let receivedCompletedResponse = false;
            while (Date.now() < deadline) {
              const bucket = historyByTypeRef.current[key];
              if (
                bucket &&
                bucket.updatedAt > previousUpdatedAt &&
                bucket.completed
              ) {
                receivedCompletedResponse = true;
                break;
              }
              await new Promise<void>(resolve => setTimeout(resolve, 50));
            }
            androidTimeouts[key] = receivedCompletedResponse
              ? 0
              : (androidTimeouts[key] ?? 0) + 1;
          }
        } else {
          await Promise.all(requests.map(([, request]) => request()));
          await new Promise<void>(resolve => setTimeout(resolve, 450));
        }
        const done = targetKeys.every(key => {
          if (Platform.OS === 'android' && (androidTimeouts[key] ?? 0) >= 2)
            return true;
          const bucket = historyByTypeRef.current[key];
          if (!bucket) return false;
          const prevUpdated = initialUpdatedAt[key] ?? 0;
          return bucket.completed && bucket.updatedAt > prevUpdated;
        });
        if (done) break;
      }

      type Agg = {
        day: string;
        steps: number | null;
        distanceKm: number | null;
        caloriesKcal: number | null;
        exerciseMinutes: number | null;
        activeMinutes: number | null;
        goalPercent: number | null;
        hrSum: number;
        hrCount: number;
        hrMin: number | null;
        hrMax: number | null;
        hrLatest: number | null;
        hrLatestTs: number;
        spo2Sum: number;
        spo2Count: number;
        spo2Min: number | null;
        spo2Max: number | null;
        spo2Latest: number | null;
        spo2LatestTs: number;
        hrvSum: number;
        hrvCount: number;
        hrvMin: number | null;
        hrvMax: number | null;
        hrvLatest: number | null;
        hrvLatestTs: number;
        sysSum: number;
        diaSum: number;
        bpCount: number;
        sysMin: number | null;
        sysMax: number | null;
        diaMin: number | null;
        diaMax: number | null;
        sysLatest: number | null;
        diaLatest: number | null;
        bpLatestTs: number;
        tempSum: number;
        tempCount: number;
        tempMin: number | null;
        tempMax: number | null;
        tempLatest: number | null;
        tempLatestTs: number;
        stressSum: number;
        stressCount: number;
        stressMin: number | null;
        stressMax: number | null;
        stressLatest: number | null;
        stressLatestTs: number;
      };

      const fromTs = dayStart.getTime();
      const toTs = new Date(`${bandDay}T23:59:59`).getTime();
      const aggs = new Map<string, Agg>();
      const ensure = (day: string): Agg => {
        const current = aggs.get(day);
        if (current) return current;
        const created: Agg = {
          day,
          steps: null,
          distanceKm: null,
          caloriesKcal: null,
          exerciseMinutes: null,
          activeMinutes: null,
          goalPercent: null,
          hrSum: 0,
          hrCount: 0,
          hrMin: null,
          hrMax: null,
          hrLatest: null,
          hrLatestTs: 0,
          spo2Sum: 0,
          spo2Count: 0,
          spo2Min: null,
          spo2Max: null,
          spo2Latest: null,
          spo2LatestTs: 0,
          hrvSum: 0,
          hrvCount: 0,
          hrvMin: null,
          hrvMax: null,
          hrvLatest: null,
          hrvLatestTs: 0,
          sysSum: 0,
          diaSum: 0,
          bpCount: 0,
          sysMin: null,
          sysMax: null,
          diaMin: null,
          diaMax: null,
          sysLatest: null,
          diaLatest: null,
          bpLatestTs: 0,
          tempSum: 0,
          tempCount: 0,
          tempMin: null,
          tempMax: null,
          tempLatest: null,
          tempLatestTs: 0,
          stressSum: 0,
          stressCount: 0,
          stressMin: null,
          stressMax: null,
          stressLatest: null,
          stressLatestTs: 0,
        };
        aggs.set(day, created);
        return created;
      };

      for (const [key, bucket] of Object.entries(historyByTypeRef.current)) {
        for (const sample of bucket.entries) {
          const day = sampleDayKey(sample);
          if (!day) continue;
          const dayTs = new Date(`${day}T00:00:00`).getTime();
          if (!Number.isFinite(dayTs) || dayTs < fromTs || dayTs > toTs)
            continue;
          const agg = ensure(day);
          const sampleTs = sample.receivedAt ?? 0;

          if (isPositiveVital(sample.heartRate)) {
            agg.hrSum += sample.heartRate;
            agg.hrCount += 1;
            agg.hrMin =
              agg.hrMin == null
                ? sample.heartRate
                : Math.min(agg.hrMin, sample.heartRate);
            agg.hrMax =
              agg.hrMax == null
                ? sample.heartRate
                : Math.max(agg.hrMax, sample.heartRate);
            if (sampleTs >= agg.hrLatestTs) {
              agg.hrLatestTs = sampleTs;
              agg.hrLatest = sample.heartRate;
            }
          }
          if (isPositiveVital(sample.spo2)) {
            agg.spo2Sum += sample.spo2;
            agg.spo2Count += 1;
            agg.spo2Min =
              agg.spo2Min == null
                ? sample.spo2
                : Math.min(agg.spo2Min, sample.spo2);
            agg.spo2Max =
              agg.spo2Max == null
                ? sample.spo2
                : Math.max(agg.spo2Max, sample.spo2);
            if (sampleTs >= agg.spo2LatestTs) {
              agg.spo2LatestTs = sampleTs;
              agg.spo2Latest = sample.spo2;
            }
          }
          if (isPositiveVital(sample.hrv)) {
            agg.hrvSum += sample.hrv;
            agg.hrvCount += 1;
            agg.hrvMin =
              agg.hrvMin == null
                ? sample.hrv
                : Math.min(agg.hrvMin, sample.hrv);
            agg.hrvMax =
              agg.hrvMax == null
                ? sample.hrv
                : Math.max(agg.hrvMax, sample.hrv);
            if (sampleTs >= agg.hrvLatestTs) {
              agg.hrvLatestTs = sampleTs;
              agg.hrvLatest = sample.hrv;
            }
          }
          if (
            isPositiveVital(sample.systolicBp) &&
            isPositiveVital(sample.diastolicBp)
          ) {
            agg.sysSum += sample.systolicBp;
            agg.diaSum += sample.diastolicBp;
            agg.bpCount += 1;
            agg.sysMin =
              agg.sysMin == null
                ? sample.systolicBp
                : Math.min(agg.sysMin, sample.systolicBp);
            agg.sysMax =
              agg.sysMax == null
                ? sample.systolicBp
                : Math.max(agg.sysMax, sample.systolicBp);
            agg.diaMin =
              agg.diaMin == null
                ? sample.diastolicBp
                : Math.min(agg.diaMin, sample.diastolicBp);
            agg.diaMax =
              agg.diaMax == null
                ? sample.diastolicBp
                : Math.max(agg.diaMax, sample.diastolicBp);
            if (sampleTs >= agg.bpLatestTs) {
              agg.bpLatestTs = sampleTs;
              agg.sysLatest = sample.systolicBp;
              agg.diaLatest = sample.diastolicBp;
            }
          }
          if (isPositiveVital(sample.temperatureC)) {
            agg.tempSum += sample.temperatureC;
            agg.tempCount += 1;
            agg.tempMin =
              agg.tempMin == null
                ? sample.temperatureC
                : Math.min(agg.tempMin, sample.temperatureC);
            agg.tempMax =
              agg.tempMax == null
                ? sample.temperatureC
                : Math.max(agg.tempMax, sample.temperatureC);
            if (sampleTs >= agg.tempLatestTs) {
              agg.tempLatestTs = sampleTs;
              agg.tempLatest = sample.temperatureC;
            }
          }
          if (isPositiveVital(sample.stress)) {
            agg.stressSum += sample.stress;
            agg.stressCount += 1;
            agg.stressMin =
              agg.stressMin == null
                ? sample.stress
                : Math.min(agg.stressMin, sample.stress);
            agg.stressMax =
              agg.stressMax == null
                ? sample.stress
                : Math.max(agg.stressMax, sample.stress);
            if (sampleTs >= agg.stressLatestTs) {
              agg.stressLatestTs = sampleTs;
              agg.stressLatest = sample.stress;
            }
          }

          if (key === 'totalActivity') {
            if (sample.steps != null) agg.steps = sample.steps;
            if (sample.distanceKm != null) agg.distanceKm = sample.distanceKm;
            if (sample.caloriesKcal != null)
              agg.caloriesKcal = sample.caloriesKcal;
            if (sample.exerciseMinutes != null)
              agg.exerciseMinutes = sample.exerciseMinutes;
            if (sample.activeMinutes != null)
              agg.activeMinutes = sample.activeMinutes;
            if (sample.goalPercent != null)
              agg.goalPercent = sample.goalPercent;
          } else {
            if (sample.steps != null)
              agg.steps =
                agg.steps == null
                  ? sample.steps
                  : Math.max(agg.steps, sample.steps);
            if (sample.distanceKm != null) {
              agg.distanceKm =
                agg.distanceKm == null
                  ? sample.distanceKm
                  : Math.max(agg.distanceKm, sample.distanceKm);
            }
            if (sample.caloriesKcal != null) {
              agg.caloriesKcal =
                agg.caloriesKcal == null
                  ? sample.caloriesKcal
                  : Math.max(agg.caloriesKcal, sample.caloriesKcal);
            }
          }
        }
      }

      return Array.from(aggs.values())
        .sort((a, b) => a.day.localeCompare(b.day))
        .map(day => ({
          date: day.day,
          steps: day.steps,
          distanceKm: day.distanceKm,
          caloriesKcal: day.caloriesKcal,
          exerciseMinutes: day.exerciseMinutes,
          activeMinutes: day.activeMinutes,
          goalPercent: day.goalPercent,
          heartRateAvg:
            day.hrCount > 0 ? Math.round(day.hrSum / day.hrCount) : null,
          heartRateMin: day.hrMin,
          heartRateMax: day.hrMax,
          heartRateLatest: day.hrLatest,
          spo2Avg:
            day.spo2Count > 0 ? Math.round(day.spo2Sum / day.spo2Count) : null,
          spo2Min: day.spo2Min,
          spo2Max: day.spo2Max,
          spo2Latest: day.spo2Latest,
          hrvAvg:
            day.hrvCount > 0 ? Math.round(day.hrvSum / day.hrvCount) : null,
          hrvMin: day.hrvMin,
          hrvMax: day.hrvMax,
          hrvLatest: day.hrvLatest,
          systolicBpMin: day.sysMin,
          systolicBpMax: day.sysMax,
          systolicBpAvg:
            day.bpCount > 0 ? Math.round(day.sysSum / day.bpCount) : null,
          diastolicBpMin: day.diaMin,
          diastolicBpMax: day.diaMax,
          diastolicBpAvg:
            day.bpCount > 0 ? Math.round(day.diaSum / day.bpCount) : null,
          systolicBpLatest: day.sysLatest,
          diastolicBpLatest: day.diaLatest,
          temperatureMinC: day.tempMin,
          temperatureMaxC: day.tempMax,
          temperatureAvgC:
            day.tempCount > 0
              ? Number((day.tempSum / day.tempCount).toFixed(1))
              : null,
          temperatureLatestC: day.tempLatest,
          stressMin: day.stressMin,
          stressMax: day.stressMax,
          stressAvg:
            day.stressCount > 0
              ? Math.round(day.stressSum / day.stressCount)
              : null,
          stressLatest: day.stressLatest,
        }));
    },
    [],
  );

  // The app only ever syncs the day the band is filling in now. There is no
  // backfill path: a missed day stays missed rather than being reconstructed
  // from a history read the band may no longer hold.
  const syncTodayVitalsToBackend = useCallback(
    async (
      bandDay: string,
      days: V8DailyVitalSummary[],
    ): Promise<{ days: number }> => {
      if (user?.role !== 'SENIOR') {
        throw new Error('Only senior users can sync Hand Band health data.');
      }
      const seniorId = user.user_id.trim();
      if (!seniorId) {
        throw new Error('Senior ID is required before syncing vitals.');
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

      const allVitalSummaries: V8WebVitalSummary[] = days.map(day => ({
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

      // Today's row is still being filled in as the day progresses, so a sync
      // never refuses to send: whatever the history aggregation leaves out is
      // taken from the latest live sample, and anything still missing after
      // that goes as 0. A day the band recorded nothing on is sent as a row of
      // zeros rather than skipped, so every day is present on the backend.
      const aggregatedRow =
        allVitalSummaries.find(summary => summary.recordDate === bandDay) ??
        allVitalSummaries[0];
      const liveFallback = latestLiveDataRef.current;
      const normalizedSummaries = [
        fillTodayVitalSummaryGaps(
          // Relabelled rather than dropped: a row the aggregation dated
          // differently still holds the band's readings for this sync.
          { ...(aggregatedRow ?? emptyVitalSummary(bandDay)), recordDate: bandDay },
          liveFallback,
        ),
      ];

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
        source: aggregatedRow
          ? 'band history'
          : liveFallback
          ? 'live sample only'
          : 'zeros - band recorded nothing today',
      });

      await syncV8VitalsByDevice(webPayload);
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
      return { days: 1 };
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
      // No rows is not a failure - the sync falls back to the live sample and
      // then to zeros, so the day is still recorded.
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
