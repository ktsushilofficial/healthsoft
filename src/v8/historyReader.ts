import type { V8HistoryBucket, V8HistoryWindow, V8ParseDiagnostics } from './models';

export const historyTypeLabels: Record<string, string> = {
  totalActivity: 'activity totals',
  detailActivity: 'activity details',
  dynamicHR: 'continuous heart rate',
  staticHR: 'heart rate',
  hrv: 'HRV',
  spo2: 'blood oxygen',
  temperature: 'temperature',
};

export type V8HistoryReadStatus = {
  phase: 'idle' | 'reading' | 'complete' | 'partial';
  day: string | null;
  currentType: string | null;
  /** Categories this read will attempt, known before the first one starts. */
  totalCategories: number;
  completedTypes: string[];
  failedTypes: string[];
  cancellationReason: string | null;
  requestedStart?: number;
  requestedEnd?: number;
  categories: Record<string, V8HistoryCategoryStatus>;
};
export type V8HistoryCategoryStatus = V8ParseDiagnostics & {
  responsePackets: number;
  pagesRequested: number;
  stoppedAtDayStart?: boolean;
  outcome:
    | 'reading'
    | 'downloaded'
    | 'empty'
    | 'failed'
    | 'unavailable'
    | 'cancelled'
    | 'notRead';
  error: string | null;
};
const emptyDiagnostics: V8ParseDiagnostics = {
  receivedRecords: 0,
  extractedSamples: 0,
  rejectedRecords: 0,
  invalidTimestampRecords: 0,
};
export const idleHistoryReadStatus: V8HistoryReadStatus = {
  phase: 'idle',
  day: null,
  currentType: null,
  totalCategories: 0,
  completedTypes: [],
  failedTypes: [],
  cancellationReason: null,
  categories: {},
};
export type HistoryRequest = {
  type: string;
  request?: (mode: number) => Promise<unknown>;
};

/**
 * Progress for the read as a whole, not just the category in front of it.
 * Per-category counters restart at zero on every category, and a category is
 * published the moment it is requested - before any packet can have arrived -
 * so reporting the current one alone showed "0 responses received, 0 samples
 * read." at the start of every category and dropped the running total back to
 * zero three times per sync.
 */
export function describeHistoryTransfer(status: V8HistoryReadStatus): string {
  const categories = Object.values(status.categories);
  const responses = categories.reduce((sum, c) => sum + c.responsePackets, 0);
  const readings = categories.reduce((sum, c) => sum + c.extractedSamples, 0);
  const plural = (count: number, word: string) =>
    `${count} ${word}${count === 1 ? '' : 's'}`;
  return responses === 0
    ? 'Waiting for the band to answer…'
    : `${plural(responses, 'response')} received, ${plural(readings, 'reading')} so far.`;
}

/** Continue after 50 callbacks; finish on dataEnd or a drained day boundary. */
export class V8HistoryReader {
  private acceptPacket: ((bucket: V8HistoryBucket) => void) | null = null;
  private rejectPending: ((error: Error) => void) | null = null;
  private cancelled = false;
  private cancellationReason: string | null = null;
  private running = false;
  // Continuous HR can contain 15 samples per 75-second record: a full day
  // can require 24 pages at one record/callback. Keep a bound above one day.
  // The inactivity timeout alone is not a duration bound: a band that keeps
  // replying without dataEnd can reset it for hours before reaching maxPages.
  // Two minutes per category is an application limit, not an SDK guarantee.
  constructor(
    private timeoutMs = 5_000,
    private maxPages = 64,
    private maxDurationMs = 120_000,
  ) {}

  accept(bucket: V8HistoryBucket) {
    this.acceptPacket?.(bucket);
  }
  cancel(reason = 'The hand band history read was cancelled.') {
    if (this.cancelled) return;
    this.cancelled = true;
    this.cancellationReason = reason;
    this.rejectPending?.(new Error(reason));
  }

  async readAll(
    day: string,
    requests: HistoryRequest[],
    onProgress: (status: V8HistoryReadStatus) => void,
    window?: V8HistoryWindow,
  ): Promise<V8HistoryReadStatus> {
    if (this.running)
      throw new Error('A hand band history read is already in progress.');
    this.running = true;
    this.cancelled = false;
    this.cancellationReason = null;
    const completedTypes: string[] = [],
      failedTypes: string[] = [];
    const categories: V8HistoryReadStatus['categories'] = {};
    const publish = (
      phase: V8HistoryReadStatus['phase'],
      currentType: string | null,
    ): V8HistoryReadStatus => {
      const status: V8HistoryReadStatus = {
        phase,
        day,
        currentType,
        totalCategories: requests.length,
        completedTypes: [...completedTypes],
        failedTypes: [...failedTypes],
        cancellationReason: this.cancellationReason,
        categories: Object.fromEntries(
          Object.entries(categories).map(([key, value]) => [key, { ...value }]),
        ),
      };
      onProgress(status);
      return status;
    };
    try {
      for (const request of requests) {
        const category: V8HistoryCategoryStatus = {
          ...emptyDiagnostics,
          responsePackets: 0,
          pagesRequested: 0,
          outcome: 'reading',
          error: null,
        };
        categories[request.type] = category;
        if (!request.request) {
          category.outcome = 'unavailable';
          category.error =
            'Native history method is unavailable; firmware support is unknown.';
          continue;
        }
        if (this.cancelled) {
          category.outcome = 'notRead';
          continue;
        }
        publish('reading', request.type);
        try {
          await this.readType(request, category, () =>
            publish('reading', request.type),
            window,
          );
          if (category.rejectedRecords) {
            category.error = `Could not parse ${category.rejectedRecords} of ${
              category.receivedRecords
            } ${historyTypeLabels[request.type] ?? request.type} records (${
              category.invalidTimestampRecords
            } invalid dates). Those readings are missing from this day.`;
          }
          if (category.rejectedRecords && !category.extractedSamples) {
            // Nothing usable survived parsing: the metric stays null, the
            // remaining categories are still read and uploaded.
            failedTypes.push(request.type);
            category.outcome = 'failed';
          } else {
            completedTypes.push(request.type);
            category.outcome = category.extractedSamples ? 'downloaded' : 'empty';
          }
        } catch (error) {
          if (!this.cancelled) failedTypes.push(request.type);
          category.outcome = this.cancelled ? 'cancelled' : 'failed';
          category.error =
            error instanceof Error ? error.message : String(error);
        }
      }
      // A category that fails, times out or cannot be parsed leaves its
      // metrics null. It never cancels the categories after it and never
      // discards the readings that did arrive; only an explicit cancellation
      // (disconnect, band/senior change, cleared data) aborts the read,
      // because the readings can no longer be attributed to a verified band.
      if (this.cancelled) {
        publish('partial', null);
        throw new Error(
          `Hand band history is incomplete. ${this.cancellationReason} Nothing was uploaded. Reconnect the band and retry.`,
        );
      }
      return publish(failedTypes.length ? 'partial' : 'complete', null);
    } finally {
      this.running = false;
    }
  }

  private readType(
    { type, request }: HistoryRequest,
    diagnostics: V8HistoryCategoryStatus,
    onPacket: () => void,
    window?: V8HistoryWindow,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      let deadlineTimer: ReturnType<typeof setTimeout>;
      const deadline = Date.now() + this.maxDurationMs;
      let packets = 0,
        page = 1,
        settled = false;
      let crossedDayStart = false;
      let previousRecordStart = Infinity;
      let outOfOrder = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(deadlineTimer);
        this.acceptPacket = null;
        this.rejectPending = null;
        if (error) reject(error);
        else resolve();
      };
      const finishWindow = () => {
        diagnostics.stoppedAtDayStart = true;
        finish(outOfOrder ? new Error('History records were out of order. Stopped at the day boundary; today’s readings may be incomplete.') : undefined);
      };
      const durationExceeded = () =>
        finish(
          new Error(
            `Time limit (${this.maxDurationMs / 1000} seconds) reached reading ${
              historyTypeLabels[type] ?? type
            } before the completion marker (${diagnostics.responsePackets} responses, page ${page}). Available readings were kept.`,
          ),
        );
      const armTimeout = () => {
        clearTimeout(timer);
        timer = setTimeout(
          () => crossedDayStart ? finishWindow() : finish(
              new Error(
                `Timed out reading ${historyTypeLabels[type] ?? type}: ${
                  diagnostics.responsePackets === 0
                    ? 'no history response received'
                    : `transfer stopped before the completion marker (${diagnostics.responsePackets} responses, page ${page})`
                } for ${this.timeoutMs / 1000} seconds.`,
              ),
            ),
          this.timeoutMs,
        );
      };
      const send = (mode: number) => {
        diagnostics.pagesRequested = page;
        armTimeout();
        Promise.resolve()
          .then(() => {
            if (!settled && Date.now() >= deadline) durationExceeded();
            if (!settled) return request!(mode);
          })
          .catch(error =>
            finish(error instanceof Error ? error : new Error(String(error))),
          );
      };
      this.rejectPending = finish;
      this.acceptPacket = bucket => {
        if (settled || bucket.source !== 'history' || bucket.dataType !== type)
          return;
        // Also check wall time when callbacks resume after app suspension.
        if (Date.now() >= deadline) {
          durationExceeded();
          return;
        }
        diagnostics.responsePackets += 1;
        if (window) {
          for (const range of bucket.recordRanges ?? []) {
            if (range.startMs > previousRecordStart) outOfOrder = true;
            previousRecordStart = range.startMs;
            if (range.endMs < window.startMs) crossedDayStart = true;
          }
        }
        armTimeout();
        const packet = bucket.diagnostics ?? {
          ...emptyDiagnostics,
          receivedRecords: bucket.entries.length,
          extractedSamples: bucket.entries.length,
        };
        for (const key of Object.keys(
          emptyDiagnostics,
        ) as (keyof V8ParseDiagnostics)[]) {
          diagnostics[key] += packet[key];
        }
        onPacket();
        if (bucket.completed) {
          // Unparsable records are counted, not fatal: readAll reports them and
          // the samples that did parse stay in this day's aggregation.
          finish();
          return;
        }
        packets += 1;
        if (packets === 50) {
          // Drain the already-requested page before changing commands. The SDK
          // has no range-end/cancel-history command; never request older pages.
          if (crossedDayStart) {
            finishWindow();
            return;
          }
          if (page >= this.maxPages) {
            finish(
              new Error(
                `Page limit (${this.maxPages}) reached for ${
                  historyTypeLabels[type] ?? type
                } before the completion marker.`,
              ),
            );
            return;
          }
          packets = 0;
          page += 1;
          send(2);
        }
      };
      deadlineTimer = setTimeout(durationExceeded, this.maxDurationMs);
      send(0);
    });
  }
}
