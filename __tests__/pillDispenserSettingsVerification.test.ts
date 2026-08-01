import { findPillDispenserSettingsMismatches } from '../src/pillDispenser/settingsVerification';
import type {
  PillDispenserDeviceInformation,
  PillDispenserSettingsInput,
} from '../src/pillDispenser/vendorTypes';

const expected: PillDispenserSettingsInput = {
  language: 2,
  timeZoneDistrict: '+0530',
  dateFormat: 2,
  timeFormat: 1,
  timeOut: 30,
  omitting: 120,
  volume: 1,
  unfazedSwitch: 1,
  unfazedStart: '23:00',
  unfazedEnd: '06:00',
};

const actual: PillDispenserDeviceInformation = {
  ...expected,
  battery: 1,
  batteryVolume: 100,
  rotate: 0,
  uncap: 1,
  wifi: 4,
  gsm: 0,
  currentCeilId: '0',
  ceilRemaining: 28,
  firmwareVersion: '5.6',
};

describe('findPillDispenserSettingsMismatches', () => {
  it('confirms every saved setting when the device reports matching values', () => {
    expect(findPillDispenserSettingsMismatches(expected, actual)).toEqual([]);
  });

  it('identifies each setting that the device did not apply', () => {
    expect(
      findPillDispenserSettingsMismatches(expected, {
        ...actual,
        language: 1,
        timeZoneDistrict: '+0000',
        timeOut: 60,
      }),
    ).toEqual(['Language', 'Timezone', 'Overtime reminder']);
  });
});
