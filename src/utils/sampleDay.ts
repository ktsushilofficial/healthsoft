import { toLocalDayKey } from './vitalsDay';

export type DatableSample = {
  timestamp: string | null;
  receivedAt: number | null;
  source?: 'history' | 'live';
};

/** Parse vendor wall-clock timestamps without allowing Date to roll invalid dates. */
export function parseMeasurementTimestamp(raw: string | null): number | null {
  const text = raw?.trim();
  if (!text) return null;
  if (/^(\d{10}|\d{13})$/.test(text)) {
    const value = Number(text) * (text.length === 10 ? 1000 : 1);
    return Number.isFinite(new Date(value).getTime()) ? value : null;
  }
  const match = text.match(
    /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/,
  );
  if (match) {
    const [, y, m, d, h = '0', min = '0', s = '0', ms = '0'] = match;
    const date = new Date(+y, +m - 1, +d, +h, +min, +s, +ms.padEnd(3, '0'));
    return date.getFullYear() === +y &&
      date.getMonth() === +m - 1 &&
      date.getDate() === +d &&
      date.getHours() === +h &&
      date.getMinutes() === +min &&
      date.getSeconds() === +s
      ? date.getTime()
      : null;
  }
  // Only explicit ISO offsets may use the host parser; arbitrary strings and
  // malformed history timestamps must never fall back to the download date.
  if (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      text,
    )
  ) {
    const datePart = text.slice(0, 10);
    if (parseMeasurementTimestamp(datePart) == null) return null;
    const value = Date.parse(text);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export function sampleMeasurementTime(sample: DatableSample): number | null {
  if (sample.timestamp?.trim())
    return parseMeasurementTimestamp(sample.timestamp);
  // Receipt time is meaningful only for an explicitly identified live callback.
  return sample.source === 'live' &&
    sample.receivedAt != null &&
    Number.isFinite(sample.receivedAt)
    ? sample.receivedAt
    : null;
}

export function sampleDayKey(sample: DatableSample): string | null {
  const time = sampleMeasurementTime(sample);
  return time == null ? null : toLocalDayKey(new Date(time));
}
