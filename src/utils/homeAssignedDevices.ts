import type { SeniorDashboardDeviceRecord } from '../types/seniorDashboard';
import {
  getAssignedHandBandMacAddress,
  isPillDispenserAssignedDevice,
  type SeniorAssignedDevice,
} from './deviceAssignments';
import {
  dashboardDeviceIdentityMatches,
  getDashboardDeviceUuid,
} from './dashboardDeviceIdentity';
import { isKnownPendantName } from '../bluetooth/pendantDeviceFilter';
import { mapSeniorDashboardDeviceToSnapshot } from './mapSeniorDashboardDeviceToSnapshot';

export type HomeAssignedDevice = {
  key: string;
  kind: 'pendant' | 'band' | 'pillDispenser' | 'other';
  name: string;
  identifier: string | null;
  deviceUuid: string | null;
  imei: string | null;
  status: string;
  alarmLabel: string | null;
  batteryPercent: number | null;
  charging: boolean | null;
};

function displayStatus(value: string): string {
  return value
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function deviceKind(device: SeniorAssignedDevice): HomeAssignedDevice['kind'] {
  if (isPillDispenserAssignedDevice(device)) return 'pillDispenser';
  const type = device.deviceType?.toUpperCase() ?? '';
  if (
    type.includes('PENDANT') ||
    isKnownPendantName(type) ||
    isKnownPendantName(device.name)
  )
    return 'pendant';
  if (type.includes('BAND') || getAssignedHandBandMacAddress(device))
    return 'band';
  // Legacy pendant assignments identify the device by IMEI without a type.
  if (!type && (device.imei || /^\d{15}$/.test(device.deviceIdentifier ?? '')))
    return 'pendant';
  return 'other';
}

function telemetryStatus(
  row: SeniorDashboardDeviceRecord | undefined,
): string | null {
  if (!row) return null;
  for (const key of ['status', 'deviceStatus', 'device.status']) {
    const value = row[key];
    if (typeof value === 'string' && value.trim()) return displayStatus(value);
  }
  const moving = row.movementStatus ?? row['movement.status'];
  return typeof moving === 'boolean'
    ? moving
      ? 'Active'
      : 'Stationary'
    : null;
}

/** Assignments own list membership; telemetry can only enrich a matching device. */
export function buildHomeAssignedDevices(
  assignments: SeniorAssignedDevice[],
  dashboardDevices: SeniorDashboardDeviceRecord[],
  connectedBandMacs: readonly string[] = [],
): HomeAssignedDevice[] {
  const seen = new Set<string>();
  const rows: HomeAssignedDevice[] = [];
  for (const device of assignments) {
    const key = (
      device.deviceId ??
      device.imei ??
      device.deviceIdentifier ??
      device.id
    )
      .trim()
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = deviceKind(device);
    const imei =
      device.imei ?? (kind === 'pendant' ? device.deviceIdentifier : null);
    const uuid = device.deviceId?.trim().toLowerCase();
    const exact = uuid
      ? dashboardDevices.find(
          row => getDashboardDeviceUuid(row).toLowerCase() === uuid,
        )
      : undefined;
    const fallback = dashboardDevices.filter(row =>
      dashboardDeviceIdentityMatches(row, {
        deviceUuid: device.deviceId,
        imei,
      }),
    );
    const telemetry =
      exact ?? (fallback.length === 1 ? fallback[0] : undefined);
    const snapshot = telemetry
      ? mapSeniorDashboardDeviceToSnapshot(telemetry)
      : null;
    const bandMac =
      kind === 'band' ? getAssignedHandBandMacAddress(device) : null;
    const connected = !!bandMac && connectedBandMacs.includes(bandMac);
    const defaultName =
      kind === 'band'
        ? 'Smart Band'
        : kind === 'pillDispenser'
        ? 'Pill Dispenser'
        : kind === 'pendant'
        ? 'Pendant'
        : device.deviceType
        ? displayStatus(device.deviceType)
        : 'Device';
    rows.push({
      key,
      kind,
      name: device.name ?? defaultName,
      identifier:
        device.serialNumber ??
        device.imei ??
        device.deviceIdentifier ??
        device.barcode ??
        device.deviceId,
      deviceUuid: device.deviceId,
      imei,
      status: connected
        ? 'Connected'
        : telemetryStatus(telemetry) ??
          (device.status ? displayStatus(device.status) : 'Assigned'),
      batteryPercent: snapshot?.batteryPercent ?? null,
      charging: snapshot?.charging ?? null,
      alarmLabel:
        snapshot?.alarmSeverity === 'critical'
          ? snapshot.primaryAlarmLabel
          : null,
    });
  }
  return rows;
}
