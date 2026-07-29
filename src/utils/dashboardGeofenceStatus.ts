import type { SeniorDashboardDeviceRecord } from '../types/seniorDashboard';

export type DashboardGeofenceValue = boolean | null;

export interface DashboardGeofenceStatus {
  alarm1: DashboardGeofenceValue;
  alarm2: DashboardGeofenceValue;
  statuses: DashboardGeofenceValue[];
  hasData: boolean;
  hasActiveAlarm: boolean;
  summary: 'Alarm detected' | 'No active alarm' | 'Not reported';
}

const readBoolean = (
  record: SeniorDashboardDeviceRecord,
  keys: string[],
): DashboardGeofenceValue => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
  }
  return null;
};

const hasAnyField = (
  record: SeniorDashboardDeviceRecord,
  keys: string[],
): boolean =>
  keys.some(key => Object.prototype.hasOwnProperty.call(record, key));

export function getDashboardGeofenceStatus(
  record: SeniorDashboardDeviceRecord | null | undefined,
): DashboardGeofenceStatus {
  if (!record) {
    return {
      alarm1: null,
      alarm2: null,
      statuses: [null, null, null, null],
      hasData: false,
      hasActiveAlarm: false,
      summary: 'Not reported',
    };
  }

  const alarmKeys = [
    ['geofenceAlarm1', 'geofence.alarm.1'],
    ['geofenceAlarm2', 'geofence.alarm.2'],
  ];
  const statusKeys = [1, 2, 3, 4].map(index => [
    `geofenceStatus${index}`,
    `geofence.status.${index}`,
  ]);
  const alarm1 = readBoolean(record, alarmKeys[0]);
  const alarm2 = readBoolean(record, alarmKeys[1]);
  const statuses = statusKeys.map(keys => readBoolean(record, keys));
  const hasData = hasAnyField(record, [
    ...alarmKeys.flat(),
    ...statusKeys.flat(),
  ]);
  const hasActiveAlarm = alarm1 === true || alarm2 === true;
  const hasReportedAlarm = alarm1 != null || alarm2 != null;

  return {
    alarm1,
    alarm2,
    statuses,
    hasData,
    hasActiveAlarm,
    summary: hasActiveAlarm
      ? 'Alarm detected'
      : hasReportedAlarm
        ? 'No active alarm'
        : 'Not reported',
  };
}

export function formatDashboardGeofenceValue(
  value: DashboardGeofenceValue,
  trueLabel: string,
  falseLabel: string,
): string {
  if (value === true) return trueLabel;
  if (value === false) return falseLabel;
  return 'Not reported';
}
