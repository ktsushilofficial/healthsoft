import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { V8DailyVitalSummary } from '../v8/models';

const fmtNum = (v: number | null | undefined, decimals = 0, suffix = '') =>
  v != null && !Number.isNaN(v) ? `${Number(v).toFixed(decimals)}${suffix}` : '—';

const COLUMNS: Array<{
  key: string;
  label: string;
  wide?: boolean;
  value: (row: V8DailyVitalSummary) => string;
}> = [
  // The day the band's own clock recorded - see src/utils/vitalsDay.ts.
  { key: 'date', label: 'Date', wide: true, value: row => row.date },
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
});

export default DailyVitalsTable;
