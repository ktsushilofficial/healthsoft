import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { InteractionManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { isMacAddressLike } from '../utils/deviceAssignments';

type VitalsSummaryRow = {
  recordDate: string;
  steps: number | null;
  hrMin: number | null;
  hrMax: number | null;
  hrAvg: number | null;
  spo2Min: number | null;
  spo2Max: number | null;
  spo2Avg: number | null;
  tempMin: number | null;
  tempMax: number | null;
  tempAvg: number | null;
  systolicBpMin: number | null;
  systolicBpMax: number | null;
  systolicBpAvg: number | null;
  diastolicBpMin: number | null;
  diastolicBpMax: number | null;
  diastolicBpAvg: number | null;
};

type ActivityRangeKey =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_one_month';

type ActivityRangeOption = {
  key: ActivityRangeKey;
  label: string;
  queryDays: number;
};

type MetricRange = {
  high: number | null;
  low: number | null;
};

type BloodPressureRange = {
  high: VitalsSummaryRow | null;
  low: VitalsSummaryRow | null;
};

const RANGE_OPTIONS: ActivityRangeOption[] = [
  { key: 'today', label: 'Today', queryDays: 1 },
  { key: 'yesterday', label: 'Yesterday', queryDays: 2 },
  { key: 'this_week', label: 'This Week', queryDays: 7 },
  { key: 'last_one_month', label: 'Last 1 Month', queryDays: 30 },
];

function sumMetric(
  rows: VitalsSummaryRow[],
  selector: (row: VitalsSummaryRow) => number | null,
): number {
  return rows.reduce((sum, row) => sum + (selector(row) ?? 0), 0);
}

function averageMetricWithFixedDivisor(
  rows: VitalsSummaryRow[],
  selector: (row: VitalsSummaryRow) => number | null,
  divisor: 7 | 30,
): number | null {
  if (!rows.some(row => selector(row) != null)) return null;
  return sumMetric(rows, selector) / divisor;
}

function metricRange(
  rows: VitalsSummaryRow[],
  selector: (row: VitalsSummaryRow) => number | null,
): MetricRange {
  const values = rows
    .map(selector)
    .filter((value): value is number => value != null);

  return {
    high: values.length > 0 ? Math.max(...values) : null,
    low: values.length > 0 ? Math.min(...values) : null,
  };
}

function bloodPressureRange(rows: VitalsSummaryRow[]): BloodPressureRange {
  const values = rows.filter(
    row => row.systolicBpAvg != null && row.diastolicBpAvg != null,
  );

  if (values.length === 0) {
    return { high: null, low: null };
  }

  const compare = (a: VitalsSummaryRow, b: VitalsSummaryRow): number =>
    (a.systolicBpAvg ?? 0) - (b.systolicBpAvg ?? 0) ||
    (a.diastolicBpAvg ?? 0) - (b.diastolicBpAvg ?? 0);

  return {
    high: values.reduce((highest, row) => compare(row, highest) > 0 ? row : highest),
    low: values.reduce((lowest, row) => compare(row, lowest) < 0 ? row : lowest),
  };
}

function formatBloodPressure(row: VitalsSummaryRow | null): string {
  return row?.systolicBpAvg != null && row.diastolicBpAvg != null
    ? `${Math.round(row.systolicBpAvg)}/${Math.round(row.diastolicBpAvg)}`
    : 'NA';
}

function formatBloodPressureValues(
  systolic: number | null | undefined,
  diastolic: number | null | undefined,
): string {
  return systolic != null && diastolic != null
    ? `${Math.round(systolic)}/${Math.round(diastolic)}`
    : 'NA';
}

function formatMetricValue(
  value: number | null | undefined,
  fractionDigits = 0,
): string {
  return value != null ? value.toFixed(fractionDigits) : 'NA';
}

function ymdDate(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSummaryRows(payload: unknown): VitalsSummaryRow[] {
  const root = asRecord(payload);
  const candidates: unknown[] =
    Array.isArray(payload)
      ? payload
      : Array.isArray(root?.vitalSummaries)
        ? root?.vitalSummaries
        : Array.isArray(root?.summaries)
          ? root?.summaries
          : Array.isArray(root?.data)
            ? root?.data
            : Array.isArray(asRecord(root?.data)?.vitalSummaries)
              ? (asRecord(root?.data)?.vitalSummaries as unknown[])
              : [];

  return candidates
    .map(item => {
      const row = asRecord(item);
      if (!row) return null;
      const recordDate = asString(row.recordDate) ?? asString(row.date);
      if (!recordDate) return null;
      return {
        recordDate,
        steps: asNumber(row.steps),
        hrMin: asNumber(row.hrMin) ?? asNumber(row.heartRateMin),
        hrMax: asNumber(row.hrMax) ?? asNumber(row.heartRateMax),
        hrAvg: asNumber(row.hrAvg) ?? asNumber(row.heartRateAvg),
        spo2Min: asNumber(row.spo2Min),
        spo2Max: asNumber(row.spo2Max),
        spo2Avg: asNumber(row.spo2Avg),
        tempMin: asNumber(row.tempMin) ?? asNumber(row.temperatureMinC),
        tempMax: asNumber(row.tempMax) ?? asNumber(row.temperatureMaxC),
        tempAvg: asNumber(row.tempAvg) ?? asNumber(row.temperatureAvgC),
        systolicBpMin: asNumber(row.systolicBpMin),
        systolicBpMax: asNumber(row.systolicBpMax),
        systolicBpAvg: asNumber(row.systolicBpAvg),
        diastolicBpMin: asNumber(row.diastolicBpMin),
        diastolicBpMax: asNumber(row.diastolicBpMax),
        diastolicBpAvg: asNumber(row.diastolicBpAvg),
      };
    })
    .filter((row): row is VitalsSummaryRow => row !== null)
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate));
}

const ActivityScreen = () => {
  const navigation = useNavigation<any>();
  const {
    user,
    isCaretaker,
    selectedSenior,
    getAssignedDevicesForSenior,
    getV8VitalsSummary,
  } = useAuth();

  const [showSevenDayTable, setShowSevenDayTable] = useState(true);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<VitalsSummaryRow[]>([]);
  const [activeDeviceUuid, setActiveDeviceUuid] = useState<string | null>(null);
  const [selectedRange, setSelectedRange] = useState<ActivityRangeKey>('today');
  const getAssignedDevicesForSeniorRef = useRef(getAssignedDevicesForSenior);
  const getV8VitalsSummaryRef = useRef(getV8VitalsSummary);
  const deviceUuidBySeniorRef = useRef<Record<string, string>>({});
  const rowsCacheRef = useRef<Record<string, { rows: VitalsSummaryRow[]; deviceUuid: string }>>({});
  const inFlightRequestKeyRef = useRef<string | null>(null);

  const activeSeniorId = useMemo(() => {
    if (isCaretaker) {
      return selectedSenior?.userId ?? null;
    }
    return user?.role === 'SENIOR' ? user.user_id : null;
  }, [isCaretaker, selectedSenior?.userId, user?.role, user?.user_id]);

  const selectedRangeOption = useMemo(
    () => RANGE_OPTIONS.find(option => option.key === selectedRange) ?? RANGE_OPTIONS[0],
    [selectedRange],
  );

  useEffect(() => {
    getAssignedDevicesForSeniorRef.current = getAssignedDevicesForSenior;
    getV8VitalsSummaryRef.current = getV8VitalsSummary;
  }, [getAssignedDevicesForSenior, getV8VitalsSummary]);

  useEffect(() => {
    rowsCacheRef.current = {};
    inFlightRequestKeyRef.current = null;
  }, [activeSeniorId]);

  useFocusEffect(
    React.useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        setReady(true);
      });
      return () => task.cancel();
    }, []),
  );

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;

      const loadVitalsSummary = async () => {
        if (!activeSeniorId) {
          setError(isCaretaker ? 'Select a senior to view activity.' : 'Profile unavailable.');
          setRows([]);
          setActiveDeviceUuid(null);
          return;
        }

        const requestKey = `${activeSeniorId}:${selectedRangeOption.queryDays}`;
        const cached = rowsCacheRef.current[requestKey];
        if (cached) {
          setError(null);
          setRows(cached.rows);
          setActiveDeviceUuid(cached.deviceUuid);
          setLoading(false);
          return;
        }
        if (inFlightRequestKeyRef.current === requestKey) {
          return;
        }

        inFlightRequestKeyRef.current = requestKey;
        setLoading(true);
        setError(null);

        try {
          let deviceUUID = deviceUuidBySeniorRef.current[activeSeniorId]?.trim() ?? '';
          if (!deviceUUID) {
            const assigned = await getAssignedDevicesForSeniorRef.current(activeSeniorId);
            const handBandAssignment = assigned.find(
              device => !!device.deviceId && isMacAddressLike(device.deviceIdentifier),
            );
            deviceUUID = handBandAssignment?.deviceId?.trim() ?? '';
          }
          if (!deviceUUID) {
            throw new Error('No assigned hand band device found for selected senior.');
          }
          deviceUuidBySeniorRef.current[activeSeniorId] = deviceUUID;

          const payload = await getV8VitalsSummaryRef.current(deviceUUID, selectedRangeOption.queryDays);
          const normalizedRows = normalizeSummaryRows(payload);

          if (cancelled) return;
          rowsCacheRef.current[requestKey] = {
            rows: normalizedRows,
            deviceUuid: deviceUUID,
          };
          setActiveDeviceUuid(deviceUUID);
          setRows(normalizedRows);
        } catch (e) {
          if (cancelled) return;
          setRows([]);
          setActiveDeviceUuid(null);
          setError(e instanceof Error ? e.message : 'Failed to load activity summary.');
        } finally {
          if (inFlightRequestKeyRef.current === requestKey) {
            inFlightRequestKeyRef.current = null;
          }
          if (!cancelled) {
            setLoading(false);
          }
        }
      };

      loadVitalsSummary();

      return () => {
        cancelled = true;
      };
    }, [activeSeniorId, isCaretaker, selectedRangeOption.queryDays]),
  );

  const visibleRows = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - 6);
    const lastOneMonthStart = new Date(today);
    lastOneMonthStart.setDate(today.getDate() - 29);

    const inRange = (date: Date): boolean => {
      switch (selectedRange) {
        case 'today':
          return date.getTime() === today.getTime();
        case 'yesterday':
          return date.getTime() === yesterday.getTime();
        case 'this_week':
          return date >= startOfWeek && date <= today;
        case 'last_one_month':
          return date >= lastOneMonthStart && date <= today;
        default:
          return true;
      }
    };

    return rows.filter(row => {
      const date = ymdDate(row.recordDate);
      return date ? inRange(date) : false;
    });
  }, [rows, selectedRange]);

  const isMultiDayRange =
    selectedRange === 'this_week' || selectedRange === 'last_one_month';

  const stepSummary = useMemo(() => {
    if (selectedRange === 'this_week') {
      return averageMetricWithFixedDivisor(visibleRows, row => row.steps, 7);
    }
    if (selectedRange === 'last_one_month') {
      return averageMetricWithFixedDivisor(visibleRows, row => row.steps, 30);
    }
    return visibleRows[0]?.steps ?? null;
  }, [selectedRange, visibleRows]);

  const vitalSummary = useMemo(() => ({
    bloodPressure: bloodPressureRange(visibleRows),
    spo2: metricRange(visibleRows, row => row.spo2Avg),
    heartRate: metricRange(visibleRows, row => row.hrAvg),
    temperature: metricRange(visibleRows, row => row.tempAvg),
  }), [visibleRows]);

  const singleDayRow = visibleRows[0] ?? null;

  const summaryPeriodLabel =
    selectedRange === 'this_week'
      ? 'This Week'
      : selectedRange === 'last_one_month'
        ? 'Last 1 Month'
        : selectedRange === 'yesterday'
          ? 'Yesterday'
          : 'Today';

  const stepLabel = isMultiDayRange
    ? `${summaryPeriodLabel} Daily Average Step Count`
    : `${summaryPeriodLabel} Step Count`;

  if (!ready) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="small" color="#F28C28" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.backButton}>
            <Icon name="arrow-back" size={22} color="#F28C28" />
          </TouchableOpacity>
          <View style={styles.brandRow}>
            <Icon name="fitness" size={20} color="#F28C28" />
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Health Activity</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rangeChipsRow}
          >
            {RANGE_OPTIONS.map(option => {
              const active = option.key === selectedRange;
              return (
                <TouchableOpacity
                  key={option.key}
                  style={[styles.rangeChip, active ? styles.rangeChipActive : null]}
                  onPress={() => {
                    if (!active) {
                      setSelectedRange(option.key);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.rangeChipText, active ? styles.rangeChipTextActive : null]}>
                    {option.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {activeDeviceUuid ? (
            <View style={styles.liveBadge}>
              <Icon name="hardware-chip-outline" size={14} color="#1D8A45" />
              <Text style={styles.liveBadgeText}>Device UUID: {activeDeviceUuid}</Text>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator size="small" color="#F28C28" />
              <Text style={styles.inlineLoadingText}>Loading activity summary...</Text>
            </View>
          ) : null}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <View style={[styles.metricCard, styles.metricSteps]}>
            <View style={styles.metricIconWrap}>
              <Icon name="footsteps" size={26} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <Text style={styles.metricValue}>
                {stepSummary != null ? `${Math.round(stepSummary)}` : 'NA'}
              </Text>
              <Text style={styles.metricLabel}>{stepLabel}</Text>
              <View style={styles.progressTrack}>
                <View style={styles.progressFill} />
                <View style={styles.goalChip}>
                  <Text style={styles.goalText}>Goal: 10,000</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="heart" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <Text style={styles.metricLabel}>
                {summaryPeriodLabel} Blood Pressure{isMultiDayRange ? '' : ' (mmHg)'}
              </Text>
              {isMultiDayRange ? (
                <View style={styles.metricRangeRow}>
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>HIGH DAY</Text>
                    <View style={styles.inlineRow}>
                      <Text style={styles.metricRangeValue}>
                        {formatBloodPressure(vitalSummary.bloodPressure.high)}
                      </Text>
                      <Text style={styles.metricRangeUnit}>mmHg</Text>
                    </View>
                  </View>
                  <View style={styles.metricRangeDivider} />
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>LOW DAY</Text>
                    <View style={styles.inlineRow}>
                      <Text style={styles.metricRangeValue}>
                        {formatBloodPressure(vitalSummary.bloodPressure.low)}
                      </Text>
                      <Text style={styles.metricRangeUnit}>mmHg</Text>
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.metricRangeRow}>
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>AVERAGE</Text>
                    <Text style={styles.metricRangeValue}>
                      {formatBloodPressure(singleDayRow)}
                    </Text>
                  </View>
                  <View style={[styles.metricRangeDivider, styles.dailyRangeDivider]} />
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>HIGH</Text>
                    <Text style={styles.metricRangeValue}>
                      {formatBloodPressureValues(
                        singleDayRow?.systolicBpMax,
                        singleDayRow?.diastolicBpMax,
                      )}
                    </Text>
                  </View>
                  <View style={[styles.metricRangeDivider, styles.dailyRangeDivider]} />
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>LOW</Text>
                    <Text style={styles.metricRangeValue}>
                      {formatBloodPressureValues(
                        singleDayRow?.systolicBpMin,
                        singleDayRow?.diastolicBpMin,
                      )}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="water" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <Text style={styles.metricLabel}>{summaryPeriodLabel} Blood Oxygen</Text>
              {isMultiDayRange ? (
                <View style={styles.metricRangeRow}>
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>HIGH DAY</Text>
                    <Text style={styles.metricRangeValue}>
                      {vitalSummary.spo2.high != null
                        ? `${Math.round(vitalSummary.spo2.high)}%`
                        : 'NA'}
                    </Text>
                  </View>
                  <View style={styles.metricRangeDivider} />
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>LOW DAY</Text>
                    <Text style={styles.metricRangeValue}>
                      {vitalSummary.spo2.low != null
                        ? `${Math.round(vitalSummary.spo2.low)}%`
                        : 'NA'}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.metricRangeRow}>
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>AVERAGE</Text>
                    <Text style={styles.metricRangeValue}>
                      {singleDayRow?.spo2Avg != null
                        ? `${Math.round(singleDayRow.spo2Avg)}%`
                        : 'NA'}
                    </Text>
                  </View>
                  <View style={[styles.metricRangeDivider, styles.dailyRangeDivider]} />
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>HIGH</Text>
                    <Text style={styles.metricRangeValue}>
                      {singleDayRow?.spo2Max != null
                        ? `${Math.round(singleDayRow.spo2Max)}%`
                        : 'NA'}
                    </Text>
                  </View>
                  <View style={[styles.metricRangeDivider, styles.dailyRangeDivider]} />
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>LOW</Text>
                    <Text style={styles.metricRangeValue}>
                      {singleDayRow?.spo2Min != null
                        ? `${Math.round(singleDayRow.spo2Min)}%`
                        : 'NA'}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="pulse" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <Text style={styles.metricLabel}>{summaryPeriodLabel} Heart Rate</Text>
              {isMultiDayRange ? (
                <View style={styles.metricRangeRow}>
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>HIGH DAY</Text>
                    <View style={styles.inlineRow}>
                      <Text style={styles.metricRangeValue}>
                        {vitalSummary.heartRate.high != null
                          ? `${Math.round(vitalSummary.heartRate.high)}`
                          : 'NA'}
                      </Text>
                      <Text style={styles.metricRangeUnit}>BPM</Text>
                    </View>
                  </View>
                  <View style={styles.metricRangeDivider} />
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>LOW DAY</Text>
                    <View style={styles.inlineRow}>
                      <Text style={styles.metricRangeValue}>
                        {vitalSummary.heartRate.low != null
                          ? `${Math.round(vitalSummary.heartRate.low)}`
                          : 'NA'}
                      </Text>
                      <Text style={styles.metricRangeUnit}>BPM</Text>
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.metricRangeRow}>
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>AVERAGE</Text>
                    <View style={styles.inlineRow}>
                      <Text style={styles.metricRangeValue}>
                        {formatMetricValue(singleDayRow?.hrAvg)}
                      </Text>
                      <Text style={styles.metricRangeUnit}>BPM</Text>
                    </View>
                  </View>
                  <View style={[styles.metricRangeDivider, styles.dailyRangeDivider]} />
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>HIGH</Text>
                    <View style={styles.inlineRow}>
                      <Text style={styles.metricRangeValue}>
                        {formatMetricValue(singleDayRow?.hrMax)}
                      </Text>
                      <Text style={styles.metricRangeUnit}>BPM</Text>
                    </View>
                  </View>
                  <View style={[styles.metricRangeDivider, styles.dailyRangeDivider]} />
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>LOW</Text>
                    <View style={styles.inlineRow}>
                      <Text style={styles.metricRangeValue}>
                        {formatMetricValue(singleDayRow?.hrMin)}
                      </Text>
                      <Text style={styles.metricRangeUnit}>BPM</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="thermometer" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <Text style={styles.metricLabel}>{summaryPeriodLabel} Body Temperature</Text>
              {isMultiDayRange ? (
                <View style={styles.metricRangeRow}>
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>HIGH DAY</Text>
                    <View style={styles.inlineRow}>
                      <Text style={styles.metricRangeValue}>
                        {vitalSummary.temperature.high != null
                          ? vitalSummary.temperature.high.toFixed(1)
                          : 'NA'}
                      </Text>
                      <Text style={styles.metricRangeUnit}>°C</Text>
                    </View>
                  </View>
                  <View style={styles.metricRangeDivider} />
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>LOW DAY</Text>
                    <View style={styles.inlineRow}>
                      <Text style={styles.metricRangeValue}>
                        {vitalSummary.temperature.low != null
                          ? vitalSummary.temperature.low.toFixed(1)
                          : 'NA'}
                      </Text>
                      <Text style={styles.metricRangeUnit}>°C</Text>
                    </View>
                  </View>
                </View>
              ) : (
                <View style={styles.metricRangeRow}>
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>AVERAGE</Text>
                    <View style={styles.inlineRow}>
                      <Text style={styles.metricRangeValue}>
                        {formatMetricValue(singleDayRow?.tempAvg, 1)}
                      </Text>
                      <Text style={styles.metricRangeUnit}>°C</Text>
                    </View>
                  </View>
                  <View style={[styles.metricRangeDivider, styles.dailyRangeDivider]} />
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>HIGH</Text>
                    <View style={styles.inlineRow}>
                      <Text style={styles.metricRangeValue}>
                        {formatMetricValue(singleDayRow?.tempMax, 1)}
                      </Text>
                      <Text style={styles.metricRangeUnit}>°C</Text>
                    </View>
                  </View>
                  <View style={[styles.metricRangeDivider, styles.dailyRangeDivider]} />
                  <View style={styles.metricRangeItem}>
                    <Text style={styles.metricRangeLabel}>LOW</Text>
                    <View style={styles.inlineRow}>
                      <Text style={styles.metricRangeValue}>
                        {formatMetricValue(singleDayRow?.tempMin, 1)}
                      </Text>
                      <Text style={styles.metricRangeUnit}>°C</Text>
                    </View>
                  </View>
                </View>
              )}
            </View>
          </View>

          <TouchableOpacity
            style={[styles.sevenDayBtn, visibleRows.length === 0 ? styles.sevenDayBtnDisabled : null]}
            disabled={visibleRows.length === 0}
            onPress={() => setShowSevenDayTable(prev => !prev)}
            activeOpacity={0.75}
          >
            <Icon name="calendar-outline" size={16} color="#F28C28" />
            <Text style={styles.sevenDayBtnText}>
              {showSevenDayTable ? 'Hide Activity Data' : 'Show Activity Data'}
            </Text>
          </TouchableOpacity>

          {showSevenDayTable ? (
            <View style={styles.tableWrap}>
              <View style={[styles.tableRow, styles.tableHeader]}>
                <Text style={[styles.tableCell, styles.tableCellDay, styles.tableHeaderText]}>Day</Text>
                <Text style={[styles.tableCell, styles.tableHeaderText]}>Steps</Text>
                <Text style={[styles.tableCell, styles.tableHeaderText]}>HR</Text>
                <Text style={[styles.tableCell, styles.tableHeaderText]}>SpO2</Text>
                <Text style={[styles.tableCell, styles.tableHeaderText]}>Temp</Text>
                <Text style={[styles.tableCell, styles.tableHeaderText]}>BP</Text>
              </View>
              {visibleRows.map(row => (
                <View key={row.recordDate} style={styles.tableRow}>
                  <Text style={[styles.tableCell, styles.tableCellDay]}>{row.recordDate.slice(5)}</Text>
                  <Text style={styles.tableCell}>{row.steps != null ? `${row.steps}` : '--'}</Text>
                  <Text style={styles.tableCell}>{row.hrAvg != null ? `${Math.round(row.hrAvg)}` : '--'}</Text>
                  <Text style={styles.tableCell}>{row.spo2Avg != null ? `${Math.round(row.spo2Avg)}%` : '--'}</Text>
                  <Text style={styles.tableCell}>{row.tempAvg != null ? `${row.tempAvg.toFixed(1)}` : '--'}</Text>
                  <Text style={styles.tableCell}>
                    {row.systolicBpAvg != null && row.diastolicBpAvg != null
                      ? `${Math.round(row.systolicBpAvg)}/${Math.round(row.diastolicBpAvg)}`
                      : '--'}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default ActivityScreen;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F2EE',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  backButton: {
    width: 24,
    alignItems: 'flex-start',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSpacer: {
    width: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2E2A27',
    marginBottom: 12,
  },
  liveBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F8ED',
    borderColor: '#B9E9CA',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 12,
  },
  rangeChipsRow: {
    paddingBottom: 10,
  },
  rangeChip: {
    backgroundColor: '#FFF5E9',
    borderWidth: 1,
    borderColor: '#F8DDBB',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginRight: 8,
  },
  rangeChipActive: {
    backgroundColor: '#F28C28',
    borderColor: '#F28C28',
  },
  rangeChipText: {
    color: '#C07320',
    fontSize: 12,
    fontWeight: '700',
  },
  rangeChipTextActive: {
    color: '#FFFFFF',
  },
  liveBadgeText: {
    marginLeft: 6,
    color: '#1D8A45',
    fontSize: 12,
    fontWeight: '700',
  },
  inlineLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  inlineLoadingText: {
    marginLeft: 8,
    color: '#7A726A',
    fontSize: 12,
  },
  errorText: {
    color: '#B00020',
    marginBottom: 10,
  },
  metricCard: {
    backgroundColor: '#FAF8F5',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F0E7DD',
  },
  metricSteps: {
    paddingBottom: 16,
  },
  metricIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#FFF2E5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  metricInfo: {
    flex: 1,
  },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#2E2A27',
  },
  metricUnit: {
    fontSize: 14,
    color: '#7A726A',
    marginLeft: 6,
    marginTop: 4,
  },
  metricLabel: {
    fontSize: 14,
    color: '#7A726A',
    marginTop: 4,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  metricRangeRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 8,
  },
  metricRangeItem: {
    flex: 1,
  },
  metricRangeDivider: {
    width: 1,
    backgroundColor: '#E6D9CC',
    marginHorizontal: 12,
  },
  dailyRangeDivider: {
    marginHorizontal: 6,
  },
  metricRangeLabel: {
    color: '#9A6A3B',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  metricRangeValue: {
    color: '#2E2A27',
    fontSize: 19,
    fontWeight: '700',
  },
  metricRangeUnit: {
    color: '#7A726A',
    fontSize: 10,
    marginLeft: 4,
  },
  progressTrack: {
    marginTop: 10,
    height: 12,
    backgroundColor: '#F1E7DB',
    borderRadius: 10,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressFill: {
    height: 12,
    width: '70%',
    backgroundColor: '#F28C28',
    borderRadius: 10,
  },
  goalChip: {
    position: 'absolute',
    right: 8,
    backgroundColor: '#E27D1A',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  goalText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  sevenDayBtn: {
    marginTop: 4,
    marginBottom: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF5E9',
    borderColor: '#F8DDBB',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  sevenDayBtnDisabled: {
    opacity: 0.5,
  },
  sevenDayBtnText: {
    marginLeft: 6,
    color: '#F28C28',
    fontSize: 12,
    fontWeight: '700',
  },
  tableWrap: {
    borderWidth: 1,
    borderColor: '#F0E7DD',
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 4,
  },
  tableHeader: {
    backgroundColor: '#FAF2E8',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F6EEE5',
    minHeight: 36,
  },
  tableCell: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    color: '#5C4A3A',
    paddingVertical: 8,
  },
  tableCellDay: {
    flex: 1.2,
  },
  tableHeaderText: {
    fontWeight: '700',
    color: '#7A5837',
    fontSize: 11,
  },
});
