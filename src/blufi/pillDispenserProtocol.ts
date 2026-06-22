export const PILL_DISPENSER_PROTOCOL_VERSION = 1;

export type PillDispenserCommandName = 'set_alarm' | 'set_reminder' | 'wifi_provision' | 'custom';

export type PillDispenserRepeatMode = 'once' | 'daily' | 'weekdays' | 'custom';

export type PillDispenserTime = {
  raw: string;
  hour: number;
  minute: number;
};

export type PillDispenserReminderPayload = {
  title: string;
  label: string;
  time: PillDispenserTime;
  repeat: {
    mode: PillDispenserRepeatMode;
    days: string[];
  };
  enabled: boolean;
};

export type PillDispenserCommandEnvelope<TPayload = unknown> = {
  protocol: 'healthsoft.pill-dispenser';
  version: number;
  command: PillDispenserCommandName;
  requestId: string;
  source: 'healthsoft';
  createdAt: string;
  payload: TPayload;
};

export type BuildReminderCommandInput = {
  title: string;
  label: string;
  time: string;
  repeatRaw: string;
};

export type BuildWifiProvisionCommandInput = {
  ssid: string;
  password: string;
  bssid?: string | null;
};

function normalizeTime(input: string): PillDispenserTime {
  const raw = input.trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error('Time must be in HH:MM format.');
  }

  const hour = Number.parseInt(match[1] ?? '', 10);
  const minute = Number.parseInt(match[2] ?? '', 10);

  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    throw new Error('Time must be a valid 24-hour clock value.');
  }

  return { raw, hour, minute };
}

function normalizeRepeat(rawRepeat: string): PillDispenserReminderPayload['repeat'] {
  const normalized = rawRepeat
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  if (!normalized || normalized === 'once') {
    return { mode: 'once', days: [] };
  }

  if (normalized === 'daily') {
    return { mode: 'daily', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] };
  }

  if (normalized === 'weekdays' || normalized === 'mon-fri' || normalized === 'monfri') {
    return { mode: 'weekdays', days: ['mon', 'tue', 'wed', 'thu', 'fri'] };
  }

  const days = normalized
    .split(',')
    .map(day => day.trim())
    .filter(Boolean);

  if (days.length === 0) {
    return { mode: 'once', days: [] };
  }

  return { mode: 'custom', days };
}

function createRequestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function buildReminderCommand(input: BuildReminderCommandInput): PillDispenserCommandEnvelope<PillDispenserReminderPayload> {
  const time = normalizeTime(input.time);
  const repeat = normalizeRepeat(input.repeatRaw);
  const title = input.title.trim();
  const label = input.label.trim();

  return {
    protocol: 'healthsoft.pill-dispenser',
    version: PILL_DISPENSER_PROTOCOL_VERSION,
    command: 'set_alarm',
    requestId: createRequestId('alarm'),
    source: 'healthsoft',
    createdAt: new Date().toISOString(),
    payload: {
      title,
      label,
      time,
      repeat,
      enabled: true,
    },
  };
}

export function buildWifiProvisionCommand(input: BuildWifiProvisionCommandInput): PillDispenserCommandEnvelope<{
  ssid: string;
  password: string;
  bssid: string | null;
}> {
  return {
    protocol: 'healthsoft.pill-dispenser',
    version: PILL_DISPENSER_PROTOCOL_VERSION,
    command: 'wifi_provision',
    requestId: createRequestId('wifi'),
    source: 'healthsoft',
    createdAt: new Date().toISOString(),
    payload: {
      ssid: input.ssid.trim(),
      password: input.password,
      bssid: input.bssid?.trim() || null,
    },
  };
}

