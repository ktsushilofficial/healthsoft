import { formatDistanceToNow } from 'date-fns';
import {
  getSeniorDashboardActivityAnalysis,
  getSeniorDashboardEnvironmentAnalysis,
  mapSeniorDashboardDeviceToSnapshot,
} from '../src/utils/mapSeniorDashboardDeviceToSnapshot';

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

  test('does not present a status-event timestamp as a location or alarm time', () => {
    const record = {
      batteryLevel: 1,
      movementStatus: false,
      fallAlarmStatus: false,
      timestamp: 1786810991,
      serverTimestamp: 1786811003.840046,
    };

    const snapshot = mapSeniorDashboardDeviceToSnapshot(record);

    expect(snapshot.locationUpdatedLabel).toBeNull();
    expect(snapshot.lastAlarmAt).toBeNull();
    expect(snapshot.lastUpdatedLabel).not.toBeNull();
    expect(snapshot.batteryUpdatedLabel).not.toBeNull();
  });

  test('derives activity and environment labels from the matching telemetry fields', () => {
    expect(getSeniorDashboardActivityAnalysis({ movementStatus: true })).toEqual(
      expect.objectContaining({ label: 'Active' }),
    );
    expect(getSeniorDashboardActivityAnalysis({ speed: 9 })).toEqual(
      expect.objectContaining({ label: 'In Transit' }),
    );

    expect(getSeniorDashboardEnvironmentAnalysis({ wifiHomeStatus: true })).toEqual(
      expect.objectContaining({ label: 'At Home' }),
    );
    expect(getSeniorDashboardEnvironmentAnalysis({ indoorStatus: true })).toEqual(
      expect.objectContaining({ label: 'Indoors' }),
    );
    expect(getSeniorDashboardEnvironmentAnalysis({ 'location.source.gps': true })).toEqual(
      expect.objectContaining({ label: 'Outdoors' }),
    );
    expect(getSeniorDashboardEnvironmentAnalysis({})).toEqual(
      expect.objectContaining({ label: 'Unknown' }),
    );
  });
});
