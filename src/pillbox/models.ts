export type PillBoxConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'scanning'
  | 'idle'
  | 'ready'
  | 'dataSyncing'
  | 'dataSynced'
  | 'error'
  | 'unsupported'
  | 'unauthorized'
  | 'powerOff';

export type PillBoxDevice = {
  id: string;
  name: string | null;
  localName: string | null;
  mac: string | null;
  rssi: number | null;
};

export type PillBoxAlarm = {
  alarmId: string | null;
  row: number | null;
  alarmTime: string | null;
  remark: string | null;
  status: number | null;
  enabled: boolean | null;
  isRepeat: number | null;
  effectWeekdays: string[];
  deviceId: string | null;
  drugCount: number | null;
  drugNumCount: number | null;
  hasImage: boolean | null;
  type: string | null;
  effectTime: string | null;
};

export type PillBoxSnapshot = {
  state: PillBoxConnectionState;
  deviceId: string | null;
  name: string | null;
  nickName: string | null;
  patientName: string | null;
  identifier: string | null;
  firmwareVersion: string | null;
  batteryPercent: number | null;
  batteryState: number | null;
  batteryPower: number | null;
  timeFormat: number | null;
  volume: number | null;
  ring: number | null;
  durationMinutes: number | null;
  batteryLabel: string | null;
  nextPutDrugTime: string | null;
  nextAlarmTime: string | null;
  nextAlarmDate: string | null;
  alarms: PillBoxAlarm[];
};

export type PillBoxMedicationEvent = {
  label: string | null;
  id: string | null;
  row: number | null;
  deviceMac: string | null;
  alarmTime: string | null;
  drugTime: string | null;
  date: string | null;
  month: string | null;
  year: string | null;
  status: number | null;
  accessToken: string | null;
};
