import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { isPillBoxNativeAvailable, pillBoxEmitter, pillBoxNative } from './nativePillbox';
import {
  normalizePillBoxDevice,
  normalizePillBoxMedication,
  normalizePillBoxSnapshot,
} from './parser';
import type {
  PillBoxConnectionState,
  PillBoxDevice,
  PillBoxMedicationEvent,
  PillBoxSnapshot,
} from './models';

type PillBoxContextValue = {
  bleState: 'PoweredOn' | 'Unsupported';
  devices: PillBoxDevice[];
  isScanning: boolean;
  scanError: string | null;
  connectionStates: Record<string, PillBoxConnectionState>;
  activeDeviceId: string | null;
  activeSnapshot: PillBoxSnapshot | null;
  medicationEvents: PillBoxMedicationEvent[];
  snapshotsByDeviceId: Record<string, PillBoxSnapshot>;
  startScan: () => Promise<void>;
  stopScan: () => Promise<void>;
  connect: (deviceId: string) => Promise<void>;
  disconnect: (deviceId?: string) => Promise<void>;
  refreshSnapshot: () => Promise<void>;
  getDeviceSnapshot: (deviceId: string) => PillBoxSnapshot | null;
  setAlarm: (args: {
    slot: number;
    time: string;
    enabled?: boolean;
    repeatDays?: number[];
    remark?: string;
  }) => Promise<void>;
  setTimeFormat: (timeFormat: number) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  setRingType: (ringType: number) => Promise<void>;
  setReminderDuration: (durationMinutes: number) => Promise<void>;
  unbind: () => Promise<void>;
  clearScanResults: () => void;
};

const PillBoxContext = createContext<PillBoxContextValue | null>(null);

const normalizeId = (id?: string | null) => (id ?? '').trim().toLowerCase();

export const PillBoxBleProvider = ({ children }: { children: React.ReactNode }) => {
  const value = usePillBoxDeviceManager();
  return <PillBoxContext.Provider value={value}>{children}</PillBoxContext.Provider>;
};

export function usePillBoxDeviceManager() {
  const [devicesById, setDevicesById] = useState<Record<string, PillBoxDevice>>({});
  const [snapshotsByDeviceId, setSnapshotsByDeviceId] = useState<Record<string, PillBoxSnapshot>>({});
  const [connectionStates, setConnectionStates] = useState<Record<string, PillBoxConnectionState>>({});
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  const [medicationEvents, setMedicationEvents] = useState<PillBoxMedicationEvent[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const activeDeviceIdRef = useRef<string | null>(null);
  const snapshotsByDeviceIdRef = useRef<Record<string, PillBoxSnapshot>>({});

  useEffect(() => {
    activeDeviceIdRef.current = activeDeviceId;
  }, [activeDeviceId]);

  useEffect(() => {
    snapshotsByDeviceIdRef.current = snapshotsByDeviceId;
  }, [snapshotsByDeviceId]);

  useEffect(() => {
    if (!pillBoxEmitter) return;

    const scanResultSub = pillBoxEmitter.addListener('PillBoxScanResult', evt => {
      const device = normalizePillBoxDevice(evt as Record<string, unknown>);
      if (!device.id) return;
      setDevicesById(prev => ({ ...prev, [normalizeId(device.id)]: device }));
    });

    const scanStateSub = pillBoxEmitter.addListener('PillBoxScanState', evt => {
      const payload = evt as Record<string, unknown>;
      const state = String(payload?.state ?? '').toLowerCase();
      setIsScanning(state === 'scanning');
      if (payload?.message) {
        setScanError(String(payload.message));
      } else if (state === 'error') {
        setScanError('Unable to scan for pill dispenser devices.');
      } else if (state === 'idle' || state === 'scanning') {
        setScanError(null);
      }
    });

    const connectionSub = pillBoxEmitter.addListener('PillBoxConnectionState', evt => {
      const payload = evt as Record<string, unknown>;
      const rawDeviceId = String(payload?.deviceId ?? '').trim();
      const key = normalizeId(rawDeviceId);
      const state = String(payload?.state ?? 'disconnected') as PillBoxConnectionState;
      if (key) {
        setConnectionStates(prev => ({ ...prev, [key]: state }));
      }
      if (state === 'connected' || state === 'dataSynced') {
        setActiveDeviceId(rawDeviceId || activeDeviceIdRef.current);
      }
      if (state === 'disconnected' && activeDeviceIdRef.current && normalizeId(activeDeviceIdRef.current) === key) {
        setActiveDeviceId(null);
      }

      const boxPayload = payload?.box && typeof payload.box === 'object'
        ? normalizePillBoxSnapshot(payload.box as Record<string, unknown>)
        : null;
      if (boxPayload && key) {
        setSnapshotsByDeviceId(prev => ({
          ...prev,
          [key]: mergeSnapshot(prev[key] ?? null, boxPayload, rawDeviceId || key),
        }));
      }
    });

    const snapshotSub = pillBoxEmitter.addListener('PillBoxSnapshot', evt => {
      const payload = evt as Record<string, unknown>;
      const rawDeviceId =
        String(payload?.deviceId ?? payload?.identifier ?? activeDeviceIdRef.current ?? '').trim();
      const key = normalizeId(rawDeviceId);
      const normalized = normalizePillBoxSnapshot(payload);
      if (!key && !normalized.deviceId && !activeDeviceIdRef.current) return;
      const resolvedKey = key || normalizeId(normalized.deviceId) || normalizeId(activeDeviceIdRef.current);
      if (!resolvedKey) return;
      setSnapshotsByDeviceId(prev => ({
        ...prev,
        [resolvedKey]: mergeSnapshot(prev[resolvedKey] ?? null, normalized, rawDeviceId || normalized.deviceId || resolvedKey),
      }));
      if (activeDeviceIdRef.current && normalizeId(activeDeviceIdRef.current) === resolvedKey) {
        // keep active snapshot aligned with the selected device
        setActiveDeviceId(prev => prev ?? (rawDeviceId || normalized.deviceId || null));
      }
    });

    const medicationSub = pillBoxEmitter.addListener('PillBoxMedication', evt => {
      const medication = normalizePillBoxMedication(evt as Record<string, unknown>);
      setMedicationEvents(prev => [medication, ...prev].slice(0, 50));
    });

    return () => {
      scanResultSub.remove();
      scanStateSub.remove();
      connectionSub.remove();
      snapshotSub.remove();
      medicationSub.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      if (!pillBoxNative?.getCachedSnapshot) return;
      try {
        const cached = await pillBoxNative.getCachedSnapshot();
        if (!active || !cached || typeof cached !== 'object') return;
        const normalized = normalizePillBoxSnapshot(cached as Record<string, unknown>);
        const deviceId = normalizeId(normalized.deviceId ?? activeDeviceIdRef.current);
        if (!deviceId) return;
        setSnapshotsByDeviceId(prev => ({
          ...prev,
          [deviceId]: mergeSnapshot(prev[deviceId] ?? null, normalized, normalized.deviceId ?? deviceId),
        }));
        if (normalized.deviceId) {
          setActiveDeviceId(normalized.deviceId);
        }
      } catch {
        // best-effort hydration only
      }
    };
    hydrate();
    return () => {
      active = false;
    };
  }, []);

  const clearScanResults = useCallback(() => {
    setDevicesById({});
    setScanError(null);
  }, []);

  const startScan = useCallback(async () => {
    if (!pillBoxNative) {
      setScanError('Pill dispenser native module is unavailable on this platform.');
      return;
    }
    try {
      setScanError(null);
      setIsScanning(true);
      await pillBoxNative.startScan();
    } catch (error) {
      setIsScanning(false);
      setScanError(error instanceof Error ? error.message : 'Failed to scan for pill dispenser devices.');
    }
  }, []);

  const stopScan = useCallback(async () => {
    if (!pillBoxNative) {
      setIsScanning(false);
      return;
    }
    try {
      await pillBoxNative.stopScan();
    } finally {
      setIsScanning(false);
    }
  }, []);

  const connect = useCallback(async (deviceId: string) => {
    if (!pillBoxNative) return;
    const normalizedTargetId = normalizeId(deviceId);
    const currentId = activeDeviceIdRef.current ? normalizeId(activeDeviceIdRef.current) : null;
    if (currentId && currentId !== normalizedTargetId) {
      try {
        await pillBoxNative.disconnect();
      } catch {
        // best-effort
      }
    }
    setConnectionStates(prev => ({ ...prev, [normalizedTargetId]: 'connecting' }));
    await pillBoxNative.connect(deviceId);
  }, []);

  const disconnect = useCallback(async (_deviceId?: string) => {
    if (!pillBoxNative) return;
    const targetId = normalizeId(_deviceId ?? activeDeviceIdRef.current ?? null);
    if (targetId) {
      setConnectionStates(prev => ({ ...prev, [targetId]: 'disconnecting' }));
    }
    try {
      await pillBoxNative.disconnect();
    } finally {
      if (targetId) {
        setConnectionStates(prev => ({ ...prev, [targetId]: 'disconnected' }));
      }
      setActiveDeviceId(null);
    }
  }, []);

  const refreshSnapshot = useCallback(async () => {
    if (!pillBoxNative) return;
    await pillBoxNative.refreshSnapshot();
  }, []);

  const getDeviceSnapshot = useCallback((deviceId: string) => {
    return snapshotsByDeviceIdRef.current[normalizeId(deviceId)] ?? null;
  }, []);

  const setAlarm = useCallback(async (args: {
    slot: number;
    time: string;
    enabled?: boolean;
    repeatDays?: number[];
    remark?: string;
  }) => {
    if (!pillBoxNative) return;
    await pillBoxNative.setAlarm(
      args.slot,
      args.time,
      args.enabled ?? true,
      args.repeatDays ?? [0, 1, 2, 3, 4, 5, 6],
      args.remark ?? '',
    );
  }, []);

  const setTimeFormat = useCallback(async (timeFormat: number) => {
    if (!pillBoxNative) return;
    await pillBoxNative.setTimeFormat(timeFormat);
  }, []);

  const setVolume = useCallback(async (volume: number) => {
    if (!pillBoxNative) return;
    await pillBoxNative.setVolume(volume);
  }, []);

  const setRingType = useCallback(async (ringType: number) => {
    if (!pillBoxNative) return;
    await pillBoxNative.setRingType(ringType);
  }, []);

  const setReminderDuration = useCallback(async (durationMinutes: number) => {
    if (!pillBoxNative) return;
    await pillBoxNative.setReminderDuration(durationMinutes);
  }, []);

  const unbind = useCallback(async () => {
    if (!pillBoxNative) return;
    await pillBoxNative.unbind();
  }, []);

  const activeSnapshot = useMemo(() => {
    const activeId = normalizeId(activeDeviceId);
    if (activeId && snapshotsByDeviceId[activeId]) {
      return snapshotsByDeviceId[activeId];
    }
    const snapshotValues = Object.values(snapshotsByDeviceId);
    return snapshotValues[0] ?? null;
  }, [activeDeviceId, snapshotsByDeviceId]);

  const value = useMemo<PillBoxContextValue>(() => ({
    bleState: isPillBoxNativeAvailable ? 'PoweredOn' : 'Unsupported',
    devices: Object.values(devicesById),
    isScanning,
    scanError,
    connectionStates,
    activeDeviceId,
    activeSnapshot,
    medicationEvents,
    snapshotsByDeviceId,
    startScan,
    stopScan,
    connect,
    disconnect,
    refreshSnapshot,
    getDeviceSnapshot,
    setAlarm,
    setTimeFormat,
    setVolume,
    setRingType,
    setReminderDuration,
    unbind,
    clearScanResults,
  }), [
    activeDeviceId,
    activeSnapshot,
    clearScanResults,
    connect,
    connectionStates,
    devicesById,
    disconnect,
    getDeviceSnapshot,
    isScanning,
    medicationEvents,
    refreshSnapshot,
    scanError,
    setAlarm,
    setReminderDuration,
    setRingType,
    setTimeFormat,
    setVolume,
    snapshotsByDeviceId,
    startScan,
    stopScan,
    unbind,
  ]);

  return value;
}

function mergeSnapshot(
  existing: PillBoxSnapshot | null,
  incoming: PillBoxSnapshot,
  deviceIdFallback: string,
): PillBoxSnapshot {
  const deviceId = incoming.deviceId ?? existing?.deviceId ?? deviceIdFallback;
  const alarms = incoming.alarms.length > 0
    ? incoming.alarms
    : existing?.alarms ?? [];

  const batteryPercent = incoming.batteryPercent ?? existing?.batteryPercent ?? null;
  const batteryState = incoming.batteryState ?? existing?.batteryState ?? null;
  const batteryPower = incoming.batteryPower ?? existing?.batteryPower ?? null;
  const timeFormat = incoming.timeFormat ?? existing?.timeFormat ?? null;
  const volume = incoming.volume ?? existing?.volume ?? null;
  const ring = incoming.ring ?? existing?.ring ?? null;
  const durationMinutes = incoming.durationMinutes ?? existing?.durationMinutes ?? null;

  return {
    state: incoming.state === 'disconnected' && existing ? existing.state : incoming.state,
    deviceId,
    name: incoming.name ?? existing?.name ?? null,
    nickName: incoming.nickName ?? existing?.nickName ?? null,
    patientName: incoming.patientName ?? existing?.patientName ?? null,
    identifier: incoming.identifier ?? existing?.identifier ?? null,
    firmwareVersion: incoming.firmwareVersion ?? existing?.firmwareVersion ?? null,
    batteryPercent,
    batteryState,
    batteryPower,
    timeFormat,
    volume,
    ring,
    durationMinutes,
    batteryLabel: incoming.batteryLabel ?? existing?.batteryLabel ?? null,
    nextPutDrugTime: incoming.nextPutDrugTime ?? existing?.nextPutDrugTime ?? null,
    nextAlarmTime: incoming.nextAlarmTime ?? existing?.nextAlarmTime ?? null,
    nextAlarmDate: incoming.nextAlarmDate ?? existing?.nextAlarmDate ?? null,
    alarms,
  };
}

export function usePillBox() {
  const ctx = useContext(PillBoxContext);
  if (!ctx) {
    throw new Error('usePillBox must be used within PillBoxBleProvider');
  }
  return ctx;
}
