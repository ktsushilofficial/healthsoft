import type {
  PillDispenserDeviceInformation,
  PillDispenserSettingsInput,
} from './vendorTypes';

const SETTINGS_FIELDS: Array<{
  key: keyof PillDispenserSettingsInput;
  label: string;
}> = [
  { key: 'language', label: 'Language' },
  { key: 'timeZoneDistrict', label: 'Timezone' },
  { key: 'timeFormat', label: 'Time format' },
  { key: 'dateFormat', label: 'Date format' },
  { key: 'volume', label: 'Volume' },
  { key: 'unfazedSwitch', label: 'Do not disturb' },
  { key: 'unfazedStart', label: 'DND start time' },
  { key: 'unfazedEnd', label: 'DND end time' },
  { key: 'omitting', label: 'Missed-dose reminder' },
  { key: 'timeOut', label: 'Overtime reminder' },
];

export function findPillDispenserSettingsMismatches(
  expected: PillDispenserSettingsInput,
  actual: PillDispenserDeviceInformation,
): string[] {
  return SETTINGS_FIELDS
    .filter(({ key }) => actual[key] !== expected[key])
    .map(({ label }) => label);
}
