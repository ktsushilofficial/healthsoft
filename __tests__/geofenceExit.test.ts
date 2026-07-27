import {
  formatGeofenceRaisedAt,
  getGeofenceExitCoordinate,
  getGeofenceLatestCoordinate,
  isActiveGeofenceExit,
} from '../src/utils/geofenceExit';
import type { GeofenceExitApiResponse } from '../src/types/geofenceExit';

const activeResponse: GeofenceExitApiResponse = {
  geofenceAlarm: {
    isResolved: false,
    timestamp: 1_785_373_289,
    'position.latitude': 28.612894,
    'position.longitude': 77.229463,
  },
  latestPosition: {
    positionLatitude: 28.612901,
    positionLongitude: 77.229471,
    positionValid: true,
  },
  ticket: {
    alertType: 'GEOFENCE_EXIT',
    severity: 'MEDIUM',
    status: 'OPEN',
    raisedAt: 1_785_373_289_000,
  },
};

describe('geofence exit helpers', () => {
  test('recognizes only open, unresolved geofence-exit tickets as active', () => {
    expect(isActiveGeofenceExit(activeResponse)).toBe(true);
    expect(
      isActiveGeofenceExit({
        ...activeResponse,
        ticket: { ...activeResponse.ticket, status: 'RESOLVED' },
      }),
    ).toBe(false);
    expect(
      isActiveGeofenceExit({
        ...activeResponse,
        geofenceAlarm: { ...activeResponse.geofenceAlarm, isResolved: true },
      }),
    ).toBe(false);
    expect(isActiveGeofenceExit(null)).toBe(false);
  });

  test('returns exit and latest coordinates when valid', () => {
    expect(getGeofenceExitCoordinate(activeResponse)).toEqual({
      latitude: 28.612894,
      longitude: 77.229463,
    });
    expect(getGeofenceLatestCoordinate(activeResponse)).toEqual({
      latitude: 28.612901,
      longitude: 77.229471,
    });
  });

  test('rejects invalid or explicitly invalid latest positions', () => {
    expect(
      getGeofenceExitCoordinate({
        geofenceAlarm: {
          'position.latitude': 120,
          'position.longitude': 77,
        },
      }),
    ).toBeNull();
    expect(
      getGeofenceLatestCoordinate({
        latestPosition: {
          positionLatitude: 28,
          positionLongitude: 77,
          positionValid: false,
        },
      }),
    ).toBeNull();
  });

  test('formats both millisecond and second timestamps', () => {
    const fromMilliseconds = formatGeofenceRaisedAt(activeResponse);
    const fromSeconds = formatGeofenceRaisedAt({
      geofenceAlarm: { timestamp: activeResponse.geofenceAlarm!.timestamp },
    });
    expect(fromMilliseconds).toBeTruthy();
    expect(fromSeconds).toBe(fromMilliseconds);
  });
});
