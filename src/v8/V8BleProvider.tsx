import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import { useAuth } from '../context/AuthContext';
import type { V8ConnectionState, V8Device } from './types';
import { isV8NativeAvailable, v8Emitter, v8Native } from './nativeV8';
import type { V8DailyVitalSummary, V8DailyVitalsSyncPayload, V8DeviceInfo, V8HistoryBucket, V8VitalSample } from './models';
import { parseV8Payload } from './parser';

type ParsedData = {
  type: 'parsed' | 'raw';
  payload?: Record<string, unknown>;
  payloadHex?: string;
};

type V8BleContextValue = {
  bleState: 'PoweredOn' | 'Unsupported';
  devices: V8Device[];
  isScanning: boolean;
  scanError: string | null;
  connectionStates: Record<string, V8ConnectionState>;
  dataEvents: ParsedData[];
  latestLiveData: V8VitalSample | null;
  historyByType: Record<string, V8HistoryBucket>;
  deviceInfo: V8DeviceInfo;
  liveModeEnabled: boolean;
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
  setRealtimeStepEnabled: (enabled: boolean, includeTemperature: boolean) => Promise<void>;
  requestHistoryBundle: () => Promise<void>;
  requestTotalActivityRange: (fromDate: string, toDate: string) => Promise<void>;
  buildDailyVitalsRange: (fromDate: string, toDate: string) => Promise<V8DailyVitalSummary[]>;
  syncVitalsRangeToBackend: (fromDate: string, toDate: string) => Promise<{ days: number }>;
  requestLiveSnapshot: () => Promise<void>;
  clearSavedData: () => Promise<void>;
  ensureAutoConnect: () => Promise<void>;
};

const V8BleContext = createContext<V8BleContextValue | null>(null);
const V8_SESSION_SERVICE = 'healthsoft.v8.session';
const V8_SESSION_USER = 'v8-session';
const V8_HISTORY_SERVICE = 'healthsoft.v8.history';
const V8_HISTORY_USER = 'v8-history';
const normalizeId = (id?: string | null) => (id ?? '').trim().toLowerCase();

const sampleDayKey = (sample: V8VitalSample): string | null => {
  const raw = sample.timestamp?.trim();
  if (raw) {
    if (/^\d{10,13}$/.test(raw)) {
      const epoch = raw.length === 13 ? Number(raw) : Number(raw) * 1000;
      if (Number.isFinite(epoch)) return new Date(epoch).toISOString().slice(0, 10);
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
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    if (Platform.OS === 'ios' && sample.receivedAt != null) {
      return new Date(sample.receivedAt).toISOString().slice(0, 10);
    }
    return null;
  }
  if (sample.receivedAt != null) return new Date(sample.receivedAt).toISOString().slice(0, 10);
  return null;
};

const useV8BleManagerInternal = (): V8BleContextValue => {
  const { selectedSenior, user, syncV8DailyVitals } = useAuth();
  const [devicesById, setDevicesById] = useState<Record<string, V8Device>>({});
  const [connectionStates, setConnectionStates] = useState<Record<string, V8ConnectionState>>({});
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [dataEvents, setDataEvents] = useState<ParsedData[]>([]);
  const [latestLiveData, setLatestLiveData] = useState<V8VitalSample | null>(null);
  const [historyByType, setHistoryByType] = useState<Record<string, V8HistoryBucket>>({});
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
  const [lastConnectedDeviceId, setLastConnectedDeviceId] = useState<string | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [suppressAutoConnectUntil, setSuppressAutoConnectUntil] = useState<number>(0);
  const [liveModeEnabled, setLiveModeEnabled] = useState(false);
  const liveSnapshotInFlightRef = useRef(false);
  const liveSnapshotPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    historyByTypeRef.current = historyByType;
  }, [historyByType]);

  useEffect(() => {
    let active = true;
    Keychain.getGenericPassword({ service: V8_SESSION_SERVICE })
      .then(value => {
        if (!active || !value) return;
        try {
          const parsed = JSON.parse(value.password) as { lastConnectedDeviceId?: string };
          if (parsed.lastConnectedDeviceId) setLastConnectedDeviceId(parsed.lastConnectedDeviceId);
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
          if (parsed.historyByType && typeof parsed.historyByType === 'object') {
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
      const rawDeviceId = (evt?.deviceId as string | undefined) ?? 'default';
      const normalizedDeviceId = normalizeId(rawDeviceId || 'default');
      const state = (evt?.state as V8ConnectionState | undefined) ?? 'disconnected';
      setConnectionStates(prev => ({ ...prev, [normalizedDeviceId]: state }));
      if (state === 'connected') {
        setActiveDeviceId(normalizedDeviceId);
      } else if (state === 'disconnected') {
        setActiveDeviceId(prev => (prev === normalizedDeviceId ? null : prev));
        setLiveModeEnabled(false);
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
      // Defer heavy processing until after any in-progress animations (tab
      // transitions, etc.) have completed so we never block the UI thread.
      InteractionManager.runAfterInteractions(() => {
        setDataEvents(prev => [event, ...prev].slice(0, 50));
        if (event.type !== 'parsed' || !event.payload) return;
        const { history, infoPatch } = parseV8Payload(event.payload);

        setDeviceInfo(prev => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(infoPatch).filter(([, value]) => value !== null && value !== undefined),
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
          setHistoryByType(prev => {
            const existing = prev[key];
            const mergedEntries = [...(existing?.entries ?? []), ...history.entries];
            // O(n) dedup using a Set instead of O(n²) filter+findIndex.
            const seen = new Set<string>();
            const deduped: V8VitalSample[] = [];
            for (const entry of mergedEntries) {
              const marker = `${entry.timestamp ?? ''}-${entry.heartRate ?? ''}-${entry.hrv ?? ''}-${entry.systolicBp ?? ''}-${entry.diastolicBp ?? ''}-${entry.steps ?? ''}-${entry.distanceKm ?? ''}-${entry.temperatureC ?? ''}-${entry.caloriesKcal ?? ''}-${entry.exerciseMinutes ?? ''}-${entry.activeMinutes ?? ''}-${entry.goalPercent ?? ''}`;
              if (!seen.has(marker)) {
                seen.add(marker);
                deduped.push(entry);
              }
            }

            const nextBucket: V8HistoryBucket = {
              dataType: history.dataType,
              completed: history.completed || existing?.completed === true,
              updatedAt: history.updatedAt,
              entries: deduped,
            };

            return { ...prev, [key]: nextBucket };
          });
        }
      });
    });

    return () => {
      scanSub.remove();
      stateSub.remove();
      dataSub.remove();
    };
  }, []);

  const startScan = useCallback(async () => {
    if (!v8Native) {
      setScanError('Vendor V8 native module is unavailable on this platform.');
      return;
    }
    try {
      setScanError(null);
      setIsScanning(true);
      await v8Native.startScan(['v8', 'jstyle']);
      setTimeout(() => setIsScanning(false), 10000);
    } catch (error) {
      setIsScanning(false);
      setScanError(error instanceof Error ? error.message : 'Failed to scan for V8 devices.');
    }
  }, []);

  const stopScan = useCallback(async () => {
    if (!v8Native) return;
    await v8Native.stopScan();
    setIsScanning(false);
  }, []);

  const connect = useCallback(async (deviceId: string) => {
    if (!v8Native) return;
    const normalizedTargetId = normalizeId(deviceId);
    const currentlyActive = activeDeviceId ? normalizeId(activeDeviceId) : null;
    if (currentlyActive && currentlyActive !== normalizedTargetId) {
      try {
        await v8Native.disconnect();
      } catch {
        // best effort
      }
      setConnectionStates(prev => ({ ...prev, [currentlyActive]: 'disconnected' }));
      setActiveDeviceId(null);
    }
    setConnectionStates(prev => ({ ...prev, [normalizedTargetId]: 'connecting' }));
    try {
      await v8Native.connect(deviceId);
    } catch (error) {
      setConnectionStates(prev => ({ ...prev, [normalizedTargetId]: 'error' }));
      throw error;
    }
  }, [activeDeviceId]);

  const disconnect = useCallback(async (deviceId: string) => {
    if (!v8Native) return;
    const normalizedTargetId = normalizeId(deviceId);
    setConnectionStates(prev => ({ ...prev, [normalizedTargetId]: 'disconnecting' }));
    try {
      await v8Native.disconnect();
    } finally {
      setConnectionStates(prev => ({ ...prev, [normalizedTargetId]: 'disconnected' }));
      if (activeDeviceId === normalizedTargetId) {
        setActiveDeviceId(null);
      }
      setSuppressAutoConnectUntil(Date.now() + 15000);
    }
  }, [activeDeviceId]);

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
  const setRealtimeStepEnabled = useCallback(async (enabled: boolean, includeTemperature: boolean) => {
    if (!v8Native) return;
    await v8Native.setRealtimeStepEnabled(enabled, includeTemperature);
    setLiveModeEnabled(enabled);
  }, []);

  const requestHistoryBundle = useCallback(async () => {
    if (!v8Native) return;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    sevenDaysAgo.setHours(0, 0, 0, 0);
    const start = Platform.OS === 'ios'
      ? sevenDaysAgo.getTime()
      : `${sevenDaysAgo.toISOString().slice(0, 10)} 00:00:00`;

    const requestPage = async (mode: number) => Promise.all([
      v8Native.requestTotalActivity(mode, start),
      v8Native.requestDetailActivity(mode, start),
      v8Native.requestSleep(mode, start),
      v8Native.requestDynamicHR(mode, start),
      v8Native.requestStaticHR(mode, start),
      v8Native.requestHRV(mode, start),
      v8Native.requestSpo2 ? v8Native.requestSpo2(mode, start) : Promise.resolve(true),
      v8Native.requestTemperature ? v8Native.requestTemperature(mode, start) : Promise.resolve(true),
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
      const start = Platform.OS === 'ios'
        ? oneDayAgo.getTime()
        : `${oneDayAgo.toISOString().slice(0, 10)} ${oneDayAgo.toTimeString().slice(0, 8)}`;

      // Request vital data types so steps, BP, SpO2, temperature, and HR are populated.
      // NOTE: requestTotalActivity is intentionally excluded — it returns
      // inflated/stale daily totals that overwrite the accurate interval
      // values from requestStaticHR / requestDetailActivity.
      await Promise.all([
        v8Native.requestStaticHR(0, start),
        v8Native.requestDynamicHR(0, start),
        v8Native.requestHRV(0, start),
        v8Native.requestSpo2 ? v8Native.requestSpo2(0, start) : Promise.resolve(true),
      ]);
      await Promise.all([
        v8Native.requestTemperature ? v8Native.requestTemperature(0, start) : Promise.resolve(true),
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

  const requestTotalActivityRange = useCallback(async (fromDate: string, toDate: string) => {
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

    const start = Platform.OS === 'ios'
      ? from.getTime()
      : `${fromDate} 00:00:00`;

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
  }, []);

  const buildDailyVitalsRange = useCallback(async (fromDate: string, toDate: string): Promise<V8DailyVitalSummary[]> => {
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
    if (!v8Native) return [];

    const start = Platform.OS === 'ios'
      ? from.getTime()
      : `${fromDate} 00:00:00`;

    const initialUpdatedAt: Record<string, number> = Object.fromEntries(
      Object.entries(historyByTypeRef.current).map(([k, b]) => [k, b.updatedAt]),
    );
    const targetKeys = ['totalActivity', 'detailActivity', 'dynamicHR', 'staticHR', 'hrv', 'spo2', 'temperature'];
    const maxPages = 12;
    for (let page = 0; page < maxPages; page += 1) {
      const mode = page === 0 ? 0 : 2;
      await Promise.all([
        v8Native.requestTotalActivity(mode, start),
        v8Native.requestDetailActivity(mode, start),
        v8Native.requestDynamicHR(mode, start),
        v8Native.requestStaticHR(mode, start),
        v8Native.requestHRV(mode, start),
        v8Native.requestSpo2 ? v8Native.requestSpo2(mode, start) : Promise.resolve(true),
        v8Native.requestTemperature ? v8Native.requestTemperature(mode, start) : Promise.resolve(true),
      ]);
      await new Promise<void>(resolve => setTimeout(resolve, 450));
      const done = targetKeys.every(key => {
        const bucket = historyByTypeRef.current[key];
        if (!bucket) return false;
        const prevUpdated = initialUpdatedAt[key] ?? 0;
        return bucket.completed && bucket.updatedAt >= prevUpdated;
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
      spo2Latest: number | null;
      spo2LatestTs: number;
      hrvSum: number;
      hrvCount: number;
      hrvLatest: number | null;
      hrvLatestTs: number;
      sysSum: number;
      diaSum: number;
      bpCount: number;
      sysLatest: number | null;
      diaLatest: number | null;
      bpLatestTs: number;
      tempSum: number;
      tempCount: number;
      tempLatest: number | null;
      tempLatestTs: number;
      stressSum: number;
      stressCount: number;
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
        spo2Latest: null,
        spo2LatestTs: 0,
        hrvSum: 0,
        hrvCount: 0,
        hrvLatest: null,
        hrvLatestTs: 0,
        sysSum: 0,
        diaSum: 0,
        bpCount: 0,
        sysLatest: null,
        diaLatest: null,
        bpLatestTs: 0,
        tempSum: 0,
        tempCount: 0,
        tempLatest: null,
        tempLatestTs: 0,
        stressSum: 0,
        stressCount: 0,
      };
      aggs.set(day, created);
      return created;
    };

    for (const [key, bucket] of Object.entries(historyByTypeRef.current)) {
      for (const sample of bucket.entries) {
        const day = sampleDayKey(sample);
        if (!day) continue;
        const dayTs = new Date(`${day}T00:00:00`).getTime();
        if (!Number.isFinite(dayTs) || dayTs < fromTs || dayTs > toTs) continue;
        const agg = ensure(day);
        const sampleTs = sample.receivedAt ?? 0;

        if (sample.heartRate != null) {
          agg.hrSum += sample.heartRate;
          agg.hrCount += 1;
          agg.hrMin = agg.hrMin == null ? sample.heartRate : Math.min(agg.hrMin, sample.heartRate);
          agg.hrMax = agg.hrMax == null ? sample.heartRate : Math.max(agg.hrMax, sample.heartRate);
          if (sampleTs >= agg.hrLatestTs) {
            agg.hrLatestTs = sampleTs;
            agg.hrLatest = sample.heartRate;
          }
        }
        if (sample.spo2 != null) {
          agg.spo2Sum += sample.spo2;
          agg.spo2Count += 1;
          agg.spo2Min = agg.spo2Min == null ? sample.spo2 : Math.min(agg.spo2Min, sample.spo2);
          if (sampleTs >= agg.spo2LatestTs) {
            agg.spo2LatestTs = sampleTs;
            agg.spo2Latest = sample.spo2;
          }
        }
        if (sample.hrv != null) {
          agg.hrvSum += sample.hrv;
          agg.hrvCount += 1;
          if (sampleTs >= agg.hrvLatestTs) {
            agg.hrvLatestTs = sampleTs;
            agg.hrvLatest = sample.hrv;
          }
        }
        if (sample.systolicBp != null && sample.diastolicBp != null) {
          agg.sysSum += sample.systolicBp;
          agg.diaSum += sample.diastolicBp;
          agg.bpCount += 1;
          if (sampleTs >= agg.bpLatestTs) {
            agg.bpLatestTs = sampleTs;
            agg.sysLatest = sample.systolicBp;
            agg.diaLatest = sample.diastolicBp;
          }
        }
        if (sample.temperatureC != null) {
          agg.tempSum += sample.temperatureC;
          agg.tempCount += 1;
          if (sampleTs >= agg.tempLatestTs) {
            agg.tempLatestTs = sampleTs;
            agg.tempLatest = sample.temperatureC;
          }
        }
        if (sample.stress != null) {
          agg.stressSum += sample.stress;
          agg.stressCount += 1;
        }

        if (key === 'totalActivity') {
          if (sample.steps != null) agg.steps = sample.steps;
          if (sample.distanceKm != null) agg.distanceKm = sample.distanceKm;
          if (sample.caloriesKcal != null) agg.caloriesKcal = sample.caloriesKcal;
          if (sample.exerciseMinutes != null) agg.exerciseMinutes = sample.exerciseMinutes;
          if (sample.activeMinutes != null) agg.activeMinutes = sample.activeMinutes;
          if (sample.goalPercent != null) agg.goalPercent = sample.goalPercent;
        } else {
          if (sample.steps != null) agg.steps = agg.steps == null ? sample.steps : Math.max(agg.steps, sample.steps);
          if (sample.distanceKm != null) {
            agg.distanceKm = agg.distanceKm == null ? sample.distanceKm : Math.max(agg.distanceKm, sample.distanceKm);
          }
          if (sample.caloriesKcal != null) {
            agg.caloriesKcal = agg.caloriesKcal == null
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
        heartRateAvg: day.hrCount > 0 ? Math.round(day.hrSum / day.hrCount) : null,
        heartRateMin: day.hrMin,
        heartRateMax: day.hrMax,
        heartRateLatest: day.hrLatest,
        spo2Avg: day.spo2Count > 0 ? Math.round(day.spo2Sum / day.spo2Count) : null,
        spo2Min: day.spo2Min,
        spo2Latest: day.spo2Latest,
        hrvAvg: day.hrvCount > 0 ? Math.round(day.hrvSum / day.hrvCount) : null,
        hrvLatest: day.hrvLatest,
        systolicBpAvg: day.bpCount > 0 ? Math.round(day.sysSum / day.bpCount) : null,
        diastolicBpAvg: day.bpCount > 0 ? Math.round(day.diaSum / day.bpCount) : null,
        systolicBpLatest: day.sysLatest,
        diastolicBpLatest: day.diaLatest,
        temperatureAvgC: day.tempCount > 0 ? Number((day.tempSum / day.tempCount).toFixed(1)) : null,
        temperatureLatestC: day.tempLatest,
        stressAvg: day.stressCount > 0 ? Math.round(day.stressSum / day.stressCount) : null,
      }));
  }, [v8Native]);

  const syncVitalsRangeToBackend = useCallback(async (fromDate: string, toDate: string): Promise<{ days: number }> => {
    const seniorId = (selectedSenior?.userId ?? (user?.role === 'SENIOR' ? user.user_id : '')).trim();
    if (!seniorId) {
      throw new Error('Select a senior before syncing vitals.');
    }
    const days = await buildDailyVitalsRange(fromDate, toDate);
    const payload: V8DailyVitalsSyncPayload = {
      seniorId,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      syncedAt: Date.now(),
      fromDate,
      toDate,
      device: {
        imei: deviceInfo.imei,
        mac: deviceInfo.mac,
        deviceName: deviceInfo.deviceName,
        firmwareVersion: deviceInfo.firmwareVersion,
      },
      days,
    };
    await syncV8DailyVitals(seniorId, payload);
    return { days: days.length };
  }, [buildDailyVitalsRange, deviceInfo.deviceName, deviceInfo.firmwareVersion, deviceInfo.imei, deviceInfo.mac, selectedSenior?.userId, syncV8DailyVitals, user?.role, user?.user_id]);

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
    try {
      await Keychain.resetGenericPassword({ service: V8_HISTORY_SERVICE });
    } catch {
      // ignore
    }
  }, []);

  const ensureAutoConnect = useCallback(async () => {
    if (Date.now() < suppressAutoConnectUntil) return;
    if (!v8Native || !lastConnectedDeviceId) return;
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
  }, [connect, connectionStates, lastConnectedDeviceId, startScan, suppressAutoConnectUntil]);

  useEffect(() => {
    if (!lastConnectedDeviceId || !v8Native) return;
    const timer = setTimeout(() => {
      ensureAutoConnect().catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [ensureAutoConnect, lastConnectedDeviceId]);

  useEffect(() => {
    const cappedHistoryByType: Record<string, V8HistoryBucket> = Object.fromEntries(
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
    Keychain.setGenericPassword(
      V8_HISTORY_USER,
      JSON.stringify(snapshot),
      {
        service: V8_HISTORY_SERVICE,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    ).catch(() => {});
  }, [deviceInfo, historyByType, latestLiveData]);

  const devices = useMemo(() => Object.values(devicesById), [devicesById]);

  return {
    bleState: isV8NativeAvailable ? 'PoweredOn' : 'Unsupported',
    devices,
    isScanning,
    scanError,
    connectionStates,
    dataEvents,
    latestLiveData,
    historyByType,
    deviceInfo,
    liveModeEnabled,
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
    requestHistoryBundle,
    requestTotalActivityRange,
    buildDailyVitalsRange,
    syncVitalsRangeToBackend,
    requestLiveSnapshot,
    clearSavedData,
    ensureAutoConnect,
  };
};

export const V8BleProvider = ({ children }: { children: React.ReactNode }) => {
  const value = useV8BleManagerInternal();
  return <V8BleContext.Provider value={value}>{children}</V8BleContext.Provider>;
};

export const useV8Ble = () => {
  const ctx = useContext(V8BleContext);
  if (!ctx) {
    throw new Error('useV8Ble must be used within V8BleProvider');
  }
  return ctx;
};
