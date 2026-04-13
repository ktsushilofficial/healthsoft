import { formatDistanceToNow } from 'date-fns';
import type { SeniorHomeSnapshot } from '../types/seniorHomeSnapshot';
import type { SeniorDashboardDeviceRecord } from '../types/seniorDashboard';

function pickNumber(record: SeniorDashboardDeviceRecord, key: string): number | undefined {
  const v = record[key];
  if (typeof v === 'number' && !Number.isNaN(v)) {
    return v;
  }
  return undefined;
}

function pickBoolean(record: SeniorDashboardDeviceRecord, key: string): boolean | undefined {
  const v = record[key];
  return typeof v === 'boolean' ? v : undefined;
}

function pickString(record: SeniorDashboardDeviceRecord, key: string): string | undefined {
  const v = record[key];
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}

function firstDefinedLatLon(
  record: SeniorDashboardDeviceRecord,
  latKeys: string[],
  lonKeys: string[],
): { lat: number; lon: number } | null {
  for (let i = 0; i < latKeys.length; i += 1) {
    const lat = pickNumber(record, latKeys[i]!);
    const lon = pickNumber(record, lonKeys[i]!);
    if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon };
    }
  }
  return null;
}

function resolveTimestampSeconds(record: SeniorDashboardDeviceRecord): number | undefined {
  const serverTs = pickNumber(record, 'server.timestamp') ?? pickNumber(record, 'serverTimestamp');
  if (serverTs != null && serverTs > 1_000_000_000) {
    return serverTs > 1e12 ? serverTs / 1000 : serverTs;
  }
  const ts = pickNumber(record, 'timestamp');
  if (ts != null && ts > 1_000_000_000) {
    return ts > 1e12 ? ts / 1000 : ts;
  }
  const keyTs = pickNumber(record, 'timestamp.key');
  if (keyTs != null && keyTs > 1_000_000_000) {
    return keyTs > 1e12 ? keyTs / 1000 : keyTs;
  }
  return undefined;
}

function formatLastUpdated(record: SeniorDashboardDeviceRecord): string | null {
  const sec = resolveTimestampSeconds(record);
  if (sec == null) {
    return null;
  }
  try {
    return formatDistanceToNow(new Date(sec * 1000), { addSuffix: true });
  } catch {
    return null;
  }
}

function buildNetworkLabel(record: SeniorDashboardDeviceRecord): string | null {
  const gsmType = pickString(record, 'gsm.network.type') ?? pickString(record, 'gsmNetworkType');
  const dbm = pickNumber(record, 'gsm.signal.dbm') ?? pickNumber(record, 'gsmSignalDbm');
  const wifiOn = pickBoolean(record, 'wifi.status') ?? pickBoolean(record, 'wifiStatus');
  const parts: string[] = [];
  if (gsmType) {
    parts.push(dbm != null ? `${gsmType} · ${dbm} dBm` : gsmType);
  } else if (dbm != null) {
    parts.push(`Cell · ${dbm} dBm`);
  }
  if (wifiOn) {
    parts.push('Wi‑Fi on');
  }
  const locGps = pickBoolean(record, 'location.source.gps') ?? pickBoolean(record, 'agpsPositionValid');
  const locWifi = pickBoolean(record, 'location.source.wifi');
  const locGsm = pickBoolean(record, 'location.source.gsm');
  const locBt = pickBoolean(record, 'location.source.bluetooth') ?? pickBoolean(record, 'bluetoothConnectedStatus');
  const sources: string[] = [];
  if (locGps) sources.push('GPS');
  if (locWifi) sources.push('Wi‑Fi');
  if (locGsm) sources.push('GSM');
  if (locBt) sources.push('Bluetooth');
  if (sources.length) {
    parts.push(`Loc: ${sources.join(' + ')}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function inferAlarm(record: SeniorDashboardDeviceRecord): Pick<
  SeniorHomeSnapshot,
  'primaryAlarmLabel' | 'alarmDetail' | 'alarmSeverity' | 'lastAlarmKind' | 'lastAlarmAt'
> {
  const fall = pickBoolean(record, 'fall.alarm.status') ?? pickBoolean(record, 'fallAlarmStatus');
  const movement = pickBoolean(record, 'movement.status') ?? pickBoolean(record, 'movementStatus');

  if (fall === undefined && movement === undefined) {
    return {
      primaryAlarmLabel: null,
      alarmDetail: null,
      alarmSeverity: 'na',
      lastAlarmKind: null,
      lastAlarmAt: formatLastUpdated(record),
    };
  }

  if (fall === true) {
    return {
      primaryAlarmLabel: 'Fall reported',
      alarmDetail: 'Device reported a fall signal on the latest packet.',
      alarmSeverity: 'critical',
      lastAlarmKind: 'Fall sensor',
      lastAlarmAt: formatLastUpdated(record),
    };
  }
  if (movement === true) {
    return {
      primaryAlarmLabel: 'Movement detected',
      alarmDetail: 'Recent movement activity reported by the device.',
      alarmSeverity: 'info',
      lastAlarmKind: 'Movement',
      lastAlarmAt: formatLastUpdated(record),
    };
  }
  return {
    primaryAlarmLabel: 'All clear',
    alarmDetail: 'No panic or fall signals on the latest packet.',
    alarmSeverity: 'ok',
    lastAlarmKind: 'Status',
    lastAlarmAt: formatLastUpdated(record),
  };
}

/**
 * Maps one dashboard device row into the home card snapshot shape.
 */
export function mapSeniorDashboardDeviceToSnapshot(
  record: SeniorDashboardDeviceRecord,
): SeniorHomeSnapshot {
  const batteryRaw = pickNumber(record, 'battery.level') ?? pickNumber(record, 'batteryLevel');
  const batteryPercent =
    batteryRaw != null ? Math.max(0, Math.min(100, Math.round(batteryRaw))) : null;
  const chargingPick =
    pickBoolean(record, 'battery.charging.status') ?? pickBoolean(record, 'batteryChargingStatus');
  const charging = chargingPick !== undefined ? chargingPick : null;

  const coords =
    firstDefinedLatLon(
      record,
      ['position.latitude', 'positionLatitude', 'latitude', 'gnss.latitude', 'gps.latitude'],
      ['position.longitude', 'positionLongitude', 'longitude', 'gnss.longitude', 'gps.longitude'],
    );

  const speedRaw =
    pickNumber(record, 'speed.kph') ?? pickNumber(record, 'positionSpeed') ?? pickNumber(record, 'speed');
  const speedKph = speedRaw != null ? Math.max(0, speedRaw) : null;

  const hdop =
    pickNumber(record, 'hdop') ?? pickNumber(record, 'positionHdop') ?? pickNumber(record, 'gnss.hdop') ?? null;
  const satellites =
    pickNumber(record, 'satellites') ??
    pickNumber(record, 'positionSatellites') ??
    pickNumber(record, 'gnss.satellites') ??
    null;

  const alarm = inferAlarm(record);

  return {
    batteryPercent,
    charging,
    networkLabel: buildNetworkLabel(record),
    lastUpdatedLabel: formatLastUpdated(record),
    latitude: coords?.lat ?? null,
    longitude: coords?.lon ?? null,
    speedKph,
    hdop,
    satellites,
    ...alarm,
  };
}

export function getSeniorDashboardDeviceLabel(record: SeniorDashboardDeviceRecord): string {
  const name = pickString(record, 'device.name') ?? pickString(record, 'deviceName');
  const ident = pickString(record, 'ident') ?? pickString(record, 'imei');
  const devId = pickNumber(record, 'device.id') ?? pickNumber(record, 'deviceId');
  if (name && ident && name !== ident) {
    return `${name} (${ident})`;
  }
  if (name) return name;
  if (ident) return ident;
  if (devId != null) return `Device ${devId}`;
  return 'NA';
}
