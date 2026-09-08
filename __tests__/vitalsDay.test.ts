import {
  addVitalsDays,
  startOfVitalsDay,
  todayLocalDayKey,
  toLocalDayKey,
  vitalsDayStart,
} from '../src/utils/vitalsDay';

// jest.setup.js pins TZ=Asia/Kolkata (UTC+05:30, no DST).
describe('vitals day key', () => {
  // The window that used to lose data: 02:00 IST on 8 Sep is still 7 Sep in
  // UTC, so a UTC-keyed row filed the senior's morning under the day before.
  const preDawn = new Date('2026-09-08T02:00:00+05:30');

  it('keeps an early-morning reading on the day the band recorded it', () => {
    expect(toLocalDayKey(preDawn)).toBe('2026-09-08');
  });

  it('does not follow the UTC date', () => {
    // Same instant, and this is precisely what the old key returned.
    expect(preDawn.toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(toLocalDayKey(preDawn)).not.toBe(preDawn.toISOString().slice(0, 10));
  });

  it('rolls over at the senior\'s midnight, not at 05:30', () => {
    expect(toLocalDayKey(new Date('2026-09-07T23:59:00+05:30'))).toBe('2026-09-07');
    expect(toLocalDayKey(new Date('2026-09-08T00:00:00+05:30'))).toBe('2026-09-08');
    expect(toLocalDayKey(new Date('2026-09-08T05:30:00+05:30'))).toBe('2026-09-08');
  });

  it('puts the whole local day in one bucket', () => {
    const first = new Date('2026-09-08T00:01:00+05:30');
    const last = new Date('2026-09-08T23:59:00+05:30');
    expect(toLocalDayKey(first)).toBe(toLocalDayKey(last));
  });

  it('puts day starts and row dates on one timeline', () => {
    const today = startOfVitalsDay(preDawn);
    expect(vitalsDayStart('2026-09-08')!.getTime()).toBe(today.getTime());
    expect(vitalsDayStart('2026-09-07')!.getTime()).toBe(
      addVitalsDays(today, -1).getTime(),
    );
  });

  it('steps the calendar across a month boundary', () => {
    const first = vitalsDayStart('2026-09-01')!;
    expect(toLocalDayKey(addVitalsDays(first, -1))).toBe('2026-08-31');
    expect(toLocalDayKey(addVitalsDays(first, 30))).toBe('2026-10-01');
  });

  it('rejects malformed dates', () => {
    expect(vitalsDayStart('not-a-date')).toBeNull();
  });

  it('todayLocalDayKey agrees with toLocalDayKey for now', () => {
    expect(todayLocalDayKey()).toBe(toLocalDayKey(new Date()));
  });
});
