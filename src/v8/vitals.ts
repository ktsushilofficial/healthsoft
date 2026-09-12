import { sampleDayKey, sampleMeasurementTime } from '../utils/sampleDay';
import type {
  V8DailyVitalSummary,
  V8HistoryBucket,
  V8VitalMetric,
  V8VitalSample,
} from './models';

export const vitalMetrics: V8VitalMetric[] = [
  'heartRate',
  'hrv',
  'stress',
  'systolicBp',
  'diastolicBp',
  'spo2',
  'temperatureC',
  'steps',
  'distanceKm',
  'caloriesKcal',
  'exerciseMinutes',
  'activeMinutes',
  'goalPercent',
];
const activityMetrics: V8VitalMetric[] = [
  'steps',
  'distanceKm',
  'caloriesKcal',
  'exerciseMinutes',
  'activeMinutes',
  'goalPercent',
];
export function validVital(
  metric: V8VitalMetric,
  value: number | null | undefined,
): value is number {
  return (
    value != null &&
    Number.isFinite(value) &&
    (activityMetrics.includes(metric) || metric === 'stress'
      ? value >= 0
      : value > 0)
  );
}

export function vitalSampleKey(sample: V8VitalSample): string {
  return JSON.stringify([
    sampleMeasurementTime(sample) ?? sample.timestamp,
    ...vitalMetrics.map(key => sample[key]),
  ]);
}

/** Preserve the time of each metric; a newer temperature cannot re-date older HR. */
export function mergeLatestVitals(
  previous: V8VitalSample | null,
  incoming: V8VitalSample,
): V8VitalSample | null {
  const time = sampleMeasurementTime(incoming);
  if (time == null) return previous;
  const next = {
    ...(previous ?? incoming),
    metricTimestamps: { ...previous?.metricTimestamps },
  };
  for (const metric of vitalMetrics) {
    if (!previous) next[metric] = null;
    const previousTime =
      previous?.metricTimestamps?.[metric] ??
      (previous && validVital(metric, previous[metric])
        ? sampleMeasurementTime(previous)
        : null) ??
      -Infinity;
    if (
      ['systolicBp', 'diastolicBp'].includes(metric) &&
      (!validVital('systolicBp', incoming.systolicBp) ||
        !validVital('diastolicBp', incoming.diastolicBp))
    )
      continue;
    if (validVital(metric, incoming[metric]) && time >= previousTime) {
      next[metric] = incoming[metric];
      next.metricTimestamps[metric] = time;
    }
  }
  if (!previous || time >= (sampleMeasurementTime(previous) ?? -Infinity)) {
    next.timestamp = incoming.timestamp;
    next.receivedAt = incoming.receivedAt;
    next.source = incoming.source;
  }
  return next;
}

/** One unreadable metric must never cost the whole day: fall back to null. */
function metricOrNull<T>(compute: () => T, fallback: T): T {
  try {
    return compute();
  } catch {
    return fallback;
  }
}

type MetricStats = {
  min: number | null;
  max: number | null;
  avg: number | null;
  latest: number | null;
};
const noStats: MetricStats = { min: null, max: null, avg: null, latest: null };

export function aggregateVitals(
  buckets: Record<string, V8HistoryBucket>,
  day: string,
): V8DailyVitalSummary[] {
  const groups = Object.values(buckets ?? {})
    .filter(bucket => Array.isArray(bucket?.entries))
    .map(bucket => ({
      bucket,
      entries: bucket.entries.filter(
        entry =>
          !!entry && metricOrNull(() => sampleDayKey(entry) === day, false),
      ),
    }));
  const entries = groups.flatMap(group => group.entries);
  if (
    !entries.some(entry =>
      vitalMetrics.some(metric =>
        metricOrNull(() => validVital(metric, entry[metric]), false),
      ),
    )
  )
    return [];
  const stats = (metric: V8VitalMetric, paired = false): MetricStats => {
    const seen = new Set<string>();
    const values = entries
      .filter(entry => {
        if (!validVital(metric, entry[metric])) return false;
        if (
          paired &&
          (!validVital('systolicBp', entry.systolicBp) ||
            !validVital('diastolicBp', entry.diastolicBp))
        )
          return false;
        const key = `${sampleMeasurementTime(entry)}:${entry[metric]}${
          paired ? `:${entry.systolicBp}:${entry.diastolicBp}` : ''
        }`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort(
        (a, b) =>
          (sampleMeasurementTime(a) ?? 0) - (sampleMeasurementTime(b) ?? 0),
      );
    const numbers = values.map(entry => entry[metric] as number);
    return {
      min: numbers.length ? Math.min(...numbers) : null,
      max: numbers.length ? Math.max(...numbers) : null,
      avg: numbers.length
        ? Number(
            (numbers.reduce((sum, n) => sum + n, 0) / numbers.length).toFixed(
              metric === 'temperatureC' ? 1 : 0,
            ),
          )
        : null,
      latest: numbers.length ? numbers[numbers.length - 1] : null,
    };
  };
  const motion = (metric: V8VitalMetric): number | null => {
    // A total and its detail intervals describe the same activity, never add them.
    for (const type of ['totalActivity', 'realtimeActivity']) {
      const totals = groups
        .filter(g => g.bucket.dataType === type)
        .flatMap(g => g.entries)
        .filter(entry => validVital(metric, entry[metric]))
        .sort(
          (a, b) =>
            (sampleMeasurementTime(b) ?? 0) - (sampleMeasurementTime(a) ?? 0) ||
            (b.receivedAt ?? 0) - (a.receivedAt ?? 0),
        );
      if (totals.length) return totals[0][metric];
    }
    if (!['steps', 'distanceKm', 'caloriesKcal'].includes(metric)) return null;
    const intervals = new Map<number, V8VitalSample>();
    for (const entry of groups
      .filter(g => g.bucket.dataType === 'detailActivity')
      .flatMap(g => g.entries)) {
      if (!validVital(metric, entry[metric])) continue;
      const time = sampleMeasurementTime(entry)!;
      const existing = intervals.get(time);
      if (!existing || (entry.receivedAt ?? 0) >= (existing.receivedAt ?? 0))
        intervals.set(time, entry);
    }
    return intervals.size
      ? Number(
          Array.from(intervals.values())
            .reduce((sum, entry) => sum + (entry[metric] as number), 0)
            .toFixed(2),
        )
      : null;
  };
  // Each metric is computed on its own. A metric that cannot be computed is
  // reported as null; it never aborts the remaining metrics or the day.
  const safeStats = (metric: V8VitalMetric, paired = false) =>
    metricOrNull(() => stats(metric, paired), noStats);
  const safeMotion = (metric: V8VitalMetric) =>
    metricOrNull(() => motion(metric), null);
  const hr = safeStats('heartRate'),
    spo2 = safeStats('spo2'),
    hrv = safeStats('hrv');
  const sys = safeStats('systolicBp', true),
    dia = safeStats('diastolicBp', true);
  const temp = safeStats('temperatureC'),
    stress = safeStats('stress');
  return [
    {
      date: day,
      steps: safeMotion('steps'),
      distanceKm: safeMotion('distanceKm'),
      caloriesKcal: safeMotion('caloriesKcal'),
      exerciseMinutes: safeMotion('exerciseMinutes'),
      activeMinutes: safeMotion('activeMinutes'),
      goalPercent: safeMotion('goalPercent'),
      heartRateMin: hr.min,
      heartRateMax: hr.max,
      heartRateAvg: hr.avg,
      heartRateLatest: hr.latest,
      spo2Min: spo2.min,
      spo2Max: spo2.max,
      spo2Avg: spo2.avg,
      spo2Latest: spo2.latest,
      hrvMin: hrv.min,
      hrvMax: hrv.max,
      hrvAvg: hrv.avg,
      hrvLatest: hrv.latest,
      systolicBpMin: sys.min,
      systolicBpMax: sys.max,
      systolicBpAvg: sys.avg,
      systolicBpLatest: sys.latest,
      diastolicBpMin: dia.min,
      diastolicBpMax: dia.max,
      diastolicBpAvg: dia.avg,
      diastolicBpLatest: dia.latest,
      temperatureMinC: temp.min,
      temperatureMaxC: temp.max,
      temperatureAvgC: temp.avg,
      temperatureLatestC: temp.latest,
      stressMin: stress.min,
      stressMax: stress.max,
      stressAvg: stress.avg,
      stressLatest: stress.latest,
    },
  ];
}
