import type {
  PillDispenserDeviceInformation,
  PillDispenserSettingsInput,
} from './vendorTypes';

export type PillDispenserSettingsUpdateKey =
  | 'timezone'
  | 'timeFormat'
  | 'dateFormat'
  | 'volume'
  | 'disturb'
  | 'omitting'
  | 'timeOut';

export type PillDispenserSettingsUpdate = {
  key: PillDispenserSettingsUpdateKey;
  label: string;
};

// Each entry is one vendor endpoint. The dispenser announces a setting change
// out loud, so an unchanged value must never be re-sent.
const UPDATES: Array<{
  key: PillDispenserSettingsUpdateKey;
  label: string;
  fields: Array<keyof PillDispenserSettingsInput>;
}> = [
  { key: 'timezone', label: 'Timezone', fields: ['timeZoneDistrict'] },
  { key: 'timeFormat', label: 'Time format', fields: ['timeFormat'] },
  { key: 'dateFormat', label: 'Date format', fields: ['dateFormat'] },
  { key: 'volume', label: 'Volume', fields: ['volume'] },
  {
    key: 'disturb',
    label: 'Do not disturb',
    fields: ['unfazedSwitch', 'unfazedStart', 'unfazedEnd'],
  },
  { key: 'omitting', label: 'Missed-dose reminder', fields: ['omitting'] },
  { key: 'timeOut', label: 'Overtime reminder', fields: ['timeOut'] },
];

/**
 * The vendor commands needed to move the dispenser from its reported settings
 * to the requested ones. With no reported settings to compare against, every
 * command is required.
 */
export function buildPillDispenserSettingsUpdates(
  next: PillDispenserSettingsInput,
  current: PillDispenserDeviceInformation | null,
): PillDispenserSettingsUpdate[] {
  return UPDATES.filter(update =>
    current
      ? update.fields.some(field => current[field] !== next[field])
      : true,
  ).map(({ key, label }) => ({ key, label }));
}
