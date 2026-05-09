import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useV8DeviceManager } from '../v8/useV8DeviceManager';

type RouteParams = { deviceId: string; deviceName?: string | null };

const fmt = (v: unknown, suffix = '') =>
  v != null && v !== '' ? `${v}${suffix}` : '—';
const fmtNum = (v: number | null | undefined, decimals = 0, suffix = '') =>
  v != null && !Number.isNaN(v) ? `${Number(v).toFixed(decimals)}${suffix}` : '—';

const sampleDayKey = (sample: { timestamp: string | null; receivedAt: number | null }): string | null => {
  const raw = sample.timestamp?.trim();
  if (raw) {
    if (/^\d{10,13}$/.test(raw)) {
      const epoch = raw.length === 13 ? Number(raw) : Number(raw) * 1000;
      if (Number.isFinite(epoch)) return new Date(epoch).toISOString().slice(0, 10);
    }
    const normalized = raw.replace(/\//g, '-').replace(/\./g, '-');
    const direct = normalized.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
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

/* ── tiny reusable pieces ──────────────────────────────── */

const InfoRow = ({ label, value }: { label: string; value: string }) => (
  <View style={s.infoRow}>
    <Text style={s.infoLabel}>{label}</Text>
    <Text style={s.infoValue} numberOfLines={1}>{value}</Text>
  </View>
);

const VitalCard = ({
  icon, color, label, value, unit,
}: { icon: string; color: string; label: string; value: string; unit?: string }) => (
  <View style={s.vitalCard}>
    <View style={[s.vitalIconWrap, { backgroundColor: `${color}18` }]}>
      <Icon name={icon} size={20} color={color} />
    </View>
    <View style={s.vitalTextWrap}>
      <View style={s.vitalValueRow}>
        <Text style={s.vitalValue}>{value}</Text>
        {unit ? <Text style={s.vitalUnit}>{unit}</Text> : null}
      </View>
      <Text style={s.vitalLabel}>{label}</Text>
    </View>
  </View>
);

const ActionBtn = ({
  icon, label, onPress, disabled, loading,
}: { icon: string; label: string; onPress: () => Promise<void> | void; disabled?: boolean; loading?: boolean }) => (
  <TouchableOpacity
    style={[s.actionBtn, disabled ? s.disabled : null]}
    disabled={disabled || loading}
    onPress={onPress}
    activeOpacity={0.7}
  >
    {loading
      ? <ActivityIndicator size="small" color="#F28C28" />
      : <Icon name={icon} size={18} color="#F28C28" />}
    <Text style={s.actionBtnText}>{label}</Text>
  </TouchableOpacity>
);

/* ── main screen ───────────────────────────────────────── */

const V8DeviceManageScreen = () => {
  const normalizeId = (id?: string | null) => (id ?? '').trim().toLowerCase();
  const navigation = useNavigation();
  const route = useRoute();
  const { deviceId, deviceName } = (route.params as RouteParams) ?? {};

  const {
    connectionStates, disconnect,
    requestBattery, requestDeviceMac, requestPersonalInfo,
    setRealtimeStepEnabled, requestHistoryBundle, requestLiveSnapshot,
    liveModeEnabled, latestLiveData, historyByType, deviceInfo, clearSavedData,
  } = useV8DeviceManager();

  const state = connectionStates[normalizeId(deviceId)] ?? 'disconnected';
  const connected = state === 'connected';

  const [syncing, setSyncing] = useState(false);
  const [refreshingLive, setRefreshingLive] = useState(false);
  const [clearingSaved, setClearingSaved] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const deviceInfoRef = useRef(deviceInfo);

  useEffect(() => {
    deviceInfoRef.current = deviceInfo;
  }, [deviceInfo]);

  // Auto-fetch visible device info when this screen gains focus and band is connected.
  useFocusEffect(
    useCallback(() => {
      if (!connected) return;
      const task = InteractionManager.runAfterInteractions(() => {
        requestPersonalInfo().catch(() => {});
        requestBattery().catch(() => {});
        requestDeviceMac().catch(() => {});
      });
      return () => task.cancel();
    }, [connected, requestBattery, requestDeviceMac, requestPersonalInfo]),
  );

  const handleSyncHistory = useCallback(async () => {
    setSyncing(true);
    try { await requestHistoryBundle(); } catch { /* */ }
    setSyncing(false);
  }, [requestHistoryBundle]);

  const handleRefreshLive = useCallback(async () => {
    setRefreshingLive(true);
    try {
      await requestLiveSnapshot();
      // Keep identity fields fresh while user is actively monitoring vitals.
      await Promise.allSettled([
        requestPersonalInfo(),
        requestBattery(),
        requestDeviceMac(),
      ]);
    } catch { /* */ }
    setRefreshingLive(false);
  }, [requestBattery, requestDeviceMac, requestLiveSnapshot, requestPersonalInfo]);

  const handleClearSavedData = useCallback(async () => {
    setClearingSaved(true);
    setActionStatus(null);
    try {
      await clearSavedData();
      setActionStatus('Saved Hand Band data cleared');
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Failed to clear saved data');
    } finally {
      setClearingSaved(false);
    }
  }, [clearSavedData]);

  const batteryIcon = useMemo(() => {
    const pct = deviceInfo.batteryPercent;
    if (pct == null) return 'battery-dead-outline';
    if (pct > 75) return 'battery-full';
    if (pct > 30) return 'battery-half';
    return 'battery-dead';
  }, [deviceInfo.batteryPercent]);

  const batteryColor = useMemo(() => {
    const pct = deviceInfo.batteryPercent;
    if (pct == null) return '#AAA';
    if (pct > 60) return '#1D8A45';
    if (pct > 20) return '#E5A100';
    return '#C62828';
  }, [deviceInfo.batteryPercent]);

  const historyEntries = useMemo(() =>
    Object.entries(historyByType).map(([key, bucket]) => ({
      key,
      count: bucket.entries.length,
      done: bucket.completed,
      updatedAt: bucket.updatedAt,
    })),
  [historyByType]);

  const totalHistoryRecords = useMemo(
    () => historyEntries.reduce((sum, b) => sum + b.count, 0),
    [historyEntries],
  );

  const todayMotionFallback = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const all = Object.values(historyByType).flatMap(bucket => bucket.entries);
    const todayEntries = all.filter(entry => sampleDayKey(entry) === today);
    let steps: number | null = null;
    let distanceKm: number | null = null;
    let caloriesKcal: number | null = null;
    for (const entry of todayEntries) {
      if (entry.steps != null) {
        steps = steps == null ? entry.steps : Math.max(steps, entry.steps);
      }
      if (entry.distanceKm != null) {
        distanceKm = distanceKm == null ? entry.distanceKm : Math.max(distanceKm, entry.distanceKm);
      }
      if (entry.caloriesKcal != null) {
        caloriesKcal = caloriesKcal == null ? entry.caloriesKcal : Math.max(caloriesKcal, entry.caloriesKcal);
      }
    }
    return { steps, distanceKm, caloriesKcal };
  }, [historyByType]);

  const latestVitalsFallback = useMemo(() => {
    const all = Object.values(historyByType).flatMap(bucket => bucket.entries);
    const latestNonNull = <T,>(pick: (entry: typeof all[number]) => T | null | undefined): T | null => {
      let value: T | null = null;
      let latestTs = 0;
      for (const entry of all) {
        const current = pick(entry);
        if (current == null) continue;
        const ts = entry.receivedAt ?? 0;
        if (ts >= latestTs) {
          latestTs = ts;
          value = current as T;
        }
      }
      return value;
    };
    const latestBp = latestNonNull<{ systolic: number; diastolic: number }>(entry =>
      entry.systolicBp != null && entry.diastolicBp != null
        ? { systolic: entry.systolicBp, diastolic: entry.diastolicBp }
        : null,
    );
    return {
      heartRate: latestNonNull<number>(entry => entry.heartRate),
      spo2: latestNonNull<number>(entry => entry.spo2),
      temperatureC: latestNonNull<number>(entry => entry.temperatureC),
      hrv: latestNonNull<number>(entry => entry.hrv),
      stress: latestNonNull<number>(entry => entry.stress),
      systolicBp: latestBp?.systolic ?? null,
      diastolicBp: latestBp?.diastolic ?? null,
    };
  }, [historyByType]);

  const latestIsToday = useMemo(() => {
    if (!latestLiveData) return false;
    return sampleDayKey(latestLiveData) === new Date().toISOString().slice(0, 10);
  }, [latestLiveData]);

  const displaySteps = latestIsToday
    ? (latestLiveData?.steps ?? todayMotionFallback.steps)
    : todayMotionFallback.steps;
  const displayDistanceKm = latestIsToday
    ? (latestLiveData?.distanceKm ?? todayMotionFallback.distanceKm)
    : todayMotionFallback.distanceKm;
  const displayCaloriesKcal = latestIsToday
    ? (latestLiveData?.caloriesKcal ?? todayMotionFallback.caloriesKcal)
    : todayMotionFallback.caloriesKcal;
  const displayHeartRate = latestLiveData?.heartRate ?? latestVitalsFallback.heartRate;
  const displaySpo2 = latestLiveData?.spo2 ?? latestVitalsFallback.spo2;
  const displaySystolicBp = latestLiveData?.systolicBp ?? latestVitalsFallback.systolicBp;
  const displayDiastolicBp = latestLiveData?.diastolicBp ?? latestVitalsFallback.diastolicBp;
  const displayTemperatureC = latestLiveData?.temperatureC ?? latestVitalsFallback.temperatureC;
  const displayHrv = latestLiveData?.hrv ?? latestVitalsFallback.hrv;
  const displayStress = latestLiveData?.stress ?? latestVitalsFallback.stress;
  const hasAnyLiveVital =
    displayHeartRate != null ||
    displaySpo2 != null ||
    (displaySystolicBp != null && displayDiastolicBp != null) ||
    displayTemperatureC != null ||
    displaySteps != null ||
    displayDistanceKm != null ||
    displayHrv != null ||
    displayCaloriesKcal != null ||
    displayStress != null;

  const lastReceivedAgo = useMemo(() => {
    if (!latestLiveData?.receivedAt) return null;
    const sec = Math.max(0, Math.floor((Date.now() - latestLiveData.receivedAt) / 1000));
    if (sec < 60) return `${sec}s ago`;
    return `${Math.floor(sec / 60)}m ago`;
  }, [latestLiveData?.receivedAt]);

  const dataTypePrettyName: Record<string, string> = {
    totalActivity: 'Total Activity',
    detailActivity: 'Detail Activity',
    sleep: 'Sleep',
    dynamicHR: 'Dynamic HR',
    staticHR: 'Static HR',
    hrv: 'HRV',
    spo2: 'SpO2',
    temperature: 'Temperature',
    bloodPressure: 'Blood Pressure',
  };

  return (
    <SafeAreaView style={s.container}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* ── Header ── */}
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="arrow-back" size={22} color="#F28C28" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Hand Band</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* ── Device Hero ── */}
        <View style={s.card}>
          <View style={s.heroTopRow}>
            <View style={s.heroIconWrap}>
              <Icon name="watch-outline" size={26} color="#F28C28" />
            </View>
            <View style={s.heroTextWrap}>
              <Text style={s.deviceName}>{deviceName ?? 'Hand Band'}</Text>
              <Text style={s.deviceMeta} numberOfLines={1}>ID: {deviceId}</Text>
            </View>
            <View style={[s.statusChip, connected ? s.statusOnline : s.statusOffline]}>
              <View style={[s.statusDot, { backgroundColor: connected ? '#1D8A45' : '#C62828' }]} />
              <Text style={[s.statusText, { color: connected ? '#1D8A45' : '#9B3C3C' }]}>
                {connected ? 'Connected' : state === 'connecting' ? 'Connecting' : 'Offline'}
              </Text>
            </View>
          </View>

          {/* Device info rows */}
          <View style={s.divider} />
          <InfoRow label="Battery" value={fmtNum(deviceInfo.batteryPercent, 0, '%')} />
          <InfoRow label="Firmware" value={fmt(deviceInfo.firmwareVersion)} />
          <InfoRow label="Device ID" value={fmt(deviceInfo.imei)} />
          <InfoRow label="MAC Address" value={fmt(deviceInfo.mac)} />
          <InfoRow label="Device Name" value={fmt(deviceInfo.deviceName)} />
          <InfoRow label="Device Time" value={fmt(deviceInfo.deviceTime)} />

          {deviceInfo.batteryPercent != null && (
            <View style={s.batteryBarWrap}>
              <View style={s.batteryBarTrack}>
                <View style={[s.batteryBarFill, { width: `${Math.min(100, deviceInfo.batteryPercent)}%`, backgroundColor: batteryColor }]} />
              </View>
              <Icon name={batteryIcon} size={16} color={batteryColor} style={{ marginLeft: 8 }} />
            </View>
          )}
        </View>

        {/* ── Live Vitals ── */}
        <View style={s.card}>
          <View style={s.sectionHeaderRow}>
            <View style={s.sectionTitleRow}>
              <Icon name="pulse" size={16} color="#F28C28" />
              <Text style={s.sectionTitle}>Live Vitals</Text>
            </View>
            {lastReceivedAgo && (
              <Text style={s.sectionMeta}>Updated {lastReceivedAgo}</Text>
            )}
          </View>

          {!hasAnyLiveVital ? (
            <View style={s.emptyState}>
              <Icon name="analytics-outline" size={32} color="#D0C8BF" />
              <Text style={s.emptyText}>No live data received yet</Text>
              <Text style={s.emptyHint}>Enable Live Data or Sync History to see vitals</Text>
            </View>
          ) : (
            <View style={s.vitalGrid}>
              <VitalCard icon="heart" color="#E53935" label="Heart Rate" value={fmtNum(displayHeartRate, 0)} unit="BPM" />
              <VitalCard icon="water" color="#1E88E5" label="Blood Oxygen" value={fmtNum(displaySpo2, 0)} unit="%" />
              <VitalCard icon="fitness" color="#8E24AA" label="Blood Pressure" value={
                displaySystolicBp != null && displayDiastolicBp != null
                  ? `${displaySystolicBp}/${displayDiastolicBp}` : '—'
              } unit="mmHg" />
              <VitalCard icon="thermometer" color="#FF7043" label="Temperature" value={fmtNum(displayTemperatureC, 1)} unit="°C" />
              <VitalCard icon="footsteps" color="#F28C28" label="Steps" value={fmtNum(displaySteps, 0)} />
              <VitalCard icon="map" color="#43A047" label="Distance" value={fmtNum(displayDistanceKm, 2)} unit="km" />
              <VitalCard icon="speedometer" color="#5C6BC0" label="HRV" value={fmtNum(displayHrv, 0)} unit="ms" />
              <VitalCard icon="flame" color="#EF6C00" label="Calories" value={fmtNum(displayCaloriesKcal, 0)} unit="kcal" />
              <VitalCard icon="sad" color="#78909C" label="Stress" value={fmtNum(displayStress, 0)} />
            </View>
          )}

          <TouchableOpacity
            style={[s.refreshLiveBtn, !connected ? s.disabled : null]}
            disabled={!connected || refreshingLive}
            onPress={handleRefreshLive}
            activeOpacity={0.7}
          >
            {refreshingLive
              ? <ActivityIndicator size="small" color="#F28C28" />
              : <Icon name="refresh" size={16} color="#F28C28" />}
            <Text style={s.refreshLiveBtnText}>Refresh Vitals</Text>
          </TouchableOpacity>
        </View>

        {/* ── Live Mode Toggle ── */}
        <View style={s.card}>
          <View style={s.sectionTitleRow}>
            <Icon name="radio" size={16} color="#F28C28" />
            <Text style={s.sectionTitle}>Real-Time Streaming</Text>
          </View>
          <Text style={s.sectionDescription}>
            Enable continuous streaming from the band. This uses more battery on both phone and band.
          </Text>
          <View style={s.toggleRow}>
            <TouchableOpacity
              style={[s.toggleBtn, liveModeEnabled ? s.toggleActive : null, !connected ? s.disabled : null]}
              disabled={!connected}
              onPress={() => setRealtimeStepEnabled(true, true)}
              activeOpacity={0.7}
            >
              <Icon name="play-circle" size={16} color={liveModeEnabled ? '#fff' : '#1D8A45'} />
              <Text style={[s.toggleBtnText, liveModeEnabled ? s.toggleActiveText : { color: '#1D8A45' }]}>ON</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.toggleBtn, !liveModeEnabled ? s.toggleInactive : null, !connected ? s.disabled : null]}
              disabled={!connected}
              onPress={() => setRealtimeStepEnabled(false, false)}
              activeOpacity={0.7}
            >
              <Icon name="stop-circle" size={16} color={!liveModeEnabled ? '#fff' : '#9B3C3C'} />
              <Text style={[s.toggleBtnText, !liveModeEnabled ? s.toggleInactiveText : { color: '#9B3C3C' }]}>OFF</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── History Sync ── */}
        <View style={s.card}>
          <View style={s.sectionHeaderRow}>
            <View style={s.sectionTitleRow}>
              <Icon name="server-outline" size={16} color="#F28C28" />
              <Text style={s.sectionTitle}>History Data</Text>
            </View>
            {totalHistoryRecords > 0 && (
              <View style={s.recordsBadge}>
                <Text style={s.recordsBadgeText}>{totalHistoryRecords} records</Text>
              </View>
            )}
          </View>

          {historyEntries.length === 0 ? (
            <View style={s.emptyState}>
              <Icon name="cloud-download-outline" size={32} color="#D0C8BF" />
              <Text style={s.emptyText}>No history synced</Text>
              <Text style={s.emptyHint}>Tap Sync History to download data from the band</Text>
            </View>
          ) : (
            <View style={s.historyList}>
              {historyEntries.map(entry => (
                <View key={entry.key} style={s.historyRow}>
                  <View style={s.historyDot} />
                  <Text style={s.historyKey}>{dataTypePrettyName[entry.key] ?? entry.key}</Text>
                  <Text style={s.historyCount}>{entry.count}</Text>
                  {entry.done && (
                    <Icon name="checkmark-circle" size={14} color="#1D8A45" style={{ marginLeft: 4 }} />
                  )}
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[s.syncBtn, !connected ? s.disabled : null]}
            disabled={!connected || syncing}
            onPress={handleSyncHistory}
            activeOpacity={0.7}
          >
            {syncing
              ? <ActivityIndicator size="small" color="#fff" />
              : <Icon name="cloud-download-outline" size={18} color="#fff" />}
            <Text style={s.syncBtnText}>{syncing ? 'Syncing...' : 'Sync History'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.clearBtn, clearingSaved ? s.disabled : null]}
            disabled={clearingSaved}
            onPress={handleClearSavedData}
            activeOpacity={0.7}
          >
            {clearingSaved
              ? <ActivityIndicator size="small" color="#9B3C3C" />
              : <Icon name="trash-outline" size={16} color="#9B3C3C" />}
            <Text style={s.clearBtnText}>{clearingSaved ? 'Clearing...' : 'Clear Saved Data'}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Disconnect ── */}
        <TouchableOpacity
          style={[s.disconnectBtn, !connected ? s.disabled : null]}
          disabled={!connected}
          onPress={() => disconnect(deviceId)}
          activeOpacity={0.7}
        >
          <Icon name="close-circle-outline" size={18} color="#C62828" />
          <Text style={s.disconnectBtnText}>Disconnect Device</Text>
        </TouchableOpacity>

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

export default V8DeviceManageScreen;

/* ── styles ────────────────────────────────────────────── */

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F2EE' },
  content: { paddingBottom: 30 },

  /* header */
  headerRow: {
    paddingHorizontal: 16, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#2E2A27' },

  /* card */
  card: {
    backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 14,
    borderRadius: 20, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },

  /* hero */
  heroTopRow: { flexDirection: 'row', alignItems: 'center' },
  heroIconWrap: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FFF5E9', borderWidth: 1.5, borderColor: '#F8DDBB',
  },
  heroTextWrap: { flex: 1, marginLeft: 12, marginRight: 10 },
  deviceName: { fontSize: 17, fontWeight: '700', color: '#2E2A27' },
  deviceMeta: { fontSize: 12, color: '#7A726A', marginTop: 2 },
  statusChip: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1,
  },
  statusOnline: { backgroundColor: '#E6F8ED', borderColor: '#B9E9CA' },
  statusOffline: { backgroundColor: '#FDECEC', borderColor: '#EBC7C7' },
  statusDot: { width: 7, height: 7, borderRadius: 4, marginRight: 5 },
  statusText: { fontSize: 11, fontWeight: '700' },

  /* info rows */
  divider: { height: 1, backgroundColor: '#F0EBE5', marginVertical: 12 },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', paddingVertical: 6,
  },
  infoLabel: { fontSize: 13, color: '#8A8078', fontWeight: '500' },
  infoValue: { fontSize: 13, color: '#2E2A27', fontWeight: '600', maxWidth: '60%', textAlign: 'right' },

  /* battery bar */
  batteryBarWrap: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  batteryBarTrack: {
    flex: 1, height: 8, backgroundColor: '#F0EBE5',
    borderRadius: 4, overflow: 'hidden',
  },
  batteryBarFill: { height: 8, borderRadius: 4 },

  /* section headers */
  sectionHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 12,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#2E2A27', marginLeft: 6 },
  sectionDescription: { fontSize: 12, color: '#8A8078', lineHeight: 17, marginBottom: 10 },
  sectionMeta: { fontSize: 11, color: '#8A8078' },

  /* vitals grid */
  vitalGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  vitalCard: {
    width: '47%', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FAF8F5', borderRadius: 14,
    padding: 10, margin: 4, borderWidth: 1, borderColor: '#F0E7DD',
  },
  vitalIconWrap: {
    width: 36, height: 36, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginRight: 8,
  },
  vitalTextWrap: { flex: 1 },
  vitalValueRow: { flexDirection: 'row', alignItems: 'baseline' },
  vitalValue: { fontSize: 17, fontWeight: '700', color: '#2E2A27' },
  vitalUnit: { fontSize: 10, color: '#8A8078', marginLeft: 3 },
  vitalLabel: { fontSize: 10, color: '#8A8078', marginTop: 1 },

  /* refresh live btn */
  refreshLiveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 10, paddingVertical: 8, borderRadius: 12,
    backgroundColor: '#FFF5E9', borderWidth: 1, borderColor: '#F8DDBB',
  },
  refreshLiveBtnText: { color: '#F28C28', fontWeight: '600', fontSize: 13, marginLeft: 6 },

  /* toggle */
  toggleRow: { flexDirection: 'row', gap: 10 },
  toggleBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 10, borderRadius: 14,
    backgroundColor: '#FAF8F5', borderWidth: 1, borderColor: '#F0E7DD',
  },
  toggleBtnText: { fontWeight: '700', fontSize: 13, marginLeft: 6, color: '#8A8078' },
  toggleActive: { backgroundColor: '#1D8A45', borderColor: '#1D8A45' },
  toggleActiveText: { color: '#fff' },
  toggleInactive: { backgroundColor: '#C62828', borderColor: '#C62828' },
  toggleInactiveText: { color: '#fff' },

  /* actions grid */
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, marginTop: 4 },
  actionBtn: {
    width: '30%', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#FAF8F5', borderRadius: 14,
    paddingVertical: 12, margin: 4, borderWidth: 1, borderColor: '#F0E7DD',
  },
  actionBtnText: { fontSize: 11, fontWeight: '600', color: '#5C4A3A', marginTop: 4 },

  /* history */
  historyList: { marginBottom: 8 },
  historyRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#F5F0EB',
  },
  historyDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: '#F28C28', marginRight: 8,
  },
  historyKey: { flex: 1, fontSize: 13, color: '#2E2A27', fontWeight: '500' },
  historyCount: { fontSize: 13, color: '#8A8078', fontWeight: '600' },

  recordsBadge: {
    backgroundColor: '#FFF5E9', borderRadius: 999,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: '#F8DDBB',
  },
  recordsBadgeText: { fontSize: 11, fontWeight: '600', color: '#F28C28' },

  /* sync button */
  syncBtn: {
    marginTop: 6, backgroundColor: '#F28C28', borderRadius: 16,
    paddingVertical: 12, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center',
  },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, marginLeft: 8 },
  clearBtn: {
    marginTop: 10,
    backgroundColor: '#FDECEC',
    borderColor: '#F3D1D1',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  clearBtnText: {
    color: '#9B3C3C',
    fontWeight: '700',
    fontSize: 13,
    marginLeft: 6,
  },

  /* disconnect */
  disconnectBtn: {
    marginHorizontal: 16, marginTop: 4,
    backgroundColor: '#FDECEC', borderRadius: 16,
    paddingVertical: 12, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center',
    borderWidth: 1, borderColor: '#F3D1D1',
  },
  disconnectBtnText: { color: '#C62828', fontWeight: '700', fontSize: 14, marginLeft: 8 },

  /* empty state */
  emptyState: { alignItems: 'center', paddingVertical: 20 },
  emptyText: { fontSize: 14, color: '#8A8078', fontWeight: '600', marginTop: 8 },
  emptyHint: { fontSize: 12, color: '#B0A89E', marginTop: 4, textAlign: 'center' },

  disabled: { opacity: 0.5 },
});
