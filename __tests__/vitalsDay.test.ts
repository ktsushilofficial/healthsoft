import {
  addVitalsDays,
  startOfVitalsDay,
  todayVitalsDayKey,
  vitalsDayKey,
  vitalsDayStart,
} from '../src/utils/vitalsDay';

describe('vitals day key', () => {
  // 00:48 IST on 8 Sep is 19:18 UTC on 7 Sep. The backend files the row under
  // 2026-09-07, so the UI must look up 2026-09-07 or it finds nothing.
  const insideSkewWindow = new Date('2026-09-08T00:48:00+05:30');

  it('matches the day the backend files the row under', () => {
    expect(vitalsDayKey(insideSkewWindow)).toBe('2026-09-07');
  });

  it('agrees with what the sync path sends', () => {
    expect(vitalsDayKey(insideSkewWindow)).toBe(
      insideSkewWindow.toISOString().slice(0, 10),
    );
  });

  it('is stable regardless of the device timezone', () => {
    // Same instant, so the same row, whichever zone the viewer's phone is in.
    expect(vitalsDayKey(new Date('2026-09-07T19:18:00Z'))).toBe('2026-09-07');
  });

  it('rolls over at 00:00 UTC, which is 05:30 IST', () => {
    expect(vitalsDayKey(new Date('2026-09-08T05:29:00+05:30'))).toBe('2026-09-07');
    expect(vitalsDayKey(new Date('2026-09-08T05:30:00+05:30'))).toBe('2026-09-08');
  });

  it('puts day starts and row dates on one timeline', () => {
    const today = startOfVitalsDay(insideSkewWindow);
    expect(vitalsDayStart('2026-09-07')!.getTime()).toBe(today.getTime());
    expect(vitalsDayStart('2026-09-06')!.getTime()).toBe(
      addVitalsDays(today, -1).getTime(),
    );
  });

  it('rejects malformed dates', () => {
    expect(vitalsDayStart('not-a-date')).toBeNull();
  });

  it('todayVitalsDayKey agrees with vitalsDayKey for now', () => {
    expect(todayVitalsDayKey()).toBe(vitalsDayKey(new Date()));
  });
});
