import {
  formatExchangeBody,
  getLastApiExchange,
  isCapturablePath,
  recordApiExchange,
  recordSyncAbort,
  subscribeToApiExchange,
} from '../src/utils/lastApiExchange';

const exchange = (url: string) => ({
  at: Date.now(),
  method: 'POST',
  url,
  requestBody: { syncDays: 1 },
  status: 200,
  responseBody: 'Sync successful for 1 days.',
  errorMessage: null,
  durationMs: 42,
  reachedServer: true,
});

describe('capture filter', () => {
  it('captures the two vitals endpoints', () => {
    expect(isCapturablePath('/api/v1/vitals/sync')).toBe(true);
    expect(isCapturablePath('/api/v1/vitals/summary?deviceUUID=x&days=1')).toBe(true);
  });

  it('never captures credential traffic', () => {
    expect(isCapturablePath('/api/v1/auth/signin')).toBe(false);
    expect(isCapturablePath('/api/v1/auth/reset-password')).toBe(false);
    expect(isCapturablePath('/api/v1/auth/signup/email')).toBe(false);
  });

  it('ignores a recorded exchange for a non-vitals url', () => {
    recordApiExchange(exchange('https://api.healthsoft.in/api/v1/vitals/sync'));
    const before = getLastApiExchange();
    recordApiExchange(exchange('https://api.healthsoft.in/api/v1/auth/signin'));
    expect(getLastApiExchange()).toBe(before);
  });
});

describe('subscribers', () => {
  it('notifies on a captured exchange and unsubscribes cleanly', () => {
    let hits = 0;
    const stop = subscribeToApiExchange(() => { hits += 1; });
    recordApiExchange(exchange('https://api.healthsoft.in/api/v1/vitals/summary'));
    expect(hits).toBe(1);
    stop();
    recordApiExchange(exchange('https://api.healthsoft.in/api/v1/vitals/sync'));
    expect(hits).toBe(1);
  });

  it('survives a throwing subscriber', () => {
    const stop = subscribeToApiExchange(() => { throw new Error('bad subscriber'); });
    expect(() =>
      recordApiExchange(exchange('https://api.healthsoft.in/api/v1/vitals/sync')),
    ).not.toThrow();
    stop();
  });
});

describe('local aborts', () => {
  it('records a sync that never reached the network', () => {
    recordSyncAbort('/api/v1/vitals/sync', 'No current hand band health data is available yet.');
    const last = getLastApiExchange();
    expect(last?.reachedServer).toBe(false);
    expect(last?.status).toBeNull();
    expect(last?.errorMessage).toContain('No current hand band health data');
  });
});

describe('body formatting', () => {
  it('pretty-prints objects and handles empties', () => {
    expect(formatExchangeBody({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(formatExchangeBody(undefined)).toBe('(none)');
    expect(formatExchangeBody(null)).toBe('null');
  });

  it('truncates very large payloads', () => {
    const huge = { rows: Array.from({ length: 20000 }, (_, i) => ({ i })) };
    expect(formatExchangeBody(huge)).toContain('truncated');
  });

  it('survives circular structures', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatExchangeBody(circular)).toBe('(could not be serialised)');
  });
});
