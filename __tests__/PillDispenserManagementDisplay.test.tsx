import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import PillDispenserManagementSection from '../src/components/PillDispenserManagementSection';
import { pillDispenserVendorApi } from '../src/pillDispenser/vendorApi';
import { loadPillDispenserRecord } from '../src/pillDispenser/vendorStorage';
import type {
  PillDispenserDeviceInformation,
  PillDispenserPlan,
} from '../src/pillDispenser/vendorTypes';

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactHooks = require('react');
    ReactHooks.useEffect(() => callback(), [callback]);
  },
}));
// Stable identities: a new object per render would restart the focus effects.
const mockUser = {
  role: 'SENIOR',
  user_id: 'senior-1',
  first_name: 'Test',
  phone_number: '1234567890',
};
const mockGetAssignedDevices = jest.fn(async () => []);
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    isCaretaker: false,
    selectedSenior: null,
    getAssignedDevicesForSenior: mockGetAssignedDevices,
  }),
}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
jest.mock('../src/pillDispenser/vendorStorage', () => ({
  loadPillDispenserRecord: jest.fn(),
  savePillDispenserRecord: jest.fn(),
  clearPillDispenserBinding: jest.fn(),
}));
jest.mock('../src/pillDispenser/vendorApi', () => ({
  ...jest.requireActual('../src/pillDispenser/vendorApi'),
  pillDispenserVendorApi: {
    getStatus: jest.fn(),
    getInformation: jest.fn(),
    getPlan: jest.fn(),
    setVolume: jest.fn(),
    setTimezone: jest.fn(),
    setTimeFormat: jest.fn(),
    setDateFormat: jest.fn(),
    setDisturb: jest.fn(),
    setMissDoseReminder: jest.fn(),
    setOvertimeReminder: jest.fn(),
  },
}));

const api = jest.mocked(pillDispenserVendorApi);
const storage = jest.mocked(loadPillDispenserRecord);
let renderer: TestRenderer.ReactTestRenderer;

const information: PillDispenserDeviceInformation = {
  language: 2,
  timeZoneDistrict: '+0530',
  dateFormat: 2,
  timeFormat: 0,
  timeOut: 30,
  omitting: 120,
  volume: 2,
  unfazedSwitch: 1,
  unfazedStart: '23:00',
  unfazedEnd: '06:30',
  battery: 3,
  batteryVolume: 64,
  rotate: 0,
  uncap: 0,
  wifi: 4,
  gsm: 0,
  currentCeilId: '4',
  ceilRemaining: 12,
  firmwareVersion: '5.6',
};

const plan: PillDispenserPlan = {
  ceilUsed: 12,
  deviceCeilAmount: 28,
  planId: '1600',
  alwaysUse: 1,
  startDate: '0000-00-00',
  endDate: '0000-00-00',
  alarms: [
    {
      alarmId: '9577',
      alarmTime: '08:00',
      status: 1,
      drugs: [{ drugName: 'Metformin', drugAmount: '1' }],
    },
    { alarmId: '9578', alarmTime: '20:00', status: 2, drugs: [] },
  ],
};

const texts = () =>
  renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');

async function press(label: string) {
  const button = renderer.root
    .findAllByType(TouchableOpacity)
    .find(node =>
      node.findAllByType(Text).some(text => text.props.children === label),
    );
  expect(button).toBeDefined();
  await act(async () => {
    await button!.props.onPress();
    renderer.update(<PillDispenserManagementSection />);
  });
}

async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(<PillDispenserManagementSection />);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.mockResolvedValue({
    ownerKey: 'senior-1',
    vendorHost: 'test',
    vendorUserId: 'vendor-user-7',
    deviceSn: '5a-0000001583c83ceb',
    model: null,
    updatedAt: 1,
  });
  api.getStatus.mockResolvedValue(true);
  api.getInformation.mockResolvedValue(information);
  api.getPlan.mockResolvedValue(plan);
  api.setVolume.mockResolvedValue(undefined);
  api.setOvertimeReminder.mockResolvedValue(undefined);
});

afterEach(async () => {
  if (renderer)
    await act(async () => {
      renderer.unmount();
    });
});

describe('device health readings', () => {
  it('shows the battery percentage with its charging state', async () => {
    await mount();
    expect(texts()).toContain('64%');
    expect(texts()).toContain('Charging');
  });

  it('describes Wi-Fi strength in words instead of a 4/4 fraction', async () => {
    await mount();
    expect(texts()).toContain('Strong signal');
    expect(texts()).not.toContain('4/4');
  });

  it('shows an unreported battery and Wi-Fi as unknown, not as zero', async () => {
    api.getInformation.mockResolvedValue({
      ...information,
      battery: 0,
      batteryVolume: null,
      wifi: null,
    });
    await mount();
    expect(texts()).toContain('Unknown');
    expect(texts()).not.toContain('0%');
  });

  it('says when the app last read the device rather than implying live data', async () => {
    await mount();
    expect(texts()).toContain('Checked just now');
    expect(texts()).toContain('not a live measurement');
  });
});

describe('plan and alarm labels', () => {
  it('describes the plan in words and keeps the vendor ID as a support reference', async () => {
    await mount();
    await press('Plan');
    expect(texts()).toContain('12 of 28 compartments filled');
    expect(texts()).toContain('For support only');
  });

  it('labels alarms by time and never as a Slot ID', async () => {
    await mount();
    await press('Alarms');
    const rendered = texts();
    expect(rendered).toContain('Alarm 1 · 08:00');
    expect(rendered).toContain('08:00');
    expect(rendered).toContain('20:00');
    expect(rendered).not.toContain('Slot ID');
  });
});

describe('timezone', () => {
  it('never re-sends the timezone when another setting is changed', async () => {
    await mount();
    await press('Mute');
    await press('Save settings');
    expect(api.setTimezone).not.toHaveBeenCalled();
  });

  it('does not present an unreported timezone as UTC', async () => {
    api.getInformation.mockResolvedValue({
      ...information,
      timeZoneDistrict: '',
    });
    await mount();
    expect(texts()).toContain('Not reported by the dispenser');
    expect(texts()).not.toContain('UTC+00:00');
  });

  it('saves an unrelated setting even when the device reports no timezone', async () => {
    api.getInformation.mockResolvedValue({
      ...information,
      timeZoneDistrict: '',
    });
    await mount();
    await press('Mute');
    await press('Save settings');
    expect(api.setVolume).toHaveBeenCalledTimes(1);
    expect(api.setTimezone).not.toHaveBeenCalled();
    expect(texts()).not.toContain('Timezone must look like');
  });
});

describe('saving settings', () => {
  it('sends only the setting that changed', async () => {
    await mount();
    await press('Mute');
    await press('Save settings');

    expect(api.setVolume).toHaveBeenCalledTimes(1);
    expect(api.setVolume).toHaveBeenCalledWith(
      'vendor-user-7',
      '5a-0000001583c83ceb',
      4,
    );
    expect(api.setTimezone).not.toHaveBeenCalled();
    expect(api.setTimeFormat).not.toHaveBeenCalled();
    expect(api.setDateFormat).not.toHaveBeenCalled();
    expect(api.setDisturb).not.toHaveBeenCalled();
    expect(api.setMissDoseReminder).not.toHaveBeenCalled();
    expect(api.setOvertimeReminder).not.toHaveBeenCalled();
  });

  it('sends nothing when the form still matches the dispenser', async () => {
    await mount();
    await press('Save settings');

    expect(api.setVolume).not.toHaveBeenCalled();
    expect(api.setTimezone).not.toHaveBeenCalled();
    expect(texts()).toContain('Nothing was sent');
  });

  it('does not re-send the fixed formats when the dispenser already matches', async () => {
    await mount();
    await press('Mute');
    await press('Save settings');
    expect(api.setTimeFormat).not.toHaveBeenCalled();
    expect(api.setDateFormat).not.toHaveBeenCalled();
  });

  it('corrects a dispenser reporting a different format', async () => {
    api.setTimeFormat.mockResolvedValue(undefined);
    api.setDateFormat.mockResolvedValue(undefined);
    api.getInformation.mockResolvedValue({
      ...information,
      timeFormat: 1,
      dateFormat: 0,
    });
    await mount();
    await press('Save settings');
    expect(api.setTimeFormat).toHaveBeenCalledWith(
      'vendor-user-7',
      '5a-0000001583c83ceb',
      0,
    );
    expect(api.setDateFormat).toHaveBeenCalledWith(
      'vendor-user-7',
      '5a-0000001583c83ceb',
      2,
    );
    expect(api.setVolume).not.toHaveBeenCalled();
  });

  it('reports which settings were accepted after a save', async () => {
    api.getInformation
      .mockResolvedValueOnce(information)
      .mockResolvedValue({ ...information, volume: 4 });
    await mount();
    await press('Mute');
    await press('Save settings');
    expect(texts()).toContain('1 setting updated: Volume');
  });

  it('still reports the applied settings when the read-back fails', async () => {
    api.getInformation
      .mockResolvedValueOnce(information)
      .mockRejectedValue(new Error('Network unavailable'));
    await mount();
    await press('Mute');
    await press('Save settings');
    const rendered = texts();
    expect(api.setVolume).toHaveBeenCalledTimes(1);
    expect(rendered).toContain('1 setting updated: Volume');
    expect(rendered).toContain('could not be read back');
  });

  it('names the command that failed without claiming a full save', async () => {
    api.setVolume.mockRejectedValue(new Error('Device refused the setting'));
    await mount();
    await press('Mute');
    await press('Save settings');
    const rendered = texts();
    expect(rendered).toContain('not accepted');
    expect(rendered).toContain('Volume');
    expect(rendered).toContain('Device refused the setting');
  });
});
