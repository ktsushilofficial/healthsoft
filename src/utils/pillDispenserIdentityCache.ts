import * as Keychain from 'react-native-keychain';

const PILL_DISPENSER_IDENTITY_CACHE_SERVICE = 'healthsoft.cache.pillDispenserIdentity';
const PILL_DISPENSER_IDENTITY_CACHE_USERNAME = 'pill-dispenser-identity-cache';

export interface PillDispenserIdentityPreference {
  advertisedName: string;
  lastDeviceId: string | null;
  updatedAt: number;
}

function normalizeString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return null;
}

function normalizePayload(payload: unknown): PillDispenserIdentityPreference | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const advertisedName = normalizeString(record.advertisedName);
  if (!advertisedName) {
    return null;
  }

  return {
    advertisedName,
    lastDeviceId: normalizeString(record.lastDeviceId),
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : Date.now(),
  };
}

export async function loadPillDispenserIdentityPreference(): Promise<PillDispenserIdentityPreference | null> {
  const credentials = await Keychain.getGenericPassword({
    service: PILL_DISPENSER_IDENTITY_CACHE_SERVICE,
  });

  if (!credentials) {
    return null;
  }

  try {
    return normalizePayload(JSON.parse(credentials.password));
  } catch {
    return null;
  }
}

export async function savePillDispenserIdentityPreference(
  advertisedName: string,
  lastDeviceId?: string | null,
): Promise<PillDispenserIdentityPreference> {
  const normalizedName = advertisedName.trim();
  if (!normalizedName) {
    throw new Error('A dispenser advertised name is required.');
  }

  const nextPreference: PillDispenserIdentityPreference = {
    advertisedName: normalizedName,
    lastDeviceId: normalizeString(lastDeviceId),
    updatedAt: Date.now(),
  };

  await Keychain.setGenericPassword(
    PILL_DISPENSER_IDENTITY_CACHE_USERNAME,
    JSON.stringify(nextPreference),
    {
      service: PILL_DISPENSER_IDENTITY_CACHE_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );

  return nextPreference;
}

export async function clearPillDispenserIdentityPreference(): Promise<void> {
  await Keychain.resetGenericPassword({ service: PILL_DISPENSER_IDENTITY_CACHE_SERVICE });
}
