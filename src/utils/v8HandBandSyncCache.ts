import * as Keychain from 'react-native-keychain';

const V8_HAND_BAND_SYNC_CACHE_SERVICE = 'healthsoft.cache.v8HandBandSync';
const V8_HAND_BAND_SYNC_CACHE_USERNAME = 'v8-hand-band-sync-cache';
export const V8_HAND_BAND_SYNC_REMINDER_MS = 60 * 60 * 1000;
export const V8_HAND_BAND_AUTO_SYNC_INTERVAL_MS = 15 * 60 * 1000;

export interface V8HandBandSyncCacheEntry {
  seniorId: string;
  deviceId: string;
  deviceIdentifier: string | null;
  lastSyncedAt: number | null;
  lastPromptedAt: number | null;
  updatedAt: number;
}

function normalizeString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function entryKey(seniorId: string, deviceId: string): string {
  return `${seniorId.trim()}::${deviceId.trim()}`;
}

function normalizePayload(payload: unknown): V8HandBandSyncCacheEntry[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const seniorId = normalizeString(record.seniorId);
      const deviceId = normalizeString(record.deviceId);
      if (!seniorId || !deviceId) {
        return null;
      }

      return {
        seniorId,
        deviceId,
        deviceIdentifier: normalizeString(record.deviceIdentifier),
        lastSyncedAt: normalizeTimestamp(record.lastSyncedAt),
        lastPromptedAt: normalizeTimestamp(record.lastPromptedAt),
        updatedAt: normalizeTimestamp(record.updatedAt) ?? Date.now(),
      };
    })
    .filter((item): item is V8HandBandSyncCacheEntry => item !== null);
}

async function loadAllEntries(): Promise<V8HandBandSyncCacheEntry[]> {
  const credentials = await Keychain.getGenericPassword({
    service: V8_HAND_BAND_SYNC_CACHE_SERVICE,
  });

  if (!credentials) {
    return [];
  }

  try {
    return normalizePayload(JSON.parse(credentials.password));
  } catch {
    return [];
  }
}

export async function getV8HandBandSyncEntry(
  seniorId: string,
  deviceIdentifier?: string | null,
): Promise<V8HandBandSyncCacheEntry | null> {
  const trimmedSeniorId = seniorId.trim();
  const normalizedIdentifier = deviceIdentifier?.replace(/[^a-fA-F0-9]/g, '').toLowerCase() ?? '';
  if (!trimmedSeniorId) {
    return null;
  }

  const entries = await loadAllEntries();
  return entries.find(entry => {
    if (entry.seniorId !== trimmedSeniorId) {
      return false;
    }
    if (!normalizedIdentifier) {
      return true;
    }
    const entryIdentifier = entry.deviceIdentifier?.replace(/[^a-fA-F0-9]/g, '').toLowerCase() ?? '';
    return entryIdentifier === normalizedIdentifier;
  }) ?? null;
}

async function saveAllEntries(entries: V8HandBandSyncCacheEntry[]): Promise<void> {
  if (entries.length === 0) {
    await Keychain.resetGenericPassword({ service: V8_HAND_BAND_SYNC_CACHE_SERVICE });
    return;
  }

  await Keychain.setGenericPassword(
    V8_HAND_BAND_SYNC_CACHE_USERNAME,
    JSON.stringify(entries),
    {
      service: V8_HAND_BAND_SYNC_CACHE_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
}

export async function upsertV8HandBandSyncAssignment(
  seniorId: string,
  deviceId: string,
  deviceIdentifier?: string | null,
): Promise<V8HandBandSyncCacheEntry> {
  const trimmedSeniorId = seniorId.trim();
  const trimmedDeviceId = deviceId.trim();
  if (!trimmedSeniorId || !trimmedDeviceId) {
    throw new Error('Senior ID and hand band device ID are required.');
  }

  const now = Date.now();
  const entries = await loadAllEntries();
  const key = entryKey(trimmedSeniorId, trimmedDeviceId);
  const existing = entries.find(entry => entryKey(entry.seniorId, entry.deviceId) === key);
  const nextEntry: V8HandBandSyncCacheEntry = {
    seniorId: trimmedSeniorId,
    deviceId: trimmedDeviceId,
    deviceIdentifier: deviceIdentifier?.trim() || existing?.deviceIdentifier || null,
    lastSyncedAt: existing?.lastSyncedAt ?? null,
    lastPromptedAt: existing?.lastPromptedAt ?? null,
    updatedAt: now,
  };
  const nextEntries = [
    nextEntry,
    ...entries.filter(entry => entryKey(entry.seniorId, entry.deviceId) !== key),
  ];
  await saveAllEntries(nextEntries);
  return nextEntry;
}

export async function recordV8HandBandSyncPrompt(
  seniorId: string,
  deviceId: string,
): Promise<V8HandBandSyncCacheEntry | null> {
  const entries = await loadAllEntries();
  const key = entryKey(seniorId, deviceId);
  const existing = entries.find(entry => entryKey(entry.seniorId, entry.deviceId) === key);
  if (!existing) {
    return null;
  }

  const now = Date.now();
  const nextEntry = {
    ...existing,
    lastPromptedAt: now,
    updatedAt: now,
  };
  await saveAllEntries([
    nextEntry,
    ...entries.filter(entry => entryKey(entry.seniorId, entry.deviceId) !== key),
  ]);
  return nextEntry;
}

export async function recordV8HandBandSynced(
  seniorId: string,
  deviceId: string,
  deviceIdentifier?: string | null,
  syncedAt = Date.now(),
): Promise<V8HandBandSyncCacheEntry> {
  const trimmedSeniorId = seniorId.trim();
  const trimmedDeviceId = deviceId.trim();
  if (!trimmedSeniorId || !trimmedDeviceId) {
    throw new Error('Senior ID and hand band device ID are required.');
  }

  const entries = await loadAllEntries();
  const key = entryKey(trimmedSeniorId, trimmedDeviceId);
  const existing = entries.find(entry => entryKey(entry.seniorId, entry.deviceId) === key);
  const nextEntry: V8HandBandSyncCacheEntry = {
    seniorId: trimmedSeniorId,
    deviceId: trimmedDeviceId,
    deviceIdentifier: deviceIdentifier?.trim() || existing?.deviceIdentifier || null,
    lastSyncedAt: syncedAt,
    lastPromptedAt: existing?.lastPromptedAt ?? null,
    updatedAt: syncedAt,
  };
  await saveAllEntries([
    nextEntry,
    ...entries.filter(entry => entryKey(entry.seniorId, entry.deviceId) !== key),
  ]);
  return nextEntry;
}

export function isV8HandBandSyncReminderDue(
  entry: V8HandBandSyncCacheEntry,
  now = Date.now(),
): boolean {
  const lastSyncedAt = entry.lastSyncedAt ?? 0;
  const lastPromptedAt = entry.lastPromptedAt ?? 0;
  return now - lastSyncedAt >= V8_HAND_BAND_SYNC_REMINDER_MS &&
    now - lastPromptedAt >= V8_HAND_BAND_SYNC_REMINDER_MS;
}
