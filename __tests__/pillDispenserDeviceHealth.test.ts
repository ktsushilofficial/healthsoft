import {
  describePillDispenserBattery,
  describePillDispenserPlan,
  describePillDispenserSignal,
  formatPillDispenserCheckedAt,
  pillDispenserAlarmLabel,
  pillDispenserAlarmStatusLabel,
} from '../src/pillDispenser/deviceHealth';
import type { PillDispenserPlan } from '../src/pillDispenser/vendorTypes';

describe('describePillDispenserBattery', () => {
  it('reports the vendor percentage with its charging state', () => {
    expect(
      describePillDispenserBattery({ battery: 3, batteryVolume: 64 }),
    ).toEqual({
      percent: 64,
      percentLabel: '64%',
      stateLabel: 'Charging',
      charging: true,
      low: false,
      known: true,
    });
  });

  it('flags a low battery so the reading can be highlighted', () => {
    const reading = describePillDispenserBattery({
      battery: 2,
      batteryVolume: 8,
    });
    expect(reading.low).toBe(true);
    expect(reading.stateLabel).toBe('Low battery');
  });

  it('shows a missing percentage as unknown instead of 0%', () => {
    const reading = describePillDispenserBattery({
      battery: 0,
      batteryVolume: null,
    });
    expect(reading.percentLabel).toBe('Unknown');
    expect(reading.known).toBe(false);
    expect(reading.stateLabel).toBeNull();
  });

  it('keeps a genuine zero percent distinct from a missing reading', () => {
    const reading = describePillDispenserBattery({
      battery: 2,
      batteryVolume: 0,
    });
    expect(reading.percentLabel).toBe('0%');
    expect(reading.known).toBe(true);
  });

  it('treats an absent device report as unknown', () => {
    expect(describePillDispenserBattery(null).percentLabel).toBe('Unknown');
  });
});

describe('describePillDispenserSignal', () => {
  it.each([
    [0, 'No signal'],
    [1, 'Weak signal'],
    [2, 'Fair signal'],
    [3, 'Good signal'],
    [4, 'Strong signal'],
  ])('describes vendor level %s as %s', (level, label) => {
    expect(describePillDispenserSignal(level)).toEqual({
      level,
      bars: level,
      label,
      known: true,
    });
  });

  it('shows a missing reading as unknown with no bars filled', () => {
    expect(describePillDispenserSignal(null)).toEqual({
      level: null,
      bars: 0,
      label: 'Unknown',
      known: false,
    });
  });

  it('clamps a value outside the documented 0-4 scale', () => {
    expect(describePillDispenserSignal(9).bars).toBe(4);
    expect(describePillDispenserSignal(-2).bars).toBe(0);
  });
});

describe('alarm labels', () => {
  it('names an alarm by position and time, never by its vendor ID', () => {
    expect(pillDispenserAlarmLabel(0, { alarmTime: '08:00' })).toBe(
      'Alarm 1 · 08:00',
    );
  });

  it('falls back to the position when no time is set', () => {
    expect(pillDispenserAlarmLabel(2, { alarmTime: '' })).toBe('Alarm 3');
    expect(pillDispenserAlarmLabel(1, null)).toBe('Alarm 2');
  });

  it.each([
    [0, 'Not set up yet'],
    [1, 'On'],
    [2, 'Off'],
  ])('describes vendor alarm status %s as %s', (status, label) => {
    expect(pillDispenserAlarmStatusLabel(status)).toBe(label);
  });
});

describe('describePillDispenserPlan', () => {
  const plan: PillDispenserPlan = {
    ceilUsed: 12,
    deviceCeilAmount: 28,
    planId: '1600',
    alwaysUse: 1,
    startDate: '0000-00-00',
    endDate: '0000-00-00',
    alarms: [],
  };

  it('describes compartments in words rather than vendor IDs', () => {
    expect(describePillDispenserPlan(plan)).toEqual({
      compartments: '12 of 28 compartments filled',
      schedule: 'Active with no end date',
    });
  });

  it('shows the effective period when the plan is date limited', () => {
    expect(
      describePillDispenserPlan({
        ...plan,
        alwaysUse: 0,
        startDate: '2026-01-01',
        endDate: '2026-03-01',
      }).schedule,
    ).toBe('Active 2026-01-01 to 2026-03-01');
  });

  it('ignores the vendor placeholder dates on a date-limited plan', () => {
    expect(
      describePillDispenserPlan({ ...plan, alwaysUse: 0 }).schedule,
    ).toBe('Active with no end date');
  });
});

describe('formatPillDispenserCheckedAt', () => {
  const now = Date.UTC(2026, 0, 2, 12, 0, 0);

  it('returns nothing when the app has not read the device yet', () => {
    expect(formatPillDispenserCheckedAt(null, now)).toBeNull();
  });

  it('describes how long ago the app last read the device', () => {
    expect(formatPillDispenserCheckedAt(now - 20_000, now)).toBe(
      'Checked just now',
    );
    expect(formatPillDispenserCheckedAt(now - 60_000, now)).toBe(
      'Checked 1 minute ago',
    );
    expect(formatPillDispenserCheckedAt(now - 5 * 60_000, now)).toBe(
      'Checked 5 minutes ago',
    );
    expect(formatPillDispenserCheckedAt(now - 2 * 3_600_000, now)).toBe(
      'Checked 2 hours ago',
    );
  });

  it('falls back to a date once the reading is more than a day old', () => {
    expect(
      formatPillDispenserCheckedAt(now - 3 * 24 * 3_600_000, now),
    ).toBe('Checked on 2025-12-30');
  });
});
