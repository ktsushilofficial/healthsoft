import { PermissionsAndroid, Platform } from 'react-native';

export async function requestHandBandPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const permissions =
    Platform.Version >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const grants = await PermissionsAndroid.requestMultiple(permissions);
  if (
    !permissions.every(
      permission => grants[permission] === PermissionsAndroid.RESULTS.GRANTED,
    )
  ) {
    throw new Error(
      'Bluetooth permission is required. Allow Nearby devices (or Location on older Android phones) in app settings, then scan again.',
    );
  }
}
