/**
 * Placeholder snapshot shaped like future device/event payloads.
 * Not wired to network — keyed by senior id for stable demos per assigned senior.
 */

export type SeniorHomeAlarmSeverity = 'ok' | 'info' | 'warning' | 'critical';

export interface SeniorHomeSnapshot {
  batteryPercent: number;
  charging: boolean;
  networkLabel: string;
  lastUpdatedLabel: string;
  latitude: number;
  longitude: number;
  speedKph: number;
  hdop?: number;
  satellites?: number;
  primaryAlarmLabel: string;
  alarmDetail: string;
  alarmSeverity: SeniorHomeAlarmSeverity;
  /** What kind of alarm last fired (mock). */
  lastAlarmKind: string;
  /** When it last fired — date & time for display (mock). */
  lastAlarmAt: string;
}

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

const PRESETS: SeniorHomeSnapshot[] = [
  {
    batteryPercent: 72,
    charging: true,
    networkLabel: '4G LTE · Good signal',
    lastUpdatedLabel: '2 min ago',
    latitude: 13.027367,
    longitude: 80.168344,
    speedKph: 1,
    hdop: 1.7,
    satellites: 11,
    primaryAlarmLabel: 'All clear',
    alarmDetail: 'No panic or fall signals on the latest packet.',
    alarmSeverity: 'ok',
    lastAlarmKind: 'Status',
    lastAlarmAt: 'No alarm in the last 48 hours',
  },
  {
    batteryPercent: 16,
    charging: false,
    networkLabel: '4G · Wi‑Fi locating',
    lastUpdatedLabel: '8 min ago',
    latitude: 28.6139,
    longitude: 77.209,
    speedKph: 0,
    hdop: 2.2,
    satellites: 10,
    primaryAlarmLabel: 'Fall sensor raised',
    alarmDetail: 'Watch reported a fall event; confirm wellness when convenient.',
    alarmSeverity: 'warning',
    lastAlarmKind: 'Fall sensor',
    lastAlarmAt: '12 Apr 2026, 9:42 AM',
  },
  {
    batteryPercent: 45,
    charging: false,
    networkLabel: '4G LTE · Moderate signal',
    lastUpdatedLabel: 'Just now',
    latitude: 28.5355,
    longitude: 77.391,
    speedKph: 12,
    satellites: 8,
    primaryAlarmLabel: 'Panic cleared',
    alarmDetail: 'Earlier panic stopped; geofences settled.',
    alarmSeverity: 'info',
    lastAlarmKind: 'SOS panic',
    lastAlarmAt: '11 Apr 2026, 6:18 PM',
  },
];

export function getMockSeniorHomeSnapshot(seniorUserId: string): SeniorHomeSnapshot {
  const idx = hashString(seniorUserId) % PRESETS.length;
  return PRESETS[idx]!;
}
