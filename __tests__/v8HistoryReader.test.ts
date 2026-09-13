import { parseV8Payload } from '../src/v8/parser';
import {
  V8HistoryReader,
  describeHistoryTransfer,
} from '../src/v8/historyReader';
import type { V8HistoryReadStatus } from '../src/v8/historyReader';
import type { V8HistoryBucket, V8VitalSample } from '../src/v8/models';
import { parseMeasurementTimestamp } from '../src/utils/sampleDay';
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

describe('today-only pagination', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const window = {
    startMs: parseMeasurementTimestamp('2026-09-13 00:00:00')!,
    endMs: parseMeasurementTimestamp('2026-09-13 12:00:00')!,
  };
  const hr = (date: string, values = [72], completed = false) => parseV8Payload({
    dataType: '28', dataEnd: completed, dicData: [{ date, arrayHR: values }],
  }, 'ios', window).history!;

  it('drains the current page and never requests an older page after crossing midnight', async () => {
    const reader = new V8HistoryReader();
    const request = jest.fn(async () => true);
    const next = jest.fn(async () => reader.accept(packet('spo2', true)));
    const result = reader.readAll('2026-09-13', [
      { type: 'dynamicHR', request }, { type: 'spo2', request: next },
    ], () => {}, window);
    await flush();
    reader.accept(hr('2026.09.13 00:00:00'));
    for (let i = 0; i < 48; i++) reader.accept(hr('2026.08.04 19:36:03', Array(15).fill(180)));
    await flush();
    expect(next).not.toHaveBeenCalled();
    reader.accept(hr('2026.08.04 19:36:03', Array(15).fill(180)));
    expect(await result).toMatchObject({ phase: 'complete', categories: { dynamicHR: {
      stoppedAtDayStart: true, pagesRequested: 1, extractedSamples: 1,
    } } });
    expect(request.mock.calls).toEqual([[0]]);
    expect(next).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('finishes at the boundary when a short old page goes quiet without dataEnd', async () => {
    const reader = new V8HistoryReader();
    const result = reader.readAll('2026-09-13', [{ type: 'dynamicHR', request: async () => true }], () => {}, window);
    await flush();
    reader.accept(hr('2026.08.04 19:36:03'));
    await jest.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ phase: 'complete', categories: { dynamicHR: { outcome: 'empty', stoppedAtDayStart: true } } });
  });

  it('does not stop on a record starting yesterday whose samples extend into today', async () => {
    const reader = new V8HistoryReader();
    const request = jest.fn(async () => true);
    const result = reader.readAll('2026-09-13', [{ type: 'dynamicHR', request }], () => {}, window);
    await flush();
    for (let i = 0; i < 50; i++) reader.accept(hr('2026.09.12 23:59:55', [70, 71, 72]));
    await flush();
    expect(request.mock.calls).toEqual([[0], [2]]);
    reader.accept(packet('dynamicHR', true));
    await result;
  });

  it('reports partial instead of claiming complete coverage if record order reverses at the boundary', async () => {
    const reader = new V8HistoryReader();
    const result = reader.readAll('2026-09-13', [{ type: 'dynamicHR', request: async () => true }], () => {}, window);
    await flush();
    reader.accept(hr('2026.09.12 23:00:00'));
    reader.accept(hr('2026.09.13 00:00:00'));
    await jest.advanceTimersByTimeAsync(5000);
    expect(await result).toMatchObject({ phase: 'partial', failedTypes: ['dynamicHR'] });
  });
});

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
  it('keeps reading and resolves partial when a category fails', async () => {
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
    const status = await result;
    expect(status).not.toBeInstanceOf(Error);
    expect(status).toMatchObject({
      phase: 'partial',
      completedTypes: ['spo2'],
      failedTypes: ['staticHR'],
    });
    expect(progress.at(-1)).toEqual(status);
  });
  it('bounds a continuous stream without dataEnd and reads the remaining categories', async () => {
    const reader = new V8HistoryReader();
    const request = jest.fn(async () => true);
    const next = jest.fn(async () => reader.accept(packet('spo2', true)));
    let status!: V8HistoryReadStatus;
    const read = reader.readAll('2026-09-12', [
      { type: 'dynamicHR', request },
      { type: 'spo2', request: next },
    ], s => { status = s; });
    await flush();
    // Responses keep the five-second idle timeout alive, even across pages.
    for (let second = 1; second < 120; second++) {
      await jest.advanceTimersByTimeAsync(1000);
      reader.accept(packet('dynamicHR'));
    }
    expect(status.currentType).toBe('dynamicHR');
    expect(request.mock.calls).toEqual([[0], [2], [2]]);
    await jest.advanceTimersByTimeAsync(1000);
    expect(await read).toMatchObject({
      phase: 'partial',
      completedTypes: ['spo2'],
      failedTypes: ['dynamicHR'],
      categories: { dynamicHR: {
        responsePackets: 119,
        pagesRequested: 3,
        error: expect.stringContaining('Time limit (120 seconds)'),
      } },
    });
    expect(next).toHaveBeenCalledTimes(1);
    reader.accept(packet('dynamicHR', true));
    expect(status.phase).toBe('partial');
    expect(jest.getTimerCount()).toBe(0);
  });
  it('expires on a resumed callback when wall time has passed the deadline', async () => {
    const reader = new V8HistoryReader();
    const read = reader.readAll('2026-09-12', [
      { type: 'dynamicHR', request: async () => true },
    ], () => {});
    await flush();
    jest.setSystemTime(Date.now() + 120_001);
    reader.accept(packet('dynamicHR', true));
    expect(await read).toMatchObject({ phase: 'partial', failedTypes: ['dynamicHR'] });
    expect(jest.getTimerCount()).toBe(0);
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
  it('fails the category rather than silently succeeding when a page limit is exhausted', async () => {
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
      phase: 'partial',
      failedTypes: ['staticHR'],
      categories: {
        staticHR: {
          outcome: 'failed',
          error: expect.stringContaining('Page limit'),
        },
      },
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
    // The records that parsed are kept and reported; only the rejected ones
    // go missing, and the read still finishes for upload.
    expect(await result).not.toBeInstanceOf(Error);
    expect(status.phase).toBe('complete');
    expect(status.categories.dynamicHR).toMatchObject({
      outcome: 'downloaded',
      receivedRecords: 2,
      extractedSamples: 3,
      rejectedRecords: 1,
      error: expect.stringContaining('Could not parse'),
    });
  });

  it('fails only the category whose records were all rejected', async () => {
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
        extractedSamples: 0,
        rejectedRecords: 2,
        invalidTimestampRecords: 2,
      },
    });
    reader.accept(packet('dynamicHR', true));
    expect(await result).not.toBeInstanceOf(Error);
    expect(status.phase).toBe('partial');
    expect(status.failedTypes).toEqual(['dynamicHR']);
    expect(status.categories.dynamicHR).toMatchObject({
      outcome: 'failed',
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
      expect(await result).not.toBeInstanceOf(Error);
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

it('preserves the first cancellation cause when cleanup also cancels', async () => {
  const reader = new V8HistoryReader();
  let status!: V8HistoryReadStatus;
  const read = reader
    .readAll(
      '2026-09-12',
      [
        { type: 'dynamicHR', request: async () => true },
        { type: 'staticHR', request: async () => true },
      ],
      s => {
        status = s;
      },
    )
    .catch(error => error);
  await flush();
  reader.cancel('Bluetooth connection failed.');
  reader.cancel('Manager closed.');
  expect((await read).message).toBe(
    'Hand band history is incomplete. Bluetooth connection failed. Nothing was uploaded. Reconnect the band and retry.',
  );
  expect(status.cancellationReason).toBe('Bluetooth connection failed.');
  expect(status.failedTypes).toEqual([]);
  expect(status.categories.staticHR).toMatchObject({
    outcome: 'notRead',
    error: null,
  });
});

it('reports the read total, never a per-category count that restarts at zero', async () => {
  const reader = new V8HistoryReader();
  const seen: string[] = [];
  const sample = (): V8VitalSample => ({
    timestamp: '2026-09-12 08:00:00',
    receivedAt: Date.now(),
    source: 'history',
    heartRate: 70,
    hrv: null,
    stress: null,
    systolicBp: null,
    diastolicBp: null,
    spo2: null,
    temperatureC: null,
    steps: null,
    distanceKm: null,
    caloriesKcal: null,
    exerciseMinutes: null,
    activeMinutes: null,
    goalPercent: null,
  });
  const withSamples = (
    type: string,
    count: number,
    completed = false,
  ): V8HistoryBucket => ({
    ...packet(type, completed),
    entries: Array.from({ length: count }, sample),
  });
  const read = reader.readAll(
    '2026-09-12',
    [
      { type: 'totalActivity', request: async () => true },
      { type: 'spo2', request: async () => true },
    ],
    status => seen.push(describeHistoryTransfer(status)),
  );
  await flush();
  reader.accept(withSamples('totalActivity', 3, true));
  await flush();
  reader.accept(withSamples('spo2', 2, true));
  const status = await read;

  // The denominator the modal renders is fixed before the first category runs.
  expect(status.totalCategories).toBe(2);
  // No frame of the sync may claim the band sent nothing when it is simply
  // being waited on, and the total may never fall back between categories.
  expect(seen).not.toContain('0 responses received, 0 readings so far.');
  expect(seen[0]).toBe('Waiting for the band to answer…');
  const totals = seen
    .map(line => Number(line.match(/(\d+) readings so far/)?.[1] ?? 0));
  expect(Math.max(...totals)).toBe(5);
  expect(totals).toEqual([...totals].sort((a, b) => a - b));
});
