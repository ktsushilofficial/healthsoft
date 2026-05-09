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
  const distanceRaw =
    toNum(record.distanceKm) ??
    toNum(record.distance) ??
    toNum(record.stepDistance) ??
    toNum(record.totalDistance);
  return {
    timestamp: toText(record.date) ?? toText(record.time) ?? toText(record.timestamp),
    receivedAt: Date.now(),
    heartRate: toNum(record.heartRate) ?? toNum(record.hr),
    hrv: toNum(record.hrv) ?? toNum(record.hrvValue),
    stress: toNum(record.stress),
    systolicBp: toNum(record.highBP) ?? toNum(record.sbp),
    diastolicBp: toNum(record.lowBP) ?? toNum(record.dbp),
    spo2:
      toNum(record.spo2) ??
      toNum(record.SpO2) ??
      toNum(record.oxygen) ??
      toNum(record.oxygenSaturation) ??
      toNum(record.bloodOxygen) ??
      toNum(record.blood_oxygen),
    temperatureC: toNum(record.temperature) ?? toNum(record.temp),
    steps: toNum(record.steps) ?? toNum(record.step) ?? toNum(record.stepCount),
    distanceKm: distanceRaw != null && distanceRaw > 1000 ? distanceRaw / 1000 : distanceRaw,
    caloriesKcal: toNum(record.calories) ?? toNum(record.kcal) ?? toNum(record.calorie),
  };
}

function parseDictDataUnknown(dicData: unknown): Record<string, unknown>[] {
  if (Array.isArray(dicData)) {
    return dicData.filter(item => !!item && typeof item === 'object') as Record<string, unknown>[];
  }

  if (typeof dicData === 'string') {
    const entries = dicData.match(/\{[^{}]*\}/g) ?? [];
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
  }

  if (dicData && typeof dicData === 'object') {
    const asRecord = dicData as Record<string, unknown>;
    const keys = Object.keys(asRecord);
    if (keys.length === 0) return [];

    // iOS can return keyed buckets or a single vital object.
    const objectValues = Object.values(asRecord).filter(v => !!v && typeof v === 'object');
    if (objectValues.length > 0) {
      return objectValues as Record<string, unknown>[];
    }
    return [asRecord];
  }

  return [];
}

export function parseV8Payload(payload: Record<string, unknown>): {
  history: V8HistoryBucket | null;
  infoPatch: Partial<V8DeviceInfo>;
} {
  const dataType = toText(payload.dataType);
  const dataEnd = payload.dataEnd === true || String(payload.dataEnd).toLowerCase() === 'true';

  const dicData = parseDictDataUnknown(payload.dicData);
  let entries = dicData.map(mapEntry);

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
    imei:
      toText(payload.imei) ?? toText(payload.imeiNumber) ?? toText(payload.deviceId) ??
      toText(payload.IMEI) ?? toText(payload.deviceID) ?? toText(payload.imeiStr) ??
      toText(payload.ID) ?? toText(payload.id),
    deviceName:
      toText(payload.deviceName) ?? toText(payload.name) ?? toText(payload.deviceNameValue) ??
      toText(payload.device_name) ?? toText(payload.Name),
    mac:
      toText(payload.mac) ?? toText(payload.macAddress) ?? toText(payload.deviceMac) ??
      toText(payload.MAC) ?? toText(payload.macAddr) ?? toText(payload.mac_address),
    firmwareVersion:
      toText(payload.version) ?? toText(payload.firmwareVersion) ??
      toText(payload.versionName) ?? toText(payload.versionCode) ?? toText(payload.ver) ??
      toText(payload.hardwareVersion) ?? toText(payload.softwareVersion),
    batteryPercent:
      toNum(payload.battery) ?? toNum(payload.batteryLevel) ?? toNum(payload.electricity) ??
      toNum(payload.electricQuantity) ?? toNum(payload.electric) ?? toNum(payload.power) ??
      toNum(payload.batteryValue),
    deviceTime:
      toText(payload.time) ?? toText(payload.deviceTime) ??
      toText(payload.dateTime) ?? toText(payload.currentTime) ?? toText(payload.clock),
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
