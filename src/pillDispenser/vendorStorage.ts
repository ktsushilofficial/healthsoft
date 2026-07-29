import * as Keychain from 'react-native-keychain';
import type { PillDispenserLocalRecord } from './vendorTypes';

const STORAGE_SERVICE = 'healthsoft.pill-dispenser.vendor-records';
const STORAGE_USERNAME = 'pill-dispenser-records';

function isRecord(value: unknown): value is PillDispenserLocalRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Partial<PillDispenserLocalRecord>;
  return (
    typeof record.ownerKey === 'string' &&
    typeof record.vendorUserId === 'string' &&
    (typeof record.deviceSn === 'string' || record.deviceSn === null) &&
    (typeof record.model === 'string' || record.model === null) &&
    typeof record.updatedAt === 'number'
  );
}

async function loadAll(): Promise<PillDispenserLocalRecord[]> {
  const credentials = await Keychain.getGenericPassword({
    service: STORAGE_SERVICE,
  });
  if (!credentials) return [];

  try {
    const parsed = JSON.parse(credentials.password) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
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
): Promise<PillDispenserLocalRecord | null> {
  const records = await loadAll();
  return records.find(record => record.ownerKey === ownerKey) ?? null;
}

export async function savePillDispenserRecord(
  record: PillDispenserLocalRecord,
): Promise<void> {
  const records = await loadAll();
  const next = records.filter(item => item.ownerKey !== record.ownerKey);
  next.push(record);
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
