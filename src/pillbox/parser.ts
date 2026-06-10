import type { PillBoxAlarm, PillBoxConnectionState, PillBoxDevice, PillBoxMedicationEvent, PillBoxSnapshot } from './models';

function toText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return null;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => (item == null ? null : String(item).trim()))
      .filter((item): item is string => !!item);
  }
  const text = toText(value);
  if (!text) return [];
  return text
    .split(/[,\s]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeConnectionState(value: unknown): PillBoxConnectionState {
  const state = toText(value)?.toLowerCase();
  switch (state) {
    case 'connected':
    case 'datasynced':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'disconnecting':
      return 'disconnecting';
    case 'scanning':
      return 'scanning';
    case 'ready':
    case 'bluetoothready':
      return 'ready';
    case 'datasyncing':
      return 'dataSyncing';
    case 'unsupported':
    case 'bluetoothnone':
      return 'unsupported';
    case 'unauthorized':
      return 'unauthorized';
    case 'poweroff':
    case 'bluetoothpoweroff':
      return 'powerOff';
    case 'error':
      return 'error';
    case 'idle':
      return 'idle';
    case 'disconnected':
    default:
      return 'disconnected';
  }
}

export function normalizePillBoxDevice(payload: Record<string, unknown>): PillBoxDevice {
  const id = toText(payload.id) ?? toText(payload.mac) ?? toText(payload.deviceId) ?? '';
  return {
    id,
    name: toText(payload.name) ?? toText(payload.localName),
    localName: toText(payload.localName) ?? toText(payload.name),
    mac: toText(payload.mac) ?? toText(payload.id),
    rssi: toNumber(payload.rssi),
  };
}

function normalizeAlarm(payload: Record<string, unknown>): PillBoxAlarm {
  const repeatDays = toStringArray(
    payload.effectWeekdays ??
    payload.effect_time ??
    payload.effectTime ??
    payload.repeatDays ??
    payload.repeatArray,
  );
  return {
    alarmId: toText(payload.alarmId) ?? toText(payload.uid) ?? null,
    row: toNumber(payload.row),
    alarmTime: toText(payload.alarmTime) ?? toText(payload.alarm_time),
    remark: toText(payload.remark),
    status: toNumber(payload.status),
    enabled: toBoolean(payload.isOpen) ?? (toNumber(payload.status) != null ? toNumber(payload.status) === 1 : null),
    isRepeat: toNumber(payload.isRepeat) ?? toNumber(payload.repeat),
    effectWeekdays: repeatDays,
    deviceId: toText(payload.deviceId) ?? toText(payload.bluetoothMac) ?? null,
    drugCount: toNumber(payload.drugCount),
    drugNumCount: toNumber(payload.drugNumCount),
    hasImage: toBoolean(payload.hasImage),
    type: toText(payload.type),
    effectTime: toText(payload.effectTime) ?? toText(payload.effect_time),
  };
}

export function normalizePillBoxMedication(payload: Record<string, unknown>): PillBoxMedicationEvent {
  return {
    label: toText(payload.label),
    id: toText(payload.id) ?? toText(payload.uid),
    row: toNumber(payload.row),
    deviceMac: toText(payload.deviceMac) ?? toText(payload.mDevice_mac),
    alarmTime: toText(payload.alarmTime) ?? toText(payload.alarm_time),
    drugTime: toText(payload.drugTime) ?? toText(payload.drug_time),
    date: toText(payload.date),
    month: toText(payload.month),
    year: toText(payload.year),
    status: toNumber(payload.status),
    accessToken: toText(payload.accessToken) ?? toText(payload.access_token),
  };
}

export function normalizePillBoxSnapshot(payload: Record<string, unknown>): PillBoxSnapshot {
  const alarmsRaw =
    payload.alarms ??
    payload.alarm_clock ??
    payload.alarmClock ??
    payload.alarm ??
    payload.alarmData;
  const alarms = Array.isArray(alarmsRaw)
    ? alarmsRaw
        .map(item => (item && typeof item === 'object' ? normalizeAlarm(item as Record<string, unknown>) : null))
        .filter((item): item is PillBoxAlarm => item !== null)
    : [];

  const batterySource = payload.battery && typeof payload.battery === 'object'
    ? (payload.battery as Record<string, unknown>)
    : payload;

  const state = normalizeConnectionState(payload.state ?? payload.kind);
  const batteryLabel = toText(payload.batteryLabel) ?? toText(payload.battery_volume_label);

  return {
    state,
    deviceId: toText(payload.deviceId) ?? toText(payload.identifier) ?? toText(payload.mac),
    name: toText(payload.name),
    nickName: toText(payload.nickName),
    patientName: toText(payload.patientName),
    identifier: toText(payload.identifier),
    firmwareVersion: toText(payload.firmwareVersion) ?? toText(payload.firmware_version),
    batteryPercent: toNumber(payload.batteryPercent) ?? toNumber(payload.percent) ?? toNumber(payload.batteryStatus) ?? toNumber(batterySource.percent),
    batteryState: toNumber(payload.batteryState) ?? toNumber(payload.stateValue) ?? toNumber(batterySource.state),
    batteryPower: toNumber(payload.batteryPower),
    timeFormat: toNumber(payload.timeFormat),
    volume: toNumber(payload.volume),
    ring: toNumber(payload.ring),
    durationMinutes: toNumber(payload.durationMinutes) ?? toNumber(payload.duration) ?? toNumber(payload.alarmClockDuration),
    batteryLabel,
    nextPutDrugTime: toText(payload.nextPutDrugTime),
    nextAlarmTime: toText(payload.nextAlarmTime),
    nextAlarmDate: toText(payload.nextAlarmDate),
    alarms,
  };
}
