import { Buffer } from 'buffer';

export interface Ev07bAlarmClockConfig {
  index: number;
  enabled: boolean;
  hour: number;
  minute: number;
  workdayMask: number;
  durationSec: number;
  ring: number;
}

export interface Ev07bNoDisturbConfig {
  enabled: boolean;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export interface Ev07bAuthorizedPhoneConfig {
  slot: number;
  enabled: boolean;
  acceptSms: boolean;
  noSimDialing: boolean;
  acceptPhoneCall: boolean;
  number: string;
}

export interface Ev07bGeoPoint {
  latitude: number;
  longitude: number;
}

export interface Ev07bGeoAlertConfig {
  index: number;
  enabled: boolean;
  direction: 'out' | 'in';
  type: 'circle' | 'polygon';
  radiusMeters: number;
  points: Ev07bGeoPoint[];
}

export interface Ev07bNoMotionAlertConfig {
  enabled: boolean;
  dial: boolean;
  staticPeriodSec: number;
}

export interface Ev07bTiltAlertConfig {
  enabled: boolean;
  dial: boolean;
  angleDeg: number;
  durationSec: number;
}

export interface Ev07bFallDownAlertConfig {
  enabled: boolean;
  dial: boolean;
  alwaysOn: boolean;
  sensitivity: number;
}

export interface Ev07bFlagDefinition {
  bit: number;
  key: string;
  label: string;
}

export const EV07B_ALARM_ENABLE_MASK = 0x80;
export const EV07B_ALARM_INDEX_MASK = 0x7f;
export const EV07B_WORKDAY_MASK = 0x7f;
export const EV07B_PHONE_ENABLE_MASK = 0x80;
export const EV07B_PHONE_ACCEPT_SMS_MASK = 0x40;
export const EV07B_PHONE_ACCEPT_CALL_MASK = 0x20;
export const EV07B_PHONE_NO_SIM_DIALING_MASK = 0x10;
export const EV07B_PHONE_SLOT_MASK = 0x0f;
export const EV07B_GEO_ALERT_INDEX_MASK = 0x0f;
export const EV07B_GEO_ALERT_POINTS_MASK = 0xf0;
export const EV07B_GEO_ALERT_ENABLE_MASK = 0x00000100;
export const EV07B_GEO_ALERT_DIRECTION_MASK = 0x00000200;
export const EV07B_GEO_ALERT_TYPE_MASK = 0x00000400;
export const EV07B_GEO_ALERT_RADIUS_MASK = 0xffff0000;
export const EV07B_NO_MOTION_ENABLE_MASK = 0x80000000;
export const EV07B_NO_MOTION_DIAL_MASK = 0x40000000;
export const EV07B_NO_MOTION_PERIOD_MASK = 0x3fffffff;
export const EV07B_TILT_ENABLE_MASK = 0x80000000;
export const EV07B_TILT_DIAL_MASK = 0x40000000;
export const EV07B_TILT_ANGLE_MASK = 0x00ff0000;
export const EV07B_TILT_DURATION_MASK = 0x0000ffff;
export const EV07B_FALL_DOWN_ENABLE_MASK = 0x80;
export const EV07B_FALL_DOWN_DIAL_MASK = 0x40;
export const EV07B_FALL_DOWN_ALWAYS_ON_MASK = 0x20;
export const EV07B_FALL_DOWN_SENSITIVITY_MASK = 0x0f;
export const EV07B_WEEKDAY_OPTIONS = [
  { key: 'mon', label: 'Mon', bit: 0 },
  { key: 'tue', label: 'Tue', bit: 1 },
  { key: 'wed', label: 'Wed', bit: 2 },
  { key: 'thu', label: 'Thu', bit: 3 },
  { key: 'fri', label: 'Fri', bit: 4 },
  { key: 'sat', label: 'Sat', bit: 5 },
  { key: 'sun', label: 'Sun', bit: 6 },
] as const;

export const EV07B_ENABLE_CONTROL_FLAGS: readonly Ev07bFlagDefinition[] = [
  { bit: 0, key: 'led', label: 'LED' },
  { bit: 1, key: 'beep', label: 'Beep' },
  { bit: 2, key: 'vibration', label: 'Vibration' },
  { bit: 3, key: 'cell_tower', label: 'Cell Tower Positioning' },
  { bit: 4, key: 'wifi', label: 'Wi-Fi' },
  { bit: 5, key: 'sos_call_speaker', label: 'SOS Call Speaker' },
  { bit: 6, key: 'side_call_speaker', label: 'Side Call Speaker' },
  { bit: 7, key: 'ble_stay_connected', label: 'BLE Stay Connected' },
  { bit: 8, key: 'ble_locating', label: 'BLE Locating' },
  { bit: 9, key: 'sos_call_voice', label: 'SOS Call Voice' },
  { bit: 10, key: 'ble_always_on', label: 'BLE Always ON' },
  { bit: 11, key: 'gps_positioning', label: 'GPS Positioning' },
  { bit: 12, key: 'alert_tcp_fast', label: 'Alert TCP Fast' },
  { bit: 13, key: 'raise_wrist', label: 'Raise Wrist to Awake' },
  { bit: 14, key: 'home_beacon', label: 'Home Beacon Location' },
  { bit: 15, key: 'activity', label: 'Activity Function' },
  { bit: 16, key: 'step_count', label: 'Step Count Function' },
  { bit: 17, key: 'home_wifi', label: 'Home Wi-Fi Location' },
  { bit: 18, key: 'data_saver', label: 'Data Saver' },
  { bit: 19, key: 'network_location', label: 'Network Location Provider' },
  { bit: 20, key: 'power_control', label: 'Power Control Enable' },
  { bit: 21, key: 'sos_cancel', label: 'SOS Cancellation Switch' },
  { bit: 22, key: 'long_sms', label: 'Long SMS' },
  { bit: 30, key: 'auto_update', label: 'Auto Update' },
  { bit: 31, key: 'agps', label: 'AGPS' },
] as const;

export const EV07B_VOICE_PROMPT_FLAGS: readonly Ev07bFlagDefinition[] = [
  { bit: 0, key: 'beep', label: 'Beep' },
  { bit: 1, key: 'tilt_alarm', label: 'Tilt Alarm' },
  { bit: 2, key: 'charging', label: 'Charging' },
  { bit: 3, key: 'battery_low', label: 'Battery Low' },
  { bit: 4, key: 'call1', label: 'Call 1' },
  { bit: 5, key: 'call2', label: 'Call 2' },
  { bit: 6, key: 'call3', label: 'Call 3' },
  { bit: 7, key: 'call4', label: 'Call 4' },
  { bit: 8, key: 'call5', label: 'Call 5' },
  { bit: 9, key: 'fall', label: 'Fall Down Alarm' },
  { bit: 10, key: 'sos', label: 'SOS Alarm' },
  { bit: 11, key: 'sos_stop', label: 'SOS Stop' },
  { bit: 12, key: 'no_motion', label: 'No Motion Alarm' },
  { bit: 13, key: 'motion', label: 'Motion Alarm' },
  { bit: 14, key: 'stop_call', label: 'Stop Call Sequence' },
  { bit: 15, key: 'activity', label: 'Activity Reminder' },
  { bit: 16, key: 'find', label: 'Find Me' },
  { bit: 17, key: 'call6', label: 'Call 6' },
  { bit: 18, key: 'alarm_cancel', label: 'Alarm Cancel' },
  { bit: 19, key: 'welfare_checkin', label: 'Welfare Check In' },
  { bit: 20, key: 'welfare_checkout', label: 'Welfare Check Out' },
  { bit: 21, key: 'welfare_checkin_warn', label: 'Welfare Check Warning' },
  { bit: 22, key: 'sos_not_allow', label: 'SOS Not Allowed Cancel' },
  { bit: 23, key: 'go_home', label: 'Go Home' },
  { bit: 24, key: 'leave_home', label: 'Leave Home' },
] as const;

function readPartialUintLe(bytes: Uint8Array): number {
  let value = 0;
  const length = Math.min(bytes.length, 4);
  for (let index = 0; index < length; index += 1) {
    value |= (bytes[index] ?? 0) << (8 * index);
  }
  return value >>> 0;
}

function readInt32Le(bytes: Uint8Array, offset: number = 0): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getInt32(offset, true);
}

function int32Le(value: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setInt32(0, value, true);
  return new Uint8Array(buffer);
}

function uint32Le(value: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setUint32(0, value >>> 0, true);
  return new Uint8Array(buffer);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function decodeEv07bAsciiSetting(value?: Uint8Array | null): string | null {
  if (!value) return null;
  return Buffer.from(value).toString('ascii').replace(/\0+$/, '').trim();
}

export function encodeEv07bAsciiSetting(value: string, maxLength: number): Uint8Array {
  return Uint8Array.from(Buffer.from(value.trim().slice(0, maxLength), 'ascii'));
}

export function decodeEv07bFlagMask(value?: Uint8Array | null): number | null {
  if (!value || value.length < 1) return null;
  return readPartialUintLe(value);
}

export function hasEv07bFlag(mask: number | null | undefined, bit: number): boolean {
  if (mask === null || mask === undefined) return false;
  const bitMask = (1 << bit) >>> 0;
  return ((((mask >>> 0) & bitMask) >>> 0) !== 0);
}

export function toggleEv07bFlag(mask: number, bit: number): number {
  const bitMask = (1 << bit) >>> 0;
  return (((mask >>> 0) ^ bitMask) >>> 0);
}

export function decodeEv07bGeoAlert(value?: Uint8Array | null): Ev07bGeoAlertConfig | null {
  if (!value || value.length < 12) return null;

  const flag = readPartialUintLe(value.slice(0, 4));
  const type: Ev07bGeoAlertConfig['type'] =
    (flag & EV07B_GEO_ALERT_TYPE_MASK) !== 0 ? 'polygon' : 'circle';
  const direction: Ev07bGeoAlertConfig['direction'] =
    (flag & EV07B_GEO_ALERT_DIRECTION_MASK) !== 0 ? 'in' : 'out';
  const declaredPointCount = (flag & EV07B_GEO_ALERT_POINTS_MASK) >>> 4;
  const availablePointCount = Math.floor((value.length - 4) / 8);
  const expectedPointCount = type === 'circle'
    ? Math.min(1, availablePointCount)
    : Math.min(
        Math.max(declaredPointCount || availablePointCount, 1),
        availablePointCount,
      );

  const points: Ev07bGeoPoint[] = [];
  for (let index = 0; index < expectedPointCount; index += 1) {
    const offset = 4 + index * 8;
    points.push({
      latitude: readInt32Le(value, offset) / 10000000,
      longitude: readInt32Le(value, offset + 4) / 10000000,
    });
  }

  return {
    index: clampInt(flag & EV07B_GEO_ALERT_INDEX_MASK, 0, 15),
    enabled: (flag & EV07B_GEO_ALERT_ENABLE_MASK) !== 0,
    direction,
    type,
    radiusMeters: clampInt((flag & EV07B_GEO_ALERT_RADIUS_MASK) >>> 16, 0, 65535),
    points,
  };
}

export function encodeEv07bGeoAlert(config: Ev07bGeoAlertConfig): Uint8Array {
  const type: Ev07bGeoAlertConfig['type'] = config.type === 'polygon' ? 'polygon' : 'circle';
  const rawPoints = Array.isArray(config.points) ? config.points : [];
  const points = (type === 'circle' ? rawPoints.slice(0, 1) : rawPoints.slice(0, 15)).map(point => ({
    latitude: Math.max(-90, Math.min(90, point.latitude)),
    longitude: Math.max(-180, Math.min(180, point.longitude)),
  }));

  if (points.length === 0) {
    throw new Error('Geo fence requires at least one coordinate');
  }
  if (type === 'polygon' && points.length < 3) {
    throw new Error('Geo fence polygon requires at least 3 points');
  }

  const pointCount = type === 'circle' ? 1 : clampInt(points.length, 3, 15);
  let flag =
    ((clampInt(config.radiusMeters, 0, 65535) << 16) >>> 0) |
    ((pointCount << 4) >>> 0) |
    (clampInt(config.index, 0, 15) & EV07B_GEO_ALERT_INDEX_MASK);
  if (config.enabled) flag |= EV07B_GEO_ALERT_ENABLE_MASK;
  if (config.direction === 'in') flag |= EV07B_GEO_ALERT_DIRECTION_MASK;
  if (type === 'polygon') flag |= EV07B_GEO_ALERT_TYPE_MASK;

  const bytes = Array.from(uint32Le(flag));
  points.forEach(point => {
    bytes.push(...int32Le(Math.round(point.latitude * 10000000)));
    bytes.push(...int32Le(Math.round(point.longitude * 10000000)));
  });
  return Uint8Array.from(bytes);
}

export function decodeEv07bNoMotionAlert(value?: Uint8Array | null): Ev07bNoMotionAlertConfig | null {
  const raw = decodeEv07bFlagMask(value);
  if (raw === null) return null;

  return {
    enabled: (raw & EV07B_NO_MOTION_ENABLE_MASK) !== 0,
    dial: (raw & EV07B_NO_MOTION_DIAL_MASK) !== 0,
    staticPeriodSec: clampInt(raw & EV07B_NO_MOTION_PERIOD_MASK, 60, 36000),
  };
}

export function encodeEv07bNoMotionAlert(config: Ev07bNoMotionAlertConfig): Uint8Array {
  let raw = clampInt(config.staticPeriodSec, 60, 36000) & EV07B_NO_MOTION_PERIOD_MASK;
  if (config.enabled) raw |= EV07B_NO_MOTION_ENABLE_MASK;
  if (config.dial) raw |= EV07B_NO_MOTION_DIAL_MASK;
  return uint32Le(raw);
}

export function decodeEv07bTiltAlert(value?: Uint8Array | null): Ev07bTiltAlertConfig | null {
  const raw = decodeEv07bFlagMask(value);
  if (raw === null) return null;

  return {
    enabled: (raw & EV07B_TILT_ENABLE_MASK) !== 0,
    dial: (raw & EV07B_TILT_DIAL_MASK) !== 0,
    angleDeg: clampInt((raw & EV07B_TILT_ANGLE_MASK) >>> 16, 30, 90),
    durationSec: clampInt(raw & EV07B_TILT_DURATION_MASK, 10, 3600),
  };
}

export function encodeEv07bTiltAlert(config: Ev07bTiltAlertConfig): Uint8Array {
  let raw =
    (clampInt(config.durationSec, 10, 3600) & EV07B_TILT_DURATION_MASK) |
    ((clampInt(config.angleDeg, 30, 90) << 16) >>> 0);
  if (config.enabled) raw |= EV07B_TILT_ENABLE_MASK;
  if (config.dial) raw |= EV07B_TILT_DIAL_MASK;
  return uint32Le(raw);
}

export function decodeEv07bFallDownAlert(value?: Uint8Array | null): Ev07bFallDownAlertConfig | null {
  if (!value || value.length < 1) return null;

  const raw = value[0];
  return {
    enabled: (raw & EV07B_FALL_DOWN_ENABLE_MASK) !== 0,
    dial: (raw & EV07B_FALL_DOWN_DIAL_MASK) !== 0,
    alwaysOn: (raw & EV07B_FALL_DOWN_ALWAYS_ON_MASK) !== 0,
    sensitivity: clampInt(raw & EV07B_FALL_DOWN_SENSITIVITY_MASK, 1, 9),
  };
}

export function encodeEv07bFallDownAlert(config: Ev07bFallDownAlertConfig): Uint8Array {
  let raw = clampInt(config.sensitivity, 1, 9) & EV07B_FALL_DOWN_SENSITIVITY_MASK;
  if (config.enabled) raw |= EV07B_FALL_DOWN_ENABLE_MASK;
  if (config.dial) raw |= EV07B_FALL_DOWN_DIAL_MASK;
  if (config.alwaysOn) raw |= EV07B_FALL_DOWN_ALWAYS_ON_MASK;
  return Uint8Array.from([raw]);
}

export function normalizeEv07bWorkdayMask(mask: number, enabled: boolean): number {
  const sanitizedMask = clampInt(mask, 0, EV07B_WORKDAY_MASK) & EV07B_WORKDAY_MASK;

  // Some device firmwares ignore "enabled" alarms when no weekday bits are set.
  // In that case we fall back to "every day" to make the enable toggle stick.
  if (enabled && sanitizedMask === 0) {
    return EV07B_WORKDAY_MASK;
  }

  return sanitizedMask;
}

export function decodeEv07bAlarmClock(value?: Uint8Array | null): Ev07bAlarmClockConfig | null {
  if (!value || value.length < 6) return null;

  const indexAndFlag = value[0];
  return {
    index: clampInt(indexAndFlag & EV07B_ALARM_INDEX_MASK, 0, 3),
    enabled: (indexAndFlag & EV07B_ALARM_ENABLE_MASK) !== 0,
    hour: clampInt(value[1], 0, 23),
    minute: clampInt(value[2], 0, 59),
    workdayMask: clampInt(value[3] & EV07B_WORKDAY_MASK, 0, EV07B_WORKDAY_MASK),
    durationSec: clampInt(value[4], 1, 120),
    ring: clampInt(value[5], 1, 10),
  };
}

export function encodeEv07bAlarmClock(config: Ev07bAlarmClockConfig): Uint8Array {
  const index = clampInt(config.index, 0, 3);
  const enabled = !!config.enabled;
  const workdayMask = normalizeEv07bWorkdayMask(config.workdayMask, enabled);

  return Uint8Array.from([
    index | (enabled ? EV07B_ALARM_ENABLE_MASK : 0),
    clampInt(config.hour, 0, 23),
    clampInt(config.minute, 0, 59),
    workdayMask,
    clampInt(config.durationSec, 1, 120),
    clampInt(config.ring, 1, 10),
  ]);
}

export function decodeEv07bNoDisturb(value?: Uint8Array | null): Ev07bNoDisturbConfig | null {
  if (!value || value.length < 5) return null;

  return {
    enabled: (value[0] & EV07B_ALARM_ENABLE_MASK) !== 0,
    startHour: clampInt(value[1], 0, 23),
    startMinute: clampInt(value[2], 0, 59),
    endHour: clampInt(value[3], 0, 23),
    endMinute: clampInt(value[4], 0, 59),
  };
}

export function encodeEv07bNoDisturb(config: Ev07bNoDisturbConfig): Uint8Array {
  return Uint8Array.from([
    config.enabled ? EV07B_ALARM_ENABLE_MASK : 0,
    clampInt(config.startHour, 0, 23),
    clampInt(config.startMinute, 0, 59),
    clampInt(config.endHour, 0, 23),
    clampInt(config.endMinute, 0, 59),
  ]);
}

export function decodeEv07bAuthorizedPhone(
  value?: Uint8Array | null,
  fallbackSlot?: number,
): Ev07bAuthorizedPhoneConfig | null {
  if (!value || value.length < 2) return null;

  const flags = value[0];
  const number = Buffer.from(value.slice(1)).toString('ascii').replace(/\0+$/, '').trim();
  if (!number) return null;

  const slot = flags & EV07B_PHONE_SLOT_MASK;
  return {
    slot: clampInt(slot || fallbackSlot || 0, 0, 9),
    enabled: (flags & EV07B_PHONE_ENABLE_MASK) !== 0,
    acceptSms: (flags & EV07B_PHONE_ACCEPT_SMS_MASK) !== 0,
    noSimDialing: (flags & EV07B_PHONE_NO_SIM_DIALING_MASK) !== 0,
    acceptPhoneCall: (flags & EV07B_PHONE_ACCEPT_CALL_MASK) !== 0,
    number,
  };
}

export function encodeEv07bAuthorizedPhone(config: Ev07bAuthorizedPhoneConfig): Uint8Array {
  const slot = clampInt(config.slot, 0, 9) & EV07B_PHONE_SLOT_MASK;
  let flags = slot;
  if (config.enabled) flags |= EV07B_PHONE_ENABLE_MASK;
  if (config.acceptSms) flags |= EV07B_PHONE_ACCEPT_SMS_MASK;
  if (config.noSimDialing) flags |= EV07B_PHONE_NO_SIM_DIALING_MASK;
  if (config.acceptPhoneCall) flags |= EV07B_PHONE_ACCEPT_CALL_MASK;

  const number = config.number.replace(/[^0-9+]/g, '').slice(0, 20);
  return Uint8Array.from([flags, ...Buffer.from(number, 'ascii')]);
}
