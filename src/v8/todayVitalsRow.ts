import { sampleDayKey, sampleMeasurementTime } from '../utils/sampleDay';
import { validVital } from './vitals';
import type { V8VitalMetric } from './models';
import type { V8VitalSample, V8WebVitalSummary } from './models';

// UI/upload freshness policy, not a physiological validity threshold.
export const LIVE_VITAL_MAX_AGE_MS = 5 * 60_000;

export const emptyVitalSummary = (recordDate: string): V8WebVitalSummary => ({
  recordDate,
  steps: null,
  distanceKm: null,
  caloriesKcal: null,
  exerciseMinutes: null,
  activeMinutes: null,
  goalPercent: null,
  hrMin: null,
  hrMax: null,
  hrAvg: null,
  hrLatest: null,
  spo2Min: null,
  spo2Max: null,
  spo2Avg: null,
  spo2Latest: null,
  hrvMin: null,
  hrvMax: null,
  hrvAvg: null,
  hrvLatest: null,
  systolicBpMin: null,
  systolicBpMax: null,
  systolicBpAvg: null,
  systolicBpLatest: null,
  diastolicBpMin: null,
  diastolicBpMax: null,
  diastolicBpAvg: null,
  diastolicBpLatest: null,
  tempMin: null,
  tempMax: null,
  tempAvg: null,
  tempLatest: null,
  stressMin: null,
  stressMax: null,
  stressAvg: null,
  stressLatest: null,
});

export const fillTodayVitalSummaryGaps = (
  summary: V8WebVitalSummary,
  live: V8VitalSample | null,
  now = Date.now(),
): V8WebVitalSummary => {
  const freshLive = (metric: V8VitalMetric): number | null => {
    if (!live) return null;
    const time = live.metricTimestamps?.[metric] ?? sampleMeasurementTime(live);
    if (
      time == null ||
      time > now ||
      now - time > LIVE_VITAL_MAX_AGE_MS ||
      sampleDayKey({ timestamp: String(time), receivedAt: null }) !==
        summary.recordDate
    )
      return null;
    return validVital(metric, live[metric]) ? live[metric] : null;
  };
  const pick = (value: number | null, metric: V8VitalMetric) =>
    validVital(metric, value) ? value : freshLive(metric);

  return {
    recordDate: summary.recordDate,
    steps: pick(summary.steps, 'steps'),
    distanceKm: pick(summary.distanceKm, 'distanceKm'),
    caloriesKcal: pick(summary.caloriesKcal, 'caloriesKcal'),
    exerciseMinutes: pick(summary.exerciseMinutes, 'exerciseMinutes'),
    activeMinutes: pick(summary.activeMinutes, 'activeMinutes'),
    goalPercent: pick(summary.goalPercent, 'goalPercent'),
    hrMin: pick(summary.hrMin, 'heartRate'),
    hrMax: pick(summary.hrMax, 'heartRate'),
    hrAvg: pick(summary.hrAvg, 'heartRate'),
    hrLatest: pick(summary.hrLatest, 'heartRate'),
    spo2Min: pick(summary.spo2Min, 'spo2'),
    spo2Max: pick(summary.spo2Max, 'spo2'),
    spo2Avg: pick(summary.spo2Avg, 'spo2'),
    spo2Latest: pick(summary.spo2Latest, 'spo2'),
    hrvMin: pick(summary.hrvMin, 'hrv'),
    hrvMax: pick(summary.hrvMax, 'hrv'),
    hrvAvg: pick(summary.hrvAvg, 'hrv'),
    hrvLatest: pick(summary.hrvLatest, 'hrv'),
    systolicBpMin: pick(summary.systolicBpMin, 'systolicBp'),
    systolicBpMax: pick(summary.systolicBpMax, 'systolicBp'),
    systolicBpAvg: pick(summary.systolicBpAvg, 'systolicBp'),
    systolicBpLatest: pick(summary.systolicBpLatest, 'systolicBp'),
    diastolicBpMin: pick(summary.diastolicBpMin, 'diastolicBp'),
    diastolicBpMax: pick(summary.diastolicBpMax, 'diastolicBp'),
    diastolicBpAvg: pick(summary.diastolicBpAvg, 'diastolicBp'),
    diastolicBpLatest: pick(summary.diastolicBpLatest, 'diastolicBp'),
    tempMin: pick(summary.tempMin, 'temperatureC'),
    tempMax: pick(summary.tempMax, 'temperatureC'),
    tempAvg: pick(summary.tempAvg, 'temperatureC'),
    tempLatest: pick(summary.tempLatest, 'temperatureC'),
    stressMin: pick(summary.stressMin, 'stress'),
    stressMax: pick(summary.stressMax, 'stress'),
    stressAvg: pick(summary.stressAvg, 'stress'),
    stressLatest: pick(summary.stressLatest, 'stress'),
  };
};

/** Select only the requested day, never relabel another day's readings. */
export function selectTodayVitalSummary(
  summaries: V8WebVitalSummary[],
  day: string,
  live: V8VitalSample | null,
  now = Date.now(),
): V8WebVitalSummary {
  return fillTodayVitalSummaryGaps(
    summaries.find(summary => summary.recordDate === day) ??
      emptyVitalSummary(day),
    live,
    now,
  );
}
