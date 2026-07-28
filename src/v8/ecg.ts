import type { V8EcgEvent, V8EcgSession } from './models';

const ECG_SAMPLE_KEYS = new Set([
  'arrayecgrawdata',
  'arrayecgdata',
  'arrayecg',
  'ecgdata',
  'ecgvalue',
  'kecgdatastring',
]);

const PPG_SAMPLE_KEYS = new Set(['arrayppgrawdata', 'arrayppgdata', 'ppgdata']);

const normalizeKey = (value: string) =>
  value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toText = (value: unknown): string | null => {
  if (value == null || typeof value === 'object') return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

function parseNumberSeries(value: unknown): number[] {
  if (Array.isArray(value)) return value.flatMap(parseNumberSeries);
  if (typeof value === 'number') return Number.isFinite(value) ? [value] : [];
  if (typeof value !== 'string') return [];
  return value
    .trim()
    .replace(/[[\](){}]/g, '')
    .split(/[\s,;|]+/)
    .map(item => Number(item))
    .filter(Number.isFinite);
}

function collectRecords(
  node: unknown,
  output: Record<string, unknown>[],
  seen: Set<object>,
): void {
  if (!node || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach(item => collectRecords(item, output, seen));
    return;
  }

  const record = node as Record<string, unknown>;
  output.push(record);
  Object.values(record).forEach(value => collectRecords(value, output, seen));
}

function findValue(
  records: Record<string, unknown>[],
  keys: string[],
): unknown {
  const normalized = new Set(keys.map(normalizeKey));
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (normalized.has(normalizeKey(key))) return value;
    }
  }
  return undefined;
}

function collectWaveform(records: Record<string, unknown>[]): {
  samples: number[];
  waveformSource: V8EcgEvent['waveformSource'];
  waveformField: string | null;
} {
  const ecgSamples: number[] = [];
  const ppgSamples: number[] = [];
  let ecgField: string | null = null;
  let ppgField: string | null = null;
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      const normalizedKey = normalizeKey(key);
      if (ECG_SAMPLE_KEYS.has(normalizedKey)) {
        ecgField ??= key;
        ecgSamples.push(...parseNumberSeries(value));
      } else if (PPG_SAMPLE_KEYS.has(normalizedKey)) {
        ppgField ??= key;
        ppgSamples.push(...parseNumberSeries(value));
      }
    }
  }
  if (ecgSamples.length > 0) {
    return {
      samples: ecgSamples,
      waveformSource: 'ecg',
      waveformField: ecgField,
    };
  }
  if (ppgSamples.length > 0) {
    return {
      samples: ppgSamples,
      waveformSource: 'ppg',
      waveformField: ppgField,
    };
  }
  return { samples: [], waveformSource: null, waveformField: null };
}

function payloadText(records: Record<string, unknown>[]): string {
  return records
    .flatMap(record =>
      Object.entries(record).flatMap(([key, value]) => [key, toText(value)]),
    )
    .filter((value): value is string => !!value)
    .join(' ')
    .toLowerCase();
}

function detectKind(
  dataType: string | null,
  samples: number[],
  text: string,
  platform?: 'ios' | 'android',
): V8EcgEvent['kind'] {
  // iOS DATATYPE_V8 values from the bundled SDK header.
  if (platform === 'ios') {
    if (dataType === '52') return 'started';
    if (dataType === '53') return 'stopped';
    if (dataType === '54' || dataType === '51')
      return samples.length > 0 ? 'samples' : 'status';
    if (dataType === '55') return 'completed';
    if (dataType === '56') return 'status';
    if (dataType === '57') return 'failed';
  }

  if (
    text.includes('ecg_failed') ||
    text.includes('ecgfailed') ||
    text.includes('ppgstartfailed')
  )
    return 'failed';
  if (
    text.includes('ecg_success') ||
    text.includes('ecgsuccess') ||
    text.includes('ecgresult')
  )
    return 'completed';
  if (
    text.includes('startecg') ||
    text.includes('enterecg') ||
    text.includes('ppgstartsucessed')
  )
    return 'started';
  if (
    text.includes('stopecg') ||
    text.includes('ppgstop') ||
    text.includes('ppgquit')
  )
    return 'stopped';
  if (samples.length > 0) return 'samples';
  if (text.includes('ecg') || text.includes('ppgmeasurementprogress'))
    return 'status';
  return 'unknown';
}

export function parseV8EcgPayload(
  payload: Record<string, unknown>,
  platform?: 'ios' | 'android',
): V8EcgEvent {
  const records: Record<string, unknown>[] = [];
  collectRecords(payload, records, new Set());
  const dataType = toText(findValue(records, ['dataType', 'DataType', 'type']));
  const { samples, waveformSource, waveformField } =
    collectWaveform(records);
  const text = payloadText(records);
  const statusMessage = toText(
    findValue(records, [
      'EcgStatus',
      'ECG_Status',
      'status',
      'message',
      'startStatus',
      'ecgAndPpgStatusData',
      'ppgMeasurementProgress',
    ]),
  );

  return {
    kind: detectKind(dataType, samples, text, platform),
    samples,
    waveformSource,
    waveformField,
    dataType,
    heartRate: toNumber(
      findValue(records, [
        'ECGHrValue',
        'EcgHR',
        'ecgHeartRate',
        'HeartRate',
        'heartRate',
        'heartValue',
        'hrValue',
        'HR',
        'PPGHrValue',
      ]),
    ),
    sampleRateHz: toNumber(
      findValue(records, [
        'sampleRate',
        'sampleRateHz',
        'frequency',
        'samplingFrequency',
      ]),
    ),
    signalQuality: toText(
      findValue(records, [
        'ECGQualityValue',
        'Quality',
        'signalQuality',
        'quality',
      ]),
    ),
    classification: toText(
      findValue(records, [
        'ECGResultValue',
        'ECGResult',
        'resultValue',
        'classification',
      ]),
    ),
    statusMessage,
  };
}

export function createV8EcgSession(
  seniorId: string,
  deviceMac: string | null,
  firmwareVersion: string | null,
  now = Date.now(),
): V8EcgSession {
  return {
    id: `ecg-${now}`,
    seniorId,
    phase: 'starting',
    startedAt: now,
    completedAt: null,
    durationMs: null,
    samples: [],
    waveformSource: null,
    sampleRateHz: null,
    firstSampleAt: null,
    firstSampleCount: 0,
    lastSampleAt: null,
    heartRate: null,
    signalQuality: null,
    classification: null,
    statusMessage: 'Starting ECG measurement…',
    error: null,
    deviceMac,
    firmwareVersion,
  };
}

export function estimateObservedSampleRateHz(
  totalSampleCount: number,
  firstSampleCount: number,
  firstSampleAt: number | null,
  lastSampleAt: number | null,
): number | null {
  if (
    firstSampleAt == null ||
    lastSampleAt == null ||
    lastSampleAt - firstSampleAt < 500
  ) {
    return null;
  }

  const samplesAfterFirstPacket = Math.max(
    0,
    totalSampleCount - firstSampleCount,
  );
  if (samplesAfterFirstPacket === 0) return null;

  const elapsedSeconds = (lastSampleAt - firstSampleAt) / 1000;
  const observedRate = Math.round(samplesAfterFirstPacket / elapsedSeconds);
  return observedRate > 0 ? observedRate : null;
}

export function shouldAutoFinishEcg(
  session: Pick<V8EcgSession, 'phase' | 'startedAt'>,
  now: number,
  maxRecordingDurationMs = 120_000,
): boolean {
  if (session.phase !== 'measuring') return false;
  return now - session.startedAt >= maxRecordingDurationMs;
}

export function isEcgStreamStalled(
  session: Pick<V8EcgSession, 'phase' | 'lastSampleAt' | 'samples'>,
  now: number,
  stallTimeoutMs = 4_000,
): boolean {
  return (
    session.phase === 'measuring' &&
    session.samples.length > 0 &&
    session.lastSampleAt != null &&
    now - session.lastSampleAt >= stallTimeoutMs
  );
}

export function downsampleEcg(samples: number[], maxPoints: number): number[] {
  if (samples.length <= maxPoints || maxPoints < 2) return samples;
  const bucketSize = samples.length / maxPoints;
  const output: number[] = [];
  for (let bucket = 0; bucket < maxPoints; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.max(start + 1, Math.floor((bucket + 1) * bucketSize));
    let total = 0;
    let count = 0;
    for (let index = start; index < end && index < samples.length; index += 1) {
      total += samples[index];
      count += 1;
    }
    output.push(count > 0 ? total / count : samples[start]);
  }
  return output;
}

export type IndexedWaveformPoint = {
  index: number;
  value: number;
};

/**
 * Reduces a waveform for display without averaging away narrow QRS peaks.
 * Each bucket contributes its minimum and maximum at their original x
 * positions, so the resulting path preserves transient morphology.
 */
export function downsampleWaveformEnvelope(
  samples: number[],
  maxPoints: number,
): IndexedWaveformPoint[] {
  if (samples.length === 0) return [];
  if (samples.length <= maxPoints || maxPoints < 4) {
    return samples.map((value, index) => ({ index, value }));
  }

  const output: IndexedWaveformPoint[] = [
    { index: 0, value: samples[0] },
  ];
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const bucketSize = (samples.length - 2) / bucketCount;

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor(bucket * bucketSize);
    const end = Math.min(
      samples.length - 1,
      1 + Math.floor((bucket + 1) * bucketSize),
    );
    let minIndex = start;
    let maxIndex = start;
    for (let index = start + 1; index < end; index += 1) {
      if (samples[index] < samples[minIndex]) minIndex = index;
      if (samples[index] > samples[maxIndex]) maxIndex = index;
    }
    if (minIndex === maxIndex) {
      output.push({ index: minIndex, value: samples[minIndex] });
    } else {
      const firstIndex = Math.min(minIndex, maxIndex);
      const secondIndex = Math.max(minIndex, maxIndex);
      output.push({ index: firstIndex, value: samples[firstIndex] });
      output.push({ index: secondIndex, value: samples[secondIndex] });
    }
  }

  output.push({
    index: samples.length - 1,
    value: samples[samples.length - 1],
  });
  return output;
}
