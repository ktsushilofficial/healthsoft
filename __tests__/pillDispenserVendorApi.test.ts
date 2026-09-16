jest.mock('axios', () => {
  const post = jest.fn();
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => ({ post })),
      isAxiosError: jest.fn(() => false),
      __post: post,
    },
  };
});

import axios from 'axios';
import {
  pillDispenserVendorApi,
  PillDispenserVendorError,
} from '../src/pillDispenser/vendorApi';

const mockPost = (axios as unknown as { __post: jest.Mock }).__post;

describe('pillDispenserVendorApi', () => {
  it('retrieves a fresh token and retries when Zoomcare returns code 713', async () => {
    mockPost
      .mockResolvedValueOnce({
        status: 200,
        data: {
          code: 200,
          message: 'Success',
          data: { token: 'expired-token', expire: 7200 },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { code: 713, message: 'Please retrieve token', data: [] },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          code: 200,
          message: 'Success',
          data: { token: 'fresh-token', expire: 7200 },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { code: 200, message: 'Success', data: { status: '1' } },
      });

    await expect(
      pillDispenserVendorApi.getStatus('vendor-user', '39-device'),
    ).resolves.toBe(true);

    expect(mockPost).toHaveBeenCalledTimes(4);
    expect(mockPost.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        token: 'expired-token',
      }),
    );
    expect(mockPost.mock.calls[3][1]).toEqual(
      expect.objectContaining({
        token: 'fresh-token',
      }),
    );
  });

  it.each([undefined, null, '', 'unknown', 2])(
    'does not interpret invalid status %s as offline',
    async status => {
      mockPost.mockReset();
      mockPost.mockResolvedValue({
        status: 200,
        data: {
          code: 200,
          message: 'Success',
          data: { status },
        },
      });
      await expect(
        pillDispenserVendorApi.getStatus('vendor-user', 'device'),
      ).rejects.toThrow('invalid device status');
    },
  );

  it('sends reboot to the documented endpoint with the bound device identity', async () => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({
      status: 200,
      data: { code: 200, message: 'Success', data: [] },
    });
    const controller = new AbortController();
    await pillDispenserVendorApi.reboot('vendor-user', 'device-sn', {
      signal: controller.signal,
    });
    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining('/Company/CommonApi/reboot'),
      expect.objectContaining({
        user_id: 'vendor-user',
        device_sn: 'device-sn',
        token: expect.any(String),
      }),
      { signal: controller.signal },
    );
  });

  it('retains vendor error details for reboot diagnostics', async () => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({
      status: 200,
      data: {
        code: 612,
        message: 'Device refused reboot',
        data: [],
      },
    });
    await expect(
      pillDispenserVendorApi.reboot('vendor-user', 'device-sn'),
    ).rejects.toMatchObject({
      code: 612,
      vendorMessage: 'Device refused reboot',
    });
    expect(new PillDispenserVendorError(611).message).toContain('offline');
  });

  describe('get_information health readings', () => {
    const readInformation = async (data: Record<string, unknown>) => {
      mockPost.mockReset();
      mockPost.mockResolvedValue({
        status: 200,
        data: { code: 200, message: 'Success', data },
      });
      return pillDispenserVendorApi.getInformation('vendor-user', 'device-sn');
    };

    it('reads the documented battery percentage and signal scales', async () => {
      const information = await readInformation({
        battery: '2',
        battery_volume: '37',
        wifi: '4',
        gsm: '0',
      });
      expect(information).toMatchObject({
        battery: 2,
        batteryVolume: 37,
        wifi: 4,
        gsm: 0,
      });
    });

    it('keeps an omitted reading unknown instead of reporting 0', async () => {
      const information = await readInformation({ battery: '0' });
      expect(information.batteryVolume).toBeNull();
      expect(information.wifi).toBeNull();
      expect(information.gsm).toBeNull();
    });

    it('rejects readings outside the documented ranges', async () => {
      const information = await readInformation({
        battery_volume: '150',
        wifi: '7',
        gsm: 'n/a',
      });
      expect(information.batteryVolume).toBeNull();
      expect(information.wifi).toBeNull();
      expect(information.gsm).toBeNull();
    });
  });
});
