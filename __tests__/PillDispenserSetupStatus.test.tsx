import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, Text, TouchableOpacity } from 'react-native';
import PillDispenserDeviceTab from '../src/components/PillDispenserDeviceTab';
import {
  pillDispenserVendorApi,
  PillDispenserVendorError,
} from '../src/pillDispenser/vendorApi';
import { loadPillDispenserRecord } from '../src/pillDispenser/vendorStorage';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const ReactHooks = require('react');
    ReactHooks.useEffect(
      () => (mockFocused ? callback() : undefined),
      [callback, mockFocused],
    );
  },
}));
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
    getAssignedDevicesForSenior: mockGetAssignedDevices,
  }),
}));
jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');
const mockProvisioning = {
  isAvailable: true,
  devices: [],
  wifiNetworks: [],
  stage: 'idle',
  selectedDeviceId: null as string | null,
  statusMessage: 'Put the pill dispenser in Wi-Fi setup mode, then scan.',
  startScan: jest.fn(),
  stopScan: jest.fn(async () => {
    mockProvisioning.stage = 'idle';
  }),
  disconnect: jest.fn(async () => {
    mockProvisioning.stage = 'idle';
    mockProvisioning.selectedDeviceId = null;
  }),
};
jest.mock('../src/pillDispenser/usePillDispenserProvisioning', () => ({
  usePillDispenserProvisioning: () => mockProvisioning,
}));
jest.mock('../src/pillDispenser/wifiCredentialStorage', () => ({
  loadSavedPillDispenserWifi: jest.fn(async () => []),
}));
jest.mock('../src/pillDispenser/vendorStorage', () => ({
  loadPillDispenserRecord: jest.fn(),
}));
jest.mock('../src/pillDispenser/vendorApi', () => ({
  ...jest.requireActual('../src/pillDispenser/vendorApi'),
  pillDispenserVendorApi: {
    getStatus: jest.fn(),
    getInformation: jest.fn(),
    getPlan: jest.fn(),
    reboot: jest.fn(),
  },
}));

let renderer: TestRenderer.ReactTestRenderer;
const statusApi = jest.mocked(pillDispenserVendorApi.getStatus);
const informationApi = jest.mocked(pillDispenserVendorApi.getInformation);
const storage = jest.mocked(loadPillDispenserRecord);
const savedRecord = {
  ownerKey: 'senior-1',
  vendorHost: 'test',
  vendorUserId: 'vendor-user-7',
  deviceSn: '5a-0000001583c83ceb',
  model: null,
  updatedAt: 1,
};
const texts = () =>
  renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .flat()
    .join(' ');
const step = () =>
  renderer.root.findByProps({ accessibilityLabel: 'Wi-Fi setup progress' })
    .props.accessibilityValue.now;
async function press(label: string) {
  const button = renderer.root
    .findAllByType(TouchableOpacity)
    .find(node =>
      node.findAllByType(Text).some(text => text.props.children === label),
    );
  expect(button).toBeDefined();
  await act(async () => {
    await button!.props.onPress();
    renderer.update(<PillDispenserDeviceTab />);
  });
}
async function mount() {
  await act(async () => {
    renderer = TestRenderer.create(<PillDispenserDeviceTab />);
  });
}
async function focus(focused: boolean) {
  mockFocused = focused;
  await act(async () => {
    renderer.update(<PillDispenserDeviceTab />);
  });
}
beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockProvisioning.stage = 'idle';
  mockProvisioning.selectedDeviceId = null;
  storage.mockResolvedValue(savedRecord);
  statusApi.mockResolvedValue(true);
  jest.mocked(pillDispenserVendorApi.reboot).mockResolvedValue(undefined);
  informationApi.mockRejectedValue(new Error('Settings unavailable'));
  jest.mocked(pillDispenserVendorApi.getPlan).mockResolvedValue({
    planId: 'plan-1',
    ceilUsed: 0,
    deviceCeilAmount: 28,
    alwaysUse: 1,
    startDate: '',
    endDate: '',
    alarms: [],
  });
});
afterEach(async () => {
  if (renderer)
    await act(async () => {
      renderer.unmount();
    });
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('checks the saved serial number before showing Complete, independently of settings loading', async () => {
  let resolve!: (online: boolean) => void;
  statusApi.mockReturnValue(
    new Promise<boolean>(done => {
      resolve = done;
    }),
  );
  await mount();
  expect(statusApi).toHaveBeenCalledWith('vendor-user-7', savedRecord.deviceSn);
  expect(texts()).toContain('Checking dispenser status');
  expect(texts()).not.toContain('Scan Pill Dispensers');
  expect(step()).toBe(0);
  await act(async () => {
    resolve(true);
  });
  expect(step()).toBe(3);
  expect(texts()).toContain('Pill dispenser online');
  expect(texts()).not.toContain('Scan Pill Dispensers');
  expect(texts()).toContain('Change Wi-Fi');
});

it('checks again after leaving and returning and replaces stale online status', async () => {
  await mount();
  expect(step()).toBe(3);
  await focus(false);
  statusApi.mockResolvedValue(false);
  await focus(true);
  expect(statusApi).toHaveBeenCalledTimes(2);
  expect(step()).toBe(1);
  expect(texts()).toContain('Pill dispenser offline');
  expect(texts()).toContain('Scan Pill Dispensers');
});

it('shows an unknown status on request failure instead of claiming online or offline', async () => {
  statusApi.mockRejectedValue(new Error('Network unavailable'));
  await mount();
  expect(texts()).toContain('Network unavailable');
  expect(texts()).not.toContain('Pill dispenser online');
  expect(texts()).not.toContain('Pill dispenser offline');
  expect(step()).toBe(1);
});

it('handles the vendor offline error as offline', async () => {
  statusApi.mockRejectedValue(new PillDispenserVendorError(611));
  await mount();
  expect(step()).toBe(1);
  expect(texts()).toContain('Pill dispenser offline');
});

it('returns to the online dispenser after cancelling a Wi-Fi change', async () => {
  await mount();
  expect(step()).toBe(3);

  await press('Change Wi-Fi');
  expect(step()).toBe(1);
  expect(texts()).toContain('Scan Pill Dispensers');
  expect(texts()).toContain('Cancel and keep current Wi-Fi');

  await press('Cancel and keep current Wi-Fi');
  expect(step()).toBe(3);
  expect(texts()).toContain('Pill dispenser online');
  expect(texts()).toContain('Change Wi-Fi');
  expect(texts()).not.toContain('Cancel and keep current Wi-Fi');
});

it('drops the Bluetooth link and stops scanning when the change is cancelled', async () => {
  await mount();
  await press('Change Wi-Fi');
  mockProvisioning.stage = 'scanning';
  mockProvisioning.selectedDeviceId = 'dispenser-ble';
  await focus(true);

  await press('Cancel and keep current Wi-Fi');
  expect(mockProvisioning.stopScan).toHaveBeenCalled();
  expect(mockProvisioning.disconnect).toHaveBeenCalled();
  expect(step()).toBe(3);
});

it('offers no cancel during first-time setup, where there is nothing to return to', async () => {
  storage.mockResolvedValue(null);
  await mount();
  expect(step()).toBe(1);
  expect(texts()).toContain('Scan Pill Dispensers');
  expect(texts()).not.toContain('Cancel and keep current Wi-Fi');
});

it('keeps first-time setup available when there is no saved dispenser', async () => {
  storage.mockResolvedValue(null);
  await mount();
  expect(statusApi).not.toHaveBeenCalled();
  expect(step()).toBe(1);
  expect(texts()).toContain('Scan Pill Dispensers');
});

it('ignores an old online response after a newer visit confirms offline', async () => {
  let resolveOld!: (online: boolean) => void;
  statusApi.mockReturnValueOnce(
    new Promise<boolean>(done => {
      resolveOld = done;
    }),
  );
  await mount();
  await focus(false);
  statusApi.mockResolvedValue(false);
  await focus(true);
  expect(step()).toBe(1);
  await act(async () => {
    resolveOld(true);
  });
  expect(step()).toBe(1);
  expect(texts()).toContain('Pill dispenser offline');
  expect(informationApi).not.toHaveBeenCalled();
});

it('allows an online dispenser to enter Wi-Fi setup explicitly', async () => {
  await mount();
  expect(step()).toBe(3);
  await press('Change Wi-Fi');
  expect(step()).toBe(1);
  expect(texts()).toContain('Scan Pill Dispensers');
  expect(mockProvisioning.disconnect).not.toHaveBeenCalled();
});

it('keeps successful setup complete after finishing Bluetooth setup', async () => {
  statusApi.mockResolvedValue(false);
  await mount();
  await press('Scan Pill Dispensers');
  mockProvisioning.stage = 'connected';
  mockProvisioning.selectedDeviceId = 'ble-1';
  await act(async () => {
    renderer.update(<PillDispenserDeviceTab />);
  });
  expect(step()).toBe(3);
  await press('Finish Bluetooth setup');
  expect(step()).toBe(3);
  await focus(false);
  await focus(true);
  expect(step()).toBe(1);
});

it('shows reboot progress, blocks duplicate requests, and reports an observed reconnection', async () => {
  await mount();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await press('Actions');
  await press('Reboot dispenser');
  const confirm = alert.mock.calls[0][2]?.find(
    item => item.text === 'Continue',
  );
  expect(confirm?.onPress).toBeDefined();
  statusApi
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  jest.useFakeTimers();
  let request: unknown;
  await act(async () => {
    request = confirm!.onPress!();
    confirm!.onPress!();
  });
  expect(texts()).toContain('Reboot request accepted');
  expect(pillDispenserVendorApi.reboot).toHaveBeenCalledTimes(1);
  const rebootButton = renderer.root
    .findAllByType(TouchableOpacity)
    .find(node =>
      node
        .findAllByType(Text)
        .some(text => text.props.children === 'Reboot dispenser'),
    );
  expect(rebootButton?.props.disabled).toBe(true);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
  });
  expect(texts()).toContain('Waiting for it to reconnect');
  await act(async () => {
    await jest.advanceTimersByTimeAsync(3000);
    await request;
  });
  expect(texts()).toContain('went offline and is now back online');
  expect(rebootButton?.props.disabled).toBe(false);
});
