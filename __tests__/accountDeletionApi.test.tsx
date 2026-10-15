import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AuthProvider, useAuth } from '../src/context/AuthContext';

const mockRequest = jest.fn();
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: () => ({ request: (...args: unknown[]) => mockRequest(...args) }),
    isAxiosError: (error: { isAxiosError?: boolean }) =>
      error?.isAxiosError === true,
  },
}));

let auth: ReturnType<typeof useAuth>;
let renderer: TestRenderer.ReactTestRenderer;
const CaptureAuth = () => {
  auth = useAuth();
  return null;
};
const response = (data: unknown) => ({ status: 200, headers: {}, data });
const rejection = {
  isAxiosError: true,
  response: { status: 400, data: { message: 'Reason is not valid.' } },
};

beforeEach(async () => {
  mockRequest.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await act(async () => {
    renderer = TestRenderer.create(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>,
    );
  });
  mockRequest.mockResolvedValueOnce(
    response({
      user_id: 'signed-in-guardian',
      role: 'GUARDIAN',
      access_token: 'session-access-token',
      refresh_token: 'session-refresh-token',
      token_type: 'Bearer',
    }),
  );
  await act(async () => {
    await auth.login('test@example.com', 'test-password');
  });
  mockRequest.mockClear();
});
afterEach(async () => {
  await act(async () => renderer.unmount());
  jest.restoreAllMocks();
});

it('uses the signed-in guardian, not the selected senior, and sends partially valid reasons unchanged', async () => {
  mockRequest.mockResolvedValueOnce(
    response([
      { userId: 'selected-senior', firstName: 'Senior', lastName: 'User' },
    ]),
  );
  await act(async () => {
    await auth.getMySeniors();
  });
  await act(async () => {
    await auth.selectSenior('selected-senior');
  });
  mockRequest.mockClear();
  mockRequest.mockResolvedValueOnce(
    response({ success: true, message: 'Request accepted' }),
  );
  await expect(
    auth.requestAccountDeletion(
      "  Don't have enough time sgdfsdagjknald  ",
      true,
    ),
  ).resolves.toBe('Request accepted');
  expect(mockRequest).toHaveBeenCalledWith({
    url: '/api/v1/profile/delete-account',
    method: 'POST',
    data: {
      userId: 'signed-in-guardian',
      reason: "Don't have enough time sgdfsdagjknald",
      consentToDelete: true,
    },
    headers: {
      Authorization: 'Bearer session-access-token',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  expect(auth.isAuthenticated).toBe(true);
});

it('does not send requests with empty reasons or without consent', async () => {
  await expect(auth.requestAccountDeletion('  ', true)).rejects.toThrow(
    'Please enter a reason',
  );
  await expect(
    auth.requestAccountDeletion('No longer using this', false),
  ).rejects.toThrow('Please consent');
  expect(mockRequest).not.toHaveBeenCalled();
});

it('surfaces server validation errors and a rejected success envelope', async () => {
  mockRequest.mockRejectedValueOnce(rejection);
  await expect(auth.requestAccountDeletion('gibberish', true)).rejects.toThrow(
    'Reason is not valid.',
  );
  mockRequest.mockResolvedValueOnce(
    response({ success: false, message: 'Please revise your reason.' }),
  );
  await expect(auth.requestAccountDeletion('gibberish', true)).rejects.toThrow(
    'Please revise your reason.',
  );
});

it('refreshes an expired token before retrying with the same deletion payload', async () => {
  mockRequest.mockRejectedValueOnce({
    ...rejection,
    response: { status: 401 },
  });
  mockRequest.mockResolvedValueOnce(
    response({
      access_token: 'renewed-token',
      refresh_token: 'renewed-refresh',
      token_type: 'Bearer',
    }),
  );
  mockRequest.mockResolvedValueOnce(response(null));
  await act(async () => {
    await expect(
      auth.requestAccountDeletion('No longer needed', true),
    ).resolves.toBe('Your account deletion request has been submitted.');
  });
  expect(mockRequest).toHaveBeenCalledTimes(3);
  expect(mockRequest.mock.calls[2][0].headers.Authorization).toBe(
    'Bearer renewed-token',
  );
  expect(mockRequest.mock.calls[2][0].data).toEqual(
    mockRequest.mock.calls[0][0].data,
  );
});
