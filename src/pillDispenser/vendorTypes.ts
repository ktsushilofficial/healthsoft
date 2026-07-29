export type VendorApiEnvelope<T> = {
  code: number | string;
  message: string;
  data: T;
};

export type VendorTokenData = {
  token: string;
  expire: number | string;
};

export type VendorRegisteredUser = {
  user_id: string;
};

export type PillDispenserOwnerProfile = {
  ownerKey: string;
  username: string;
  mobile: string;
  patientName: string;
  patientSex?: 1 | 2;
  patientBirthday?: string;
};

export type PillDispenserLocalRecord = {
  ownerKey: string;
  vendorUserId: string;
  deviceSn: string | null;
  model: string | null;
  updatedAt: number;
};

export type PillDispenserDeviceInformation = {
  language: 1 | 2;
  timeZoneDistrict: string;
  dateFormat: 0 | 1 | 2;
  timeFormat: 0 | 1;
  timeOut: number;
  omitting: number;
  volume: 1 | 2 | 3 | 4;
  unfazedSwitch: 1 | 2;
  unfazedStart: string;
  unfazedEnd: string;
  battery: number;
  batteryVolume: number;
  rotate: number;
  uncap: number;
  wifi: number;
  gsm: number;
  currentCeilId: string;
  ceilRemaining: number;
  firmwareVersion: string;
};

export type PillDispenserDrug = {
  drugName: string;
  drugAmount: string;
};

export type PillDispenserAlarm = {
  alarmId: string;
  alarmTime: string;
  status: 0 | 1 | 2;
  drugs: PillDispenserDrug[];
};

export type PillDispenserPlan = {
  ceilUsed: number;
  deviceCeilAmount: number;
  planId: string;
  alwaysUse: 0 | 1;
  startDate: string;
  endDate: string;
  alarms: PillDispenserAlarm[];
};

export type PillDispenserSettingsInput = Pick<
  PillDispenserDeviceInformation,
  | 'language'
  | 'timeZoneDistrict'
  | 'dateFormat'
  | 'timeFormat'
  | 'timeOut'
  | 'omitting'
  | 'volume'
  | 'unfazedSwitch'
  | 'unfazedStart'
  | 'unfazedEnd'
>;

export type PillDispenserPlanInput = Pick<
  PillDispenserPlan,
  'planId' | 'ceilUsed' | 'alwaysUse' | 'startDate' | 'endDate'
>;

export type PillDispenserAlarmInput = Pick<
  PillDispenserAlarm,
  'alarmId' | 'alarmTime' | 'status' | 'drugs'
>;
