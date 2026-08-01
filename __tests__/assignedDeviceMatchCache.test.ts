import {
  findCachedAssignedDeviceMatch,
  mergeCachedAssignedDeviceMatches,
  type CachedAssignedDeviceMatch,
} from '../src/utils/assignedDeviceMatchCache';
import type { SeniorAssignedDevice } from '../src/utils/deviceAssignments';

describe('assignedDeviceMatchCache', () => {
  it('merges newer cached entries over older ones', () => {
    const existing: CachedAssignedDeviceMatch[] = [
      {
        seniorId: 'senior-1',
        bleDeviceId: 'ble-1',
        assignmentId: 'assignment-1',
        assignedDeviceId: 'device-1',
        deviceIdentifier: '7510160',
        imei: '123456789012345',
        deviceName: 'Old Name',
        localName: null,
        updatedAt: 100,
      },
    ];

    const merged = mergeCachedAssignedDeviceMatches(existing, [
      {
        ...existing[0],
        deviceName: 'New Name',
        updatedAt: 200,
      },
    ]);

    expect(merged).toEqual([
      expect.objectContaining({
        deviceName: 'New Name',
        updatedAt: 200,
      }),
    ]);
  });

  it('finds a cached match for the current senior assignment', () => {
    const assignedDevice: SeniorAssignedDevice = {
      id: 'assignment-1',
      assignmentId: 'assignment-1',
      deviceId: 'device-1',
      deviceType: null,
      deviceIdentifier: '7510160',
      imei: '123456789012345',
      serialNumber: null,
      barcode: null,
      bluetoothMacAddress: null,
      name: 'Tracker',
      status: 'ASSIGNED',
      raw: {},
    };

    const cachedMatches: CachedAssignedDeviceMatch[] = [
      {
        seniorId: 'senior-1',
        bleDeviceId: 'ble-1',
        assignmentId: 'assignment-1',
        assignedDeviceId: 'device-1',
        deviceIdentifier: '7510160',
        imei: '123456789012345',
        deviceName: 'Tracker BLE',
        localName: 'EV07B',
        updatedAt: 200,
      },
    ];

    expect(
      findCachedAssignedDeviceMatch('senior-1', assignedDevice, cachedMatches),
    ).toEqual(expect.objectContaining({ bleDeviceId: 'ble-1' }));
  });
});
