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
  exerciseMinutes: number | null;
  activeMinutes: number | null;
  goalPercent: number | null;
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

export type V8EcgPhase =
  | 'idle'
  | 'starting'
  | 'measuring'
  | 'processing'
  | 'completed'
  | 'failed';

export type V8EcgSession = {
  id: string;
  seniorId: string;
  phase: V8EcgPhase;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  samples: number[];
  sampleRateHz: number | null;
  firstSampleAt: number | null;
  firstSampleCount: number;
  lastSampleAt: number | null;
  heartRate: number | null;
  signalQuality: string | null;
  classification: string | null;
  statusMessage: string | null;
  error: string | null;
  deviceMac: string | null;
  firmwareVersion: string | null;
};

export type V8EcgEvent = {
  kind: 'started' | 'samples' | 'status' | 'completed' | 'stopped' | 'failed' | 'unknown';
  samples: number[];
  heartRate: number | null;
  sampleRateHz: number | null;
  signalQuality: string | null;
  classification: string | null;
  statusMessage: string | null;
};

export type V8HistoryBucket = {
  dataType: string | null;
  entries: V8VitalSample[];
  completed: boolean;
  updatedAt: number;
};

export type V8DailyVitalSummary = {
  date: string;
  steps: number | null;
  distanceKm: number | null;
  caloriesKcal: number | null;
  exerciseMinutes: number | null;
  activeMinutes: number | null;
  goalPercent: number | null;
  heartRateAvg: number | null;
  heartRateMin: number | null;
  heartRateMax: number | null;
  heartRateLatest: number | null;
  spo2Avg: number | null;
  spo2Min: number | null;
  spo2Latest: number | null;
  hrvAvg: number | null;
  hrvLatest: number | null;
  systolicBpAvg: number | null;
  diastolicBpAvg: number | null;
  systolicBpLatest: number | null;
  diastolicBpLatest: number | null;
  temperatureAvgC: number | null;
  temperatureLatestC: number | null;
  stressAvg: number | null;
  stressLatest?: number | null;
  spo2Max?: number | null;
  hrvMin?: number | null;
  hrvMax?: number | null;
  systolicBpMin?: number | null;
  systolicBpMax?: number | null;
  diastolicBpMin?: number | null;
  diastolicBpMax?: number | null;
  temperatureMinC?: number | null;
  temperatureMaxC?: number | null;
  stressMin?: number | null;
  stressMax?: number | null;
};

export type V8DailyVitalsSyncPayload = {
  seniorId: string;
  platform: 'ios' | 'android';
  syncedAt: number;
  fromDate: string;
  toDate: string;
  device: {
    imei: string | null;
    mac: string | null;
    deviceName: string | null;
    firmwareVersion: string | null;
  };
  days: V8DailyVitalSummary[];
};

export type V8WebVitalSummary = {
  recordDate: string;
  steps: number | null;
  distanceKm: number | null;
  caloriesKcal: number | null;
  exerciseMinutes: number | null;
  activeMinutes: number | null;
  goalPercent: number | null;
  hrMin: number | null;
  hrMax: number | null;
  hrAvg: number | null;
  hrLatest: number | null;
  spo2Min: number | null;
  spo2Max: number | null;
  spo2Avg: number | null;
  spo2Latest: number | null;
  hrvMin: number | null;
  hrvMax: number | null;
  hrvAvg: number | null;
  hrvLatest: number | null;
  systolicBpMin: number | null;
  systolicBpMax: number | null;
  systolicBpAvg: number | null;
  systolicBpLatest: number | null;
  diastolicBpMin: number | null;
  diastolicBpMax: number | null;
  diastolicBpAvg: number | null;
  diastolicBpLatest: number | null;
  tempMin: number | null;
  tempMax: number | null;
  tempAvg: number | null;
  tempLatest: number | null;
  stressMin: number | null;
  stressMax: number | null;
  stressAvg: number | null;
  stressLatest: number | null;
};

export type V8WebVitalsSyncPayload = {
  deviceUUID: string;
  syncDays: number;
  syncFrom: string;
  syncTo: string;
  vitalSummaries: V8WebVitalSummary[];
};
