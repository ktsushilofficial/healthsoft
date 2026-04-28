import { formatDistanceToNow } from 'date-fns';
import { mapSeniorDashboardDeviceToSnapshot } from '../src/utils/mapSeniorDashboardDeviceToSnapshot';

describe('mapSeniorDashboardDeviceToSnapshot', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-28T16:00:00.000Z'));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test('uses source-specific timestamps for battery, location, and alarms', () => {
    const record = {
      batteryLevel: 90,
      batteryChargingStatus: false,
      movementStatus: false,
      positionLatitude: 12.996803,
      positionLongitude: 80.260215,
      serverTimestamp: Date.parse('2026-04-28T15:55:00.000Z'),
      timestamp: Math.floor(Date.parse('2026-04-28T15:54:30.000Z') / 1000),
      'battery.server.timestamp': Date.parse('2026-04-28T14:00:00.000Z'),
      'battery.timestamp': Math.floor(Date.parse('2026-04-28T14:00:00.000Z') / 1000),
      'position.server.timestamp': Date.parse('2026-04-28T15:30:00.000Z'),
      'position.timestamp': Math.floor(Date.parse('2026-04-28T15:29:30.000Z') / 1000),
      'alarm.server.timestamp': Date.parse('2026-04-28T13:00:00.000Z'),
      'alarm.timestamp': Math.floor(Date.parse('2026-04-28T12:59:30.000Z') / 1000),
    };

    const snapshot = mapSeniorDashboardDeviceToSnapshot(record);

    expect(snapshot.batteryUpdatedLabel).toBe(
      formatDistanceToNow(new Date('2026-04-28T14:00:00.000Z'), { addSuffix: true }),
    );
    expect(snapshot.locationUpdatedLabel).toBe(
      formatDistanceToNow(new Date('2026-04-28T15:30:00.000Z'), { addSuffix: true }),
    );
    expect(snapshot.lastAlarmAt).toBe(
      formatDistanceToNow(new Date('2026-04-28T13:00:00.000Z'), { addSuffix: true }),
    );
    expect(snapshot.lastUpdatedLabel).toBe(
      formatDistanceToNow(new Date('2026-04-28T15:55:00.000Z'), { addSuffix: true }),
    );
  });
});
