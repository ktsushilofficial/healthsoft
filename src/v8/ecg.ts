import type { V8EcgEvent, V8EcgSession } from './models';

export const ECG_RECORDING_DURATION_SECONDS = 30;
export const ECG_RECORDING_DURATION_MS = ECG_RECORDING_DURATION_SECONDS * 1_000;

const ECG_SAMPLE_KEYS = new Set([
  'arrayecgrawdata',
  'arrayecgdata',
  'arrayecg',
  'ecgdata',
  'ecgvalue',
  'kecgdatastring',
]);

const PPG_SAMPLE_KEYS = new Set([
  'arrayppgrawdata',
  'arrayppgdata',
  'ppgdata',
  // Android Blood_glucose_data (type 119) uses DeviceKey.PPG.
  'ppg',
]);

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
  requestedMode?: 'ecg' | 'ppg',
): V8EcgEvent['kind'] {
  // iOS DATATYPE_V8 values from the bundled SDK header.
  if (platform === 'ios') {
    if (requestedMode !== 'ppg') {
      if (dataType === '52') return 'started';
      if (dataType === '53') return 'stopped';
      if (dataType === '54' || dataType === '51')
        return samples.length > 0 ? 'samples' : 'status';
      if (dataType === '55') return 'completed';
      if (dataType === '56') return 'status';
      if (dataType === '57') return 'failed';
      // Contact ECG is recorded through the SDK's manual HRV workflow. Its
      // measurement result contains heartRate and arrives as type 59.
      if (dataType === '59') return 'status';
    }
    if (requestedMode === 'ppg') {
      if (dataType === '70') return samples.length > 0 ? 'samples' : 'status';
      if (dataType === '71') return 'started';
      if (dataType === '72') return 'failed';
      if (dataType === '73') return 'completed';
      if (dataType === '74' || dataType === '75') return 'stopped';
      if (dataType === '76') return 'status';
    }
  }

  if (platform === 'android') {
    // The dedicated Android optical PPG workflow emits status 118 and samples
    // 119. Measurement callbacks 73-78 belong to 0x28 modes 1-3 and must not
    // complete a contact-ECG or optical-PPG recording.
    if (requestedMode === 'ppg' && dataType === '118') return 'status';
    if (requestedMode === 'ppg' && dataType === '119')
      return samples.length > 0 ? 'samples' : 'status';
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
  requestedMode?: 'ecg' | 'ppg',
): V8EcgEvent {
  const records: Record<string, unknown>[] = [];
  collectRecords(payload, records, new Set());
  const dataType = toText(findValue(records, ['dataType', 'DataType', 'type']));
  const collectedWaveform = collectWaveform(records);
  const androidContactEcg =
    platform === 'android' &&
    dataType === '64' &&
    collectedWaveform.waveformSource === 'ppg' &&
    normalizeKey(collectedWaveform.waveformField ?? '') === 'arrayppgrawdata';
  const iosContactEcg =
    platform === 'ios' &&
    requestedMode === 'ecg' &&
    dataType === '70' &&
    collectedWaveform.waveformSource === 'ppg' &&
    normalizeKey(collectedWaveform.waveformField ?? '') === 'arrayppgdata';
  const samples = collectedWaveform.samples;
  const waveformSource =
    androidContactEcg || iosContactEcg
      ? 'ecg'
      : collectedWaveform.waveformSource;
  const waveformField = collectedWaveform.waveformField;
  const contactEcgPacket =
    waveformSource === 'ecg' &&
    ((platform === 'ios' && dataType === '54') ||
      androidContactEcg ||
      iosContactEcg);
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
  const explicitSampleRateHz = toNumber(
    findValue(records, [
      'sampleRate',
      'sampleRateHz',
      'frequency',
      'samplingFrequency',
    ]),
  );
  const rawHeartRate = toNumber(
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
  );
  // Zero is the SDK's common "not measured" sentinel. Keep a deliberately
  // broad range so unusual but possible rates are not silently discarded.
  const heartRate =
    rawHeartRate != null && rawHeartRate >= 20 && rawHeartRate <= 250
      ? Math.round(rawHeartRate)
      : null;

  return {
    kind: detectKind(dataType, samples, text, platform, requestedMode),
    samples,
    waveformSource,
    waveformField,
    dataType,
    heartRate,
    heartRateSource: heartRate == null ? null : 'device',
    sampleRateHz: explicitSampleRateHz ?? (contactEcgPacket ? 250 : null),
    sampleRateSource:
      explicitSampleRateHz != null
        ? 'device'
        : contactEcgPacket
        ? 'protocol'
        : null,
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
  requestedMode: 'ecg' | 'ppg' = 'ecg',
): V8EcgSession {
  const modeLabel = requestedMode === 'ecg' ? 'ECG' : 'PPG';
  return {
    id: `ecg-${now}`,
    seniorId,
    requestedMode,
    phase: 'starting',
    startedAt: now,
    completedAt: null,
    durationMs: null,
    samples: [],
    waveformSource: null,
    waveformField: null,
    waveformDataType: null,
    sampleRateHz: null,
    sampleRateSource: null,
    firstSampleAt: null,
    firstSampleCount: 0,
    lastSampleAt: null,
    heartRate: null,
    heartRateSource: null,
    heartRateConfidence: null,
    signalQuality: null,
    classification: null,
    statusMessage: `Starting ${modeLabel} measurement…`,
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

function centeredMovingAverage(
  samples: number[],
  windowSize: number,
): number[] {
  if (samples.length === 0) return [];
  const size = Math.max(1, Math.min(samples.length, Math.round(windowSize)));
  if (size === 1) return [...samples];
  const left = Math.floor(size / 2);
  const right = size - left;
  const prefix = new Array<number>(samples.length + 1).fill(0);
  for (let index = 0; index < samples.length; index += 1) {
    prefix[index + 1] = prefix[index] + samples[index];
  }
  return samples.map((_, index) => {
    const start = Math.max(0, index - left);
    const end = Math.min(samples.length, index + right);
    return (prefix[end] - prefix[start]) / Math.max(1, end - start);
  });
}

function quantile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const bounded = Math.max(0, Math.min(1, fraction));
  const position = (sorted.length - 1) * bounded;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function detrendAndSmoothWaveform(
  samples: number[],
  sampleRateHz: number,
  source: 'ecg' | 'ppg',
): number[] {
  const finiteSamples = samples.map(value =>
    Number.isFinite(value) ? value : 0,
  );
  const baselineSeconds = source === 'ecg' ? 0.8 : 1.5;
  const baseline = centeredMovingAverage(
    finiteSamples,
    Math.max(3, sampleRateHz * baselineSeconds),
  );
  const detrended = finiteSamples.map(
    (value, index) => value - baseline[index],
  );

  type BiquadCoefficients = {
    b0: number;
    b1: number;
    b2: number;
    a1: number;
    a2: number;
  };
  const applyBiquad = (
    input: number[],
    coefficients: BiquadCoefficients,
  ): number[] => {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    return input.map(value => {
      const output =
        coefficients.b0 * value +
        coefficients.b1 * x1 +
        coefficients.b2 * x2 -
        coefficients.a1 * y1 -
        coefficients.a2 * y2;
      x2 = x1;
      x1 = value;
      y2 = y1;
      y1 = output;
      return Number.isFinite(output) ? output : 0;
    });
  };
  const normalizedBiquad = (
    b0: number,
    b1: number,
    b2: number,
    a0: number,
    a1: number,
    a2: number,
  ): BiquadCoefficients => ({
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  });
  const lowPass = (cutoffHz: number): BiquadCoefficients => {
    const omega = (2 * Math.PI * cutoffHz) / sampleRateHz;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * Math.SQRT1_2);
    return normalizedBiquad(
      (1 - cosine) / 2,
      1 - cosine,
      (1 - cosine) / 2,
      1 + alpha,
      -2 * cosine,
      1 - alpha,
    );
  };
  const notch = (frequencyHz: number): BiquadCoefficients => {
    const omega = (2 * Math.PI * frequencyHz) / sampleRateHz;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / 40;
    return normalizedBiquad(
      1,
      -2 * cosine,
      1,
      1 + alpha,
      -2 * cosine,
      1 - alpha,
    );
  };

  let filtered = detrended;
  if (source === 'ecg') {
    // Remove common mains interference without committing the report to one
    // locale. The notches are narrow enough to preserve ECG morphology.
    if (sampleRateHz > 110) filtered = applyBiquad(filtered, notch(50));
    if (sampleRateHz > 130) filtered = applyBiquad(filtered, notch(60));
  }
  const nyquistHz = sampleRateHz / 2;
  const cutoffHz = Math.min(
    source === 'ecg' ? 35 : 8,
    Math.max(2, nyquistHz * 0.8),
  );
  const coefficients = lowPass(cutoffHz);
  filtered = applyBiquad(filtered, coefficients);
  // Reverse filtering removes the visible phase lag and adds attenuation to
  // the high-frequency fuzz that the envelope renderer would otherwise retain.
  return applyBiquad([...filtered].reverse(), coefficients).reverse();
}

/**
 * Produces a baseline-corrected display copy. The session continues to retain
 * the untouched raw device samples for export/debugging and future analysis.
 */
export function filterWaveformForDisplay(
  samples: number[],
  sampleRateHz: number | null,
  source: 'ecg' | 'ppg' = 'ecg',
): number[] {
  if (samples.length < 3) return [...samples];
  const rate =
    sampleRateHz != null && sampleRateHz >= 20 && sampleRateHz <= 2_000
      ? sampleRateHz
      : 250;
  const filtered = detrendAndSmoothWaveform(samples, rate, source);
  const sorted = [...filtered].sort((a, b) => a - b);
  const lower = quantile(sorted, 0.005);
  const upper = quantile(sorted, 0.995);
  if (upper <= lower) return filtered;
  return filtered.map(value => Math.max(lower, Math.min(upper, value)));
}

/**
 * Computes a stable shared display scale. The first seconds of a contact ECG
 * commonly contain electrode-settling artifacts; excluding them from the
 * scale calculation keeps those artifacts visible as clipping without making
 * the useful remainder of all three strips appear flat.
 */
export function getWaveformDisplayRange(
  samples: number[],
  sampleRateHz: number | null,
  settlingSeconds = 3,
): { min: number; max: number } {
  const finite = samples.filter(Number.isFinite);
  if (finite.length === 0) return { min: -1, max: 1 };
  const rate =
    sampleRateHz != null && sampleRateHz >= 20 && sampleRateHz <= 2_000
      ? sampleRateHz
      : 250;
  const settlingCount = Math.min(
    finite.length - 1,
    Math.max(0, Math.round(rate * settlingSeconds)),
  );
  const scaleSamples = finite.slice(settlingCount);
  const sorted = [...(scaleSamples.length > 20 ? scaleSamples : finite)].sort(
    (a, b) => a - b,
  );
  let min = quantile(sorted, 0.005);
  let max = quantile(sorted, 0.995);
  if (max <= min) {
    const center = quantile(sorted, 0.5);
    min = center - 1;
    max = center + 1;
  }
  const padding = (max - min) * 0.08;
  return { min: min - padding, max: max + padding };
}

export type WaveformHeartRateAnalysis = {
  heartRate: number | null;
  confidence: number;
  quality: 'good' | 'fair' | 'poor';
  peakCount: number;
  rrVariation: number | null;
};

const poorHeartRateAnalysis = (
  confidence = 0,
  peakCount = 0,
  rrVariation: number | null = null,
): WaveformHeartRateAnalysis => ({
  heartRate: null,
  confidence,
  quality: 'poor',
  peakCount,
  rrVariation,
});

/**
 * Conservative waveform fallback for when the vendor result contains no BPM.
 * It detects periodic QRS/pulse energy after baseline removal and refuses to
 * publish a number unless interval consistency and signal contrast are usable.
 */
export function analyzeWaveformHeartRate(
  samples: number[],
  sampleRateHz: number | null,
  source: 'ecg' | 'ppg' = 'ecg',
): WaveformHeartRateAnalysis {
  if (
    sampleRateHz == null ||
    sampleRateHz < 20 ||
    sampleRateHz > 2_000 ||
    samples.length < sampleRateHz * 8
  ) {
    return poorHeartRateAnalysis();
  }

  const filtered = detrendAndSmoothWaveform(samples, sampleRateHz, source);
  const derivativeEnergy = new Array<number>(filtered.length).fill(0);
  for (let index = 1; index < filtered.length; index += 1) {
    const delta = filtered[index] - filtered[index - 1];
    derivativeEnergy[index] = delta * delta;
  }
  const energy = centeredMovingAverage(
    derivativeEnergy,
    Math.max(2, sampleRateHz * (source === 'ecg' ? 0.08 : 0.12)),
  );
  // Contact/motion artefacts are common while the user first touches the
  // electrode. Exclude that settling period from both threshold calibration
  // and peak detection; otherwise one large spike can hide the valid beats in
  // the remaining recording.
  const leadingEdgeSamples = Math.round(
    sampleRateHz * (source === 'ecg' ? 5 : 0.75),
  );
  const trailingEdgeSamples = Math.round(sampleRateHz * 0.75);
  const end = energy.length - trailingEdgeSamples;
  const analysisEnergy = energy.slice(leadingEdgeSamples, end);
  if (analysisEnergy.length < sampleRateHz * 4) {
    return poorHeartRateAnalysis();
  }
  const sortedEnergy = [...analysisEnergy].sort((a, b) => a - b);
  const medianEnergy = quantile(sortedEnergy, 0.5);
  const deviations = analysisEnergy
    .map(value => Math.abs(value - medianEnergy))
    .sort((a, b) => a - b);
  const madEnergy = quantile(deviations, 0.5);
  const highEnergy = quantile(sortedEnergy, 0.9);
  const veryHighEnergy = quantile(sortedEnergy, 0.98);
  if (!Number.isFinite(veryHighEnergy) || veryHighEnergy <= 0) {
    return poorHeartRateAnalysis();
  }
  const threshold = Math.max(medianEnergy + madEnergy * 6, highEnergy * 0.35);
  if (veryHighEnergy < threshold * 1.15) {
    return poorHeartRateAnalysis();
  }

  const refractorySamples = Math.round(sampleRateHz * 0.28);
  const peaks: number[] = [];
  let index = leadingEdgeSamples;
  while (index < end) {
    if (energy[index] < threshold) {
      index += 1;
      continue;
    }
    let peakIndex = index;
    let peakValue = energy[index];
    while (index < end && energy[index] >= threshold * 0.6) {
      if (energy[index] > peakValue) {
        peakValue = energy[index];
        peakIndex = index;
      }
      index += 1;
    }
    const previousIndex = peaks[peaks.length - 1];
    if (
      previousIndex == null ||
      peakIndex - previousIndex >= refractorySamples
    ) {
      peaks.push(peakIndex);
    } else if (energy[peakIndex] > energy[previousIndex]) {
      peaks[peaks.length - 1] = peakIndex;
    }
  }

  if (peaks.length < 5) return poorHeartRateAnalysis(0.1, peaks.length);
  const plausibleIntervals = peaks
    .slice(1)
    .map((peak, peakIndex) => (peak - peaks[peakIndex]) / sampleRateHz)
    .filter(seconds => seconds >= 0.3 && seconds <= 2);
  if (plausibleIntervals.length < 4) {
    return poorHeartRateAnalysis(0.15, peaks.length);
  }
  const sortedIntervals = [...plausibleIntervals].sort((a, b) => a - b);
  const medianInterval = quantile(sortedIntervals, 0.5);
  const intervalTolerance = Math.max(0.12, medianInterval * 0.3);
  const acceptedIntervals = plausibleIntervals.filter(
    seconds => Math.abs(seconds - medianInterval) <= intervalTolerance,
  );
  if (acceptedIntervals.length < 4) {
    return poorHeartRateAnalysis(0.2, peaks.length);
  }

  const acceptedMean =
    acceptedIntervals.reduce((total, seconds) => total + seconds, 0) /
    acceptedIntervals.length;
  const intervalVariance =
    acceptedIntervals.reduce(
      (total, seconds) => total + (seconds - acceptedMean) ** 2,
      0,
    ) / acceptedIntervals.length;
  const rrVariation =
    acceptedMean > 0 ? Math.sqrt(intervalVariance) / acceptedMean : 1;
  const acceptedRatio = acceptedIntervals.length / plausibleIntervals.length;
  const contrast = Math.max(
    0,
    Math.min(
      1,
      (veryHighEnergy - medianEnergy) /
        Math.max(veryHighEnergy, Number.EPSILON),
    ),
  );
  const regularity = Math.max(0, Math.min(1, 1 - rrVariation / 0.25));
  const intervalScore = Math.min(1, acceptedIntervals.length / 10);
  const durationScore = Math.min(1, samples.length / sampleRateHz / 20);
  const confidence = Math.max(
    0,
    Math.min(
      1,
      regularity * 0.35 +
        acceptedRatio * 0.25 +
        intervalScore * 0.2 +
        contrast * 0.1 +
        durationScore * 0.1,
    ),
  );
  const heartRate = Math.round(60 / medianInterval);
  if (
    heartRate < 30 ||
    heartRate > 200 ||
    rrVariation > 0.22 ||
    acceptedRatio < 0.55 ||
    confidence < 0.58
  ) {
    return poorHeartRateAnalysis(confidence, peaks.length, rrVariation);
  }
  return {
    heartRate,
    confidence,
    quality: confidence >= 0.78 ? 'good' : 'fair',
    peakCount: peaks.length,
    rrVariation,
  };
}

export function splitWaveformIntoStrips(
  samples: number[],
  stripCount: number,
): number[][] {
  if (stripCount <= 0 || !Number.isFinite(stripCount)) return [];
  const count = Math.max(1, Math.floor(stripCount));
  const baseSize = Math.floor(samples.length / count);
  const remainder = samples.length % count;
  let start = 0;

  return Array.from({ length: count }, (_, index) => {
    const size = baseSize + (index < remainder ? 1 : 0);
    const strip = samples.slice(start, start + size);
    start += size;
    return strip;
  });
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

  const output: IndexedWaveformPoint[] = [{ index: 0, value: samples[0] }];
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
