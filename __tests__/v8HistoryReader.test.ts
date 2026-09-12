import { parseV8Payload } from '../src/v8/parser';
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

describe('history outcome diagnostics', () => {
  it('retains a parse failure across packets even when the final marker is empty', async () => {
    const reader = new V8HistoryReader();
    let status!: V8HistoryReadStatus;
    const result = reader
      .readAll(
        '2026-09-11',
        [{ type: 'dynamicHR', request: async () => true }],
        s => {
          status = s;
        },
      )
      .catch(error => error);
    await flush();
    reader.accept({
      ...packet('dynamicHR'),
      diagnostics: {
        receivedRecords: 2,
        extractedSamples: 3,
        rejectedRecords: 1,
        invalidTimestampRecords: 0,
      },
    });
    reader.accept(packet('dynamicHR', true));
    expect(await result).toBeInstanceOf(Error);
    expect(status.categories.dynamicHR).toMatchObject({
      outcome: 'failed',
      receivedRecords: 2,
      extractedSamples: 3,
      rejectedRecords: 1,
      error: expect.stringContaining('Could not parse'),
    });
  });

  it('separates empty history, missing native methods and timeouts', async () => {
    jest.useFakeTimers();
    try {
      const reader = new V8HistoryReader(100);
      let status!: V8HistoryReadStatus;
      const result = reader
        .readAll(
          '2026-09-11',
          [
            {
              type: 'staticHR',
              request: async () => {
                reader.accept(packet('staticHR', true));
              },
            },
            { type: 'temperature' },
            { type: 'spo2', request: async () => true },
          ],
          s => {
            status = s;
          },
        )
        .catch(error => error);
      await jest.advanceTimersByTimeAsync(101);
      expect(await result).toBeInstanceOf(Error);
      expect(status.categories.staticHR.outcome).toBe('empty');
      expect(status.categories.temperature.outcome).toBe('unavailable');
      expect(status.categories.spo2).toMatchObject({
        outcome: 'failed',
        error: expect.stringContaining('no history response received'),
      });
      expect(status.failedTypes).toEqual(['spo2']);
    } finally {
      jest.useRealTimers();
    }
  });
});

it('paginates real iOS HR packets by callback count, not expanded sample count', async () => {
  const reader = new V8HistoryReader();
  const request = jest.fn(async () => true);
  let status!: V8HistoryReadStatus;
  const read = reader.readAll(
    '2026-09-11',
    [{ type: 'dynamicHR', request }],
    s => {
      status = s;
    },
  );
  await flush();
  const bucket = parseV8Payload(
    {
      dataType: '28',
      dataEnd: false,
      dicData: {
        arrayContinuousHR: [
          { date: '2026.09.10 23:59:55', arrayHR: [70, 71, 72] },
        ],
      },
    },
    'ios',
  ).history!;
  for (let i = 0; i < 49; i++) reader.accept(bucket);
  await flush();
  expect(request.mock.calls).toEqual([[0]]);
  reader.accept(bucket);
  await flush();
  expect(request.mock.calls).toEqual([[0], [2]]);
  reader.accept({ ...bucket, completed: true });
  await read;
  expect(status.categories.dynamicHR).toMatchObject({
    outcome: 'downloaded',
    receivedRecords: 51,
    extractedSamples: 153,
    rejectedRecords: 0,
  });
});

it('allows a full day of continuous HR beyond twelve pages', async () => {
  const reader = new V8HistoryReader();
  let status!: V8HistoryReadStatus;
  const request = jest.fn(async () => {
    const currentPage = request.mock.calls.length;
    for (let i = 0; i < 50; i++) {
      reader.accept(packet('dynamicHR', currentPage === 24 && i === 49));
    }
  });
  await reader.readAll('2026-09-12', [{ type: 'dynamicHR', request }], s => {
    status = s;
  });
  expect(request).toHaveBeenCalledTimes(24);
  expect(status.phase).toBe('complete');
  expect(status.categories.dynamicHR).toMatchObject({
    responsePackets: 1200,
    pagesRequested: 24,
  });
});

it('counts a batched iOS notification once without confusing records or HR samples with callbacks', async () => {
  const reader = new V8HistoryReader();
  const request = jest.fn(async () => true);
  const read = reader.readAll(
    '2026-09-12',
    [{ type: 'dynamicHR', request }],
    () => {},
  );
  await flush();
  // Captured iOS notifications contain seven 24-byte records, each with 15 HR samples.
  const bucket = parseV8Payload(
    {
      dataType: '28',
      dataEnd: false,
      dicData: {
        arrayContinuousHR: Array.from({ length: 7 }, (_, index) => ({
          date: `2026.09.12 09:${String(index).padStart(2, '0')}:00`,
          arrayHR: Array(15).fill(72),
        })),
      },
    },
    'ios',
  ).history!;
  expect(bucket.diagnostics).toMatchObject({
    receivedRecords: 7,
    extractedSamples: 105,
    rejectedRecords: 0,
  });
  for (let i = 0; i < 49; i++) reader.accept(bucket);
  await flush();
  expect(request.mock.calls).toEqual([[0]]);
  reader.accept(bucket);
  await flush();
  expect(request.mock.calls).toEqual([[0], [2]]);
  reader.accept(packet('dynamicHR', true));
  await read;
});
