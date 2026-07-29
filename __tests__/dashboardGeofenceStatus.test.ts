import {
  formatDashboardGeofenceValue,
  getDashboardGeofenceStatus,
} from '../src/utils/dashboardGeofenceStatus';

describe('dashboard geofence status', () => {
  it('detects active alarms from dashboard camel-case fields', () => {
    expect(
      getDashboardGeofenceStatus({
        geofenceAlarm1: true,
        geofenceAlarm2: false,
        geofenceStatus1: true,
        geofenceStatus2: false,
      }),
    ).toEqual(
      expect.objectContaining({
        alarm1: true,
        alarm2: false,
        hasData: true,
        hasActiveAlarm: true,
        summary: 'Alarm detected',
      }),
    );
  });

  it('keeps null alarm values distinct from a clear alarm', () => {
    expect(
      getDashboardGeofenceStatus({
        geofenceAlarm1: null,
        geofenceAlarm2: null,
        geofenceStatus1: false,
        geofenceStatus2: false,
        geofenceStatus3: false,
        geofenceStatus4: false,
      }),
    ).toEqual(
      expect.objectContaining({
        hasData: true,
        hasActiveAlarm: false,
        summary: 'Not reported',
        statuses: [false, false, false, false],
      }),
    );
  });

  it('supports dotted backend aliases and display formatting', () => {
    const result = getDashboardGeofenceStatus({
      'geofence.alarm.2': false,
      'geofence.status.4': true,
    });

    expect(result.alarm2).toBe(false);
    expect(result.statuses[3]).toBe(true);
    expect(result.summary).toBe('No active alarm');
    expect(formatDashboardGeofenceValue(null, 'Triggered', 'Clear')).toBe(
      'Not reported',
    );
  });
});
