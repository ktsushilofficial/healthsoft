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
import {
  analyzeWaveformHeartRate,
  createV8EcgSession,
  estimateObservedSampleRateHz,
  parseV8EcgPayload,
} from './ecg';
import {
  getAssignedHandBandMacAddress,
  normalizeMacAddress,
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

export type V8AutoSyncStatus = {
  enabled: boolean;
  phase: 'disabled' | 'waiting' | 'scheduled' | 'syncing' | 'error';
  lastSyncedAt: number | null;
  nextSyncAt: number | null;
  error: string | null;
};

type V8BleContextValue = {
  bleState: 'PoweredOn' | 'Unsupported';
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
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  connect: (deviceId: string) => Promise<void>;
  disconnect: (deviceId: string) => Promise<void>;
  requestDeviceVersion: () => Promise<void>;
  requestBattery: () => Promise<void>;
  requestDeviceMac: () => Promise<void>;
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
  requestHistoryBundle: () => Promise<void>;
  requestTotalActivityRange: (
    fromDate: string,
    toDate: string,
  ) => Promise<void>;
  buildDailyVitalsRange: (
    fromDate: string,
    toDate: string,
  ) => Promise<V8DailyVitalSummary[]>;
  syncDailyVitalsToBackend: (
    fromDate: string,
    toDate: string,
    days: V8DailyVitalSummary[],
  ) => Promise<{ days: number }>;
  syncVitalsRangeToBackend: (
    fromDate: string,
    toDate: string,
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
const MAX_PERSISTED_ECG_SAMPLES = 4_000;
const MIN_ECG_SAMPLE_RATE_HZ = 250;
const LATE_ECG_RESULT_WINDOW_MS = 5_000;
const normalizeId = (id?: string | null) => (id ?? '').trim().toLowerCase();
const logV8Debug = (label: string, value?: unknown) => {
  if (!__DEV__) return;
  if (value === undefined) {
    console.log(`[V8 Debug] ${label}`);
    return;
  }
  console.log(`[V8 Debug] ${label}`, value);
};

const sampleDayKey = (sample: V8VitalSample): string | null => {
  const raw = sample.timestamp?.trim();
  if (raw) {
    if (/^\d{10,13}$/.test(raw)) {
      const epoch = raw.length === 13 ? Number(raw) : Number(raw) * 1000;
      if (Number.isFinite(epoch))
        return new Date(epoch).toISOString().slice(0, 10);
    }
    const normalized = raw.replace(/\//g, '-').replace(/\./g, '-');
    const direct = normalized.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (direct) {
      const y = direct[1];
      const m = direct[2].padStart(2, '0');
      const d = direct[3].padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime()))
      return parsed.toISOString().slice(0, 10);
    if (Platform.OS === 'ios' && sample.receivedAt != null) {
      return new Date(sample.receivedAt).toISOString().slice(0, 10);
    }
    return null;
  }
  if (sample.receivedAt != null)
    return new Date(sample.receivedAt).toISOString().slice(0, 10);
  return null;
};

const subtractDaysYmdUtc = (ymd: string, days: number): string => {
  const match = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return ymd;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const shifted = new Date(utcMs - days * 24 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const addDaysYmdUtc = (ymd: string, days: number): string => {
  const match = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return ymd;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const shifted = new Date(utcMs + days * 24 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const diffDaysYmdUtc = (fromYmd: string, toYmd: string): number => {
  const fromMatch = fromYmd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const toMatch = toYmd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!fromMatch || !toMatch) return 0;
  const fromMs = Date.UTC(
    Number(fromMatch[1]),
    Number(fromMatch[2]) - 1,
    Number(fromMatch[3]),
  );
  const toMs = Date.UTC(
    Number(toMatch[1]),
    Number(toMatch[2]) - 1,
    Number(toMatch[3]),
  );
  return Math.max(0, Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)));
};

const useV8BleManagerInternal = (): V8BleContextValue => {
  const {
    user,
    selectedSenior,
    syncV8VitalsByDevice,
    getAssignedDevicesForSenior,
    selectedSeniorHandBandMacs,
  } = useAuth();
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
  const [deviceInfo, setDeviceInfo] = useState<V8DeviceInfo>({
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

  useEffect(
    () => () => {
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
    historyByTypeRef.current = historyByType;
  }, [historyByType]);

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
          };
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
            setDeviceInfo(prev => ({ ...prev, ...parsed.deviceInfo }));
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
        setLastConnectedDeviceId(rawDeviceId);
        Keychain.setGenericPassword(
          V8_SESSION_USER,
          JSON.stringify({ lastConnectedDeviceId: rawDeviceId }),
          {
            service: V8_SESSION_SERVICE,
            accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          },
        ).catch(() => {});
        // Prime visible device info after successful connection.
        v8Native?.requestBattery().catch(() => {});
        v8Native?.requestDeviceVersion().catch(() => {});
        v8Native?.requestDeviceMac().catch(() => {});
        v8Native?.requestDeviceName().catch(() => {});
        v8Native?.requestDeviceTime().catch(() => {});
        v8Native?.requestPersonalInfo().catch(() => {});
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
                ? Math.min(30_000, now - prev.startedAt)
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
      setIsScanning(false);
      setScanError(
        error instanceof Error
          ? error.message
          : 'Failed to scan for V8 devices.',
      );
    }
  }, []);

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
      if (assignedMacs.size === 0) {
        throw new Error(
          'No Hand Band MAC address is assigned to the selected senior.',
        );
      }
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
        await v8Native.connect(deviceId);
      } catch (error) {
        setConnectionStates(prev => ({
          ...prev,
          [normalizedTargetId]: 'error',
        }));
        throw error;
      }
    },
    [activeDeviceId, selectedSeniorHandBandMacs],
  );

  const disconnect = useCallback(
    async (deviceId: string) => {
      if (!v8Native) return;
      const normalizedTargetId = normalizeId(deviceId);
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
        setSuppressAutoConnectUntil(Date.now() + 15000);
      }
    },
    [activeDeviceId],
  );

  useEffect(() => {
    if (!activeDeviceId || connectionStates[activeDeviceId] !== 'connected')
      return;
    const connectedMac = resolveConnectedHandBandMac(
      deviceInfo.mac,
      activeDeviceId,
    );
    if (!connectedMac) return;

    const assignedMacs = new Set(
      selectedSeniorHandBandMacs
        .map(value => normalizeMacAddress(value))
        .filter((value): value is string => !!value),
    );
    if (assignedMacs.has(connectedMac)) {
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
              ? Math.min(30_000, recordingStoppedAt - prev.startedAt)
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

  const requestHistoryBundle = useCallback(async () => {
    const native = v8Native;
    if (!native) return;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const start =
      Platform.OS === 'ios'
        ? sevenDaysAgo.getTime()
        : `${sevenDaysAgo.toISOString().slice(0, 10)} 00:00:00`;

    const requestPage = async (mode: number) =>
      Promise.all([
        native.requestTotalActivity(mode, start),
        native.requestDetailActivity(mode, start),
        native.requestSleep(mode, start),
        native.requestDynamicHR(mode, start),
        native.requestStaticHR(mode, start),
        native.requestHRV(mode, start),
        native.requestSpo2
          ? native.requestSpo2(mode, start)
          : Promise.resolve(true),
        native.requestTemperature
          ? native.requestTemperature(mode, start)
          : Promise.resolve(true),
      ]);

    // Fetch latest page first, then next page for better 7-day coverage on bands
    // that chunk history in vendor-defined pages.
    await requestPage(0);
    await new Promise<void>(resolve => setTimeout(resolve, 400));
    await requestPage(2);
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
          : `${oneDayAgo.toISOString().slice(0, 10)} ${oneDayAgo
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

  const requestTotalActivityRange = useCallback(
    async (fromDate: string, toDate: string) => {
      if (!v8Native) return;
      const parseYmd = (value: string): Date | null => {
        const trimmed = value.trim();
        const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
        return Number.isNaN(date.getTime()) ? null : date;
      };
      const from = parseYmd(fromDate);
      const to = parseYmd(toDate);
      if (!from || !to) {
        throw new Error('Use YYYY-MM-DD date format.');
      }
      if (from.getTime() > to.getTime()) {
        throw new Error('From date must be before To date.');
      }

      const start =
        Platform.OS === 'ios' ? from.getTime() : `${fromDate} 00:00:00`;

      const syncStartedAt = Date.now();
      const maxPages = 12;
      for (let page = 0; page < maxPages; page += 1) {
        const mode = page === 0 ? 0 : 2;
        await v8Native.requestTotalActivity(mode, start);
        await new Promise<void>(resolve => setTimeout(resolve, 350));
        const totalBucket = historyByTypeRef.current.totalActivity;
        if (totalBucket?.completed && totalBucket.updatedAt >= syncStartedAt) {
          break;
        }
      }
    },
    [],
  );

  const buildDailyVitalsRange = useCallback(
    async (
      fromDate: string,
      toDate: string,
    ): Promise<V8DailyVitalSummary[]> => {
      const parseYmd = (value: string): Date | null => {
        const trimmed = value.trim();
        const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
        return Number.isNaN(date.getTime()) ? null : date;
      };
      const from = parseYmd(fromDate);
      const to = parseYmd(toDate);
      if (!from || !to) {
        throw new Error('Use YYYY-MM-DD date format.');
      }
      if (from.getTime() > to.getTime()) {
        throw new Error('From date must be before To date.');
      }
      const native = v8Native;
      if (!native) return [];

      const start =
        Platform.OS === 'ios' ? from.getTime() : `${fromDate} 00:00:00`;

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

      const fromTs = new Date(`${fromDate}T00:00:00`).getTime();
      const toTs = new Date(`${toDate}T23:59:59`).getTime();
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

          if (sample.heartRate != null) {
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
          if (sample.spo2 != null) {
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
          if (sample.hrv != null) {
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
          if (sample.systolicBp != null && sample.diastolicBp != null) {
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
          if (sample.temperatureC != null) {
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
          if (sample.stress != null) {
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

  const syncDailyVitalsToBackend = useCallback(
    async (
      fromDate: string,
      toDate: string,
      days: V8DailyVitalSummary[],
    ): Promise<{ days: number }> => {
      if (user?.role !== 'SENIOR') {
        throw new Error('Only senior users can sync Hand Band health data.');
      }
      const seniorId = user.user_id.trim();
      if (!seniorId) {
        throw new Error('Senior ID is required before syncing vitals.');
      }
      const connectedMac = resolveConnectedHandBandMac(
        deviceInfo.mac,
        activeDeviceId,
      );
      if (!connectedMac) {
        throw new Error(
          'Connected Hand Band MAC is unavailable. Open Manage and refresh device info.',
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

      // Sync window should be inclusive of both fromDate and toDate.
      const requestedSyncDays = Math.max(
        1,
        diffDaysYmdUtc(fromDate, toDate) + 1,
      );
      const syncDays = requestedSyncDays;
      const syncFromComputed = subtractDaysYmdUtc(toDate, syncDays - 1);
      const byRecordDate = new Map(
        allVitalSummaries.map(summary => [summary.recordDate, summary]),
      );
      const effectiveSummaries: V8WebVitalSummary[] = Array.from(
        { length: syncDays },
        (_, i) => {
          const date = addDaysYmdUtc(syncFromComputed, i);
          const row = byRecordDate.get(date);
          if (row) {
            return row;
          }
          return {
            recordDate: date,
            steps: null,
            distanceKm: null,
            caloriesKcal: null,
            exerciseMinutes: null,
            activeMinutes: null,
            goalPercent: null,
            hrMin: null,
            hrMax: null,
            hrAvg: null,
            hrLatest: null,
            spo2Min: null,
            spo2Max: null,
            spo2Avg: null,
            spo2Latest: null,
            hrvMin: null,
            hrvMax: null,
            hrvAvg: null,
            hrvLatest: null,
            systolicBpMin: null,
            systolicBpMax: null,
            systolicBpAvg: null,
            systolicBpLatest: null,
            diastolicBpMin: null,
            diastolicBpMax: null,
            diastolicBpAvg: null,
            diastolicBpLatest: null,
            tempMin: null,
            tempMax: null,
            tempAvg: null,
            tempLatest: null,
            stressMin: null,
            stressMax: null,
            stressAvg: null,
            stressLatest: null,
          };
        },
      );

      const webPayload: V8WebVitalsSyncPayload = {
        deviceUUID,
        syncDays,
        syncFrom: syncFromComputed,
        syncTo: toDate,
        vitalSummaries: effectiveSummaries,
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
        rows: webPayload.vitalSummaries.length,
        firstRecordDate: webPayload.vitalSummaries[0]?.recordDate ?? null,
        lastRecordDate:
          webPayload.vitalSummaries[webPayload.vitalSummaries.length - 1]
            ?.recordDate ?? null,
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
      return { days: days.length };
    },
    [
      activeDeviceId,
      deviceInfo.mac,
      getAssignedDevicesForSenior,
      selectedSeniorHandBandMacs,
      syncV8VitalsByDevice,
      user?.role,
      user?.user_id,
    ],
  );

  const syncVitalsRangeToBackend = useCallback(
    async (fromDate: string, toDate: string): Promise<{ days: number }> => {
      const days = await buildDailyVitalsRange(fromDate, toDate);
      return syncDailyVitalsToBackend(fromDate, toDate, days);
    },
    [buildDailyVitalsRange, syncDailyVitalsToBackend],
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
    setLiveModeEnabled(false);
    setConnectionStates({});
    setDevicesById({});
    setLastConnectedDeviceId(null);
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
    if (isScanning) return;
    const rememberedMac = resolveConnectedHandBandMac(
      deviceInfo.mac,
      lastConnectedDeviceId,
    );
    const assignedMacs = selectedSeniorHandBandMacs
      .map(value => normalizeMacAddress(value))
      .filter((value): value is string => !!value);
    if (!rememberedMac || !assignedMacs.includes(rememberedMac)) return;
    const state = connectionStates[normalizeId(lastConnectedDeviceId)];
    if (state === 'connected' || state === 'connecting') return;
    try {
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
    connectionStates,
    deviceInfo.mac,
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
      const today = new Date().toISOString().slice(0, 10);
      const todayRows = await buildDailyVitalsRange(today, today);
      const rowsToSync = todayRows.filter(row => row.date === today);
      if (rowsToSync.length === 0) {
        throw new Error('No current hand band health data is available yet.');
      }
      await syncDailyVitalsToBackend(today, today, rowsToSync);
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
    buildDailyVitalsRange,
    connectionStates,
    deviceInfo.mac,
    ensureAutoConnect,
    requestDeviceMac,
    selectedSeniorHandBandMacs.length,
    syncDailyVitalsToBackend,
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
    bleState: isV8NativeAvailable ? 'PoweredOn' : 'Unsupported',
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
    startScan,
    stopScan,
    connect,
    disconnect,
    requestDeviceVersion,
    requestBattery,
    requestDeviceMac,
    requestDeviceName,
    requestDeviceTime,
    syncDeviceTime,
    requestPersonalInfo,
    setRealtimeStepEnabled,
    startEcgMeasurement,
    finishEcgMeasurement,
    cancelEcgMeasurement,
    resetEcgMeasurement,
    requestHistoryBundle,
    requestTotalActivityRange,
    buildDailyVitalsRange,
    syncDailyVitalsToBackend,
    syncVitalsRangeToBackend,
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
