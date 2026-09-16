import { buildPillDispenserSettingsUpdates } from '../src/pillDispenser/settingsUpdates';
import type {
  PillDispenserDeviceInformation,
  PillDispenserSettingsInput,
} from '../src/pillDispenser/vendorTypes';

const settings: PillDispenserSettingsInput = {
  timeZoneDistrict: '+0530',
  dateFormat: 2,
  timeFormat: 0,
  timeOut: 30,
  omitting: 120,
  volume: 2,
  unfazedSwitch: 2,
  unfazedStart: '23:00',
  unfazedEnd: '06:30',
};

const reported: PillDispenserDeviceInformation = {
  ...settings,
  language: 2,
  battery: 0,
  batteryVolume: 90,
  rotate: 0,
  uncap: 0,
  wifi: 3,
  gsm: 0,
  currentCeilId: '4',
  ceilRemaining: 12,
  firmwareVersion: '5.6',
};

const keys = (...args: Parameters<typeof buildPillDispenserSettingsUpdates>) =>
  buildPillDispenserSettingsUpdates(...args).map(update => update.key);

describe('buildPillDispenserSettingsUpdates', () => {
  it('sends nothing when every setting already matches the dispenser', () => {
    expect(buildPillDispenserSettingsUpdates(settings, reported)).toEqual([]);
  });

  it('sends only the command for the setting that changed', () => {
    expect(keys({ ...settings, volume: 4 }, reported)).toEqual(['volume']);
    expect(keys({ ...settings, omitting: 60 }, reported)).toEqual(['omitting']);
    expect(keys({ ...settings, timeZoneDistrict: '+0000' }, reported)).toEqual([
      'timezone',
    ]);
  });

  it('sends the single do-not-disturb command for any of its three fields', () => {
    expect(keys({ ...settings, unfazedStart: '22:00' }, reported)).toEqual([
      'disturb',
    ]);
    expect(
      keys(
        { ...settings, unfazedSwitch: 1, unfazedEnd: '07:00' },
        reported,
      ),
    ).toEqual(['disturb']);
  });

  it('does not re-send the formats when the device already reports them', () => {
    const updates = keys({ ...settings, timeOut: 45 }, reported);
    expect(updates).not.toContain('timeFormat');
    expect(updates).not.toContain('dateFormat');
    expect(updates).toEqual(['timeOut']);
  });

  it('sends every command when the device settings are not known yet', () => {
    expect(keys(settings, null)).toEqual([
      'timezone',
      'timeFormat',
      'dateFormat',
      'volume',
      'disturb',
      'omitting',
      'timeOut',
    ]);
  });

  it('labels each update for the confirmation message', () => {
    expect(
      buildPillDispenserSettingsUpdates(
        { ...settings, volume: 1, timeOut: 45 },
        reported,
      ),
    ).toEqual([
      { key: 'volume', label: 'Volume' },
      { key: 'timeOut', label: 'Overtime reminder' },
    ]);
  });
});
