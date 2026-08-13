import * as Keychain from 'react-native-keychain';
import {
  loadSavedPillDispenserWifi,
  removePillDispenserWifi,
  savePillDispenserWifi,
} from '../src/pillDispenser/wifiCredentialStorage';

const getGenericPassword = Keychain.getGenericPassword as jest.Mock;
const setGenericPassword = Keychain.setGenericPassword as jest.Mock;
const resetGenericPassword = Keychain.resetGenericPassword as jest.Mock;

describe('pill dispenser Wi-Fi credential storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getGenericPassword.mockResolvedValue(false);
  });

  it('saves Wi-Fi credentials in device-only Keychain storage', async () => {
    await savePillDispenserWifi('Care Home', 'secret');

    expect(setGenericPassword).toHaveBeenCalledWith(
      'pill-dispenser-wifi-credentials',
      expect.any(String),
      expect.objectContaining({
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    );
    expect(JSON.parse(setGenericPassword.mock.calls[0][1])).toEqual([
      expect.objectContaining({ ssid: 'Care Home', password: 'secret' }),
    ]);
  });

  it('updates an edited SSID without keeping the old entry', async () => {
    getGenericPassword.mockResolvedValue({
      username: 'pill-dispenser-wifi-credentials',
      password: JSON.stringify([
        { ssid: 'Old Wi-Fi', password: 'old', updatedAt: 1 },
        { ssid: 'Guest', password: 'guest', updatedAt: 2 },
      ]),
    });

    const saved = await savePillDispenserWifi(
      'New Wi-Fi',
      'new-password',
      'Old Wi-Fi',
    );

    expect(saved.map(profile => profile.ssid)).toEqual([
      'New Wi-Fi',
      'Guest',
    ]);
  });

  it('removes the Keychain entry after deleting the last profile', async () => {
    getGenericPassword.mockResolvedValue({
      username: 'pill-dispenser-wifi-credentials',
      password: JSON.stringify([
        { ssid: 'Care Home', password: 'secret', updatedAt: 1 },
      ]),
    });

    await expect(removePillDispenserWifi('Care Home')).resolves.toEqual([]);
    expect(resetGenericPassword).toHaveBeenCalled();
  });

  it('ignores malformed saved data', async () => {
    getGenericPassword.mockResolvedValue({
      username: 'pill-dispenser-wifi-credentials',
      password: '{invalid',
    });

    await expect(loadSavedPillDispenserWifi()).resolves.toEqual([]);
  });
});
