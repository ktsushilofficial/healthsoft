import type { V8VitalSample, V8WebVitalSummary } from './models';

// How a day's row is assembled for the sync, in three tiers:
//
//   1. what the band's history aggregated for that day, from its own midnight
//   2. the latest live sample, for anything the aggregation left null
//   3. 0, for anything still missing
//
// The third tier is why a sync never refuses to send. A day the band recorded
// nothing on goes up as a row of zeros rather than being skipped, so every day
// is present on the backend - which also means a zero here is indistinguishable
// from a measured zero, and readers have to treat 0 as "no reading".

export const emptyVitalSummary = (recordDate: string): V8WebVitalSummary => ({
  recordDate,
  steps: null, distanceKm: null, caloriesKcal: null,
  exerciseMinutes: null, activeMinutes: null, goalPercent: null,
  hrMin: null, hrMax: null, hrAvg: null, hrLatest: null,
  spo2Min: null, spo2Max: null, spo2Avg: null, spo2Latest: null,
  hrvMin: null, hrvMax: null, hrvAvg: null, hrvLatest: null,
  systolicBpMin: null, systolicBpMax: null, systolicBpAvg: null, systolicBpLatest: null,
  diastolicBpMin: null, diastolicBpMax: null, diastolicBpAvg: null, diastolicBpLatest: null,
  tempMin: null, tempMax: null, tempAvg: null, tempLatest: null,
  stressMin: null, stressMax: null, stressAvg: null, stressLatest: null,
});

export const fillTodayVitalSummaryGaps = (
  summary: V8WebVitalSummary,
  live: V8VitalSample | null,
): V8WebVitalSummary => {
  const pick = (value: number | null, liveValue: number | null | undefined) =>
    value ?? liveValue ?? 0;

  return {
    recordDate: summary.recordDate,
    steps: pick(summary.steps, live?.steps),
    distanceKm: pick(summary.distanceKm, live?.distanceKm),
    caloriesKcal: pick(summary.caloriesKcal, live?.caloriesKcal),
    exerciseMinutes: pick(summary.exerciseMinutes, live?.exerciseMinutes),
    activeMinutes: pick(summary.activeMinutes, live?.activeMinutes),
    goalPercent: pick(summary.goalPercent, live?.goalPercent),
    hrMin: pick(summary.hrMin, live?.heartRate),
    hrMax: pick(summary.hrMax, live?.heartRate),
    hrAvg: pick(summary.hrAvg, live?.heartRate),
    hrLatest: pick(summary.hrLatest, live?.heartRate),
    spo2Min: pick(summary.spo2Min, live?.spo2),
    spo2Max: pick(summary.spo2Max, live?.spo2),
    spo2Avg: pick(summary.spo2Avg, live?.spo2),
    spo2Latest: pick(summary.spo2Latest, live?.spo2),
    hrvMin: pick(summary.hrvMin, live?.hrv),
    hrvMax: pick(summary.hrvMax, live?.hrv),
    hrvAvg: pick(summary.hrvAvg, live?.hrv),
    hrvLatest: pick(summary.hrvLatest, live?.hrv),
    systolicBpMin: pick(summary.systolicBpMin, live?.systolicBp),
    systolicBpMax: pick(summary.systolicBpMax, live?.systolicBp),
    systolicBpAvg: pick(summary.systolicBpAvg, live?.systolicBp),
    systolicBpLatest: pick(summary.systolicBpLatest, live?.systolicBp),
    diastolicBpMin: pick(summary.diastolicBpMin, live?.diastolicBp),
    diastolicBpMax: pick(summary.diastolicBpMax, live?.diastolicBp),
    diastolicBpAvg: pick(summary.diastolicBpAvg, live?.diastolicBp),
    diastolicBpLatest: pick(summary.diastolicBpLatest, live?.diastolicBp),
    tempMin: pick(summary.tempMin, live?.temperatureC),
    tempMax: pick(summary.tempMax, live?.temperatureC),
    tempAvg: pick(summary.tempAvg, live?.temperatureC),
    tempLatest: pick(summary.tempLatest, live?.temperatureC),
    stressMin: pick(summary.stressMin, live?.stress),
    stressMax: pick(summary.stressMax, live?.stress),
    stressAvg: pick(summary.stressAvg, live?.stress),
    stressLatest: pick(summary.stressLatest, live?.stress),
  };
};
