import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Alert, Text, TextInput, TouchableOpacity } from 'react-native';
import AccountScreen from '../src/screens/AccountScreen';
import DeleteAccountScreen from '../src/screens/DeleteAccountScreen';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockRequestDeletion = jest.fn();
const mockUser = {
  user_id: 'guardian-1',
  role: 'GUARDIAN',
  first_name: 'Test',
  last_name: 'User',
};
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    refreshUserProfile: jest.fn(async () => {}),
    requestAccountDeletion: mockRequestDeletion,
  }),
}));

let renderer: TestRenderer.ReactTestRenderer;
const button = (label: string) =>
  renderer.root
    .findAllByType(TouchableOpacity)
    .find(node => node.props.accessibilityLabel === label)!;
const submit = () => button('Submit Deletion Request');
const consent = () =>
  button('I consent to the deletion of my Healthsoft account');
const confirmation = () => {
  const calls = jest.mocked(Alert.alert).mock.calls;
  return calls[calls.length - 1][2]!;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockRequestDeletion.mockResolvedValue('Your request has been accepted.');
});
afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  jest.restoreAllMocks();
});

it('opens the privacy policy inside the app and exposes the deletion screen from Account', async () => {
  await act(async () => {
    renderer = TestRenderer.create(<AccountScreen />);
  });
  await act(async () => {
    button('Privacy Policy').props.onPress();
    button('Delete Account').props.onPress();
  });
  expect(mockNavigate.mock.calls).toEqual([
    [
      'WebView',
      { url: 'https://healthsoft.in/privacy-policy', title: 'Privacy Policy' },
    ],
    ['DeleteAccount'],
  ]);
});

it('requires a nonempty reason and consent; cancellation sends no request', async () => {
  await act(async () => {
    renderer = TestRenderer.create(<DeleteAccountScreen />);
  });
  expect(submit().props.disabled).toBe(true);
  await act(async () => {
    renderer.root.findByType(TextInput).props.onChangeText('   ');
    consent().props.onPress();
  });
  expect(submit().props.disabled).toBe(true);
  await act(async () => {
    renderer.root.findByType(TextInput).props.onChangeText('No longer needed');
    consent().props.onPress();
  });
  expect(submit().props.disabled).toBe(true);
  await act(async () => {
    consent().props.onPress();
  });
  expect(submit().props.disabled).toBe(false);
  await act(async () => {
    submit().props.onPress();
  });
  expect(mockRequestDeletion).not.toHaveBeenCalled();
  await act(async () => {
    confirmation()[0].onPress!();
  });
  expect(mockRequestDeletion).not.toHaveBeenCalled();
});

it('submits once after confirmation and displays acceptance', async () => {
  let finish!: (message: string) => void;
  mockRequestDeletion.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  await act(async () => {
    renderer = TestRenderer.create(<DeleteAccountScreen />);
  });
  await act(async () => {
    renderer.root
      .findByType(TextInput)
      .props.onChangeText("Don't have enough time sgdfsdagjknald");
    consent().props.onPress();
  });
  await act(async () => {
    submit().props.onPress();
    submit().props.onPress();
  });
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  await act(async () => {
    confirmation()[1].onPress!();
    confirmation()[1].onPress!();
  });
  expect(mockRequestDeletion).toHaveBeenCalledTimes(1);
  expect(mockRequestDeletion).toHaveBeenCalledWith(
    "Don't have enough time sgdfsdagjknald",
    true,
  );
  expect(submit().props.disabled).toBe(true);
  expect(renderer.root.findByType(TextInput).props.editable).toBe(false);
  await act(async () => {
    finish('Your request has been accepted.');
  });
  const text = renderer.root
    .findAllByType(Text)
    .map(node => node.props.children);
  expect(text).toContain('Request Submitted');
  expect(text).toContain('Your request has been accepted.');
  expect(renderer.root.findAllByType(TextInput)).toHaveLength(0);
});

it('keeps the reason and consent after server rejection and lets the user retry', async () => {
  mockRequestDeletion.mockRejectedValueOnce(
    new Error('Please provide a valid reason.'),
  );
  await act(async () => {
    renderer = TestRenderer.create(<DeleteAccountScreen />);
  });
  await act(async () => {
    renderer.root.findByType(TextInput).props.onChangeText('gibberish');
    consent().props.onPress();
  });
  await act(async () => {
    submit().props.onPress();
  });
  await act(async () => {
    await confirmation()[1].onPress!();
  });
  expect(renderer.root.findByType(TextInput).props.value).toBe('gibberish');
  expect(consent().props.accessibilityState.checked).toBe(true);
  expect(submit().props.disabled).toBe(false);
  expect(
    renderer.root
      .findAllByType(Text)
      .some(node => node.props.children === 'Please provide a valid reason.'),
  ).toBe(true);
  await act(async () => {
    renderer.root
      .findByType(TextInput)
      .props.onChangeText('No longer using the service');
  });
  await act(async () => {
    submit().props.onPress();
  });
  await act(async () => {
    await confirmation()[1].onPress!();
  });
  expect(mockRequestDeletion).toHaveBeenCalledTimes(2);
});
