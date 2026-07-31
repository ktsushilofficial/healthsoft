import * as Keychain from 'react-native-keychain';
import {
  PILL_DISPENSER_VENDOR_CONFIG,
  PILL_DISPENSER_VENDOR_HOSTS,
} from './vendorConfig';
import type { PillDispenserLocalRecord } from './vendorTypes';

const STORAGE_SERVICE = 'healthsoft.pill-dispenser.vendor-records';
const STORAGE_USERNAME = 'pill-dispenser-records';

function normalizeHost(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

function parseRecord(value: unknown): PillDispenserLocalRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<PillDispenserLocalRecord>;
  const valid =
    typeof record.ownerKey === 'string' &&
    typeof record.vendorUserId === 'string' &&
    (typeof record.deviceSn === 'string' || record.deviceSn === null) &&
    (typeof record.model === 'string' || record.model === null) &&
    typeof record.updatedAt === 'number';
  if (!valid) return null;

  return {
    ownerKey: record.ownerKey!,
    // Records created before environment scoping were production records.
    vendorHost: normalizeHost(
      typeof record.vendorHost === 'string'
        ? record.vendorHost
        : PILL_DISPENSER_VENDOR_HOSTS.production,
    ),
    vendorUserId: record.vendorUserId!,
    deviceSn: record.deviceSn!,
    model: record.model!,
    updatedAt: record.updatedAt!,
  };
}

async function loadAll(): Promise<PillDispenserLocalRecord[]> {
  const credentials = await Keychain.getGenericPassword({
    service: STORAGE_SERVICE,
  });
  if (!credentials) return [];

  try {
    const parsed = JSON.parse(credentials.password) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .map(parseRecord)
          .filter((record): record is PillDispenserLocalRecord => !!record)
      : [];
  } catch {
    return [];
  }
}

async function saveAll(records: PillDispenserLocalRecord[]): Promise<void> {
  if (records.length === 0) {
    await Keychain.resetGenericPassword({ service: STORAGE_SERVICE });
    return;
  }

  await Keychain.setGenericPassword(STORAGE_USERNAME, JSON.stringify(records), {
    service: STORAGE_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadPillDispenserRecord(
  ownerKey: string,
  vendorHost: string = PILL_DISPENSER_VENDOR_CONFIG.host,
): Promise<PillDispenserLocalRecord | null> {
  const records = await loadAll();
  const currentHost = normalizeHost(vendorHost);
  return (
    records.find(
      record =>
        record.ownerKey === ownerKey && record.vendorHost === currentHost,
    ) ?? null
  );
}

export async function savePillDispenserRecord(
  record: PillDispenserLocalRecord,
): Promise<void> {
  const records = await loadAll();
  const scopedRecord = {
    ...record,
    vendorHost: normalizeHost(record.vendorHost),
  };
  const next = records.filter(
    item =>
      item.ownerKey !== scopedRecord.ownerKey ||
      item.vendorHost !== scopedRecord.vendorHost,
  );
  next.push(scopedRecord);
  await saveAll(next);
}

export async function clearPillDispenserBinding(
  ownerKey: string,
): Promise<PillDispenserLocalRecord | null> {
  const record = await loadPillDispenserRecord(ownerKey);
  if (!record) return null;

  const updated: PillDispenserLocalRecord = {
    ...record,
    deviceSn: null,
    model: null,
    updatedAt: Date.now(),
  };
  await savePillDispenserRecord(updated);
  return updated;
}
