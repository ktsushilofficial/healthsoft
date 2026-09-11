import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { useV8DeviceManager } from '../v8/useV8DeviceManager';
import type { V8DailyVitalSummary } from '../v8/models';
import { todayLocalDayKey } from '../utils/vitalsDay';
import { historyTypeLabels } from '../v8/historyReader';
import { aggregateVitals } from '../v8/vitals';
import DailyVitalsTable from '../components/DailyVitalsTable';

type RouteParams = {
  deviceId: string;
  deviceName?: string | null;
  showSyncLatestPrompt?: boolean;
  promptToken?: string | number | null;
};

const fmt = (v: unknown, suffix = '') =>
  v != null && v !== '' ? `${v}${suffix}` : '—';
const fmtNum = (v: number | null | undefined, decimals = 0, suffix = '') =>
  v != null && !Number.isNaN(v) ? `${Number(v).toFixed(decimals)}${suffix}` : '—';

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

/* ── main screen ───────────────────────────────────────── */

const V8DeviceManageScreen = () => {
  const { user, selectedSeniorHandBandMacs } = useAuth();
  const normalizeId = (id?: string | null) => (id ?? '').trim().toLowerCase();
  const navigation = useNavigation<any>();
  const route = useRoute();
  const { deviceId, deviceName } = (route.params as RouteParams) ?? {};

  const {
    connectionStates, disconnect,
    requestBattery, requestDeviceMac, requestPersonalInfo,
    requestLiveSnapshot,
    buildTodayVitals, syncTodayVitalsToBackend,
    latestLiveData, historyByType, deviceInfo, historyReadStatus,
  } = useV8DeviceManager();

  const state = connectionStates[normalizeId(deviceId)] ?? 'disconnected';
  const connected = state === 'connected';
  const isSeniorUser = user?.role === 'SENIOR';
  const canUseEcg = isSeniorUser && selectedSeniorHandBandMacs.length > 0;

  const [refreshingLive, setRefreshingLive] = useState(false);
  const [todayFetching, setTodayFetching] = useState(false);
  const [todaySyncing, setTodaySyncing] = useState(false);
  const [fetchedVitalsRows, setFetchedVitalsRows] = useState<V8DailyVitalSummary[]>([]);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const deviceInfoRef = useRef(deviceInfo);
  const syncLatestPromptKeyRef = useRef<string | null>(null);

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
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Unable to refresh vitals.');
    }
    setRefreshingLive(false);
  }, [requestBattery, requestDeviceMac, requestLiveSnapshot, requestPersonalInfo]);

  const handleFetchTodayVitals = useCallback(async () => {
    if (!isSeniorUser) {
      setActionStatus('Only senior users can fetch wrist band data.');
      return;
    }
    if (!connected) {
      setActionStatus('Connect the hand band before fetching today data.');
      return;
    }
    setTodayFetching(true);
    setActionStatus(null);
    try {
      const bandDay = todayLocalDayKey();
      const rows = await buildTodayVitals(bandDay);
      setFetchedVitalsRows(rows);
      setActionStatus(
        rows.length > 0
          ? `Fetched today's vitals (${bandDay}) for review`
          : 'No vitals recorded on the band for today yet',
      );
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Failed to fetch today vitals');
    } finally {
      setTodayFetching(false);
    }
  }, [buildTodayVitals, connected, isSeniorUser]);

  const handleFetchAndSyncToday = useCallback(async () => {
    if (!isSeniorUser) {
      setActionStatus('Only senior users can sync wrist band data.');
      return;
    }
    if (!connected) {
      setActionStatus('Connect the hand band before syncing today data.');
      return;
    }

    const bandDay = todayLocalDayKey();
    setTodaySyncing(true);
    setActionStatus(null);

    try {
      const todayRows = await buildTodayVitals(bandDay);
      setFetchedVitalsRows(todayRows);

      const bandRows = todayRows.filter(row => row.date === bandDay);
      const result = await syncTodayVitalsToBackend(bandDay, bandRows);
      setActionStatus(`Today vitals synced to backend for ${result.days} day(s)`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Failed to fetch and sync today vitals');
    } finally {
      setTodaySyncing(false);
    }
  }, [buildTodayVitals, connected, isSeniorUser, syncTodayVitalsToBackend]);

  useEffect(() => {
    if (!isSeniorUser || !route.params || !(route.params as RouteParams).showSyncLatestPrompt) {
      return;
    }

    const promptKey = String((route.params as RouteParams).promptToken ?? deviceId ?? 'latest');
    if (syncLatestPromptKeyRef.current === promptKey) {
      return;
    }
    syncLatestPromptKeyRef.current = promptKey;

    Alert.alert(
      'Sync latest data?',
      'Sync today\'s hand band data now?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sync Now', onPress: () => { handleFetchAndSyncToday(); } },
      ],
      { cancelable: true },
    );
  }, [deviceId, handleFetchAndSyncToday, isSeniorUser, route.params]);

  const todayRows = useMemo(() => aggregateVitals(historyByType, todayLocalDayKey()), [historyByType]);
  const vitalsRowsForTable = useMemo(
    () => historyReadStatus.day === todayLocalDayKey() ? todayRows : fetchedVitalsRows,
    [todayRows, historyReadStatus.day, fetchedVitalsRows],
  );
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

  const today = todayRows[0];
  const displaySteps = today?.steps ?? null;
  const displayDistanceKm = today?.distanceKm ?? null;
  const displayCaloriesKcal = today?.caloriesKcal ?? null;
  const displayHeartRate = today?.heartRateLatest ?? null;
  const displaySpo2 = today?.spo2Latest ?? null;
  const displaySystolicBp = today?.systolicBpLatest ?? null;
  const displayDiastolicBp = today?.diastolicBpLatest ?? null;
  const displayTemperatureC = today?.temperatureLatestC ?? null;
  const displayHrv = today?.hrvLatest ?? null;
  const displayStress = today?.stressLatest ?? null;
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

  const readStatusText = historyReadStatus.phase === 'reading'
    ? historyReadStatus.currentType
      ? `Reading ${historyTypeLabels[historyReadStatus.currentType] ?? 'vitals'}… ${historyReadStatus.completedTypes.length} categories complete. Values shown so far are partial.`
      : 'Preparing to read hand band vitals…'
    : historyReadStatus.phase === 'partial'
    ? 'Some readings could not be downloaded. Review the received values and retry before syncing.'
    : null;

  return (
    <SafeAreaView style={s.container}>
      {readStatusText ? <Text accessibilityLiveRegion="polite" style={s.readStatus}>{readStatusText}</Text> : null}
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

        {/* ── Today's Vitals ── */}
        <View style={s.card}>
          <View style={s.sectionHeaderRow}>
            <View style={s.sectionTitleRow}>
              <Icon name="today-outline" size={16} color="#F28C28" />
              <Text style={s.sectionTitle}>Today's Vitals</Text>
            </View>
            <Text style={s.sectionMeta}>{todayLocalDayKey()}</Text>
          </View>
          <Text style={s.sectionDescription}>
            Read today's readings off the band to review them, or sync them
            straight to the backend.
          </Text>

          <TouchableOpacity
            style={[s.fetchTodayBtn, (!isSeniorUser || !connected || todayFetching || todaySyncing) ? s.disabled : null]}
            disabled={!isSeniorUser || !connected || todayFetching || todaySyncing}
            onPress={handleFetchTodayVitals}
            activeOpacity={0.7}
          >
            {todayFetching
              ? <ActivityIndicator size="small" color="#fff" />
              : <Icon name="pulse-outline" size={18} color="#fff" />}
            <Text style={s.syncBtnText}>
              {todayFetching ? 'Fetching Today...' : 'Fetch Today Vitals'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.todaySyncBtn, (!isSeniorUser || !connected || todaySyncing || todayFetching) ? s.disabled : null]}
            disabled={!isSeniorUser || !connected || todaySyncing || todayFetching}
            onPress={handleFetchAndSyncToday}
            activeOpacity={0.7}
          >
            {todaySyncing
              ? <ActivityIndicator size="small" color="#fff" />
              : <Icon name="cloud-upload-outline" size={18} color="#fff" />}
            <Text style={s.syncBtnText}>
              {todaySyncing ? 'Syncing Today...' : 'Sync Today Data'}
            </Text>
          </TouchableOpacity>

          <Text style={s.hintText}>
            {!isSeniorUser
              ? 'Only senior users can fetch and sync wrist band data.'
              : !connected
              ? 'Connect the hand band to fetch or sync today\'s data.'
              : 'Sync reads the band again, so it is always up to date.'}
          </Text>

          {vitalsRowsForTable.length === 0 ? (
            <View style={s.emptyState}>
              <Icon name="pulse-outline" size={28} color="#D0C8BF" />
              <Text style={s.emptyText}>No vitals fetched yet</Text>
            </View>
          ) : (
            <DailyVitalsTable rows={vitalsRowsForTable} sortDescending={false} />
          )}
        </View>

        {actionStatus ? (
          <View style={s.statusBanner}>
            <Text style={s.statusBannerText}>{actionStatus}</Text>
          </View>
        ) : null}

        {canUseEcg ? (
          <TouchableOpacity
            style={[s.ecgBtn, !connected ? s.disabled : null]}
            disabled={!connected}
            onPress={() => navigation.navigate('ECGMeasurement')}
            activeOpacity={0.75}
          >
            <View style={s.ecgBtnIcon}>
              <Icon name="pulse" size={20} color="#D64545" />
            </View>
            <View style={s.ecgBtnTextWrap}>
              <Text style={s.ecgBtnTitle}>Take ECG</Text>
              <Text style={s.ecgBtnSubtitle}>{connected ? 'Start a guided ECG recording' : 'Connect this hand band first'}</Text>
            </View>
            <Icon name="chevron-forward" size={19} color="#B96767" />
          </TouchableOpacity>
        ) : null}

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
  readStatus: { padding: 12 },
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

  fetchTodayBtn: {
    marginTop: 8, backgroundColor: '#3E7CB1', borderRadius: 16,
    paddingVertical: 12, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center',
  },
  todaySyncBtn: {
    marginTop: 8, backgroundColor: '#2F8A66', borderRadius: 16,
    paddingVertical: 12, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center',
  },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, marginLeft: 8 },
  hintText: { fontSize: 12, color: '#7B6E61', marginTop: 10 },
  statusBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#EEF7FF',
    borderColor: '#CFE6F8',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  statusBannerText: {
    color: '#2C5D87',
    fontSize: 12,
    fontWeight: '600',
  },

  ecgBtn: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#F1D4D4',
  },
  ecgBtnIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FDECEC',
    marginRight: 11,
  },
  ecgBtnTextWrap: { flex: 1 },
  ecgBtnTitle: { color: '#3A302C', fontSize: 14, fontWeight: '700' },
  ecgBtnSubtitle: { color: '#8A8078', fontSize: 11, marginTop: 2 },

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
