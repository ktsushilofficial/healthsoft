import { PermissionsAndroid, Platform } from 'react-native';
import { requestHandBandPermissions } from '../src/v8/permissions';

describe('hand band permissions', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;
  afterEach(() => {
    Platform.OS = originalOS;
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: originalVersion,
    });
    jest.restoreAllMocks();
  });

  it.each([30, 31, 35])(
    'requests the permissions required for a fresh Android %i install',
    async version => {
      Platform.OS = 'android';
      Object.defineProperty(Platform, 'Version', {
        configurable: true,
        value: version,
      });
      const request = jest
        .spyOn(PermissionsAndroid, 'requestMultiple')
        .mockImplementation(
          async permissions =>
            Object.fromEntries(
              permissions.map(permission => [permission, 'granted']),
            ) as any,
        );
      await requestHandBandPermissions();
      expect(request).toHaveBeenCalledWith(
        version >= 31
          ? [
              'android.permission.BLUETOOTH_SCAN',
              'android.permission.BLUETOOTH_CONNECT',
            ]
          : ['android.permission.ACCESS_FINE_LOCATION'],
      );
    },
  );

  it('blocks scanning when any required permission is denied', async () => {
    Platform.OS = 'android';
    Object.defineProperty(Platform, 'Version', {
      configurable: true,
      value: 35,
    });
    jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue({
      'android.permission.BLUETOOTH_SCAN': 'granted',
      'android.permission.BLUETOOTH_CONNECT': 'never_ask_again',
    } as any);
    await expect(requestHandBandPermissions()).rejects.toThrow(
      'Bluetooth permission is required',
    );
  });

  it('leaves iOS authorization to CoreBluetooth', async () => {
    Platform.OS = 'ios';
    const request = jest.spyOn(PermissionsAndroid, 'requestMultiple');
    await requestHandBandPermissions();
    expect(request).not.toHaveBeenCalled();
  });
});
