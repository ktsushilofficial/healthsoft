import { sampleDayKey } from '../src/utils/sampleDay';

// jest.setup.js pins TZ=Asia/Kolkata (UTC+05:30, no DST).
describe('band sample day key', () => {
  // 02:00 IST on 8 Sep is 20:30 UTC on 7 Sep. A UTC-keyed reading filed the
  // senior's early morning under the previous day; this is that regression.
  const preDawn = new Date('2026-09-08T02:00:00+05:30');

  it('keeps a pre-dawn epoch timestamp on the band\'s own day', () => {
    expect(preDawn.toISOString().slice(0, 10)).toBe('2026-09-07');
    expect(sampleDayKey({ timestamp: String(preDawn.getTime()), receivedAt: null }))
      .toBe('2026-09-08');
  });

  it('accepts epoch seconds as well as milliseconds', () => {
    const seconds = String(Math.floor(preDawn.getTime() / 1000));
    expect(sampleDayKey({ timestamp: seconds, receivedAt: null })).toBe('2026-09-08');
  });

  it('takes a spelled-out date as written', () => {
    expect(sampleDayKey({ timestamp: '2026-09-08 02:00:00', receivedAt: null }))
      .toBe('2026-09-08');
  });

  it('normalises separators and unpadded months', () => {
    expect(sampleDayKey({ timestamp: '2026/09/08 02:00', receivedAt: null }))
      .toBe('2026-09-08');
    expect(sampleDayKey({ timestamp: '2026-9-8 02:00', receivedAt: null }))
      .toBe('2026-09-08');
  });

  it('falls back to arrival time on the local day', () => {
    expect(sampleDayKey({ timestamp: null, receivedAt: preDawn.getTime() }))
      .toBe('2026-09-08');
  });

  it('returns null when there is nothing to date it by', () => {
    expect(sampleDayKey({ timestamp: 'not a date', receivedAt: null })).toBeNull();
    expect(sampleDayKey({ timestamp: null, receivedAt: null })).toBeNull();
  });
});
