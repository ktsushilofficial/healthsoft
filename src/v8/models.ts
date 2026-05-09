export type V8VitalSample = {
  timestamp: string | null;
  receivedAt: number | null;
  heartRate: number | null;
  hrv: number | null;
  stress: number | null;
  systolicBp: number | null;
  diastolicBp: number | null;
  spo2: number | null;
  temperatureC: number | null;
  steps: number | null;
  distanceKm: number | null;
  caloriesKcal: number | null;
};

export type V8DeviceInfo = {
  imei: string | null;
  deviceName: string | null;
  mac: string | null;
  batteryPercent: number | null;
  firmwareVersion: string | null;
  deviceTime: string | null;
  updatedAt: number | null;
};

export type V8HistoryBucket = {
  dataType: string | null;
  entries: V8VitalSample[];
  completed: boolean;
  updatedAt: number;
};
