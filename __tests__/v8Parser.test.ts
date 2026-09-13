import { parseV8Payload } from '../src/v8/parser';
import { parseMeasurementTimestamp } from '../src/utils/sampleDay';

describe('parseV8Payload', () => {
  it.each(['ios', 'android'] as const)('keeps only samples between midnight and read time on %s, including a record spanning midnight', platform => {
    const startMs = parseMeasurementTimestamp('2026-09-13 00:00:00')!;
    const endMs = parseMeasurementTimestamp('2026-09-13 12:00:00')!;
    const history = parseV8Payload({ dataType: platform === 'ios' ? '28' : '27', dataEnd: false,
      dicData: [
        { date: '2026.09.13 12:00:05', arrayHR: [200, 200] },
        { date: '2026.09.13 11:59:55', arrayHR: [70, 71, 72] },
        { date: '2026.09.12 23:59:55', arrayHR: [60, 61, 62] },
        { date: '2026.08.04 19:36:03', arrayHR: Array(15).fill(180) },
      ],
    }, platform, { startMs, endMs }).history!;
    expect(history.entries.map(entry => [parseMeasurementTimestamp(entry.timestamp), entry.heartRate])).toEqual([
      [endMs - 5000, 70], [endMs, 71], [startMs, 61], [startMs + 5000, 62],
    ]);
    expect(history.diagnostics).toMatchObject({ receivedRecords: 4, extractedSamples: 4, rejectedRecords: 0 });
    expect(history.recordRanges).toHaveLength(4);
  });
  it.each(['android', 'ios'] as const)('reads the %s SDK clock without replacing it with history timestamps', platform => {
    expect(parseV8Payload({ dataType: '0', dicData: { strDeviceTime: '2026-09-12 22:37:00' } }, platform).infoPatch.deviceTime)
      .toBe('2026-09-12 22:37:00');
    expect(parseV8Payload({ dataType: '28', dicData: { dateTime: '2026-09-11 12:00:00' } }, platform).infoPatch.deviceTime)
      .toBeNull();
  });
  it('reads the iOS SDK strMac field used by the MAC response', () => {
    const { infoPatch } = parseV8Payload(
      {
        dataType: '10',
        dataEnd: true,
        dicData: { strMac: 'AA:BB:CC:DD:EE:FF' },
      },
      'ios',
    );

    expect(infoPatch.mac).toBe('AA:BB:CC:DD:EE:FF');
  });

  it.each(['ios', 'android'] as const)(
    'reads the %s SDK deviceVersion field used by the version response',
    platform => {
      // Android ResolveUtil.getDeviceVersion and the iOS demo both read
      // dicData["deviceVersion"] for GetDeviceVersion (dataType 11).
      const { infoPatch } = parseV8Payload(
        { dataType: '11', dataEnd: true, dicData: { deviceVersion: '1.0.2.5' } },
        platform,
      );

      expect(infoPatch.firmwareVersion).toBe('1.0.2.5');
    },
  );

  it('reads the Android SDK deviceName field used by the name response', () => {
    // ResolveUtil.getDeviceName answers CMD_Get_Name (117) with dicData.deviceName.
    const { infoPatch } = parseV8Payload(
      { dataType: '117', dataEnd: true, dicData: { deviceName: 'JCV8B' } },
      'android',
    );

    expect(infoPatch.deviceName).toBe('JCV8B');
  });

  it('maps iOS manual-HRV type 59 to HRV rather than temperature', () => {
    const { history } = parseV8Payload(
      {
        dataType: '59',
        dataEnd: true,
        dicData: { heartRate: 101, hrv: 55 },
      },
      'ios',
    );

    expect(history?.dataType).toBe('hrv');
    expect(history?.entries[0]).toEqual(
      expect.objectContaining({ heartRate: 101, hrv: 55 }),
    );
  });

  it('maps Android AutoHRV type 73 to HRV', () => {
    const { history } = parseV8Payload(
      {
        dataType: '73',
        dataEnd: true,
        dicData: { heartRate: 96, hrv: 61 },
      },
      'android',
    );

    expect(history?.dataType).toBe('hrv');
    expect(history?.entries[0]?.heartRate).toBe(96);
  });

  it('keeps Android measurement callbacks separated by SDK type', () => {
    expect(
      parseV8Payload(
        { dataType: '74', dataEnd: true, dicData: { heartRate: 82 } },
        'android',
      ).history?.dataType,
    ).toBe('staticHR');
    expect(
      parseV8Payload(
        { dataType: '75', dataEnd: true, dicData: { Blood_oxygen: 97 } },
        'android',
      ).history?.dataType,
    ).toBe('spo2');
  });

  it('parses iOS nested dicData arrays for activity, spo2, and BP/HRV records', () => {
    const payload = {
      dataType: 'DetailActivityData_V8',
      dataEnd: true,
      dicData: {
        arrayDetailActivityData: [
          {
            date: '2026.05.08 10:10:10',
            step: 1234,
            distance: 1.23,
            calories: 45.6,
          },
        ],
        arrayAutomaticSpo2Data: [
          { date: '2026.05.08 10:20:00', automaticSpo2Data: 97 },
        ],
        arrayAutomaticHRVData: [
          {
            date: '2026.05.08 10:40:00',
            systolicBP: 121,
            diastolicBP: 79,
            hrv: 96,
            stress: 28,
          },
        ],
      },
    };

    const { history } = parseV8Payload(payload as any);
    expect(history).not.toBeNull();

    const entries = history?.entries ?? [];
    expect(
      entries.some(entry => entry.steps === 1234 && entry.distanceKm === 1.23),
    ).toBe(true);
    expect(entries.some(entry => entry.spo2 === 97)).toBe(true);
    expect(
      entries.some(
        entry => entry.systolicBp === 121 && entry.diastolicBp === 79,
      ),
    ).toBe(true);
  });

  it('normalizes total activity payload and maps total activity fields', () => {
    const payload = {
      dataType: '25',
      dataEnd: true,
      dicData: {
        arrayTotalActivityData: [
          {
            date: '2026.05.09',
            step: 7654,
            distance: 5.8,
            calories: 320,
            exerciseMinutes: 64,
            activeMinutes: 22,
            goal: 76,
          },
        ],
      },
    };

    const { history } = parseV8Payload(payload as any);
    expect(history?.dataType).toBe('totalActivity');
    const entry = history?.entries[0];
    expect(entry?.steps).toBe(7654);
    expect(entry?.distanceKm).toBe(5.8);
    expect(entry?.caloriesKcal).toBe(320);
    expect(entry?.exerciseMinutes).toBe(64);
    expect(entry?.activeMinutes).toBe(22);
    expect(entry?.goalPercent).toBe(76);
  });

  it('parses stringified dictionary records used by android payloads', () => {
    const payload = {
      dataType: 'spo2',
      dataEnd: true,
      dicData:
        '{date=2026.05.08 10:20:00, automaticSpo2Data=98, step=345, distance=0.27}',
    };

    const { history } = parseV8Payload(payload as any);
    expect(history).not.toBeNull();
    expect(history?.entries[0].spo2).toBe(98);
    expect(history?.entries[0].steps).toBe(345);
    expect(history?.entries[0].distanceKm).toBe(0.27);
  });

  it('parses android Blood_oxygen payloads into spo2 values', () => {
    const payload = {
      dataType: '75',
      dataEnd: true,
      dicData: {
        Blood_oxygen: 96,
        step: 1200,
        distance: 0.9,
      },
    };

    const { history } = parseV8Payload(payload as any);
    expect(history).not.toBeNull();
    expect(history?.entries[0].spo2).toBe(96);
  });

  it('expands the Android SDK dynamic heart-rate series', () => {
    const payload = {
      dataType: '27',
      dataEnd: true,
      dicData: '[{date=2026.07.14 09:15:00, arrayDynamicHR=0 24 72 24}]',
    };

    const { history } = parseV8Payload(payload as any);
    expect(history?.dataType).toBe('dynamicHR');
    expect(history?.entries.map(entry => entry.heartRate)).toEqual([
      0, 24, 72, 24,
    ]);
    expect(history?.entries[0].timestamp).toBe('2026.07.14 09:15:00');
    expect(history?.entries[1].timestamp).toBe('2026.07.14 09:15:05');
  });

  it('normalizes stringified Android HRV, BP, and stress history', () => {
    const payload = {
      dataType: '42',
      dataEnd: true,
      dicData:
        '[{date=2026.07.14 09:20:00, hrv=79, stress=59, highBP=118, lowBP=68, heartRate=72}]',
    };

    const { history } = parseV8Payload(payload as any);
    expect(history?.dataType).toBe('hrv');
    expect(history?.entries[0]).toMatchObject({
      heartRate: 72,
      hrv: 79,
      stress: 59,
      systolicBp: 118,
      diastolicBp: 68,
    });
  });

  it('parses Android temperature payload aliases', () => {
    const payload = {
      dataType: '59',
      dataEnd: true,
      dicData: {
        arrayTemperatureData: [
          {
            date: '2026.07.14 09:20:00',
            axillaryTemperature: '32.7',
          },
        ],
      },
    };

    const { history } = parseV8Payload(payload as any);
    expect(history?.dataType).toBe('temperature');
    expect(history?.entries[0].temperatureC).toBe(32.7);
  });
});

describe('SDK-shaped vitals regression cases', () => {
  it('reads Android detailMinterStep without rescaling SDK units', () => {
    const { history } = parseV8Payload(
      {
        dataType: '25',
        dicData: [
          {
            date: '2026.09.11 10:00:00',
            detailMinterStep: '200',
            calories: '12.34',
            distance: '1.23',
          },
        ],
      },
      'android',
    );
    expect(history?.entries[0]).toMatchObject({
      steps: 200,
      caloriesKcal: 12.34,
      distanceKm: 1.23,
      source: 'history',
    });
  });
  it('does not invent a record from count metadata', () => {
    const { history } = parseV8Payload(
      {
        dataType: '29',
        dicData: {
          count: 1,
          arraySingleHR: [{ date: '2026.09.11 10:00:00', heartRate: 72 }],
        },
      },
      'ios',
    );
    expect(history?.entries).toHaveLength(1);
  });
  it.each(['51', '54', '55', '70', '80', '255'])(
    'keeps iOS ECG/status callback %s out of vitals history',
    dataType => {
      expect(
        parseV8Payload(
          { dataType, dataEnd: true, dicData: { ECGHrValue: 72 } },
          'ios',
        ).history,
      ).toBeNull();
    },
  );
  it.each([
    ['25', 'totalActivity'],
    ['26', 'detailActivity'],
    ['28', 'dynamicHR'],
    ['29', 'staticHR'],
    ['41', 'hrv'],
    ['45', 'spo2'],
    ['48', 'temperature'],
  ])('maps empty iOS completion %s to %s', (dataType, type) => {
    expect(
      parseV8Payload({ dataType, dataEnd: true, dicData: [] }, 'ios').history,
    ).toMatchObject({
      dataType: type,
      source: 'history',
      completed: true,
      entries: [],
    });
  });
  it('distinguishes live SpO2 from a history completion', () => {
    expect(
      parseV8Payload(
        { dataType: '60', dataEnd: true, dicData: { spo2: 98 } },
        'ios',
      ).history,
    ).toMatchObject({ dataType: 'spo2', source: 'live' });
    expect(
      parseV8Payload({ dataType: '68', dataEnd: true, dicData: [] }, 'android')
        .history,
    ).toMatchObject({ dataType: 'spo2', source: 'history' });
  });
  it('spaces dynamic HR across midnight using five-second intervals', () => {
    const { history } = parseV8Payload(
      {
        dataType: '27',
        dicData: [{ date: '2026.09.10 23:59:55', arrayDynamicHR: '71 72 73' }],
      },
      'android',
    );
    expect(history?.entries.map(entry => entry.timestamp)).toEqual([
      '2026.09.10 23:59:55',
      '2026.09.11 00:00:00',
      '2026.09.11 00:00:05',
    ]);
    expect(new Set(history?.entries.map(entry => entry.receivedAt)).size).toBe(
      1,
    );
  });
});

describe('history parsing diagnostics', () => {
  it('expands the actual iOS inner arrayHR across midnight', () => {
    const { history } = parseV8Payload(
      {
        dataType: '28',
        dataEnd: true,
        dicData: {
          count: 1,
          arrayContinuousHR: [
            { date: '2026.09.10 23:59:55', arrayHR: [71, 72, 73] },
          ],
        },
      },
      'ios',
    );
    expect(history?.entries.map(s => [s.timestamp, s.heartRate])).toEqual([
      ['2026.09.10 23:59:55', 71],
      ['2026.09.11 00:00:00', 72],
      ['2026.09.11 00:00:05', 73],
    ]);
    expect(history?.diagnostics).toEqual({
      receivedRecords: 1,
      extractedSamples: 3,
      rejectedRecords: 0,
      invalidTimestampRecords: 0,
    });
  });

  it.each([[], {}, null, { arrayContinuousHR: [] }])(
    'recognizes an empty SDK completion: %j',
    dicData => {
      expect(
        parseV8Payload({ dataType: '28', dataEnd: true, dicData }, 'ios')
          .history,
      ).toMatchObject({
        entries: [],
        diagnostics: { receivedRecords: 0, rejectedRecords: 0 },
      });
    },
  );

  it.each([
    { unexpectedWrapper: [] },
    { arrayContinuousHR: null },
    { arrayContinuousHR: [{}] },
    { arrayContinuousHR: [null] },
    { arrayContinuousHR: [{ date: '2026.09.11', unknownHR: [70] }] },
    'not a decoded record',
  ])('does not confuse unknown data with empty history: %j', dicData => {
    const { history } = parseV8Payload(
      { dataType: '28', dataEnd: true, dicData },
      'ios',
    );
    expect(history?.entries).toEqual([]);
    expect(history?.diagnostics?.rejectedRecords).toBeGreaterThan(0);
  });

  it.each(['ios', 'android'] as const)(
    'counts mixed valid and rejected records on %s',
    platform => {
      const records = [
        { date: '2026.09.11 10:00:00', heartRate: 75 },
        { date: '2026.09.11 10:05:00', unknownHR: 80 },
        { date: '2026.02.30', heartRate: 70 },
      ];
      const { history } = parseV8Payload(
        {
          dataType: platform === 'ios' ? '29' : '28',
          dataEnd: true,
          dicData: platform === 'ios' ? { arraySingleHR: records } : records,
        },
        platform,
      );
      expect(history?.diagnostics).toEqual({
        receivedRecords: 3,
        extractedSamples: 1,
        rejectedRecords: 2,
        invalidTimestampRecords: 1,
      });
      expect(history?.entries[0].heartRate).toBe(75);
    },
  );

  it.each([
    { series: [70, 'bad', 72] },
    { series: [70, null, 72] },
    { series: '70 bad 72' },
  ])('keeps HR offsets for malformed series: %j', ({ series }) => {
    const { history } = parseV8Payload(
      {
        dataType: '28',
        dataEnd: true,
        dicData: {
          arrayContinuousHR: [{ date: '2026.09.11 10:00:00', arrayHR: series }],
        },
      },
      'ios',
    );
    expect(history?.entries.map(s => [s.timestamp, s.heartRate])).toEqual([
      ['2026.09.11 10:00:00', 70],
      ['2026.09.11 10:00:10', 72],
    ]);
    expect(history?.diagnostics?.rejectedRecords).toBe(1);
  });

  it('keeps Android missing active minutes null even when exercise minutes exist', () => {
    expect(
      parseV8Payload(
        {
          dataType: '24',
          dataEnd: true,
          dicData: [{ date: '2026.09.11', step: '0', exerciseMinutes: '25' }],
        },
        'android',
      ).history?.entries[0],
    ).toMatchObject({
      steps: 0,
      exerciseMinutes: 25,
      activeMinutes: null,
    });
  });
});
