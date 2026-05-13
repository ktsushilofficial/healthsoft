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
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { isMacAddressLike } from '../utils/deviceAssignments';

type VitalsSummaryRow = {
  recordDate: string;
  steps: number | null;
  hrAvg: number | null;
  spo2Avg: number | null;
  tempAvg: number | null;
  systolicBpAvg: number | null;
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

const RANGE_OPTIONS: ActivityRangeOption[] = [
  { key: 'today', label: 'Today', queryDays: 1 },
  { key: 'yesterday', label: 'Yesterday', queryDays: 2 },
  { key: 'this_week', label: 'This Week', queryDays: 7 },
  { key: 'last_one_month', label: 'Last 1 Month', queryDays: 31 },
];

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
        hrAvg: asNumber(row.hrAvg) ?? asNumber(row.heartRateAvg),
        spo2Avg: asNumber(row.spo2Avg),
        tempAvg: asNumber(row.tempAvg) ?? asNumber(row.temperatureAvgC),
        systolicBpAvg: asNumber(row.systolicBpAvg),
        diastolicBpAvg: asNumber(row.diastolicBpAvg),
      };
    })
    .filter((row): row is VitalsSummaryRow => row !== null)
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate));
}

const ActivityScreen = () => {
  const {
    user,
    isCaretaker,
    selectedSenior,
    getAssignedDevicesForSenior,
    getV8VitalsSummary,
  } = useAuth();

  const [showSevenDayTable, setShowSevenDayTable] = useState(false);
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
    startOfWeek.setDate(today.getDate() - today.getDay());
    const lastOneMonthStart = new Date(today);
    lastOneMonthStart.setDate(today.getDate() - 30);

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

  const todayRow = visibleRows[0] ?? null;

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
          <View style={styles.brandRow}>
            <Icon name="fitness" size={20} color="#F28C28" />
          </View>
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
              <Text style={styles.metricValue}>{todayRow?.steps != null ? `${todayRow.steps}` : 'NA'}</Text>
              <Text style={styles.metricLabel}>Today Step Count</Text>
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
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>
                  {todayRow?.systolicBpAvg != null && todayRow?.diastolicBpAvg != null
                    ? `${Math.round(todayRow.systolicBpAvg)}/${Math.round(todayRow.diastolicBpAvg)}`
                    : 'NA'}
                </Text>
                <Text style={styles.metricUnit}>mmHg</Text>
              </View>
              <Text style={styles.metricLabel}>Blood Pressure</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="water" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <Text style={styles.metricValue}>{todayRow?.spo2Avg != null ? `${Math.round(todayRow.spo2Avg)}%` : 'NA'}</Text>
              <Text style={styles.metricLabel}>Blood Oxygen</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="pulse" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>{todayRow?.hrAvg != null ? `${Math.round(todayRow.hrAvg)}` : 'NA'}</Text>
                <Text style={styles.metricUnit}>BPM</Text>
              </View>
              <Text style={styles.metricLabel}>Heart Rate</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="thermometer" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>
                  {todayRow?.tempAvg != null ? `${todayRow.tempAvg.toFixed(1)}` : 'NA'}
                </Text>
                <Text style={styles.metricUnit}>°C</Text>
              </View>
              <Text style={styles.metricLabel}>Body Temperature</Text>
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
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
