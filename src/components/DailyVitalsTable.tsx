import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { V8DailyVitalSummary } from '../v8/models';
import { vitalsDayStart } from '../utils/vitalsDay';

const fmtNum = (v: number | null | undefined, decimals = 0, suffix = '') =>
  v != null && !Number.isNaN(v) ? `${Number(v).toFixed(decimals)}${suffix}` : '—';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const pad2 = (value: number) => String(value).padStart(2, '0');

/** Short name for the device's timezone, e.g. "IST" or "GMT+4". */
export function localZoneLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find(part => part.type === 'timeZoneName')?.value ?? 'local';
  } catch {
    return 'local';
  }
}

/**
 * The local window a UTC day covers. A UTC day is not a local day: east of
 * Greenwich it starts and ends mid-morning local time, so 2026-09-07 holds
 * 7 Sep 05:30 through 8 Sep 05:30 in IST. Showing the span is what makes the
 * offset legible - a single local date would have to discard half of it.
 */
export function localWindowFor(ymd: string): string {
  const start = vitalsDayStart(ymd);
  if (!start) return '—';
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const stamp = (d: Date) =>
    `${pad2(d.getDate())} ${MONTHS[d.getMonth()]} ${pad2(d.getHours())}:${pad2(
      d.getMinutes(),
    )}`;
  return `${stamp(start)} → ${stamp(end)}`;
}

const COLUMNS: Array<{
  key: string;
  label: string;
  wide?: boolean;
  widest?: boolean;
  value: (row: V8DailyVitalSummary) => string;
}> = [
  // Labelled UTC because that is genuinely the day these rows are filed under -
  // see src/utils/vitalsDay.ts. Without it the date reads as a day behind for
  // anyone east of Greenwich in their early morning.
  { key: 'date', label: 'Date (UTC)', wide: true, value: row => row.date },
  {
    key: 'local',
    label: `Local window (${localZoneLabel()})`,
    widest: true,
    value: row => localWindowFor(row.date),
  },
  { key: 'steps', label: 'Steps', value: row => fmtNum(row.steps, 0) },
  { key: 'dist', label: 'Dist', value: row => fmtNum(row.distanceKm, 2) },
  { key: 'kcal', label: 'Kcal', value: row => fmtNum(row.caloriesKcal, 0) },
  { key: 'hrAvg', label: 'HR Avg', value: row => fmtNum(row.heartRateAvg, 0) },
  { key: 'hrMin', label: 'HR Min', value: row => fmtNum(row.heartRateMin, 0) },
  { key: 'hrMax', label: 'HR Max', value: row => fmtNum(row.heartRateMax, 0) },
  { key: 'spo2', label: 'SpO2 Avg', value: row => fmtNum(row.spo2Avg, 0) },
  { key: 'hrv', label: 'HRV Avg', value: row => fmtNum(row.hrvAvg, 0) },
  {
    key: 'bp',
    label: 'BP Avg',
    value: row =>
      row.systolicBpAvg != null && row.diastolicBpAvg != null
        ? `${row.systolicBpAvg}/${row.diastolicBpAvg}`
        : '—',
  },
  { key: 'temp', label: 'Temp Avg', value: row => fmtNum(row.temperatureAvgC, 1) },
  { key: 'stress', label: 'Stress Avg', value: row => fmtNum(row.stressAvg, 0) },
];

type Props = {
  rows: V8DailyVitalSummary[];
  title?: string;
  /** Newest first. Off for callers that already ordered the rows. */
  sortDescending?: boolean;
};

const DailyVitalsTable = ({
  rows,
  title = 'Daily Vitals Table',
  sortDescending = true,
}: Props) => {
  const ordered = useMemo(
    () =>
      sortDescending
        ? [...rows].sort((a, b) => b.date.localeCompare(a.date))
        : rows,
    [rows, sortDescending],
  );

  if (ordered.length === 0) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.headerRow}>
            {COLUMNS.map(column => (
              <Text
                key={column.key}
                style={[
                  styles.headerCell,
                  column.wide && styles.wideCell,
                  column.widest && styles.widestCell,
                ]}
              >
                {column.label}
              </Text>
            ))}
          </View>
          {ordered.map(row => (
            <View key={row.date} style={styles.dataRow}>
              {COLUMNS.map(column => (
                <Text
                  key={column.key}
                  style={[
                    styles.dataCell,
                    column.wide && styles.wideCell,
                    column.widest && styles.widestCell,
                  ]}
                >
                  {column.value(row)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: '#E9E4DD',
    borderRadius: 12,
    marginTop: 12,
    backgroundColor: '#FFFDFA',
    paddingVertical: 8,
  },
  title: {
    fontSize: 12,
    color: '#5A524B',
    fontWeight: '700',
    marginHorizontal: 10,
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: '#F7F2EA',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#EEE5DA',
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  headerCell: {
    minWidth: 72,
    fontSize: 10,
    color: '#7B5835',
    fontWeight: '700',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  dataRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#F3ECE3',
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  dataCell: {
    minWidth: 72,
    fontSize: 11,
    color: '#2E2A27',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  wideCell: {
    minWidth: 94,
  },
  widestCell: {
    minWidth: 176,
  },
});

export default DailyVitalsTable;
