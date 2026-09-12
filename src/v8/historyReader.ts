import type { V8HistoryBucket, V8ParseDiagnostics } from './models';

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
  completedTypes: string[];
  failedTypes: string[];
  categories: Record<string, V8HistoryCategoryStatus>;
};
export type V8HistoryCategoryStatus = V8ParseDiagnostics & {
  responsePackets: number;
  pagesRequested: number;
  outcome: 'reading' | 'downloaded' | 'empty' | 'failed' | 'unavailable';
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
  completedTypes: [],
  failedTypes: [],
  categories: {},
};
export type HistoryRequest = {
  type: string;
  request?: (mode: number) => Promise<unknown>;
};

/** One vendor response at a time. Continue after 50 callbacks, finish on dataEnd. */
export class V8HistoryReader {
  private acceptPacket: ((bucket: V8HistoryBucket) => void) | null = null;
  private rejectPending: ((error: Error) => void) | null = null;
  private cancelled = false;
  private running = false;
  // Continuous HR can contain 15 samples per 75-second record: a full day
  // can require 24 pages at one record/callback. Keep a bound above one day.
  constructor(private timeoutMs = 5_000, private maxPages = 64) {}

  accept(bucket: V8HistoryBucket) {
    this.acceptPacket?.(bucket);
  }
  cancel() {
    this.cancelled = true;
    this.rejectPending?.(
      new Error('Hand band history read cancelled. Reconnect and retry.'),
    );
  }

  async readAll(
    day: string,
    requests: HistoryRequest[],
    onProgress: (status: V8HistoryReadStatus) => void,
  ): Promise<void> {
    if (this.running)
      throw new Error('A hand band history read is already in progress.');
    this.running = true;
    this.cancelled = false;
    const completedTypes: string[] = [],
      failedTypes: string[] = [];
    const categories: V8HistoryReadStatus['categories'] = {};
    const publish = (
      phase: V8HistoryReadStatus['phase'],
      currentType: string | null,
    ) =>
      onProgress({
        phase,
        day,
        currentType,
        completedTypes: [...completedTypes],
        failedTypes: [...failedTypes],
        categories: Object.fromEntries(
          Object.entries(categories).map(([key, value]) => [key, { ...value }]),
        ),
      });
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
          failedTypes.push(request.type);
          category.outcome = 'failed';
          category.error = 'History read cancelled.';
          continue;
        }
        publish('reading', request.type);
        try {
          await this.readType(request, category, () =>
            publish('reading', request.type),
          );
          completedTypes.push(request.type);
          category.outcome = category.receivedRecords ? 'downloaded' : 'empty';
        } catch (error) {
          failedTypes.push(request.type);
          category.outcome = 'failed';
          category.error =
            error instanceof Error ? error.message : String(error);
        }
      }
      if (failedTypes.length || this.cancelled) {
        publish('partial', null);
        throw new Error(
          `Hand band history is incomplete (${
            failedTypes
              .map(type => historyTypeLabels[type] ?? type)
              .join(', ') || 'disconnected'
          }). ${failedTypes
            .map(type => categories[type].error)
            .filter(Boolean)
            .join(
              ' ',
            )} Received readings are available for review; retry before uploading.`,
        );
      }
      publish('complete', null);
    } finally {
      this.running = false;
    }
  }

  private readType(
    { type, request }: HistoryRequest,
    diagnostics: V8HistoryCategoryStatus,
    onPacket: () => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      let packets = 0,
        page = 1,
        settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.acceptPacket = null;
        this.rejectPending = null;
        if (error) reject(error);
        else resolve();
      };
      const armTimeout = () => {
        clearTimeout(timer);
        timer = setTimeout(
          () =>
            finish(
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
        diagnostics.responsePackets += 1;
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
          finish(
            diagnostics.rejectedRecords
              ? new Error(
                  `Could not parse ${diagnostics.rejectedRecords} of ${
                    diagnostics.receivedRecords
                  } ${historyTypeLabels[type] ?? type} records (${
                    diagnostics.invalidTimestampRecords
                  } invalid dates). Retry before uploading.`,
                )
              : undefined,
          );
          return;
        }
        packets += 1;
        if (packets === 50) {
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
      send(0);
    });
  }
}
