import type {
  PillDispenserAlarm,
  PillDispenserDeviceInformation,
  PillDispenserPlan,
} from './vendorTypes';

export type PillDispenserBatteryReading = {
  percent: number | null;
  /** "82%" when the dispenser reported a percentage, otherwise "Unknown". */
  percentLabel: string;
  /** Charging/low/full state from the vendor's separate battery field. */
  stateLabel: string | null;
  charging: boolean;
  low: boolean;
  known: boolean;
};

export type PillDispenserSignalReading = {
  level: number | null;
  /** Filled bars to draw, out of 4. Unknown readings draw none. */
  bars: number;
  label: string;
  known: boolean;
};

// Vendor field `battery`: 0 normal, 1 Full-in, 2 Low battery, 3 Charging.
const BATTERY_STATE_LABELS: Record<number, string> = {
  1: 'Fully charged',
  2: 'Low battery',
  3: 'Charging',
};

// Vendor field `wifi` / `gsm`: 0-4, higher is stronger.
const SIGNAL_LABELS = [
  'No signal',
  'Weak signal',
  'Fair signal',
  'Good signal',
  'Strong signal',
];

export function describePillDispenserBattery(
  information: Pick<
    PillDispenserDeviceInformation,
    'battery' | 'batteryVolume'
  > | null,
): PillDispenserBatteryReading {
  const percent = information?.batteryVolume ?? null;
  const state = information ? BATTERY_STATE_LABELS[information.battery] : undefined;
  return {
    percent,
    percentLabel: percent === null ? 'Unknown' : `${percent}%`,
    stateLabel: state ?? null,
    charging: information?.battery === 3,
    low: information?.battery === 2,
    known: percent !== null,
  };
}

export function describePillDispenserSignal(
  level: number | null | undefined,
): PillDispenserSignalReading {
  if (level === null || level === undefined || !Number.isFinite(level)) {
    return { level: null, bars: 0, label: 'Unknown', known: false };
  }
  const clamped = Math.max(0, Math.min(4, Math.round(level)));
  return {
    level: clamped,
    bars: clamped,
    label: SIGNAL_LABELS[clamped],
    known: true,
  };
}

// Vendor field `alarms[].status`: 0 initial, 1 valid, 2 invalid.
export function pillDispenserAlarmStatusLabel(status: number): string {
  if (status === 1) return 'On';
  if (status === 2) return 'Off';
  return 'Not set up yet';
}

/**
 * A readable name for an alarm. `alarm_id` is a vendor record ID, not the
 * physical compartment, so it is never used as the user-facing label.
 */
export function pillDispenserAlarmLabel(
  index: number,
  alarm: Pick<PillDispenserAlarm, 'alarmTime'> | null,
): string {
  const position = `Alarm ${index + 1}`;
  const time = alarm?.alarmTime?.trim();
  return time ? `${position} · ${time}` : position;
}

export function describePillDispenserPlan(plan: PillDispenserPlan): {
  compartments: string;
  schedule: string;
} {
  const compartments =
    plan.deviceCeilAmount > 0
      ? `${plan.ceilUsed} of ${plan.deviceCeilAmount} compartments filled`
      : `${plan.ceilUsed} compartments filled`;
  const hasDates =
    plan.alwaysUse === 0 &&
    !!plan.startDate &&
    !!plan.endDate &&
    !plan.startDate.startsWith('0000') &&
    !plan.endDate.startsWith('0000');
  return {
    compartments,
    schedule: hasDates
      ? `Active ${plan.startDate} to ${plan.endDate}`
      : 'Active with no end date',
  };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Describes when the app last read the dispenser, never when the device measured. */
export function formatPillDispenserCheckedAt(
  timestamp: number | null,
  now: number = Date.now(),
): string | null {
  if (!timestamp || !Number.isFinite(timestamp)) return null;
  const elapsed = now - timestamp;
  if (elapsed < 0) return 'Checked just now';
  if (elapsed < MINUTE_MS) return 'Checked just now';
  if (elapsed < HOUR_MS) {
    const minutes = Math.floor(elapsed / MINUTE_MS);
    return `Checked ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (elapsed < 24 * HOUR_MS) {
    const hours = Math.floor(elapsed / HOUR_MS);
    return `Checked ${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  return `Checked on ${new Date(timestamp).toISOString().slice(0, 10)}`;
}
