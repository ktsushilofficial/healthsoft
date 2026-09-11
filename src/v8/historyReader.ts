import type { V8HistoryBucket } from './models';

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
};
export const idleHistoryReadStatus: V8HistoryReadStatus = {
  phase: 'idle',
  day: null,
  currentType: null,
  completedTypes: [],
  failedTypes: [],
};
export type HistoryRequest = {
  type: string;
  request: (mode: number) => Promise<unknown>;
};

/** One vendor response at a time. Continue after 50 callbacks, finish on dataEnd. */
export class V8HistoryReader {
  private acceptPacket: ((bucket: V8HistoryBucket) => void) | null = null;
  private rejectPending: ((error: Error) => void) | null = null;
  private cancelled = false;
  private running = false;
  constructor(private timeoutMs = 5_000, private maxPages = 12) {}

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
      });
    try {
      for (const request of requests) {
        if (this.cancelled) {
          failedTypes.push(request.type);
          break;
        }
        publish('reading', request.type);
        try {
          await this.readType(request);
          completedTypes.push(request.type);
        } catch {
          failedTypes.push(request.type);
        }
      }
      if (failedTypes.length || this.cancelled) {
        publish('partial', null);
        throw new Error(
          `Hand band history is incomplete (${
            failedTypes
              .map(type => historyTypeLabels[type] ?? type)
              .join(', ') || 'disconnected'
          }). Received readings are available for review; retry before uploading.`,
        );
      }
      publish('complete', null);
    } finally {
      this.running = false;
    }
  }

  private readType({ type, request }: HistoryRequest): Promise<void> {
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
          () => finish(new Error(`Timed out reading ${type}`)),
          this.timeoutMs,
        );
      };
      const send = (mode: number) => {
        armTimeout();
        Promise.resolve()
          .then(() => {
            if (!settled) return request(mode);
          })
          .catch(error =>
            finish(error instanceof Error ? error : new Error(String(error))),
          );
      };
      this.rejectPending = finish;
      this.acceptPacket = bucket => {
        if (settled || bucket.source !== 'history' || bucket.dataType !== type)
          return;
        armTimeout();
        if (bucket.completed) {
          finish();
          return;
        }
        packets += 1;
        if (packets === 50) {
          if (page >= this.maxPages) {
            finish(new Error(`Page limit reached for ${type}`));
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
