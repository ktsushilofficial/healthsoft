import { parseV8Payload } from '../src/v8/parser';

describe('parseV8Payload', () => {
  it('parses iOS nested dicData arrays for activity, spo2, and BP/HRV records', () => {
    const payload = {
      dataType: 'DetailActivityData_V8',
      dataEnd: true,
      dicData: {
        arrayDetailActivityData: [
          { date: '2026.05.08 10:10:10', step: 1234, distance: 1.23, calories: 45.6 },
        ],
        arrayAutomaticSpo2Data: [
          { date: '2026.05.08 10:20:00', automaticSpo2Data: 97 },
        ],
        arrayAutomaticHRVData: [
          { date: '2026.05.08 10:40:00', systolicBP: 121, diastolicBP: 79, hrv: 96, stress: 28 },
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
});
