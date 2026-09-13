import { advertisedBandModel, V8DeviceInfoReader } from '../src/v8/deviceInfoReader';

describe('device details command channel', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for a matching reply, retries a dropped firmware query, then allows history', async () => {
    const reader = new V8DeviceInfoReader();
    const version = jest.fn(async () => true);
    const history = jest.fn(async () => true);
    const first = reader.request('firmwareVersion', version);
    const next = reader.run(history);
    await jest.advanceTimersByTimeAsync(0);
    reader.accept({ batteryPercent: 80 });
    expect(history).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1500);
    expect(version).toHaveBeenCalledTimes(2);
    reader.accept({ firmwareVersion: '1.0.2.5' });
    await first;
    await next;
    expect(history).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('reports unanswered details and releases queued work even when native send never resolves', async () => {
    const reader = new V8DeviceInfoReader();
    const first = reader.request('firmwareVersion', () => new Promise(() => {})).catch(error => error);
    const next = reader.request('deviceTime', async () => reader.accept({ deviceTime: '2026-09-12 22:37:00' }));
    await jest.advanceTimersByTimeAsync(3000);
    expect((await first).message).toContain('No response');
    await next;
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds a native command that never settles so the next command still runs', async () => {
    const reader = new V8DeviceInfoReader();
    const stuck = reader.run<never>(() => new Promise<never>(() => {})).catch((error: Error) => error);
    const next = jest.fn(async () => 'done');
    const queued = reader.run(next);
    await jest.advanceTimersByTimeAsync(14_000);
    expect(next).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1_000);
    expect((await stuck).message).toContain('did not finish this command within 15 seconds');
    expect(await queued).toBe('done');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('frees the command channel on disconnect while an earlier command is still stuck', async () => {
    const reader = new V8DeviceInfoReader();
    const stuck = reader.run<never>(() => new Promise<never>(() => {})).catch((error: Error) => error);
    await jest.advanceTimersByTimeAsync(0);
    reader.cancel();
    const afterReconnect = jest.fn(async () => true);
    await reader.run(afterReconnect);
    expect(afterReconnect).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(15_000);
    expect((await stuck).message).toContain('did not finish');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cancels active and queued queries on a changed connection, then accepts a fresh read', async () => {
    const reader = new V8DeviceInfoReader();
    const first = reader.request('firmwareVersion', async () => true).catch(error => error);
    const send = jest.fn(async () => true);
    const second = reader.request('deviceTime', send).catch(error => error);
    await jest.advanceTimersByTimeAsync(0);
    reader.cancel();
    expect((await first).message).toContain('connection changed');
    expect((await second).message).toContain('connection changed');
    expect(send).not.toHaveBeenCalled();
    await reader.request('batteryPercent', async () => reader.accept({ batteryPercent: 0 }));
    expect(jest.getTimerCount()).toBe(0);
  });
});

it('derives the advertised model only by removing a matching MAC suffix', () => {
  expect(advertisedBandModel('JCV8B 6DDC93', 'D6:1B:DF:6D:DC:93')).toBe('JCV8B');
  expect(advertisedBandModel('JCV8B 123456', 'D6:1B:DF:6D:DC:93')).toBe('JCV8B 123456');
  expect(advertisedBandModel('JCV8B')).toBe('JCV8B');
  expect(advertisedBandModel(null)).toBeNull();
});
