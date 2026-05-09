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

  const distanceRaw =
    toNum(record.distanceKm) ??
    toNum(record.distance) ??
    toNum(record.stepDistance) ??
    toNum(record.totalDistance);
  const systolicFromPair =
    parseBpPart(record.bp, 0) ??
    parseBpPart(record.BP, 0) ??
    parseBpPart(record.bloodPressure, 0);
  const diastolicFromPair =
    parseBpPart(record.bp, 1) ??
    parseBpPart(record.BP, 1) ??
    parseBpPart(record.bloodPressure, 1);
  return {
    timestamp:
      toText(record.date) ??
      toText(record.time) ??
      toText(record.timestamp) ??
      toText(record.dateTime) ??
      toText(record.measureTime) ??
      toText(record.startTime) ??
      toText(record.historyDate) ??
      toText(record.day),
    receivedAt: Date.now(),
    heartRate: toNum(record.heartRate) ?? toNum(record.hr) ?? toNum(record.singleHR),
    hrv: toNum(record.hrv) ?? toNum(record.hrvValue),
    stress: toNum(record.stress),
    systolicBp:
      toNum(record.highBP) ??
      toNum(record.sbp) ??
      toNum(record.sys) ??
      toNum(record.sysBp) ??
      toNum(record.systolic) ??
      toNum(record.systolicBP) ??
      toNum(record.highPressure) ??
      toNum(record.bloodHigh) ??
      systolicFromPair,
    diastolicBp:
      toNum(record.lowBP) ??
      toNum(record.dbp) ??
      toNum(record.dia) ??
      toNum(record.diaBp) ??
      toNum(record.diastolic) ??
      toNum(record.diastolicBP) ??
      toNum(record.lowPressure) ??
      toNum(record.bloodLow) ??
      diastolicFromPair,
    spo2:
      toNum(record.spo2) ??
      toNum(record.SpO2) ??
      toNum(record.oxygen) ??
      toNum(record.oxygenSaturation) ??
      toNum(record.bloodOxygen) ??
      toNum(record.blood_oxygen) ??
      toNum(record.oxygenValue) ??
      toNum(record.oxygenPercent) ??
      toNum(record.spo2Value) ??
      toNum(record.bloodSpo2) ??
      toNum(record.automaticSpo2Data) ??
      toNum(record.manualSpo2Data),
    temperatureC: toNum(record.temperature) ?? toNum(record.temp),
    steps: toNum(record.steps) ?? toNum(record.step) ?? toNum(record.stepCount),
    distanceKm: distanceRaw != null && distanceRaw > 1000 ? distanceRaw / 1000 : distanceRaw,
    caloriesKcal: toNum(record.calories) ?? toNum(record.kcal) ?? toNum(record.calorie),
  };
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
      const hasPrimitiveValue = values.some(v =>
        v == null || (typeof v !== 'object' && !Array.isArray(v)),
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

export function parseV8Payload(payload: Record<string, unknown>): {
  history: V8HistoryBucket | null;
  infoPatch: Partial<V8DeviceInfo>;
} {
  const dataType = toText(payload.dataType);
  const dataEnd = payload.dataEnd === true || String(payload.dataEnd).toLowerCase() === 'true';

  const dicData = parseDictDataUnknown(payload.dicData);
  let entries = dicData.map(mapEntry);

  const infoSources: Record<string, unknown>[] = [payload, ...dicData];
  const normalizeKey = (key: string) => key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const readAnyKey = (source: Record<string, unknown>, key: string): unknown => {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
    const target = normalizeKey(key);
    for (const [k, v] of Object.entries(source)) {
      if (normalizeKey(k) === target) return v;
    }
    return undefined;
  };
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
      'imei', 'imeiNumber', 'deviceId', 'IMEI', 'deviceID', 'imeiStr',
      'ID', 'id', 'serialNumber', 'sn', 'SN', 'deviceIdentifier', 'identifier',
    ),
    deviceName: pickText('deviceName', 'name', 'deviceNameValue', 'device_name', 'Name'),
    mac: pickText('mac', 'macAddress', 'deviceMac', 'MAC', 'macAddr', 'mac_address'),
    firmwareVersion: pickText(
      'version', 'firmwareVersion', 'versionName', 'versionCode',
      'ver', 'hardwareVersion', 'softwareVersion',
    ),
    batteryPercent: pickNum(
      'battery', 'batteryLevel', 'electricity', 'electricQuantity',
      'electric', 'power', 'batteryValue', 'bat', 'Battery',
    ),
    deviceTime: pickText('time', 'deviceTime', 'dateTime', 'currentTime', 'clock'),
    updatedAt: Date.now(),
  };

  if (!dataType && entries.length === 0) {
    return { history: null, infoPatch };
  }

  return {
    history: {
      dataType,
      entries,
      completed: dataEnd,
      updatedAt: Date.now(),
    },
    infoPatch,
  };
}
