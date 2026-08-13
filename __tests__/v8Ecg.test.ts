import {
  analyzeWaveformHeartRate,
  createV8EcgSession,
  downsampleEcg,
  downsampleWaveformEnvelope,
  estimateObservedSampleRateHz,
  filterWaveformForDisplay,
  getWaveformDisplayRange,
  isEcgStreamStalled,
  parseV8EcgPayload,
  shouldAutoFinishEcg,
  splitWaveformIntoStrips,
} from '../src/v8/ecg';

describe('V8 ECG helpers', () => {
  it('parses iOS raw ECG packets from dicData', () => {
    const event = parseV8EcgPayload({
      dataType: '54',
      dataEnd: false,
      dicData: {
        arrayEcgRawData: [10, 12, 18, 9],
        ECGHrValue: '73',
        ECGQualityValue: 'good',
        sampleRate: 500,
      },
    });

    expect(event).toEqual(
      expect.objectContaining({
        kind: 'samples',
        samples: [10, 12, 18, 9],
        waveformSource: 'ecg',
        waveformField: 'arrayEcgRawData',
        dataType: '54',
        heartRate: 73,
        sampleRateHz: 500,
        signalQuality: 'good',
      }),
    );
  });

  it('parses an Android-style ECG result payload', () => {
    const event = parseV8EcgPayload(
      {
        dataType: 'ECGResult',
        dataEnd: true,
        dicData: {
          Type: '4',
          ECGResultVALUE: 'recording-complete',
          ECGHrValue: 68,
        },
      },
      'android',
      'ecg',
    );

    expect(event.kind).toBe('completed');
    expect(event.classification).toBe('recording-complete');
    expect(event.heartRate).toBe(68);
    expect(event.heartRateSource).toBe('device');
  });

  it('captures the iOS manual-HRV heart-rate result used by contact ECG', () => {
    const event = parseV8EcgPayload(
      {
        dataType: '59',
        dataEnd: true,
        dicData: { heartRate: '101', hrv: '54' },
      },
      'ios',
      'ecg',
    );

    expect(event.kind).toBe('status');
    expect(event.heartRate).toBe(101);
    expect(event.heartRateSource).toBe('device');
  });

  it('does not use the Android mode-1 HRV callback as an ECG result', () => {
    const event = parseV8EcgPayload(
      {
        dataType: '73',
        dataEnd: true,
        dicData: { Type: '1', heartRate: '96', hrv: '62' },
      },
      'android',
      'ecg',
    );

    expect(event.kind).toBe('unknown');
    expect(event.heartRate).toBe(96);
    expect(event.heartRateSource).toBe('device');
  });

  it('rejects zero-valued SDK heart-rate sentinels', () => {
    const event = parseV8EcgPayload(
      { dataType: '73', dicData: { heartRate: '0' } },
      'android',
      'ecg',
    );

    expect(event.heartRate).toBeNull();
    expect(event.heartRateSource).toBeNull();
  });

  it('treats Android protocol 0x07 samples as ECG during contact ECG', () => {
    const event = parseV8EcgPayload(
      {
        dataType: '64',
        dataEnd: false,
        dicData: {
          arrayPpgRawData: '8451200,8451456,8450944,8451712',
          packetID: '7',
        },
      },
      'android',
      'ecg',
    );

    expect(event.kind).toBe('samples');
    expect(event.samples).toEqual([8451200, 8451456, 8450944, 8451712]);
    expect(event.waveformSource).toBe('ecg');
    expect(event.waveformField).toBe('arrayPpgRawData');
    expect(event.sampleRateHz).toBe(250);
    expect(event.sampleRateSource).toBe('protocol');
  });

  it('keeps Android protocol 0x07 labeled ECG so the PPG tab rejects it', () => {
    const event = parseV8EcgPayload(
      {
        dataType: '64',
        dataEnd: false,
        dicData: {
          arrayPpgRawData: '8451200,8451456',
          packetID: '8',
        },
      },
      'android',
      'ppg',
    );

    expect(event.waveformSource).toBe('ecg');
    expect(event.sampleRateHz).toBe(250);
    expect(event.sampleRateSource).toBe('protocol');
  });

  it('parses Android type-119 optical PPG samples on the PPG tab', () => {
    const event = parseV8EcgPayload(
      {
        dataType: '119',
        dataEnd: false,
        dicData: {
          PPG: '[1048572, 1048598, 1048611, 1048580]',
        },
      },
      'android',
      'ppg',
    );

    expect(event.kind).toBe('samples');
    expect(event.samples).toEqual([1048572, 1048598, 1048611, 1048580]);
    expect(event.waveformSource).toBe('ppg');
    expect(event.waveformField).toBe('PPG');
    expect(event.sampleRateHz).toBeNull();
  });

  it('parses the iOS real-time stream emitted as arrayPPGData', () => {
    const event = parseV8EcgPayload(
      {
        dataType: '70',
        dataEnd: false,
        dicData: {
          arrayPPGData: [1048572, 1048598, 1048611, 1048580],
        },
      },
      'ios',
      'ppg',
    );

    expect(event.kind).toBe('samples');
    expect(event.samples).toEqual([1048572, 1048598, 1048611, 1048580]);
    expect(event.waveformSource).toBe('ppg');
    expect(event.waveformField).toBe('arrayPPGData');
    expect(event.dataType).toBe('70');
  });

  it('keeps iOS ECG type-54 samples labeled ECG on the PPG tab', () => {
    const event = parseV8EcgPayload(
      {
        dataType: '54',
        dataEnd: false,
        dicData: { arrayEcgRawData: [10, 12, 18, 9] },
      },
      'ios',
      'ppg',
    );

    expect(event.kind).toBe('samples');
    expect(event.waveformSource).toBe('ecg');
  });

  it('keeps Android type-119 samples labeled PPG on the ECG tab', () => {
    const event = parseV8EcgPayload(
      {
        dataType: '119',
        dataEnd: false,
        dicData: { PPG: '[1048572, 1048598]' },
      },
      'android',
      'ecg',
    );

    expect(event.kind).toBe('samples');
    expect(event.waveformSource).toBe('ppg');
  });

  it('treats the iOS firmware-0032 type-70 stream as contact ECG in ECG mode', () => {
    const event = parseV8EcgPayload(
      {
        dataType: '70',
        dataEnd: false,
        dicData: {
          arrayPPGData: [1048572, 1048598, 1048611, 1048580],
        },
      },
      'ios',
      'ecg',
    );

    expect(event.kind).toBe('samples');
    expect(event.waveformSource).toBe('ecg');
    expect(event.waveformField).toBe('arrayPPGData');
    expect(event.sampleRateHz).toBe(250);
    expect(event.sampleRateSource).toBe('protocol');
  });

  it('maps iOS PPG lifecycle callbacks only for the PPG tab', () => {
    expect(
      parseV8EcgPayload({ dataType: '71', dicData: {} }, 'ios', 'ppg').kind,
    ).toBe('started');
    expect(
      parseV8EcgPayload({ dataType: '72', dicData: {} }, 'ios', 'ppg').kind,
    ).toBe('failed');
    expect(
      parseV8EcgPayload({ dataType: '74', dicData: {} }, 'ios', 'ppg').kind,
    ).toBe('stopped');
    expect(
      parseV8EcgPayload({ dataType: '71', dicData: {} }, 'ios', 'ecg').kind,
    ).toBe('unknown');
  });

  it('does not confuse Android blood-oxygen type 55 with iOS ECG success', () => {
    expect(
      parseV8EcgPayload({ dataType: '55', Blood_oxygen: 97 }, 'android').kind,
    ).toBe('unknown');
    expect(parseV8EcgPayload({ dataType: '55' }, 'ios').kind).toBe('completed');
  });

  it('creates a fresh diagnostic session', () => {
    expect(
      createV8EcgSession('senior-1', 'AA:BB:CC:DD:EE:FF', '1.2.3', 1000),
    ).toEqual(
      expect.objectContaining({
        id: 'ecg-1000',
        seniorId: 'senior-1',
        requestedMode: 'ecg',
        phase: 'starting',
        startedAt: 1000,
        samples: [],
        waveformSource: null,
        waveformField: null,
        waveformDataType: null,
        firstSampleAt: null,
        firstSampleCount: 0,
        lastSampleAt: null,
        deviceMac: 'AA:BB:CC:DD:EE:FF',
        firmwareVersion: '1.2.3',
      }),
    );
  });

  it('calculates observed sample frequency after multiple packets arrive', () => {
    expect(estimateObservedSampleRateHz(260, 10, 1000, 2000)).toBe(250);
    expect(estimateObservedSampleRateHz(522, 10, 1000, 2000)).toBe(512);
    expect(estimateObservedSampleRateHz(10, 10, 1000, 2000)).toBeNull();
    expect(estimateObservedSampleRateHz(260, 10, 1000, 1200)).toBeNull();
  });

  it('downsamples long waveforms while retaining the requested size', () => {
    expect(
      downsampleEcg(
        Array.from({ length: 100 }, (_, index) => index),
        10,
      ),
    ).toHaveLength(10);
  });

  it('preserves narrow waveform peaks when reducing points for display', () => {
    const samples = Array.from({ length: 100 }, () => 0);
    samples[51] = 1_000;

    const points = downsampleWaveformEnvelope(samples, 10);

    expect(points.length).toBeLessThanOrEqual(10);
    expect(points).toContainEqual({ index: 51, value: 1_000 });
    expect(points.map(point => point.index)).toEqual(
      [...points.map(point => point.index)].sort((a, b) => a - b),
    );
  });

  it('removes slow baseline drift from a display copy without changing raw samples', () => {
    const sampleRate = 250;
    const raw = Array.from(
      { length: sampleRate * 10 },
      (_, index) =>
        500 + 120 * Math.sin((2 * Math.PI * index) / (sampleRate * 4)),
    );
    const original = [...raw];

    const filtered = filterWaveformForDisplay(raw, sampleRate, 'ecg');
    const filteredRange = Math.max(...filtered) - Math.min(...filtered);

    expect(raw).toEqual(original);
    expect(filtered).toHaveLength(raw.length);
    expect(filteredRange).toBeLessThan(80);
  });

  it('attenuates 50 Hz interference while retaining the ECG pulse shape', () => {
    const sampleRate = 250;
    const clean = Array.from({ length: sampleRate * 10 }, (_, index) => {
      const seconds = index / sampleRate;
      const phase = seconds % 0.8;
      const distance = Math.min(phase, 0.8 - phase);
      return 4 * Math.exp(-((distance / 0.02) ** 2));
    });
    const noisy = clean.map(
      (value, index) =>
        value + 1.5 * Math.sin((2 * Math.PI * 50 * index) / sampleRate),
    );

    const filtered = filterWaveformForDisplay(noisy, sampleRate, 'ecg');
    const errorBefore = Math.sqrt(
      noisy.reduce(
        (total, value, index) => total + (value - clean[index]) ** 2,
        0,
      ) / noisy.length,
    );
    const errorAfter = Math.sqrt(
      filtered.reduce(
        (total, value, index) => total + (value - clean[index]) ** 2,
        0,
      ) / filtered.length,
    );

    expect(errorAfter).toBeLessThan(errorBefore * 0.65);
    expect(Math.max(...filtered)).toBeGreaterThan(2);
  });

  it('keeps startup contact artifacts from flattening the report scale', () => {
    const sampleRate = 250;
    const samples = Array.from({ length: sampleRate * 30 }, (_, index) =>
      index < sampleRate * 2 ? 1_000 : Math.sin(index / 10) * 4,
    );

    const range = getWaveformDisplayRange(samples, sampleRate);

    expect(range.max - range.min).toBeLessThan(12);
    expect(range.min).toBeLessThan(-3);
    expect(range.max).toBeGreaterThan(3);
  });

  it('estimates BPM from a baseline-wandering ECG without a device result', () => {
    const sampleRate = 250;
    const durationSeconds = 30;
    const beatInterval = 0.6; // 100 bpm
    let randomState = 123456789;
    const random = () => {
      randomState = (randomState * 16807) % 2147483647;
      return randomState / 2147483647 - 0.5;
    };
    const samples = Array.from(
      { length: sampleRate * durationSeconds },
      (_, index) => {
        const seconds = index / sampleRate;
        const baseline = 0.9 * Math.sin(2 * Math.PI * 0.22 * seconds);
        const beatPhase = seconds % beatInterval;
        const qrsDistance = Math.min(beatPhase, beatInterval - beatPhase);
        const qrs = 4 * Math.exp(-((qrsDistance / 0.018) ** 2));
        const initialContactArtifact = index < 3 ? 15 - index * 4 : 0;
        return baseline + qrs + random() * 0.08 + initialContactArtifact;
      },
    );

    const analysis = analyzeWaveformHeartRate(samples, sampleRate, 'ecg');

    expect(analysis.heartRate).toBeGreaterThanOrEqual(98);
    expect(analysis.heartRate).toBeLessThanOrEqual(102);
    expect(analysis.confidence).toBeGreaterThanOrEqual(0.58);
    expect(['good', 'fair']).toContain(analysis.quality);
  });

  it('estimates BPM after a large multi-second contact artefact', () => {
    const sampleRate = 250;
    const beatInterval = 0.75; // 80 bpm
    const samples = Array.from({ length: sampleRate * 30 }, (_, index) => {
      const seconds = index / sampleRate;
      if (seconds < 5) {
        return 80 * Math.sin(2 * Math.PI * 1.7 * seconds);
      }
      const beatPhase = seconds % beatInterval;
      const qrsDistance = Math.min(beatPhase, beatInterval - beatPhase);
      const baseline = 0.5 * Math.sin(2 * Math.PI * 0.18 * seconds);
      return baseline + 2.5 * Math.exp(-((qrsDistance / 0.02) ** 2));
    });

    const analysis = analyzeWaveformHeartRate(samples, sampleRate, 'ecg');

    expect(analysis.heartRate).toBeGreaterThanOrEqual(79);
    expect(analysis.heartRate).toBeLessThanOrEqual(81);
    expect(analysis.confidence).toBeGreaterThanOrEqual(0.58);
  });

  it('does not publish a waveform BPM for an unusable flat signal', () => {
    const analysis = analyzeWaveformHeartRate(
      Array.from({ length: 250 * 30 }, () => 42),
      250,
      'ecg',
    );

    expect(analysis.heartRate).toBeNull();
    expect(analysis.quality).toBe('poor');
  });

  it('does not publish a waveform BPM for non-periodic noise', () => {
    let randomState = 987654321;
    const samples = Array.from({ length: 250 * 30 }, () => {
      randomState = (randomState * 16807) % 2147483647;
      return randomState / 2147483647 - 0.5;
    });

    const analysis = analyzeWaveformHeartRate(samples, 250, 'ecg');

    expect(analysis.heartRate).toBeNull();
    expect(analysis.quality).toBe('poor');
  });

  it('auto-finishes at 2 minutes but continues waiting through a stream stall', () => {
    const session = createV8EcgSession('senior-1', null, null, 1_000);
    session.phase = 'measuring';

    expect(shouldAutoFinishEcg(session, 120_999)).toBe(false);
    expect(shouldAutoFinishEcg(session, 121_000)).toBe(true);

    session.samples = [1, 2, 3];
    session.lastSampleAt = 10_000;
    expect(isEcgStreamStalled(session, 13_999)).toBe(false);
    expect(isEcgStreamStalled(session, 14_000)).toBe(true);
    expect(shouldAutoFinishEcg(session, 14_000)).toBe(false);
  });

  it('supports the 30-second contact ECG recording limit', () => {
    const session = createV8EcgSession('senior-1', null, null, 1_000, 'ecg');
    session.phase = 'measuring';

    expect(shouldAutoFinishEcg(session, 30_999, 30_000)).toBe(false);
    expect(shouldAutoFinishEcg(session, 31_000, 30_000)).toBe(true);
  });

  it('splits a recording into consecutive report strips without losing samples', () => {
    const strips = splitWaveformIntoStrips([0, 1, 2, 3, 4, 5, 6, 7], 3);

    expect(strips).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7],
    ]);
    expect(strips.flat()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
