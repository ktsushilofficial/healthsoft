import { extractSeniorAssignedDevices } from '../src/utils/deviceAssignments';
import { buildHomeAssignedDevices } from '../src/utils/homeAssignedDevices';

describe('Home assigned devices', () => {
  const assignments = extractSeniorAssignedDevices([
    {
      deviceId: 'pendant-1',
      deviceType: 'PENDANT',
      name: 'Mum’s pendant',
      imei: '123456789012345',
    },
    {
      deviceId: 'band-1',
      deviceType: 'HAND_BAND',
      deviceIdentifier: 'AA:BB:CC:DD:EE:FF',
    },
    {
      deviceId: 'pill-1',
      deviceType: 'PILL_DISPENSER',
      deviceSn: 'pill-serial',
    },
    { deviceId: 'scale-1', deviceType: 'SCALE', name: 'Bathroom scale' },
  ]);

  it('shows every assigned device without requiring dashboard telemetry', () => {
    const rows = buildHomeAssignedDevices(assignments, []);
    expect(rows.map(row => row.deviceUuid)).toEqual([
      'pendant-1',
      'band-1',
      'pill-1',
      'scale-1',
    ]);
    expect(rows.map(row => row.kind)).toEqual([
      'pendant',
      'band',
      'pillDispenser',
      'other',
    ]);
    expect(
      rows.every(
        row => row.status === 'Assigned' && row.batteryPercent === null,
      ),
    ).toBe(true);
    expect(rows[0]).toMatchObject({
      name: 'Mum’s pendant',
      imei: '123456789012345',
    });
    expect(rows[2].identifier).toBe('pill-serial');
  });

  it('enriches assignments by UUID while excluding unassigned dashboard devices', () => {
    const telemetry = [
      { deviceUUID: 'PENDANT-1', batteryLevel: 72, movementStatus: false },
      { deviceUUID: 'unassigned', batteryLevel: 99, movementStatus: true },
    ];
    const rows = buildHomeAssignedDevices(assignments, telemetry);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ batteryPercent: 72, status: 'Stationary' });
    expect(buildHomeAssignedDevices([], telemetry)).toEqual([]);
  });

  it('does not attach telemetry with a conflicting UUID despite matching IMEI', () => {
    const [row] = buildHomeAssignedDevices(assignments, [
      {
        deviceUUID: 'another-device',
        imei: '123456789012345',
        batteryLevel: 99,
      },
    ]);
    expect(row.batteryPercent).toBeNull();
  });

  it('preserves reported alarms only for the matching assigned device', () => {
    const rows = buildHomeAssignedDevices(assignments, [
      { deviceUUID: 'pendant-1', fallAlarmStatus: true },
      { deviceUUID: 'unassigned', fallAlarmStatus: true },
    ]);
    expect(rows[0].alarmLabel).toBe('Fall reported');
    expect(rows[1].alarmLabel).toBeNull();
  });

  it('prefers the exact UUID over a legacy IMEI-only row', () => {
    const [row] = buildHomeAssignedDevices(assignments, [
      { ident: '123456789012345', batteryLevel: 10 },
      { 'device.uuid': 'pendant-1', batteryLevel: 80 },
    ]);
    expect(row.batteryPercent).toBe(80);
  });

  it('supports unambiguous legacy IMEI telemetry and preserves a zero battery', () => {
    const [row] = buildHomeAssignedDevices(assignments, [
      {
        ident: '123456789012345',
        batteryLevel: 0,
        batteryChargingStatus: true,
      },
    ]);
    expect(row).toMatchObject({ batteryPercent: 0, charging: true });
  });

  it('leaves telemetry unknown when legacy identity matches are ambiguous', () => {
    const [row] = buildHomeAssignedDevices(assignments, [
      { ident: '123456789012345', batteryLevel: 10 },
      { ident: '123456789012345', batteryLevel: 80 },
    ]);
    expect(row.batteryPercent).toBeNull();
  });

  it('shows separate bands and marks only the matching assigned band connected', () => {
    const bands = extractSeniorAssignedDevices([
      { deviceId: 'band-1', deviceIdentifier: 'AA:BB:CC:DD:EE:FF' },
      { deviceId: 'band-2', deviceIdentifier: '11:22:33:44:55:66' },
    ]);
    const rows = buildHomeAssignedDevices(bands, [], ['AABBCCDDEEFF']);
    expect(rows.map(row => row.status)).toEqual(['Connected', 'Assigned']);
    expect(buildHomeAssignedDevices([], [], ['AABBCCDDEEFF'])).toEqual([]);
  });

  it('deduplicates repeated assignments for the same backend device', () => {
    const rows = buildHomeAssignedDevices(
      [assignments[0], { ...assignments[0], id: 'duplicate-assignment' }],
      [],
    );
    expect(rows).toHaveLength(1);
  });

  it('retains assignment status and hides removed devices even if telemetry remains', () => {
    const telemetry = [{ deviceUUID: 'pendant-1', batteryLevel: 72 }];
    const rows = buildHomeAssignedDevices(
      [{ ...assignments[1], status: 'INACTIVE' }],
      telemetry,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      deviceUuid: 'band-1',
      status: 'Inactive',
      batteryPercent: null,
    });
  });
});
