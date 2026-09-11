import {
  emptyVitalSummary,
  fillTodayVitalSummaryGaps,
  selectTodayVitalSummary,
} from '../src/v8/todayVitalsRow';
import { parseV8Payload } from '../src/v8/parser';

const now = new Date('2026-09-11T10:00:00').getTime();
const live = {
  ...parseV8Payload(
    { dataType: '75', dicData: { heartRate: 74, Blood_oxygen: 97, step: 0 } },
    'android',
  ).history!.entries[0],
  receivedAt: now,
};

describe('dated vitals upload rows', () => {
  it('preserves the aggregate and fills gaps only from fresh same-day readings', () => {
    const row = fillTodayVitalSummaryGaps(
      { ...emptyVitalSummary('2026-09-11'), hrAvg: 68, steps: 4210 },
      live,
      now,
    );
    expect(row.hrAvg).toBe(68);
    expect(row.steps).toBe(4210);
    expect(row.hrLatest).toBe(74);
    expect(row.spo2Avg).toBe(97);
    expect(row.tempAvg).toBeNull();
  });
  it('keeps missing values null, including through JSON serialization', () => {
    const row = JSON.parse(
      JSON.stringify(
        fillTodayVitalSummaryGaps(emptyVitalSummary('2026-09-11'), null, now),
      ),
    );
    const { recordDate, ...metrics } = row;
    expect(recordDate).toBe('2026-09-11');
    expect(Object.values(metrics).every(value => value === null)).toBe(true);
  });
  it('keeps valid zero activity but rejects zero HR and SpO2', () => {
    const row = fillTodayVitalSummaryGaps(
      emptyVitalSummary('2026-09-11'),
      { ...live, heartRate: 0, spo2: 0 },
      now,
    );
    expect(row.steps).toBe(0);
    expect(row.hrLatest).toBeNull();
    expect(row.spo2Latest).toBeNull();
  });
  it.each([now - 301_000, now + 1_000, now - 86400_000])(
    'rejects stale, future, or other-day fallback (%s)',
    time => {
      const row = fillTodayVitalSummaryGaps(
        emptyVitalSummary('2026-09-11'),
        { ...live, receivedAt: time },
        now,
      );
      expect(row.hrLatest).toBeNull();
    },
  );
  it('does not relabel yesterday even when no requested-day row exists', () => {
    const row = selectTodayVitalSummary(
      [{ ...emptyVitalSummary('2026-09-10'), steps: 9999, hrLatest: 83 }],
      '2026-09-11',
      null,
      now,
    );
    expect(row.recordDate).toBe('2026-09-11');
    expect(row.steps).toBeNull();
    expect(row.hrLatest).toBeNull();
  });
  it('checks freshness per metric in a merged live sample', () => {
    const row = fillTodayVitalSummaryGaps(
      emptyVitalSummary('2026-09-11'),
      {
        ...live,
        metricTimestamps: { heartRate: now - 86400_000, spo2: now },
      },
      now,
    );
    expect(row.hrLatest).toBeNull();
    expect(row.spo2Latest).toBe(97);
  });
  it('never accepts undated legacy cached data as a live reading', () => {
    expect(
      fillTodayVitalSummaryGaps(
        emptyVitalSummary('2026-09-11'),
        { ...live, source: undefined },
        now,
      ).hrLatest,
    ).toBeNull();
  });
});
