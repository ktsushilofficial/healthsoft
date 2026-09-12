import {
  aggregateVitals,
  mergeLatestVitals,
  vitalSampleKey,
} from '../src/v8/vitals';
import { parseV8Payload } from '../src/v8/parser';
import type { V8VitalSample } from '../src/v8/models';
const sample = (time: string, fields: Record<string, unknown>): V8VitalSample =>
  parseV8Payload(
    { dataType: '28', dicData: [{ date: time, ...fields }] },
    'android',
  ).history!.entries[0];
const bucket = (dataType: string, entries: V8VitalSample[]) => ({
  dataType,
  entries,
  completed: true,
  updatedAt: 0,
  source: 'history' as const,
});
const day = '2026-09-11';

describe('shared daily vitals aggregation', () => {
  it('sums unique intervals and prefers a daily total without double counting', () => {
    const a = sample(`${day} 10:00:00`, {
      step: 100,
      calories: 1.1,
      distance: 0.1,
    });
    const b = sample(`${day} 10:10:00`, {
      step: 200,
      calories: 2.2,
      distance: 0.2,
    });
    const detail = bucket('detailActivity', [
      a,
      b,
      { ...a, receivedAt: Date.now() + 1 },
    ]);
    expect(aggregateVitals({ detail }, day)[0]).toMatchObject({
      steps: 300,
      distanceKm: 0.3,
      caloriesKcal: 3.3,
    });
    const total = bucket('totalActivity', [
      sample(day, { step: 900, distance: 0.9, calories: 9 }),
    ]);
    for (const buckets of [
      { detail, total },
      { total, detail },
    ]) {
      expect(aggregateVitals(buckets, day)[0]).toMatchObject({
        steps: 900,
        distanceKm: 0.9,
        caloriesKcal: 9,
      });
    }
  });
  it('uses the most recently received revision of an interval, not both revisions', () => {
    const old = { ...sample(`${day} 10:00:00`, { step: 100 }), receivedAt: 1 };
    const updated = { ...old, steps: 120, receivedAt: 2 };
    expect(
      aggregateVitals(
        { detail: bucket('detailActivity', [updated, old]) },
        day,
      )[0].steps,
    ).toBe(120);
  });
  it('orders latest by measurement time regardless of download order', () => {
    const old = {
      ...sample(`${day} 09:00:00`, {
        heartRate: 60,
        spo2: 95,
        highBP: 110,
        lowBP: 70,
      }),
      receivedAt: 2000,
    };
    const newer = {
      ...sample(`${day} 10:00:00`, {
        heartRate: 80,
        spo2: 98,
        highBP: 120,
        lowBP: 80,
      }),
      receivedAt: 1000,
    };
    for (const entries of [
      [newer, old],
      [old, newer],
    ]) {
      expect(
        aggregateVitals({ hr: bucket('staticHR', entries) }, day)[0],
      ).toMatchObject({
        heartRateLatest: 80,
        heartRateAvg: 70,
        spo2Latest: 98,
        systolicBpLatest: 120,
        diastolicBpLatest: 80,
      });
    }
  });
  it('preserves SpO2/stress differences in duplicate keys', () => {
    const a = sample(`${day} 10:00:00`, { spo2: 95, stress: 10 });
    expect(vitalSampleKey(a)).not.toBe(vitalSampleKey({ ...a, spo2: 98 }));
    expect(vitalSampleKey(a)).not.toBe(vitalSampleKey({ ...a, stress: 20 }));
    expect(vitalSampleKey(a)).toBe(vitalSampleKey({ ...a, receivedAt: 99 }));
  });
  it('excludes undated history, other days, and missing physiological zeros', () => {
    const entries = [
      sample('2026-09-10 10:00:00', { heartRate: 90 }),
      { ...sample(day, { heartRate: 99 }), timestamp: 'bad' },
      sample(day, { heartRate: 0, spo2: 0, step: 0 }),
    ];
    expect(
      aggregateVitals({ total: bucket('totalActivity', entries) }, day)[0],
    ).toMatchObject({
      steps: 0,
      heartRateAvg: null,
      heartRateLatest: null,
      spo2Avg: null,
    });
  });
  it('does not average the same measurement twice across live/history buckets', () => {
    const a = sample(`${day} 09:00:00`, { heartRate: 60 });
    const b = sample(`${day} 10:00:00`, { heartRate: 80 });
    expect(
      aggregateVitals(
        { hr: bucket('staticHR', [a, b]), manual: bucket('hrv', [b]) },
        day,
      )[0].heartRateAvg,
    ).toBe(70);
  });
  it('never assembles a BP pair from separate partial records', () => {
    const a = sample(`${day} 09:00:00`, { highBP: 120 });
    const b = sample(`${day} 10:00:00`, { lowBP: 80 });
    expect(
      aggregateVitals({ hr: bucket('hrv', [a, b]) }, day)[0],
    ).toMatchObject({ systolicBpLatest: null, diastolicBpLatest: null });
  });
  it('keeps each live metric timestamp when different metrics arrive', () => {
    const a = sample('2026-09-10 23:59:00', { heartRate: 75 });
    const b = sample(`${day} 10:00:00`, { temperature: 36.5 });
    const merged = mergeLatestVitals(mergeLatestVitals(null, a), b)!;
    expect(merged.heartRate).toBe(75);
    expect(merged.metricTimestamps?.heartRate).toBe(
      new Date('2026-09-10T23:59:00').getTime(),
    );
    expect(
      mergeLatestVitals(merged, {
        ...a,
        timestamp: '2026-09-10 20:00:00',
        heartRate: 60,
      })?.heartRate,
    ).toBe(75);
  });
});
