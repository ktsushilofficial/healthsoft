import * as Keychain from 'react-native-keychain';

export type SavedPillDispenserWifi = {
  ssid: string;
  password: string;
  updatedAt: number;
};

const STORAGE_SERVICE = 'healthsoft.pill-dispenser.wifi-credentials';
const STORAGE_USERNAME = 'pill-dispenser-wifi-credentials';

function parseProfile(value: unknown): SavedPillDispenserWifi | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const profile = value as Partial<SavedPillDispenserWifi>;
  if (
    typeof profile.ssid !== 'string' ||
    !profile.ssid.trim() ||
    typeof profile.password !== 'string' ||
    typeof profile.updatedAt !== 'number'
  ) {
    return null;
  }
  return {
    ssid: profile.ssid.trim(),
    password: profile.password,
    updatedAt: profile.updatedAt,
  };
}

export async function loadSavedPillDispenserWifi(): Promise<
  SavedPillDispenserWifi[]
> {
  const credentials = await Keychain.getGenericPassword({
    service: STORAGE_SERVICE,
  });
  if (!credentials) return [];

  try {
    const parsed = JSON.parse(credentials.password) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseProfile)
      .filter((profile): profile is SavedPillDispenserWifi => !!profile)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

async function storeProfiles(
  profiles: SavedPillDispenserWifi[],
): Promise<void> {
  if (profiles.length === 0) {
    await Keychain.resetGenericPassword({ service: STORAGE_SERVICE });
    return;
  }
  await Keychain.setGenericPassword(
    STORAGE_USERNAME,
    JSON.stringify(profiles),
    {
      service: STORAGE_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
}

export async function savePillDispenserWifi(
  ssid: string,
  password: string,
  previousSsid?: string | null,
): Promise<SavedPillDispenserWifi[]> {
  const normalizedSsid = ssid.trim();
  if (!normalizedSsid) throw new Error('Wi-Fi name is required.');

  const profiles = await loadSavedPillDispenserWifi();
  const next = profiles.filter(
    profile =>
      profile.ssid !== normalizedSsid &&
      (!previousSsid || profile.ssid !== previousSsid),
  );
  next.unshift({
    ssid: normalizedSsid,
    password,
    updatedAt: Date.now(),
  });
  await storeProfiles(next);
  return next;
}

export async function removePillDispenserWifi(
  ssid: string,
): Promise<SavedPillDispenserWifi[]> {
  const profiles = await loadSavedPillDispenserWifi();
  const next = profiles.filter(profile => profile.ssid !== ssid);
  await storeProfiles(next);
  return next;
}
