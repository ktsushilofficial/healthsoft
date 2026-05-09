// ============================================
// src/screens/ActivityScreen.tsx
// ============================================
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { InteractionManager } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useV8DeviceManager } from '../v8/useV8DeviceManager';
import type { V8VitalSample } from '../v8/models';

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

    // Handle compact yyyymmdd formats.
    const compact = normalized.match(/\b(\d{4})(\d{2})(\d{2})\b/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

    // Handle mm-dd-yyyy / m-d-yyyy variants.
    const usLike = normalized.match(/\b(\d{1,2})-(\d{1,2})-(\d{4})\b/);
    if (usLike) {
      const y = usLike[3];
      const m = usLike[1].padStart(2, '0');
      const d = usLike[2].padStart(2, '0');
      return `${y}-${m}-${d}`;
    }

    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

    // iOS SDK sometimes returns non-standard date strings; fall back to receive
    // time there so we still surface rows instead of dropping all entries.
    if (Platform.OS === 'ios' && sample.receivedAt != null) {
      return new Date(sample.receivedAt).toISOString().slice(0, 10);
    }
    // On Android keep strict behavior to avoid stale cross-day carry-over.
    return null;
  }

  if (sample.receivedAt != null) return new Date(sample.receivedAt).toISOString().slice(0, 10);
  return null;
};

const ActivityScreen = () => {
  const { connectionStates, latestLiveData, historyByType, requestLiveSnapshot } = useV8DeviceManager();
  const isHandBandConnected = Object.values(connectionStates).some(state => state === 'connected');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showSevenDayTable, setShowSevenDayTable] = useState(false);
  // Defer heavy content until after the tab transition animation finishes.
  const [ready, setReady] = useState(false);

  useFocusEffect(
    React.useCallback(() => {
      const task = InteractionManager.runAfterInteractions(() => {
        setReady(true);
      });
      return () => task.cancel();
    }, []),
  );

  // Only tick while screen is focused to avoid re-renders when on other tabs.
  useFocusEffect(
    React.useCallback(() => {
      if (!isHandBandConnected) return undefined;
      setNowMs(Date.now());
      const timer = setInterval(() => setNowMs(Date.now()), 5000);
      return () => clearInterval(timer);
    }, [isHandBandConnected]),
  );

  const fallbackFromHistory = useMemo<V8VitalSample | null>(() => {
    const all = Object.values(historyByType).flatMap(bucket => bucket.entries);
    if (all.length === 0) return null;
    return all.reduce<V8VitalSample | null>((latest, current) => {
      if (!latest) return current;
      return (current.receivedAt ?? 0) > (latest.receivedAt ?? 0) ? current : latest;
    }, null);
  }, [historyByType]);

  const effectiveLiveData = latestLiveData ?? fallbackFromHistory;

  const metricFallback = useMemo(() => {
    const all = Object.values(historyByType).flatMap(bucket => bucket.entries);
    const todayKey = new Date().toISOString().slice(0, 10);
    const todaySamples = all.filter(sample => sampleDayKey(sample) === todayKey);

    const latestNonNull = <T,>(pick: (s: V8VitalSample) => T | null | undefined): T | null => {
      let value: T | null = null;
      let latestTs = 0;
      for (const sample of all) {
        const current = pick(sample);
        if (current == null) continue;
        const ts = sample.receivedAt ?? 0;
        if (ts >= latestTs) {
          latestTs = ts;
          value = current as T;
        }
      }
      return value;
    };
    const maxToday = (pick: (s: V8VitalSample) => number | null | undefined): number | null => {
      let best: number | null = null;
      for (const sample of todaySamples) {
        const current = pick(sample);
        if (current == null) continue;
        if (best == null || current > best) best = current;
      }
      return best;
    };
    const latestBp = latestNonNull<{ systolic: number; diastolic: number }>(s =>
      s.systolicBp != null && s.diastolicBp != null
        ? { systolic: s.systolicBp, diastolic: s.diastolicBp }
        : null,
    );
    return {
      heartRate: latestNonNull<number>(s => s.heartRate),
      spo2: latestNonNull<number>(s => s.spo2),
      temperatureC: latestNonNull<number>(s => s.temperatureC),
      steps: maxToday(s => s.steps),
      distanceKm: maxToday(s => s.distanceKm),
      systolicBp: latestBp?.systolic ?? null,
      diastolicBp: latestBp?.diastolic ?? null,
    };
  }, [historyByType]);

  const lastUpdateLabel = useMemo(() => {
    if (!isHandBandConnected) return null;
    const receivedAt = effectiveLiveData?.receivedAt ?? null;
    if (!receivedAt) return 'Waiting for first live packet...';
    const diffSec = Math.max(0, Math.floor((nowMs - receivedAt) / 1000));
    return `Last update: ${diffSec}s ago`;
  }, [isHandBandConnected, effectiveLiveData?.receivedAt, nowMs]);

  // Read directly from latestLiveData — it now merges all fields from different
  // data types (HR, SpO2, steps, etc.), so the expensive allSamples flatMap +
  // backward scan through all history entries is no longer needed.
  const isSampleFromToday = (sample: V8VitalSample | null | undefined): boolean => {
    if (!sample) return false;
    const today = new Date().toISOString().slice(0, 10);
    return sampleDayKey(sample) === today;
  };

  const displaySteps = isSampleFromToday(effectiveLiveData)
    ? (effectiveLiveData?.steps ?? metricFallback.steps)
    : metricFallback.steps;
  const displayDistanceKm = isSampleFromToday(effectiveLiveData)
    ? (effectiveLiveData?.distanceKm ?? metricFallback.distanceKm)
    : metricFallback.distanceKm;
  const displayTemperatureC = effectiveLiveData?.temperatureC ?? metricFallback.temperatureC;
  const displaySystolic = effectiveLiveData?.systolicBp ?? metricFallback.systolicBp;
  const displayDiastolic = effectiveLiveData?.diastolicBp ?? metricFallback.diastolicBp;
  const displaySpo2 = effectiveLiveData?.spo2 ?? metricFallback.spo2;
  const displayHeartRate = effectiveLiveData?.heartRate ?? metricFallback.heartRate;

  const sevenDayRows = useMemo(() => {
    type DailyAgg = {
      day: string;
      stepsTotal: number;
      hrSum: number;
      hrCount: number;
      spo2Sum: number;
      spo2Count: number;
      tempSum: number;
      tempCount: number;
      sysSum: number;
      diaSum: number;
      bpCount: number;
    };

    const all = Object.values(historyByType).flatMap(bucket => bucket.entries);
    const byDay: Record<string, DailyAgg> = {};

    for (const sample of all) {
      const day = sampleDayKey(sample);
      if (!day) continue;
      if (!byDay[day]) {
        byDay[day] = {
          day,
          stepsTotal: 0,
          hrSum: 0,
          hrCount: 0,
          spo2Sum: 0,
          spo2Count: 0,
          tempSum: 0,
          tempCount: 0,
          sysSum: 0,
          diaSum: 0,
          bpCount: 0,
        };
      }
      const agg = byDay[day];
      if (sample.steps != null) agg.stepsTotal = Math.max(agg.stepsTotal, sample.steps);
      if (sample.heartRate != null) {
        agg.hrSum += sample.heartRate;
        agg.hrCount += 1;
      }
      if (sample.spo2 != null) {
        agg.spo2Sum += sample.spo2;
        agg.spo2Count += 1;
      }
      if (sample.temperatureC != null) {
        agg.tempSum += sample.temperatureC;
        agg.tempCount += 1;
      }
      if (sample.systolicBp != null && sample.diastolicBp != null) {
        agg.sysSum += sample.systolicBp;
        agg.diaSum += sample.diastolicBp;
        agg.bpCount += 1;
      }
    }

    const days: string[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().slice(0, 10);
    }).reverse();

    return days.map(day => {
      const agg = byDay[day];
      if (!agg) {
        return { day, steps: null, hr: null, spo2: null, temp: null, bp: null as string | null };
      }
      const hr = agg.hrCount > 0 ? Math.round(agg.hrSum / agg.hrCount) : null;
      const spo2 = agg.spo2Count > 0 ? Math.round(agg.spo2Sum / agg.spo2Count) : null;
      const temp = agg.tempCount > 0 ? Number((agg.tempSum / agg.tempCount).toFixed(1)) : null;
      const bp = agg.bpCount > 0
        ? `${Math.round(agg.sysSum / agg.bpCount)}/${Math.round(agg.diaSum / agg.bpCount)}`
        : null;
      return {
        day,
        steps: agg.stepsTotal > 0 ? agg.stepsTotal : null,
        hr,
        spo2,
        temp,
        bp,
      };
    });
  }, [historyByType]);

  useFocusEffect(
    React.useCallback(() => {
      if (!isHandBandConnected) return undefined;
      const initialTask = InteractionManager.runAfterInteractions(() => {
        requestLiveSnapshot().catch(() => {});
      });
      const interval = setInterval(() => {
        InteractionManager.runAfterInteractions(() => {
          requestLiveSnapshot().catch(() => {});
        });
      }, 45000);
      return () => {
        initialTask.cancel();
        clearInterval(interval);
      };
    }, [isHandBandConnected, requestLiveSnapshot]),
  );

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
          {isHandBandConnected ? (
            <>
              <View style={styles.liveBadge}>
                <Icon name="watch-outline" size={14} color="#1D8A45" />
                <Text style={styles.liveBadgeText}>Live from Hand Band</Text>
              </View>
              {lastUpdateLabel ? <Text style={styles.liveMeta}>{lastUpdateLabel}</Text> : null}
            </>
          ) : null}

          <View style={[styles.metricCard, styles.metricSteps]}>
            <View style={styles.metricIconWrap}>
              <Icon name="footsteps" size={26} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <Text style={styles.metricValue}>
                {isHandBandConnected
                  ? (displaySteps != null ? `${displaySteps}` : 'NA')
                  : 'NA'}
              </Text>
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
                  {isHandBandConnected && displaySystolic != null && displayDiastolic != null
                    ? `${displaySystolic}/${displayDiastolic}`
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
              <Text style={styles.metricValue}>
                {isHandBandConnected
                  ? (displaySpo2 != null ? `${displaySpo2}%` : 'NA')
                  : 'NA'}
              </Text>
              <Text style={styles.metricLabel}>Blood Oxygen</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="pulse" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>
                  {isHandBandConnected
                    ? (displayHeartRate != null ? `${displayHeartRate}` : 'NA')
                    : 'NA'}
                </Text>
                <Text style={styles.metricUnit}>BPM</Text>
              </View>
              <Text style={styles.metricLabel}>Heart Rate</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="resize" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>
                  {isHandBandConnected && displayDistanceKm != null
                    ? `${displayDistanceKm.toFixed(2)}`
                    : 'NA'}
                </Text>
                <Text style={styles.metricUnit}>km</Text>
              </View>
              <Text style={styles.metricLabel}>Distance Today</Text>
            </View>
          </View>

          <View style={styles.metricCard}>
            <View style={styles.metricIconWrap}>
              <Icon name="thermometer" size={24} color="#F28C28" />
            </View>
            <View style={styles.metricInfo}>
              <View style={styles.inlineRow}>
                <Text style={styles.metricValue}>
                  {isHandBandConnected && displayTemperatureC != null
                    ? `${displayTemperatureC.toFixed(1)}`
                    : 'NA'}
                </Text>
                <Text style={styles.metricUnit}>°C</Text>
              </View>
              <Text style={styles.metricLabel}>Body Temperature</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.sevenDayBtn, !isHandBandConnected ? styles.sevenDayBtnDisabled : null]}
            disabled={!isHandBandConnected}
            onPress={() => setShowSevenDayTable(prev => !prev)}
            activeOpacity={0.75}
          >
            <Icon name="calendar-outline" size={16} color="#F28C28" />
            <Text style={styles.sevenDayBtnText}>
              {showSevenDayTable ? 'Hide Seven Days Data' : 'Seven Days Data'}
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
              {sevenDayRows.map(row => (
                <View key={row.day} style={styles.tableRow}>
                  <Text style={[styles.tableCell, styles.tableCellDay]}>{row.day.slice(5)}</Text>
                  <Text style={styles.tableCell}>{row.steps != null ? `${row.steps}` : '--'}</Text>
                  <Text style={styles.tableCell}>{row.hr != null ? `${row.hr}` : '--'}</Text>
                  <Text style={styles.tableCell}>{row.spo2 != null ? `${row.spo2}%` : '--'}</Text>
                  <Text style={styles.tableCell}>{row.temp != null ? `${row.temp}` : '--'}</Text>
                  <Text style={styles.tableCell}>{row.bp ?? '--'}</Text>
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
  liveBadgeText: {
    marginLeft: 6,
    color: '#1D8A45',
    fontSize: 12,
    fontWeight: '700',
  },
  liveMeta: {
    fontSize: 12,
    color: '#5E8A6C',
    marginBottom: 10,
    marginLeft: 2,
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
