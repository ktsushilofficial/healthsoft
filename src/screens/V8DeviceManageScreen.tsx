import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  InteractionManager,
  Modal,
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
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useV8DeviceManager } from '../v8/useV8DeviceManager';
import type { V8DailyVitalSummary } from '../v8/models';

type RouteParams = { deviceId: string; deviceName?: string | null };

const fmt = (v: unknown, suffix = '') =>
  v != null && v !== '' ? `${v}${suffix}` : '—';
const fmtNum = (v: number | null | undefined, decimals = 0, suffix = '') =>
  v != null && !Number.isNaN(v) ? `${Number(v).toFixed(decimals)}${suffix}` : '—';
const toYmd = (date: Date) => date.toISOString().slice(0, 10);
const parseYmdDate = (value: string): Date | null => {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

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
    requestLiveSnapshot,
    buildDailyVitalsRange, syncDailyVitalsToBackend,
    latestLiveData, historyByType, deviceInfo,
  } = useV8DeviceManager();

  const state = connectionStates[normalizeId(deviceId)] ?? 'disconnected';
  const connected = state === 'connected';

  const [refreshingLive, setRefreshingLive] = useState(false);
  const [rangeVitalsFetching, setRangeVitalsFetching] = useState(false);
  const [backendSyncing, setBackendSyncing] = useState(false);
  const [todaySyncing, setTodaySyncing] = useState(false);
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    return toYmd(d);
  });
  const [toDate, setToDate] = useState(() => toYmd(new Date()));
  const [pickerTarget, setPickerTarget] = useState<'from' | 'to' | null>(null);
  const [iosPickerValue, setIosPickerValue] = useState<Date>(new Date());
  const [fetchedVitalsRows, setFetchedVitalsRows] = useState<V8DailyVitalSummary[]>([]);
  const [fetchedVitalsRangeKey, setFetchedVitalsRangeKey] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const deviceInfoRef = useRef(deviceInfo);
  const currentRangeKey = `${fromDate}|${toDate}`;

  const fromDateValue = useMemo(() => parseYmdDate(fromDate) ?? new Date(), [fromDate]);
  const toDateValue = useMemo(() => parseYmdDate(toDate) ?? new Date(), [toDate]);

  const applyPickedDate = useCallback((target: 'from' | 'to', value: Date) => {
    const normalized = toYmd(value);
    if (target === 'from') {
      setFromDate(normalized);
      if (normalized > toDate) {
        setToDate(normalized);
      }
      return;
    }
    setToDate(normalized);
    if (normalized < fromDate) {
      setFromDate(normalized);
    }
  }, [fromDate, toDate]);

  const openDatePicker = useCallback((target: 'from' | 'to') => {
    setPickerTarget(target);
    setIosPickerValue(target === 'from' ? fromDateValue : toDateValue);
  }, [fromDateValue, toDateValue]);

  const handleDatePickerChange = useCallback((event: DateTimePickerEvent, value?: Date) => {
    if (!pickerTarget) return;
    if (Platform.OS === 'ios') {
      if (value) {
        setIosPickerValue(value);
      }
      return;
    }
    if (event.type === 'dismissed' || !value) {
      setPickerTarget(null);
      return;
    }
    applyPickedDate(pickerTarget, value);
    setPickerTarget(null);
  }, [applyPickedDate, pickerTarget]);

  useEffect(() => {
    deviceInfoRef.current = deviceInfo;
  }, [deviceInfo]);

  useEffect(() => {
    setFetchedVitalsRows([]);
    setFetchedVitalsRangeKey(null);
  }, [currentRangeKey]);

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
    } catch { /* */ }
    setRefreshingLive(false);
  }, [requestBattery, requestDeviceMac, requestLiveSnapshot, requestPersonalInfo]);

  const handleSyncVitalsToBackend = useCallback(async () => {
    if (fetchedVitalsRangeKey !== currentRangeKey) {
      setActionStatus('Fetch vitals for selected date range first, then sync.');
      return;
    }
    if (fetchedVitalsRows.length === 0) {
      setActionStatus('No vitals rows available to sync for this range.');
      return;
    }
    setBackendSyncing(true);
    setActionStatus(null);
    try {
      const result = await syncDailyVitalsToBackend(fromDate, toDate, fetchedVitalsRows);
      setActionStatus(`Vitals synced to backend for ${result.days} day(s)`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Failed to sync vitals to backend');
    } finally {
      setBackendSyncing(false);
    }
  }, [currentRangeKey, fetchedVitalsRangeKey, fetchedVitalsRows, fromDate, syncDailyVitalsToBackend, toDate]);

  const handleFetchVitalsRange = useCallback(async () => {
    setRangeVitalsFetching(true);
    setActionStatus(null);
    try {
      const rows = await buildDailyVitalsRange(fromDate, toDate);
      setFetchedVitalsRows(rows);
      setFetchedVitalsRangeKey(currentRangeKey);
      setActionStatus(`Fetched ${rows.length} vitals day row(s) for review`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Failed to fetch vitals range');
    } finally {
      setRangeVitalsFetching(false);
    }
  }, [buildDailyVitalsRange, currentRangeKey, fromDate, toDate]);

  const handleFetchAndSyncToday = useCallback(async () => {
    if (!connected) {
      setActionStatus('Connect the hand band before syncing today data.');
      return;
    }

    const today = toYmd(new Date());
    setTodaySyncing(true);
    setActionStatus(null);

    try {
      setFromDate(today);
      setToDate(today);

      const todayRows = await buildDailyVitalsRange(today, today);
      setFetchedVitalsRows(todayRows);
      setFetchedVitalsRangeKey(`${today}|${today}`);

      const exactTodayRows = todayRows.filter(row => row.date === today);
      const rowsToSync = exactTodayRows.length > 0 ? exactTodayRows : todayRows;
      if (rowsToSync.length === 0) {
        throw new Error('No today vitals data available to sync.');
      }

      const result = await syncDailyVitalsToBackend(today, today, rowsToSync);
      setActionStatus(`Today vitals synced to backend for ${result.days} day(s)`);
    } catch (error) {
      setActionStatus(error instanceof Error ? error.message : 'Failed to fetch and sync today vitals');
    } finally {
      setTodaySyncing(false);
    }
  }, [buildDailyVitalsRange, connected, syncDailyVitalsToBackend]);

  const vitalsRowsForTable = useMemo(
    () => [...fetchedVitalsRows].sort((a, b) => b.date.localeCompare(a.date)),
    [fetchedVitalsRows],
  );
  const hasFetchedVitalsForCurrentRange =
    fetchedVitalsRangeKey === currentRangeKey;
  const canSyncFetchedVitals =
    connected && hasFetchedVitalsForCurrentRange && fetchedVitalsRows.length > 0 && !backendSyncing;

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

        {/* ── Vitals Range ── */}
        <View style={s.card}>
          <View style={s.sectionHeaderRow}>
            <View style={s.sectionTitleRow}>
              <Icon name="calendar-outline" size={16} color="#F28C28" />
              <Text style={s.sectionTitle}>Vitals Range</Text>
            </View>
            <Text style={s.sectionMeta}>{vitalsRowsForTable.length} days</Text>
          </View>
          <Text style={s.sectionDescription}>
            Select date range, fetch daily vitals table, review rows, then sync.
          </Text>

          <View style={s.rangeInputRow}>
            <View style={s.rangeInputWrap}>
              <Text style={s.rangeInputLabel}>From</Text>
              <TouchableOpacity
                style={s.datePickerBtn}
                onPress={() => openDatePicker('from')}
                activeOpacity={0.75}
              >
                <Icon name="calendar-outline" size={16} color="#7A726A" />
                <Text style={s.datePickerText}>{fromDate}</Text>
              </TouchableOpacity>
            </View>
            <View style={s.rangeInputWrap}>
              <Text style={s.rangeInputLabel}>To</Text>
              <TouchableOpacity
                style={s.datePickerBtn}
                onPress={() => openDatePicker('to')}
                activeOpacity={0.75}
              >
                <Icon name="calendar-outline" size={16} color="#7A726A" />
                <Text style={s.datePickerText}>{toDate}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {Platform.OS === 'ios' ? (
            <Modal
              visible={pickerTarget !== null}
              animationType="slide"
              transparent
              onRequestClose={() => setPickerTarget(null)}
            >
              <View style={s.dateModalOverlay}>
                <View style={s.dateModalCard}>
                  <View style={s.dateModalHeader}>
                    <TouchableOpacity
                      onPress={() => setPickerTarget(null)}
                      style={s.dateModalActionBtn}
                    >
                      <Text style={s.dateModalActionText}>Cancel</Text>
                    </TouchableOpacity>
                    <Text style={s.dateModalTitle}>{pickerTarget === 'from' ? 'Select From Date' : 'Select To Date'}</Text>
                    <TouchableOpacity
                      onPress={() => {
                        if (!pickerTarget) return;
                        applyPickedDate(pickerTarget, iosPickerValue);
                        setPickerTarget(null);
                      }}
                      style={s.dateModalActionBtn}
                    >
                      <Text style={[s.dateModalActionText, s.dateModalDoneText]}>Done</Text>
                    </TouchableOpacity>
                  </View>
                  <DateTimePicker
                    value={iosPickerValue}
                    mode="date"
                    display="inline"
                    themeVariant="light"
                    accentColor="#2F8A66"
                    textColor="#1F1F1F"
                    maximumDate={pickerTarget === 'from' ? toDateValue : undefined}
                    minimumDate={pickerTarget === 'to' ? fromDateValue : undefined}
                    onChange={handleDatePickerChange}
                    style={s.iosDatePicker}
                  />
                </View>
              </View>
            </Modal>
          ) : null}

          {Platform.OS === 'android' && pickerTarget ? (
            <DateTimePicker
              value={pickerTarget === 'from' ? fromDateValue : toDateValue}
              mode="date"
              display="default"
              maximumDate={pickerTarget === 'from' ? toDateValue : undefined}
              minimumDate={pickerTarget === 'to' ? fromDateValue : undefined}
              onChange={handleDatePickerChange}
            />
          ) : null}

          <TouchableOpacity
            style={[s.fetchVitalsBtn, (!connected || rangeVitalsFetching) ? s.disabled : null]}
            disabled={!connected || rangeVitalsFetching}
            onPress={handleFetchVitalsRange}
            activeOpacity={0.7}
          >
            {rangeVitalsFetching
              ? <ActivityIndicator size="small" color="#fff" />
              : <Icon name="pulse-outline" size={18} color="#fff" />}
            <Text style={s.syncBtnText}>{rangeVitalsFetching ? 'Fetching Vitals...' : 'Fetch Vitals Table'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.backendSyncBtn, !canSyncFetchedVitals ? s.disabled : null]}
            disabled={!canSyncFetchedVitals}
            onPress={handleSyncVitalsToBackend}
            activeOpacity={0.7}
          >
            {backendSyncing
              ? <ActivityIndicator size="small" color="#fff" />
              : <Icon name="cloud-upload-outline" size={18} color="#fff" />}
            <Text style={s.syncBtnText}>
              {backendSyncing ? 'Uploading...' : 'Sync Fetched Vitals to Backend'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.todaySyncBtn, (!connected || todaySyncing || rangeVitalsFetching || backendSyncing) ? s.disabled : null]}
            disabled={!connected || todaySyncing || rangeVitalsFetching || backendSyncing}
            onPress={handleFetchAndSyncToday}
            activeOpacity={0.7}
          >
            {todaySyncing
              ? <ActivityIndicator size="small" color="#fff" />
              : <Icon name="flash-outline" size={18} color="#fff" />}
            <Text style={s.syncBtnText}>
              {todaySyncing ? 'Syncing Today...' : 'Fetch + Sync Today Data'}
            </Text>
          </TouchableOpacity>

          <Text style={s.rangeHintText}>
            {hasFetchedVitalsForCurrentRange
              ? `Fetched vitals rows: ${fetchedVitalsRows.length}. Review table below, then sync.`
              : 'Fetch vitals table first for this date range, then sync to backend.'}
          </Text>

          {vitalsRowsForTable.length === 0 ? (
            <View style={s.emptyState}>
              <Icon name="pulse-outline" size={28} color="#D0C8BF" />
              <Text style={s.emptyText}>No fetched vitals rows yet</Text>
            </View>
          ) : (
            <View style={s.vitalsTableWrap}>
              <Text style={s.vitalsTableTitle}>Daily Vitals Table</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View>
                  <View style={s.vitalsHeaderRow}>
                    <Text style={[s.vitalsHeaderCell, { minWidth: 94 }]}>Date</Text>
                    <Text style={s.vitalsHeaderCell}>Steps</Text>
                    <Text style={s.vitalsHeaderCell}>Dist</Text>
                    <Text style={s.vitalsHeaderCell}>Kcal</Text>
                    <Text style={s.vitalsHeaderCell}>HR Avg</Text>
                    <Text style={s.vitalsHeaderCell}>HR Min</Text>
                    <Text style={s.vitalsHeaderCell}>HR Max</Text>
                    <Text style={s.vitalsHeaderCell}>SpO2 Avg</Text>
                    <Text style={s.vitalsHeaderCell}>HRV Avg</Text>
                    <Text style={s.vitalsHeaderCell}>BP Avg</Text>
                    <Text style={s.vitalsHeaderCell}>Temp Avg</Text>
                    <Text style={s.vitalsHeaderCell}>Stress Avg</Text>
                  </View>
                  {vitalsRowsForTable.map(row => (
                    <View key={row.date} style={s.vitalsDataRow}>
                      <Text style={[s.vitalsDataCell, { minWidth: 94 }]}>{row.date}</Text>
                      <Text style={s.vitalsDataCell}>{fmtNum(row.steps, 0)}</Text>
                      <Text style={s.vitalsDataCell}>{fmtNum(row.distanceKm, 2)}</Text>
                      <Text style={s.vitalsDataCell}>{fmtNum(row.caloriesKcal, 0)}</Text>
                      <Text style={s.vitalsDataCell}>{fmtNum(row.heartRateAvg, 0)}</Text>
                      <Text style={s.vitalsDataCell}>{fmtNum(row.heartRateMin, 0)}</Text>
                      <Text style={s.vitalsDataCell}>{fmtNum(row.heartRateMax, 0)}</Text>
                      <Text style={s.vitalsDataCell}>{fmtNum(row.spo2Avg, 0)}</Text>
                      <Text style={s.vitalsDataCell}>{fmtNum(row.hrvAvg, 0)}</Text>
                      <Text style={s.vitalsDataCell}>
                        {row.systolicBpAvg != null && row.diastolicBpAvg != null
                          ? `${row.systolicBpAvg}/${row.diastolicBpAvg}`
                          : '—'}
                      </Text>
                      <Text style={s.vitalsDataCell}>{fmtNum(row.temperatureAvgC, 1)}</Text>
                      <Text style={s.vitalsDataCell}>{fmtNum(row.stressAvg, 0)}</Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            </View>
          )}
        </View>

        {actionStatus ? (
          <View style={s.statusBanner}>
            <Text style={s.statusBannerText}>{actionStatus}</Text>
          </View>
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

  backendSyncBtn: {
    marginTop: 8, backgroundColor: '#3E7CB1', borderRadius: 16,
    paddingVertical: 12, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center',
  },
  fetchVitalsBtn: {
    marginTop: 8, backgroundColor: '#2F8A66', borderRadius: 16,
    paddingVertical: 12, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center',
  },
  todaySyncBtn: {
    marginTop: 8, backgroundColor: '#2F8A66', borderRadius: 16,
    paddingVertical: 12, alignItems: 'center',
    flexDirection: 'row', justifyContent: 'center',
  },
  syncBtnText: { color: '#fff', fontWeight: '700', fontSize: 14, marginLeft: 8 },
  rangeHintText: { fontSize: 12, color: '#7B6E61', marginTop: 10 },
  rangeInputRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  rangeInputWrap: { flex: 1 },
  rangeInputLabel: { fontSize: 11, color: '#8A8078', marginBottom: 4 },
  datePickerBtn: {
    borderWidth: 1,
    borderColor: '#E9DFD5',
    borderRadius: 10,
    backgroundColor: '#FAF8F5',
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  datePickerText: {
    color: '#2E2A27',
    fontSize: 13,
    marginLeft: 8,
    fontWeight: '600',
  },
  dateModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.28)',
    justifyContent: 'flex-end',
  },
  dateModalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 24,
  },
  dateModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dateModalActionBtn: {
    minWidth: 60,
    paddingVertical: 6,
  },
  dateModalActionText: {
    fontSize: 14,
    color: '#7A726A',
    fontWeight: '600',
  },
  dateModalDoneText: {
    textAlign: 'right',
    color: '#2F8A66',
  },
  dateModalTitle: {
    fontSize: 15,
    color: '#2E2A27',
    fontWeight: '700',
    textAlign: 'center',
  },
  iosDatePicker: { backgroundColor: '#FFFFFF' },
  vitalsTableWrap: {
    borderWidth: 1,
    borderColor: '#E9E4DD',
    borderRadius: 12,
    marginTop: 12,
    backgroundColor: '#FFFDFA',
    paddingVertical: 8,
  },
  vitalsTableTitle: {
    fontSize: 12,
    color: '#5A524B',
    fontWeight: '700',
    marginHorizontal: 10,
    marginBottom: 8,
  },
  vitalsHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F7F2EA',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#EEE5DA',
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  vitalsHeaderCell: {
    minWidth: 72,
    fontSize: 10,
    color: '#7B5835',
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  vitalsDataRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F3ECE3',
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  vitalsDataCell: {
    minWidth: 72,
    fontSize: 11,
    color: '#2E2A27',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
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
