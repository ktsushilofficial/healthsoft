import type { SeniorDashboardDeviceRecord } from '../types/seniorDashboard';

function readPath(record: SeniorDashboardDeviceRecord, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(record, path)) {
    return record[path];
  }

  return path.split('.').reduce<unknown>((value, segment) => {
    if (value == null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, record);
}

function readText(
  record: SeniorDashboardDeviceRecord | null | undefined,
  paths: readonly string[],
  allowNumber = false,
): string {
  if (!record) return '';

  for (const path of paths) {
    const value = readPath(record, path);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (allowNumber && typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return '';
}

/** Returns the backend UUID used by device-specific APIs such as position streaming. */
export function getDashboardDeviceUuid(
  record: SeniorDashboardDeviceRecord | null | undefined,
): string {
  return readText(record, ['device.uuid', 'deviceUUID', 'deviceUuid']);
}

/** Returns the pendant IMEI, with `ident` retained as the legacy API fallback. */
export function getDashboardDeviceImei(
  record: SeniorDashboardDeviceRecord | null | undefined,
): string {
  return readText(
    record,
    ['imei', 'ident', 'device.imei', 'deviceImei', 'imeiNumber'],
    true,
  );
}

export function dashboardDeviceIdentityMatches(
  record: SeniorDashboardDeviceRecord,
  identity: { deviceUuid?: string | null; imei?: string | null },
): boolean {
  const expectedUuid = identity.deviceUuid?.trim().toLowerCase() ?? '';
  const expectedImei = identity.imei?.trim().toLowerCase() ?? '';
  const recordUuid = getDashboardDeviceUuid(record).toLowerCase();
  const recordImei = getDashboardDeviceImei(record).toLowerCase();

  if (expectedUuid && recordUuid) return recordUuid === expectedUuid;
  return !!expectedImei && recordImei === expectedImei;
}
