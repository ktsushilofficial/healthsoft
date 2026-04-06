import {
  extractSeniorAssignedDevices,
  findAssignedDeviceForBleDevice,
  resolveDisplayedImei,
} from '../src/utils/deviceAssignments';

describe('deviceAssignments', () => {
  it('extracts assigned devices from the senior-device assignment payload', () => {
    const devices = extractSeniorAssignedDevices([
      {
        assignmentId: 'assignment-1',
        deviceId: 'device-1',
        deviceIdentifier: '7510160',
        imei: '123456789012345',
        status: 'ASSIGNED',
      },
    ]);

    expect(devices).toEqual([
      expect.objectContaining({
        id: 'assignment-1',
        assignmentId: 'assignment-1',
        deviceId: 'device-1',
        deviceIdentifier: '7510160',
        imei: '123456789012345',
        status: 'ASSIGNED',
      }),
    ]);
  });

  it('matches BLE devices to assigned devices by IMEI', () => {
    const assignedDevices = extractSeniorAssignedDevices([
      {
        id: 'assignment-1',
        imei: '123456789012345',
        deviceName: 'Senior Tracker',
      },
    ]);

    const match = findAssignedDeviceForBleDevice(
      {
        id: 'ble-device-1',
        name: 'Nearby tracker',
        localName: null,
        rssi: -52,
        isConnectable: true,
        serviceUUIDs: null,
      },
      {
        imei: '123456789012345',
      },
      assignedDevices,
    );

    expect(match?.id).toBe('assignment-1');
  });

  it('falls back to the assigned IMEI when BLE identity is not ready yet', () => {
    const assignedDevices = extractSeniorAssignedDevices([
      {
        id: 'assignment-1',
        imei: '123456789012345',
      },
    ]);

    expect(resolveDisplayedImei(undefined, assignedDevices[0])).toBe('123456789012345');
  });
});
