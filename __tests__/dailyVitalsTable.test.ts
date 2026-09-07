import { localWindowFor } from '../src/components/DailyVitalsTable';

describe('local window for a UTC vitals day', () => {
  // Run under TZ=Asia/Kolkata (UTC+05:30).
  it('spans two local dates, starting mid-morning', () => {
    expect(localWindowFor('2026-09-07')).toBe('07 Sep 05:30 → 08 Sep 05:30');
  });

  it('crosses a month boundary correctly', () => {
    expect(localWindowFor('2026-08-31')).toBe('31 Aug 05:30 → 01 Sep 05:30');
  });

  it('returns a placeholder for a malformed date', () => {
    expect(localWindowFor('nonsense')).toBe('—');
  });
});
