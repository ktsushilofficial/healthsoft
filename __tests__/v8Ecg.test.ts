import {
  createV8EcgSession,
  downsampleEcg,
  parseV8EcgPayload,
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

  it('parses Android real-time ECG packets emitted as PPG raw data', () => {
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
    );

    expect(event.kind).toBe('samples');
    expect(event.samples).toEqual([8451200, 8451456, 8450944, 8451712]);
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
        phase: 'starting',
        startedAt: 1000,
        samples: [],
        deviceMac: 'AA:BB:CC:DD:EE:FF',
        firmwareVersion: '1.2.3',
      }),
    );
  });

  it('downsamples long waveforms while retaining the requested size', () => {
    expect(
      downsampleEcg(
        Array.from({ length: 100 }, (_, index) => index),
        10,
      ),
    ).toHaveLength(10);
  });
});
