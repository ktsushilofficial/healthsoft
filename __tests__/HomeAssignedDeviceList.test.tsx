import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';
import HomeAssignedDeviceList from '../src/components/HomeAssignedDeviceList';
import HomeDevicesScreen from '../src/screens/HomeDevicesScreen';
import { buildHomeAssignedDevices } from '../src/utils/homeAssignedDevices';
import { extractSeniorAssignedDevices } from '../src/utils/deviceAssignments';

jest.mock('react-native-vector-icons/MaterialCommunityIcons', () => 'DeviceIcon');

const mockNavigate = jest.fn();
let mockParams: Record<string, unknown> = {};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
  useRoute: () => ({ params: mockParams }),
}));

const devices = buildHomeAssignedDevices(
  extractSeniorAssignedDevices([
    {
      deviceId: 'pendant-1',
      deviceType: 'PENDANT',
      name: 'Pendant',
      imei: '123456789012345',
    },
    { deviceId: 'band-1', deviceType: 'HAND_BAND' },
    { deviceId: 'pill-1', deviceType: 'PILL_DISPENSER' },
    { deviceId: 'scale-1', deviceType: 'SCALE' },
  ]),
  [],
);

afterEach(() => {
  mockNavigate.mockClear();
  mockParams = {};
});

it('keeps known device destinations and displays unknown device types without a wrong destination', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <HomeAssignedDeviceList devices={devices} seniorId="senior-1" />,
    );
  });
  const cards = renderer.root.findAllByType(TouchableOpacity);
  expect(cards).toHaveLength(4);
  await act(async () => {
    cards.slice(0, 3).forEach(card => card.props.onPress());
  });
  expect(mockNavigate.mock.calls).toEqual([
    [
      'PendantDetail',
      {
        seniorId: 'senior-1',
        deviceUuid: 'pendant-1',
        imei: '123456789012345',
        deviceName: 'Pendant',
      },
    ],
    ['Activity'],
    ['PillDispenser'],
  ]);
  expect(cards[3].props.disabled).toBe(true);
  await act(async () => {
    renderer.unmount();
  });
});

it('See all renders the same assignment-owned list passed from Home', async () => {
  mockParams = { devices, activeSeniorId: 'senior-1' };
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<HomeDevicesScreen />);
  });
  const list = renderer.root.findByType(HomeAssignedDeviceList);
  expect(list.props.devices).toEqual(devices);
  expect(list.props.seniorId).toBe('senior-1');
  await act(async () => {
    renderer.unmount();
  });
});

it('does not create a synthetic Smart Band when no devices are assigned', async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <HomeAssignedDeviceList devices={[]} seniorId="senior-1" />,
    );
  });
  expect(renderer.root.findAllByType(TouchableOpacity)).toHaveLength(0);
  await act(async () => {
    renderer.unmount();
  });
});
