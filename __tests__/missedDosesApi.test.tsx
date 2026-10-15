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

it('fetches the senior missed doses and returns them parsed, newest first', async () => {
  mockRequest.mockResolvedValueOnce(
    response([
      { date: '2026-10-14', alarmTime: '04:02', deviceSn: 'sn', drugs: [], reportedAt: 1 },
      {
        date: '2026-10-15',
        alarmTime: '12:54',
        deviceSn: 'sn',
        drugs: [{ drugName: 'Dolo', drugAmount: '1' }],
        reportedAt: 2,
      },
    ]),
  );
  const doses = await auth.getSeniorMissedDoses(' senior/1 ');
  expect(mockRequest).toHaveBeenCalledWith(
    expect.objectContaining({
      url: '/api/v1/guardian-dashboard/seniors/senior%2F1/missed-doses',
      method: 'GET',
      headers: expect.objectContaining({
        Authorization: 'Bearer session-access-token',
      }),
    }),
  );
  expect(doses.map(d => d.alarmTime)).toEqual(['12:54', '04:02']);
  expect(doses[0].drugs).toEqual([{ drugName: 'Dolo', drugAmount: '1' }]);
});

it('rejects a blank senior id without calling the API', async () => {
  await expect(auth.getSeniorMissedDoses('  ')).rejects.toThrow('Senior ID is required');
  expect(mockRequest).not.toHaveBeenCalled();
});

it('surfaces the server error message', async () => {
  mockRequest.mockRejectedValueOnce({
    isAxiosError: true,
    response: { status: 500, data: { message: 'Pill dispenser service unavailable.' } },
  });
  await expect(auth.getSeniorMissedDoses('senior-1')).rejects.toThrow(
    'Pill dispenser service unavailable.',
  );
});
