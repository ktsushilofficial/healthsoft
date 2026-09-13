import type { V8DeviceInfo } from './models';

const CONNECTION_CHANGED = 'The hand band connection changed. Retry the read.';

/**
 * Rejects if `promise` has not settled within `timeoutMs`. A native bridge call
 * that never settles would otherwise leave its awaiter pending forever; the
 * original promise is abandoned, not cancelled, so the caller must be able to
 * continue without its result.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs)) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}

/** Serializes device queries and history transfers on the band's command channel. */
export class V8DeviceInfoReader {
  private tail: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private acceptResponse: ((patch: Partial<V8DeviceInfo>) => void) | null = null;
  private rejectPending: ((error: Error) => void) | null = null;

  constructor(private timeoutMs = 1500, private queueTimeoutMs = 15_000) {}

  /**
   * Queues one command on the band's single command channel. Every task is
   * bounded: a native promise that never settles must not hold the queue
   * forever, or no later command - including the vitals history read - could
   * ever run again. On expiry this caller fails and the next task proceeds.
   */
  run<T>(task: () => Promise<T>, timeoutMs = this.queueTimeoutMs): Promise<T> {
    const generation = this.generation;
    const result = this.tail.then(() => {
      if (generation !== this.generation) throw new Error(CONNECTION_CHANGED);
      return withTimeout(task(), timeoutMs, `The hand band did not finish this command within ${Math.round(timeoutMs / 1000)} seconds. The next step continues.`);
    });
    this.tail = result.catch(() => {});
    return result;
  }

  accept(patch: Partial<V8DeviceInfo>) {
    this.acceptResponse?.(patch);
  }

  cancel() {
    this.generation += 1;
    this.rejectPending?.(new Error(CONNECTION_CHANGED));
    // Release the queue itself. A task still awaiting a dead connection would
    // otherwise keep every command after the reconnect waiting behind it.
    this.tail = Promise.resolve();
  }

  request(field: keyof V8DeviceInfo, send: () => Promise<unknown>): Promise<void> {
    return this.run(async () => {
      const generation = this.generation;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (generation !== this.generation) throw new Error(CONNECTION_CHANGED);
        const received = await new Promise<boolean>((resolve, reject) => {
          let settled = false;
          const finish = (value: boolean, error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            this.acceptResponse = null;
            this.rejectPending = null;
            if (error) reject(error);
            else resolve(value);
          };
          const timer = setTimeout(() => finish(false), this.timeoutMs);
          this.acceptResponse = patch => {
            if (patch[field] != null) finish(true);
          };
          this.rejectPending = error => finish(false, error);
          Promise.resolve().then(() => { if (!settled) return send(); }).catch(error =>
            finish(false, error instanceof Error ? error : new Error(String(error))),
          );
        });
        if (received) return;
      }
      throw new Error('No response from the band after two attempts.');
    });
  }
}

// Advertising names include a MAC suffix on JCV8 bands. Remove it only when
// it matches this band's MAC; the remaining name is not a verified hardware ID.
export function advertisedBandModel(name?: string | null, mac?: string | null): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const suffix = mac?.replace(/[^a-fA-F0-9]/g, '').slice(-6);
  const match = trimmed.match(/^(.*?)\s+([a-fA-F0-9]{6})$/);
  return match && suffix?.length === 6 && match[2].toLowerCase() === suffix.toLowerCase()
    ? match[1]
    : trimmed;
}
