import * as Keychain from 'react-native-keychain';
import type { SeniorAssignedDevice } from './deviceAssignments';

const MATCH_CACHE_SERVICE = 'healthsoft.cache.assignedDeviceMatches';
const MATCH_CACHE_USERNAME = 'assigned-device-match-cache';

export interface CachedAssignedDeviceMatch {
  seniorId: string;
  bleDeviceId: string;
  assignmentId: string | null;
  assignedDeviceId: string | null;
  deviceIdentifier: string | null;
  imei: string | null;
  deviceName: string | null;
  localName: string | null;
  updatedAt: number;
}

function normalizeImei(value?: string | null): string | null {
  if (!value) return null;
  const digitsOnly = value.replace(/\D/g, '');
  return digitsOnly.length > 0 ? digitsOnly : null;
}

function entryKey(entry: CachedAssignedDeviceMatch): string {
  return [
    entry.seniorId,
    entry.assignmentId ?? '',
    entry.assignedDeviceId ?? '',
    normalizeImei(entry.imei) ?? '',
    entry.bleDeviceId,
  ].join('::');
}

function assignedDeviceKey(seniorId: string, assignedDevice: SeniorAssignedDevice): string {
  return [
    seniorId,
    assignedDevice.assignmentId ?? '',
    assignedDevice.deviceId ?? '',
    normalizeImei(assignedDevice.imei ?? assignedDevice.deviceIdentifier ?? assignedDevice.serialNumber) ?? '',
    '',
  ].join('::');
}

function isMatchForAssignedDevice(
  seniorId: string,
  assignedDevice: SeniorAssignedDevice,
  cachedMatch: CachedAssignedDeviceMatch,
): boolean {
  if (cachedMatch.seniorId !== seniorId) {
    return false;
  }

  if (cachedMatch.assignmentId && assignedDevice.assignmentId && cachedMatch.assignmentId === assignedDevice.assignmentId) {
    return true;
  }

  if (cachedMatch.assignedDeviceId && assignedDevice.deviceId && cachedMatch.assignedDeviceId === assignedDevice.deviceId) {
    return true;
  }

  const assignedImei = normalizeImei(
    assignedDevice.imei ?? assignedDevice.deviceIdentifier ?? assignedDevice.serialNumber,
  );
  const cachedImei = normalizeImei(cachedMatch.imei);
  return !!assignedImei && !!cachedImei && assignedImei === cachedImei;
}

function normalizeCachePayload(payload: unknown): CachedAssignedDeviceMatch[] {
  if (!Array.isArray(payload)) {
    return [];
  }

  return payload
    .map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }

      const record = item as Record<string, unknown>;
      const seniorId = typeof record.seniorId === 'string' ? record.seniorId.trim() : '';
      const bleDeviceId = typeof record.bleDeviceId === 'string' ? record.bleDeviceId.trim() : '';
      if (!seniorId || !bleDeviceId) {
        return null;
      }

      return {
        seniorId,
        bleDeviceId,
        assignmentId: typeof record.assignmentId === 'string' ? record.assignmentId : null,
        assignedDeviceId: typeof record.assignedDeviceId === 'string' ? record.assignedDeviceId : null,
        deviceIdentifier: typeof record.deviceIdentifier === 'string' ? record.deviceIdentifier : null,
        imei: typeof record.imei === 'string' || typeof record.imei === 'number' ? String(record.imei) : null,
        deviceName: typeof record.deviceName === 'string' ? record.deviceName : null,
        localName: typeof record.localName === 'string' ? record.localName : null,
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
      };
    })
    .filter((item): item is CachedAssignedDeviceMatch => item !== null);
}

async function loadAllCachedAssignedDeviceMatches(): Promise<CachedAssignedDeviceMatch[]> {
  const credentials = await Keychain.getGenericPassword({
    service: MATCH_CACHE_SERVICE,
  });

  if (!credentials) {
    return [];
  }

  try {
    return normalizeCachePayload(JSON.parse(credentials.password));
  } catch {
    return [];
  }
}

async function saveAllCachedAssignedDeviceMatches(entries: CachedAssignedDeviceMatch[]): Promise<void> {
  if (entries.length === 0) {
    await Keychain.resetGenericPassword({ service: MATCH_CACHE_SERVICE });
    return;
  }

  await Keychain.setGenericPassword(
    MATCH_CACHE_USERNAME,
    JSON.stringify(entries),
    {
      service: MATCH_CACHE_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
}

export function mergeCachedAssignedDeviceMatches(
  existing: CachedAssignedDeviceMatch[],
  incoming: CachedAssignedDeviceMatch[],
): CachedAssignedDeviceMatch[] {
  const map = new Map<string, CachedAssignedDeviceMatch>();

  existing.forEach(entry => {
    map.set(entryKey(entry), entry);
  });

  incoming.forEach(entry => {
    const key = entryKey(entry);
    const current = map.get(key);
    if (!current || entry.updatedAt >= current.updatedAt) {
      map.set(key, entry);
    }
  });

  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCachedAssignedDeviceMatchesForSenior(seniorId: string): Promise<CachedAssignedDeviceMatch[]> {
  const allEntries = await loadAllCachedAssignedDeviceMatches();
  return allEntries.filter(entry => entry.seniorId === seniorId);
}

export async function upsertCachedAssignedDeviceMatches(
  incoming: CachedAssignedDeviceMatch[],
): Promise<CachedAssignedDeviceMatch[]> {
  if (incoming.length === 0) {
    return loadAllCachedAssignedDeviceMatches();
  }

  const allEntries = await loadAllCachedAssignedDeviceMatches();
  const merged = mergeCachedAssignedDeviceMatches(allEntries, incoming);
  await saveAllCachedAssignedDeviceMatches(merged);
  return merged;
}

export async function clearCachedAssignedDeviceMatchesForSenior(seniorId: string): Promise<void> {
  const allEntries = await loadAllCachedAssignedDeviceMatches();
  const filtered = allEntries.filter(entry => entry.seniorId !== seniorId);
  await saveAllCachedAssignedDeviceMatches(filtered);
}

export async function clearAllCachedAssignedDeviceMatches(): Promise<void> {
  await Keychain.resetGenericPassword({ service: MATCH_CACHE_SERVICE });
}

export function findCachedAssignedDeviceMatch(
  seniorId: string,
  assignedDevice: SeniorAssignedDevice,
  cachedMatches: CachedAssignedDeviceMatch[],
): CachedAssignedDeviceMatch | null {
  const directKey = assignedDeviceKey(seniorId, assignedDevice);
  const directMatch = cachedMatches.find(entry => entryKey(entry) === directKey);
  if (directMatch) {
    return directMatch;
  }

  return cachedMatches.find(entry => isMatchForAssignedDevice(seniorId, assignedDevice, entry)) ?? null;
}
