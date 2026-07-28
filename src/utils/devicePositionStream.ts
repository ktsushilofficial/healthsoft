import type { DevicePositionUpdate } from '../types/devicePosition';

export const canAccessPendantTracking = (
  role: string | null | undefined,
): boolean => role === 'CARE_TAKER' || role === 'GUARDIAN';

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readFiniteNumber = (
  record: Record<string, unknown>,
  keys: string[],
): number | null => {
  for (const key of keys) {
    const value = record[key];
    const number =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim().length > 0
          ? Number(value)
          : Number.NaN;
    if (Number.isFinite(number)) return number;
  }
  return null;
};

const readBoolean = (
  record: Record<string, unknown>,
  keys: string[],
): boolean | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
  }
  return null;
};

/**
 * Accepts the direct position DTO as well as common stream wrappers used by
 * Spring SSE endpoints (`data`, `position`, or `latestPosition`).
 */
export function parseDevicePositionUpdate(
  payload: unknown,
): DevicePositionUpdate | null {
  const root = asRecord(payload);
  if (!root) return null;

  const candidates: Record<string, unknown>[] = [root];
  for (const key of ['data', 'position', 'latestPosition', 'payload']) {
    const nested = asRecord(root[key]);
    if (nested) candidates.unshift(nested);
  }

  for (const record of candidates) {
    const latitude = readFiniteNumber(record, [
      'positionLatitude',
      'position.latitude',
      'latitude',
      'lat',
    ]);
    const longitude = readFiniteNumber(record, [
      'positionLongitude',
      'position.longitude',
      'longitude',
      'lon',
      'lng',
    ]);
    if (
      latitude == null ||
      longitude == null ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      continue;
    }

    return {
      latitude,
      longitude,
      altitude: readFiniteNumber(record, [
        'positionAltitude',
        'position.altitude',
        'altitude',
      ]),
      direction: readFiniteNumber(record, [
        'positionDirection',
        'position.direction',
        'direction',
      ]),
      speed: readFiniteNumber(record, [
        'positionSpeed',
        'speed.kph',
        'speed',
      ]),
      hdop: readFiniteNumber(record, ['positionHdop', 'hdop']),
      satellites: readFiniteNumber(record, [
        'positionSatellites',
        'satellites',
      ]),
      timestamp: readFiniteNumber(record, ['timestamp', 'timestampKey']),
      serverTimestamp: readFiniteNumber(record, [
        'serverTimestamp',
        'server.timestamp',
      ]),
      positionValid: readBoolean(record, [
        'positionValid',
        'position.valid',
      ]),
      raw: record,
    };
  }

  return null;
}

export function parseSseEventBlock(block: string): unknown | null {
  const normalized = block.replace(/\r/g, '').trim();
  if (!normalized || normalized.startsWith(':')) return null;

  const dataLines = normalized
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart());
  const serialized =
    dataLines.length > 0 ? dataLines.join('\n').trim() : normalized;
  if (!serialized || serialized === '[DONE]') return null;

  try {
    return JSON.parse(serialized);
  } catch {
    return null;
  }
}
