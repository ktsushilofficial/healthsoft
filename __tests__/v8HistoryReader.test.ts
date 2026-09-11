import { V8HistoryReader } from '../src/v8/historyReader';
import type { V8HistoryReadStatus } from '../src/v8/historyReader';
import type { V8HistoryBucket } from '../src/v8/models';
const packet = (
  type = 'staticHR',
  completed = false,
  source: 'live' | 'history' = 'history',
): V8HistoryBucket => ({
  dataType: type,
  source,
  completed,
  entries: [],
  updatedAt: Date.now(),
});
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe('response-driven history reads', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it('continues at 50 callbacks and finishes only on a history end marker', async () => {
    const reader = new V8HistoryReader();
    const request = jest.fn(async () => true);
    const progress: V8HistoryReadStatus[] = [];
    const read = reader.readAll(
      '2026-09-11',
      [{ type: 'staticHR', request }],
      s => progress.push(s),
    );
    await flush();
    reader.accept(packet('staticHR', true, 'live'));
    reader.accept(packet('spo2', true));
    for (let i = 0; i < 49; i++) reader.accept(packet());
    await flush();
    expect(request.mock.calls).toEqual([[0]]);
    reader.accept(packet());
    await flush();
    expect(request.mock.calls).toEqual([[0], [2]]);
    reader.accept(packet('staticHR', true));
    await read;
    expect(progress.at(-1)).toMatchObject({
      phase: 'complete',
      completedTypes: ['staticHR'],
      failedTypes: [],
    });
  });
  it('refreshes the timeout while data is arriving and never continues based only on elapsed time', async () => {
    const reader = new V8HistoryReader(5000);
    const request = jest.fn(async () => true);
    const read = reader.readAll(
      '2026-09-11',
      [{ type: 'staticHR', request }],
      () => {},
    );
    await flush();
    await jest.advanceTimersByTimeAsync(4000);
    reader.accept(packet());
    await jest.advanceTimersByTimeAsync(4000);
    expect(request).toHaveBeenCalledTimes(1);
    reader.accept(packet('staticHR', true));
    await read;
  });
  it('reports partial failure but still collects other categories', async () => {
    const reader = new V8HistoryReader(100);
    const first = jest.fn(async () => true),
      second = jest.fn(async () => true);
    const progress: V8HistoryReadStatus[] = [];
    const read = reader.readAll(
      '2026-09-11',
      [
        { type: 'staticHR', request: first },
        { type: 'spo2', request: second },
      ],
      s => progress.push(s),
    );
    const result = read.catch(error => error);
    await jest.advanceTimersByTimeAsync(101);
    expect(second).toHaveBeenCalledWith(0);
    reader.accept(packet('spo2', true));
    expect(await result).toMatchObject({
      message: expect.stringContaining('incomplete'),
    });
    expect(progress.at(-1)).toMatchObject({
      phase: 'partial',
      completedTypes: ['spo2'],
      failedTypes: ['staticHR'],
    });
  });
  it('does not send the next category until the current category completes', async () => {
    const reader = new V8HistoryReader();
    const second = jest.fn(async () => true);
    const read = reader.readAll(
      '2026-09-11',
      [
        { type: 'staticHR', request: async () => true },
        { type: 'spo2', request: second },
      ],
      () => {},
    );
    await flush();
    expect(second).not.toHaveBeenCalled();
    reader.accept(packet('staticHR', true));
    await flush();
    expect(second).toHaveBeenCalledTimes(1);
    reader.accept(packet('spo2', true));
    await read;
  });
  it('cancels on disconnect without sending later commands', async () => {
    const reader = new V8HistoryReader();
    const request = jest.fn(async () => true),
      second = jest.fn(async () => true);
    const read = reader.readAll(
      '2026-09-11',
      [
        { type: 'staticHR', request },
        { type: 'spo2', request: second },
      ],
      () => {},
    );
    const result = read.catch(error => error);
    await flush();
    reader.cancel();
    expect(await result).toMatchObject({
      message: expect.stringContaining('incomplete'),
    });
    expect(second).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
  it('fails rather than silently succeeding when a page limit is exhausted', async () => {
    const reader = new V8HistoryReader(100, 1);
    const read = reader.readAll(
      '2026-09-11',
      [{ type: 'staticHR', request: async () => true }],
      () => {},
    );
    const result = read.catch(error => error);
    await flush();
    for (let i = 0; i < 50; i++) reader.accept(packet());
    expect(await result).toMatchObject({
      message: expect.stringContaining('incomplete'),
    });
  });
});
