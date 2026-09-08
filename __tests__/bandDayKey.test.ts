import {
  toLocalDayKey,
  todayLocalDayKey,
  todayVitalsDayKey,
  vitalsDayKey,
} from '../src/utils/vitalsDay';

// Run under TZ=Asia/Kolkata (UTC+05:30).
describe('band day vs API day', () => {
  it('keeps early-morning samples on the senior\'s day, where UTC would lose them', () => {
    // 02:00 IST on 8 Sep is still 7 Sep in UTC.
    const preDawn = new Date('2026-09-08T02:00:00+05:30');
    expect(vitalsDayKey(preDawn)).toBe('2026-09-07'); // what the API files it under
    expect(toLocalDayKey(preDawn)).toBe('2026-09-08'); // what the band recorded
  });

  it('agrees for the rest of the day', () => {
    const midMorning = new Date('2026-09-08T10:07:00+05:30');
    expect(vitalsDayKey(midMorning)).toBe('2026-09-08');
    expect(toLocalDayKey(midMorning)).toBe('2026-09-08');
  });

  it('puts the whole local day in one bucket', () => {
    const first = new Date('2026-09-08T00:01:00+05:30');
    const last = new Date('2026-09-08T23:59:00+05:30');
    expect(toLocalDayKey(first)).toBe(toLocalDayKey(last));
    // The same span straddles two API days, which is the bug this avoids.
    expect(vitalsDayKey(first)).not.toBe(vitalsDayKey(last));
  });

  it('exposes both keys for the current moment', () => {
    expect(todayLocalDayKey()).toBe(toLocalDayKey(new Date()));
    expect(todayVitalsDayKey()).toBe(vitalsDayKey(new Date()));
  });
});
