import {
  extractSeniorAssignedDevices,
  findAssignedDeviceForBleDevice,
  getAssignedHandBandMacAddress,
  normalizeMacAddress,
  resolveConnectedHandBandMac,
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

  it('resolves an assigned hand-band MAC without using the BLE device ID', () => {
    const [fromDedicatedField, fromIdentifier] = extractSeniorAssignedDevices([
      {
        assignmentId: 'assignment-1',
        deviceIdentifier: 'backend-device-id',
        bluetoothMacAddress: 'AA:BB:CC:DD:EE:FF',
      },
      {
        assignmentId: 'assignment-2',
        deviceIdentifier: '11-22-33-44-55-66',
      },
    ]);

    expect(getAssignedHandBandMacAddress(fromDedicatedField)).toBe('AABBCCDDEEFF');
    expect(getAssignedHandBandMacAddress(fromIdentifier)).toBe('112233445566');
    expect(normalizeMacAddress('ios-core-bluetooth-uuid')).toBeNull();
  });

  it('uses the Android BLE device ID when the band has not reported its MAC yet', () => {
    expect(
      resolveConnectedHandBandMac(null, 'aa:bb:cc:dd:ee:ff'),
    ).toBe('AABBCCDDEEFF');
    expect(
      resolveConnectedHandBandMac('11:22:33:44:55:66', 'aa:bb:cc:dd:ee:ff'),
    ).toBe('112233445566');
    expect(
      resolveConnectedHandBandMac(null, 'ios-core-bluetooth-uuid'),
    ).toBeNull();
  });
});
