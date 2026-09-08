import {
  emptyVitalSummary,
  fillTodayVitalSummaryGaps,
} from '../src/v8/todayVitalsRow';
import type { V8VitalSample, V8WebVitalSummary } from '../src/v8/models';

const live = { heartRate: 74, spo2: 97, steps: 1200 } as unknown as V8VitalSample;

const rowWithGaps = (): V8WebVitalSummary => ({
  ...emptyVitalSummary('2026-09-08'),
  steps: 4210,
  hrAvg: 68,
});

describe('today vitals row', () => {
  it('prefers the aggregated value over the live sample', () => {
    const filled = fillTodayVitalSummaryGaps(rowWithGaps(), live);
    expect(filled.steps).toBe(4210);
    expect(filled.hrAvg).toBe(68);
  });

  it('falls back to the live sample for gaps the aggregation left', () => {
    const filled = fillTodayVitalSummaryGaps(rowWithGaps(), live);
    expect(filled.hrMin).toBe(74);
    expect(filled.hrMax).toBe(74);
    expect(filled.hrLatest).toBe(74);
    expect(filled.spo2Avg).toBe(97);
  });

  it('falls back to 0 when neither has the metric', () => {
    const filled = fillTodayVitalSummaryGaps(rowWithGaps(), live);
    expect(filled.tempAvg).toBe(0);
    expect(filled.stressAvg).toBe(0);
    expect(filled.systolicBpAvg).toBe(0);
  });

  it('sends a full row of zeros when the band recorded nothing', () => {
    const filled = fillTodayVitalSummaryGaps(emptyVitalSummary('2026-09-08'), null);
    const { recordDate, ...metrics } = filled;
    expect(recordDate).toBe('2026-09-08');
    expect(Object.values(metrics).every(value => value === 0)).toBe(true);
  });

  it('never emits null, so the sync always has something to send', () => {
    const filled = fillTodayVitalSummaryGaps(emptyVitalSummary('2026-09-08'), live);
    expect(Object.values(filled).some(value => value == null)).toBe(false);
    expect(filled.hrAvg).toBe(74);
    expect(filled.tempAvg).toBe(0);
  });

  it('keeps the requested day on the row', () => {
    expect(emptyVitalSummary('2026-09-08').recordDate).toBe('2026-09-08');
  });
});
