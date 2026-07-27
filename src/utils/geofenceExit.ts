import type { GeofenceExitApiResponse } from '../types/geofenceExit';

export type GeofenceCoordinate = {
  latitude: number;
  longitude: number;
};

function isCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180
  );
}

export function isActiveGeofenceExit(
  response: GeofenceExitApiResponse | null | undefined,
): boolean {
  if (!response?.ticket || !response.geofenceAlarm) return false;

  return (
    response.ticket.alertType?.trim().toUpperCase() === 'GEOFENCE_EXIT' &&
    response.ticket.status?.trim().toUpperCase() === 'OPEN' &&
    response.geofenceAlarm.isResolved === false
  );
}

export function getGeofenceExitCoordinate(
  response: GeofenceExitApiResponse | null | undefined,
): GeofenceCoordinate | null {
  const latitude = response?.geofenceAlarm?.['position.latitude'];
  const longitude = response?.geofenceAlarm?.['position.longitude'];
  return isCoordinate(latitude, longitude) ? { latitude: latitude!, longitude: longitude! } : null;
}

export function getGeofenceLatestCoordinate(
  response: GeofenceExitApiResponse | null | undefined,
): GeofenceCoordinate | null {
  const position = response?.latestPosition;
  const latitude = position?.positionLatitude;
  const longitude = position?.positionLongitude;
  if (position?.positionValid === false || !isCoordinate(latitude, longitude)) return null;
  return { latitude: latitude!, longitude: longitude! };
}

export function formatGeofenceRaisedAt(
  response: GeofenceExitApiResponse | null | undefined,
): string | null {
  const raw =
    response?.ticket?.raisedAt ??
    response?.geofenceAlarm?.timestamp ??
    response?.geofenceAlarm?.createdAt;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return null;

  const milliseconds = raw > 1e12 ? raw : raw * 1000;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}
