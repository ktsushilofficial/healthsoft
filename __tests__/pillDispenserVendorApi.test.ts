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
import { pillDispenserVendorApi } from '../src/pillDispenser/vendorApi';

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
    expect(mockPost.mock.calls[1][1]).toEqual(expect.objectContaining({
      token: 'expired-token',
    }));
    expect(mockPost.mock.calls[3][1]).toEqual(expect.objectContaining({
      token: 'fresh-token',
    }));
  });
});
