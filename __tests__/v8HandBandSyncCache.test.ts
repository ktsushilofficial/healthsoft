import * as Keychain from 'react-native-keychain';
import {
  V8_HAND_BAND_AUTO_SYNC_INTERVAL_MS,
  getV8HandBandSyncEntry,
} from '../src/utils/v8HandBandSyncCache';

describe('v8HandBandSyncCache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses a 15 minute automatic sync interval', () => {
    expect(V8_HAND_BAND_AUTO_SYNC_INTERVAL_MS).toBe(15 * 60 * 1000);
  });

  it('loads the cached sync time for the matching senior and hand band MAC', async () => {
    (Keychain.getGenericPassword as jest.Mock).mockResolvedValueOnce({
      username: 'v8-hand-band-sync-cache',
      password: JSON.stringify([
        {
          seniorId: 'senior-1',
          deviceId: 'device-1',
          deviceIdentifier: 'AA:BB:CC:DD:EE:FF',
          lastSyncedAt: 123456,
          lastPromptedAt: null,
          updatedAt: 123456,
        },
      ]),
    });

    await expect(getV8HandBandSyncEntry('senior-1', 'aa-bb-cc-dd-ee-ff')).resolves.toEqual(
      expect.objectContaining({
        deviceId: 'device-1',
        lastSyncedAt: 123456,
      }),
    );
  });
});
