import { parseMeasurementTimestamp } from '../utils/sampleDay';
import type { V8DeviceInfo, V8HistoryBucket, V8VitalSample } from './models';

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toText(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function readAnyKey(source: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  const target = normalizeKey(key);
  for (const [k, v] of Object.entries(source)) {
    if (normalizeKey(k) === target) return v;
  }
  return undefined;
}

function mapEntry(record: Record<string, unknown>): V8VitalSample {
  const parseBpPart = (value: unknown, index: 0 | 1): number | null => {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    const match = text.match(/(\d{2,3})\s*[/\\-]\s*(\d{2,3})/);
    if (!match) return null;
    const raw = Number(match[index + 1]);
    return Number.isFinite(raw) ? raw : null;
  };
  const pickNum = (...keys: string[]): number | null => {
    for (const key of keys) {
      const val = toNum(readAnyKey(record, key));
      if (val != null) return val;
    }
    return null;
  };

  const distanceRaw = pickNum(
    'distanceKm',
    'distance',
    'stepDistance',
    'totalDistance',
  );
  const systolicFromPair =
    parseBpPart(readAnyKey(record, 'bp'), 0) ??
    parseBpPart(readAnyKey(record, 'BP'), 0) ??
    parseBpPart(readAnyKey(record, 'bloodPressure'), 0);
  const diastolicFromPair =
    parseBpPart(readAnyKey(record, 'bp'), 1) ??
    parseBpPart(readAnyKey(record, 'BP'), 1) ??
    parseBpPart(readAnyKey(record, 'bloodPressure'), 1);
  return {
    timestamp:
      toText(readAnyKey(record, 'date')) ??
      toText(readAnyKey(record, 'time')) ??
      toText(readAnyKey(record, 'timestamp')) ??
      toText(readAnyKey(record, 'dateTime')) ??
      toText(readAnyKey(record, 'measureTime')) ??
      toText(readAnyKey(record, 'startTime')) ??
      toText(readAnyKey(record, 'historyDate')) ??
      toText(readAnyKey(record, 'day')),
    receivedAt: Date.now(),
    heartRate: pickNum(
      'heartRate',
      'hr',
      'singleHR',
      'HeartRate',
      'heartRateValue',
      'onceHeartValue',
      'HR',
    ),
    hrv: pickNum('hrv', 'hrvValue', 'HRV'),
    stress: pickNum('stress', 'stressValue', 'fatigueDegree'),
    systolicBp:
      pickNum(
        'highBP',
        'sbp',
        'sys',
        'sysBp',
        'systolic',
        'systolicBP',
        'highPressure',
        'bloodHigh',
        'KHrvBloodHighPressure',
      ) ?? systolicFromPair,
    diastolicBp:
      pickNum(
        'lowBP',
        'dbp',
        'dia',
        'diaBp',
        'diastolic',
        'diastolicBP',
        'lowPressure',
        'bloodLow',
        'KHrvBloodLowPressure',
      ) ?? diastolicFromPair,
    spo2: pickNum(
      'spo2',
      'SpO2',
      'Blood_oxygen',
      'BloodOxygen',
      'bloodOxygen',
      'blood_oxygen',
      'oxygen',
      'oxygenSaturation',
      'oxygenValue',
      'oxygenPercent',
      'spo2Value',
      'bloodSpo2',
      'automaticSpo2Data',
      'manualSpo2Data',
    ),
    temperatureC: pickNum(
      'temperature',
      'temp',
      'axillaryTemperature',
      'TempData',
    ),
    steps: pickNum('steps', 'step', 'stepCount', 'detailMinterStep'),
    // Vendor SDK output is already in km and kcal.
    distanceKm: distanceRaw,
    caloriesKcal: pickNum('calories', 'kcal', 'calorie'),
    exerciseMinutes: pickNum('exerciseMinutes', 'sportMinutes'),
    activeMinutes: pickNum('activeMinutes', 'StrengthTrainingTime'),
    goalPercent: pickNum('goal', 'goalPercent'),
  };
}

function parseNumberSeries(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => parseNumberSeries(item));
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [value] : [];
  }
  if (typeof value !== 'string') return [];
  return value
    .trim()
    .split(/[\s,;|]+/)
    .map(item => Number(item))
    .filter(Number.isFinite);
}

function offsetSeriesTimestamp(
  timestamp: string | null,
  index: number,
): string | null {
  if (!timestamp || index === 0) return timestamp;
  const base = parseMeasurementTimestamp(timestamp);
  if (base == null) return timestamp;
  const date = new Date(base + index * 5_000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

function mapRecordEntries(record: Record<string, unknown>): V8VitalSample[] {
  const dynamicHeartRates = parseNumberSeries(
    readAnyKey(record, 'arrayDynamicHR') ??
      readAnyKey(record, 'arrayContinuousHR'),
  );
  if (dynamicHeartRates.length === 0) return [mapEntry(record)];

  const base = mapEntry(record);
  return dynamicHeartRates.map((heartRate, index) => ({
    ...base,
    timestamp: offsetSeriesTimestamp(base.timestamp, index),
    receivedAt: base.receivedAt,
    heartRate,
  }));
}

function parseDictDataUnknown(dicData: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];

  const parseRecordString = (value: string): Record<string, unknown>[] => {
    const entries = value.match(/\{[^{}]*\}/g) ?? [];
    return entries.map(raw => {
      const body = raw.slice(1, -1);
      const obj: Record<string, unknown> = {};
      body.split(',').forEach(pair => {
        const [k, ...rest] = pair.split('=');
        if (!k || rest.length === 0) return;
        obj[k.trim()] = rest.join('=').trim();
      });
      return obj;
    });
  };

  const collect = (node: unknown): void => {
    if (node == null) return;

    if (typeof node === 'string') {
      parseRecordString(node).forEach(item => out.push(item));
      return;
    }

    if (Array.isArray(node)) {
      node.forEach(item => collect(item));
      return;
    }

    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const values = Object.values(obj);
      const hasPrimitiveValue = values.some(
        v => v == null || (typeof v !== 'object' && !Array.isArray(v)),
      );
      if (hasPrimitiveValue) {
        out.push(obj);
      }
      values.forEach(v => collect(v));
    }
  };

  collect(dicData);
  return out;
}

function detectDataTypeFromPayload(
  payload: Record<string, unknown>,
  platform?: 'ios' | 'android',
): string | null {
  const raw = payload.dicData;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const keys = Object.keys(raw);
    if (keys.includes('arrayTotalActivityData')) return 'totalActivity';
    if (keys.includes('arrayDetailActivityData')) return 'detailActivity';
    if (keys.includes('arrayDetailSleepData')) return 'sleep';
    if (keys.includes('arrayContinuousHR')) return 'dynamicHR';
    if (keys.includes('arraySingleHR')) return 'staticHR';
    if (keys.includes('arrayDynamicHR')) return 'dynamicHR';
    if (keys.includes('arrayHrvData')) return 'hrv';
    if (
      keys.includes('arrayAutomaticSpo2Data') ||
      keys.includes('arrayManualSpo2Data') ||
      keys.includes('arrayBloodOxygenData')
    )
      return 'spo2';
    if (
      keys.includes('arrayemperatureData') ||
      keys.includes('arrayTemperatureData')
    )
      return 'temperature';
  }

  const dataType = toText(payload.dataType);
  if (!dataType) return null;
  if (
    [
      'totalActivity',
      'detailActivity',
      'sleep',
      'dynamicHR',
      'staticHR',
      'hrv',
      'spo2',
      'temperature',
      'realtimeActivity',
    ].includes(dataType)
  )
    return dataType;
  const ios: Record<string, string> = {
    '24': 'realtimeActivity',
    '25': 'totalActivity',
    '26': 'detailActivity',
    '27': 'sleep',
    '28': 'dynamicHR',
    '29': 'staticHR',
    '41': 'hrv',
    '45': 'spo2',
    '46': 'spo2',
    '48': 'temperature',
    '49': 'temperature',
    '58': 'staticHR',
    '59': 'hrv',
    '60': 'spo2',
  };
  const android: Record<string, string> = {
    '23': 'realtimeActivity',
    '24': 'totalActivity',
    '25': 'detailActivity',
    '26': 'sleep',
    '27': 'dynamicHR',
    '28': 'staticHR',
    '42': 'hrv',
    '55': 'spo2',
    '68': 'spo2',
    '36': 'temperature',
    '59': 'temperature',
    '62': 'temperature',
    '73': 'hrv',
    '74': 'staticHR',
    '75': 'spo2',
  };
  return (platform === 'ios' ? ios : android)[dataType] ?? null;
}

export function parseV8Payload(
  payload: Record<string, unknown>,
  platform?: 'ios' | 'android',
): {
  history: V8HistoryBucket | null;
  infoPatch: Partial<V8DeviceInfo>;
} {
  const dataType = detectDataTypeFromPayload(payload, platform);
  const rawType = toText(payload.dataType);
  const sampleSource =
    (platform === 'ios'
      ? ['24', '58', '59', '60']
      : ['23', '73', '74', '75']
    ).includes(rawType ?? '') || dataType === 'realtimeActivity'
      ? ('live' as const)
      : ('history' as const);
  const dataEnd =
    payload.dataEnd === true ||
    String(payload.dataEnd).toLowerCase() === 'true';

  const dicData = parseDictDataUnknown(payload.dicData);
  let entries = dicData.flatMap(mapRecordEntries);

  const infoSources: Record<string, unknown>[] = [payload, ...dicData];
  const pickText = (...keys: string[]): string | null => {
    for (const source of infoSources) {
      for (const key of keys) {
        const val = toText(readAnyKey(source, key));
        if (val != null) return val;
      }
    }
    return null;
  };
  const pickNum = (...keys: string[]): number | null => {
    for (const source of infoSources) {
      for (const key of keys) {
        const val = toNum(readAnyKey(source, key));
        if (val != null) return val;
      }
    }
    return null;
  };

  // iOS sometimes puts live fields directly in payload instead of dicData.
  if (entries.length === 0) {
    const directEntry = mapEntry(payload);
    const hasAnyVital =
      directEntry.heartRate != null ||
      directEntry.spo2 != null ||
      directEntry.systolicBp != null ||
      directEntry.diastolicBp != null ||
      directEntry.temperatureC != null ||
      directEntry.steps != null ||
      directEntry.distanceKm != null;
    if (hasAnyVital) {
      entries = [directEntry];
    }
  }

  const infoPatch: Partial<V8DeviceInfo> = {
    imei: pickText(
      'imei',
      'imeiNumber',
      'deviceId',
      'IMEI',
      'deviceID',
      'imeiStr',
      'ID',
      'id',
      'serialNumber',
      'sn',
      'SN',
      'deviceIdentifier',
      'identifier',
    ),
    deviceName: pickText(
      'deviceName',
      'name',
      'deviceNameValue',
      'device_name',
      'Name',
    ),
    mac: pickText(
      'mac',
      'macAddress',
      'deviceMac',
      'MAC',
      'macAddr',
      'mac_address',
      'strMac',
    ),
    firmwareVersion: pickText(
      'version',
      'firmwareVersion',
      'versionName',
      'versionCode',
      'ver',
      'hardwareVersion',
      'softwareVersion',
    ),
    batteryPercent: pickNum(
      'battery',
      'batteryLevel',
      'electricity',
      'electricQuantity',
      'electric',
      'power',
      'batteryValue',
      'bat',
      'Battery',
    ),
    deviceTime: pickText(
      'time',
      'deviceTime',
      'dateTime',
      'currentTime',
      'clock',
    ),
    updatedAt: Date.now(),
  };

  entries = entries
    .filter(entry =>
      Object.entries(entry).some(
        ([key, value]) =>
          key !== 'receivedAt' &&
          key !== 'timestamp' &&
          typeof value === 'number' &&
          Number.isFinite(value),
      ),
    )
    .map(entry => ({ ...entry, source: sampleSource }));

  // Device time comes from the time response, not a history record's dateTime.
  if (rawType !== '0') infoPatch.deviceTime = null;
  if (!dataType) {
    return { history: null, infoPatch };
  }

  return {
    history: {
      dataType,
      source: sampleSource,
      entries,
      completed: dataEnd,
      updatedAt: Date.now(),
    },
    infoPatch,
  };
}
