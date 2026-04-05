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
export const EV07B_PHONE_NO_SIM_DIALING_MASK = 0x20;
export const EV07B_PHONE_ACCEPT_CALL_MASK = 0x10;
export const EV07B_PHONE_SLOT_MASK = 0x0f;
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
