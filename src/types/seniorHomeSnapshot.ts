/**
 * Home “live status” fields sourced from senior dashboard API (or empty when unavailable).
 */

export type SeniorHomeAlarmSeverity = 'ok' | 'info' | 'warning' | 'critical' | 'na';

export interface SeniorHomeSnapshot {
  batteryPercent: number | null;
  charging: boolean | null;
  networkLabel: string | null;
  lastUpdatedLabel: string | null;
  latitude: number | null;
  longitude: number | null;
  speedKph: number | null;
  hdop?: number | null;
  satellites?: number | null;
  primaryAlarmLabel: string | null;
  alarmDetail: string | null;
  alarmSeverity: SeniorHomeAlarmSeverity;
  lastAlarmKind: string | null;
  lastAlarmAt: string | null;
}

export function emptySeniorHomeSnapshot(): SeniorHomeSnapshot {
  return {
    batteryPercent: null,
    charging: null,
    networkLabel: null,
    lastUpdatedLabel: null,
    latitude: null,
    longitude: null,
    speedKph: null,
    hdop: null,
    satellites: null,
    primaryAlarmLabel: null,
    alarmDetail: null,
    alarmSeverity: 'na',
    lastAlarmKind: null,
    lastAlarmAt: null,
  };
}
