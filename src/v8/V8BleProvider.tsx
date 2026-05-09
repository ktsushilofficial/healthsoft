import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';
import type { V8ConnectionState, V8Device } from './types';
import { isV8NativeAvailable, v8Emitter, v8Native } from './nativeV8';
import type { V8DeviceInfo, V8HistoryBucket, V8VitalSample } from './models';
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
  setRealtimeStepEnabled: (enabled: boolean, includeTemperature: boolean) => Promise<void>;
  requestHistoryBundle: () => Promise<void>;
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

const useV8BleManagerInternal = (): V8BleContextValue => {
  const [devicesById, setDevicesById] = useState<Record<string, V8Device>>({});
  const [connectionStates, setConnectionStates] = useState<Record<string, V8ConnectionState>>({});
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [dataEvents, setDataEvents] = useState<ParsedData[]>([]);
  const [latestLiveData, setLatestLiveData] = useState<V8VitalSample | null>(null);
  const [historyByType, setHistoryByType] = useState<Record<string, V8HistoryBucket>>({});
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
              const marker = `${entry.timestamp ?? ''}-${entry.heartRate ?? ''}-${entry.hrv ?? ''}-${entry.systolicBp ?? ''}-${entry.diastolicBp ?? ''}-${entry.steps ?? ''}-${entry.distanceKm ?? ''}-${entry.temperatureC ?? ''}`;
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
  const setRealtimeStepEnabled = useCallback(async (enabled: boolean, includeTemperature: boolean) => {
    if (!v8Native) return;
    await v8Native.setRealtimeStepEnabled(enabled, includeTemperature);
    setLiveModeEnabled(enabled);
  }, []);

  const requestHistoryBundle = useCallback(async () => {
    if (!v8Native) return;
    const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const start = Platform.OS === 'ios'
      ? sevenDaysAgoMs
      : new Date(sevenDaysAgoMs).toISOString().slice(0, 19).replace('T', ' ');
    await Promise.all([
      v8Native.requestTotalActivity(0, start),
      v8Native.requestDetailActivity(0, start),
      v8Native.requestSleep(0, start),
      v8Native.requestDynamicHR(0, start),
      v8Native.requestStaticHR(0, start),
      v8Native.requestHRV(0, start),
    ]);
  }, []);

  const requestLiveSnapshot = useCallback(async () => {
    if (!v8Native) return;
    if (liveSnapshotInFlightRef.current) return;
    liveSnapshotInFlightRef.current = true;
    const start = Platform.OS === 'ios' ? Date.now() - 60 * 60 * 1000 : '2026-01-01 00:00:00';
    try {
      // Request vital data types so steps, BP, SpO2, temperature, and HR are populated.
      // NOTE: requestTotalActivity is intentionally excluded — it returns
      // inflated/stale daily totals that overwrite the accurate interval
      // values from requestStaticHR / requestDetailActivity.
      await Promise.all([
        v8Native.requestStaticHR(0, start),
        v8Native.requestSpo2 ? v8Native.requestSpo2(0, start) : Promise.resolve(true),
      ]);
      await Promise.all([
        v8Native.requestTemperature ? v8Native.requestTemperature(0, start) : Promise.resolve(true),
        v8Native.requestDetailActivity(0, start),
      ]);
    } finally {
      liveSnapshotInFlightRef.current = false;
    }
  }, []);

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
    setRealtimeStepEnabled,
    requestHistoryBundle,
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
