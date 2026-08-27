import {
  dashboardDeviceIdentityMatches,
  getDashboardDeviceImei,
  getDashboardDeviceUuid,
} from '../src/utils/dashboardDeviceIdentity';

describe('dashboardDeviceIdentity', () => {
  it('reads and trims the flattened dashboard UUID and IMEI fields', () => {
    const row = {
      'device.uuid': ' uuid-123 ',
      imei: ' 123456789012345 ',
      ident: 'legacy-ident',
    };

    expect(getDashboardDeviceUuid(row)).toBe('uuid-123');
    expect(getDashboardDeviceImei(row)).toBe('123456789012345');
  });

  it('supports camelCase and nested device UUID payloads', () => {
    expect(getDashboardDeviceUuid({ deviceUUID: 'uuid-a' })).toBe('uuid-a');
    expect(getDashboardDeviceUuid({ deviceUuid: 'uuid-b' })).toBe('uuid-b');
    expect(getDashboardDeviceUuid({ device: { uuid: 'uuid-c' } })).toBe('uuid-c');
  });

  it('uses ident as the legacy IMEI fallback and accepts numeric IMEIs', () => {
    expect(getDashboardDeviceImei({ ident: 'legacy-imei' })).toBe('legacy-imei');
    expect(getDashboardDeviceImei({ imei: 123456789012345 })).toBe('123456789012345');
  });

  it('matches the tapped pendant by UUID before using the IMEI fallback', () => {
    const row = { deviceUUID: 'UUID-1', imei: 'imei-1' };

    expect(
      dashboardDeviceIdentityMatches(row, {
        deviceUuid: 'uuid-1',
        imei: 'different-imei',
      }),
    ).toBe(true);
    expect(
      dashboardDeviceIdentityMatches(row, {
        deviceUuid: 'different-uuid',
        imei: 'IMEI-1',
      }),
    ).toBe(false);
    expect(
      dashboardDeviceIdentityMatches(
        { imei: 'imei-1' },
        { deviceUuid: 'uuid-not-in-this-payload', imei: 'IMEI-1' },
      ),
    ).toBe(true);
  });

  it('does not accidentally match a row when no identity was passed', () => {
    expect(dashboardDeviceIdentityMatches({ deviceUUID: 'uuid-1' }, {})).toBe(false);
  });
});
