import {
  createV8EcgSession,
  downsampleEcg,
  downsampleWaveformEnvelope,
  estimateObservedSampleRateHz,
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
    const event = parseV8EcgPayload({
      DataType: 'ECGResult',
      ECGResultVALUE: 'recording-complete',
      ECGHrValue: 68,
    });

    expect(event.kind).toBe('completed');
    expect(event.classification).toBe('recording-complete');
    expect(event.heartRate).toBe(68);
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
  });

  it('keeps Android protocol 0x07 samples labeled PPG in PPG mode', () => {
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

    expect(event.waveformSource).toBe('ppg');
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
    );

    expect(event.kind).toBe('samples');
    expect(event.samples).toEqual([1048572, 1048598, 1048611, 1048580]);
    expect(event.waveformSource).toBe('ppg');
    expect(event.waveformField).toBe('arrayPPGData');
    expect(event.dataType).toBe('70');
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
    const session = createV8EcgSession(
      'senior-1',
      null,
      null,
      1_000,
      'ecg',
    );
    session.phase = 'measuring';

    expect(shouldAutoFinishEcg(session, 30_999, 30_000)).toBe(false);
    expect(shouldAutoFinishEcg(session, 31_000, 30_000)).toBe(true);
  });

  it('splits a recording into consecutive report strips without losing samples', () => {
    const strips = splitWaveformIntoStrips([0, 1, 2, 3, 4, 5, 6, 7], 3);

    expect(strips).toEqual([[0, 1, 2], [3, 4, 5], [6, 7]]);
    expect(strips.flat()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});
