import { parseV8Payload } from '../src/v8/parser';

describe('parseV8Payload', () => {
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
        arrayAutomaticSpo2Data: [{ date: '2026.05.08 10:20:00', automaticSpo2Data: 97 }],
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
    expect(entries.some(entry => entry.steps === 1234 && entry.distanceKm === 1.23)).toBe(true);
    expect(entries.some(entry => entry.spo2 === 97)).toBe(true);
    expect(entries.some(entry => entry.systolicBp === 121 && entry.diastolicBp === 79)).toBe(true);
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
      dicData: '{date=2026.05.08 10:20:00, automaticSpo2Data=98, step=345, distance=0.27}',
    };

    const { history } = parseV8Payload(payload as any);
    expect(history).not.toBeNull();
    expect(history?.entries[0].spo2).toBe(98);
    expect(history?.entries[0].steps).toBe(345);
    expect(history?.entries[0].distanceKm).toBe(0.27);
  });

  it('parses android Blood_oxygen payloads into spo2 values', () => {
    const payload = {
      dataType: '2',
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
    expect(history?.entries.map(entry => entry.heartRate)).toEqual([0, 24, 72, 24]);
    expect(history?.entries[0].timestamp).toBe('2026.07.14 09:15:00');
    expect(history?.entries[1].timestamp).toBe('2026.07.14 09:15:01');
  });

  it('normalizes stringified Android HRV, BP, and stress history', () => {
    const payload = {
      dataType: '42',
      dataEnd: true,
      dicData: '[{date=2026.07.14 09:20:00, hrv=79, stress=59, highBP=118, lowBP=68, heartRate=72}]',
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
