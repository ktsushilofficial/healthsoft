import {
  rebootPillDispenser,
  type PillDispenserRebootState,
} from '../src/pillDispenser/reboot';
import {
  pillDispenserVendorApi,
  PillDispenserVendorError,
} from '../src/pillDispenser/vendorApi';

jest.mock('../src/pillDispenser/vendorApi', () => ({
  ...jest.requireActual('../src/pillDispenser/vendorApi'),
  pillDispenserVendorApi: { getStatus: jest.fn(), reboot: jest.fn() },
}));
const status = jest.mocked(pillDispenserVendorApi.getStatus);
const reboot = jest.mocked(pillDispenserVendorApi.reboot);
let controller: AbortController;
let progress: PillDispenserRebootState[];
let online: boolean[];
const run = () =>
  rebootPillDispenser({
    userId: 'owner',
    deviceSn: 'dispenser',
    signal: controller.signal,
    onProgress: value => progress.push(value),
    onOnlineChange: value => online.push(value),
  });
beforeEach(() => {
  jest.useFakeTimers();
  jest.resetAllMocks();
  controller = new AbortController();
  progress = [];
  online = [];
  status.mockResolvedValue(true);
  reboot.mockResolvedValue(undefined);
});
afterEach(() => {
  controller.abort();
  jest.useRealTimers();
});

it('reports reconnection only after observing offline then online', async () => {
  status
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  const task = run();
  await jest.advanceTimersByTimeAsync(6000);
  await task;
  expect(progress.map(item => item.phase)).toEqual([
    'checking',
    'sending',
    'waiting',
    'offline',
    'reconnected',
  ]);
  expect(online).toEqual([true, false, true]);
  expect(reboot).toHaveBeenCalledTimes(1);
});

it('does not claim a restart when the API always reports online', async () => {
  const task = run();
  await jest.advanceTimersByTimeAsync(90000);
  await task;
  expect(progress.at(-1)?.phase).toBe('unconfirmed');
  expect(progress.at(-1)?.message).toContain('remained online');
  expect(reboot).toHaveBeenCalledTimes(1);
});

it('reports a device that disconnects but does not return', async () => {
  status.mockResolvedValueOnce(true).mockResolvedValue(false);
  const task = run();
  await jest.advanceTimersByTimeAsync(90000);
  await task;
  expect(progress.at(-1)?.message).toContain('has not reconnected');
  expect(progress.at(-1)?.phase).toBe('unconfirmed');
});

it.each([false, new PillDispenserVendorError(611)])(
  'does not send a reboot to an offline dispenser (%s)',
  async value => {
    if (value === false) status.mockResolvedValue(false);
    else status.mockRejectedValue(value);
    await run();
    expect(reboot).not.toHaveBeenCalled();
    expect(progress.at(-1)?.message).toContain('Reboot was not sent');
    expect(online.at(-1)).toBe(false);
  },
);

it('preserves the actual vendor rejection code and explanation', async () => {
  reboot.mockRejectedValue(
    new PillDispenserVendorError(612, 'Firmware does not accept reboot'),
  );
  await run();
  expect(progress.at(-1)).toEqual({
    phase: 'failed',
    message:
      'Reboot request failed. Firmware does not accept reboot (vendor code 612)',
  });
  expect(status).toHaveBeenCalledTimes(1);
});

it('observes an ambiguous command timeout without resending reboot', async () => {
  reboot.mockRejectedValue(new Error('timeout'));
  status
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(false)
    .mockResolvedValueOnce(true);
  const task = run();
  await jest.advanceTimersByTimeAsync(6000);
  await task;
  expect(
    progress.some(item => item.message.includes('No acknowledgement')),
  ).toBe(true);
  expect(progress.at(-1)?.phase).toBe('reconnected');
  expect(reboot).toHaveBeenCalledTimes(1);
});

it('does not mistake a network error for device disconnection', async () => {
  status
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValue(true);
  const task = run();
  await jest.advanceTimersByTimeAsync(90000);
  await task;
  expect(progress.at(-1)?.phase).toBe('unconfirmed');
  expect(online).not.toContain(false);
});

it('recognizes vendor code 611 during reboot as offline', async () => {
  status
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new PillDispenserVendorError(611))
    .mockResolvedValue(true);
  const task = run();
  await jest.advanceTimersByTimeAsync(6000);
  await task;
  expect(progress.at(-1)?.phase).toBe('reconnected');
});

it('cancels polling on leaving the screen without stale updates', async () => {
  const task = run();
  const cancelled = task.catch(error => error);
  await jest.advanceTimersByTimeAsync(3000);
  controller.abort();
  const count = progress.length;
  await jest.advanceTimersByTimeAsync(90000);
  expect(await cancelled).toMatchObject({ name: 'AbortError' });
  expect(progress).toHaveLength(count);
  expect(status).toHaveBeenCalledTimes(2);
});
