import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Platform } from 'react-native';
import type { V8DailyVitalSummary } from '../src/v8/models';
import * as Keychain from 'react-native-keychain';
import { V8BleProvider, useV8Ble } from '../src/v8/V8BleProvider';
import { requestHandBandPermissions } from '../src/v8/permissions';

const mockListeners = new Map<string, (event: any) => void>();
const mockHistoryRequests = {
  requestTotalActivity: jest.fn(
    async (_mode: number, _start: string | number) => true,
  ),
  requestDetailActivity: jest.fn(
    async (_mode: number, _start: string | number) => true,
  ),
  requestDynamicHR: jest.fn(
    async (_mode: number, _start: string | number) => true,
  ),
  requestStaticHR: jest.fn(
    async (_mode: number, _start: string | number) => true,
  ),
  requestHRV: jest.fn(async (_mode: number, _start: string | number) => true),
  requestSpo2: jest.fn(async (_mode: number, _start: string | number) => true),
  requestTemperature: jest.fn(
    async (_mode: number, _start: string | number) => true,
  ),
};
const mockNative = {
  ...mockHistoryRequests,
  getBluetoothState: jest.fn(async () => 'PoweredOn'),
  startScan: jest.fn(async () => true),
  stopScan: jest.fn(async () => true),
  connect: jest.fn(async () => true),
  disconnect: jest.fn(async () => true),
  requestDeviceMac: jest.fn(async () => true),
  requestBattery: jest.fn(async () => true),
  requestDeviceVersion: jest.fn(async () => true),
  requestDeviceTime: jest.fn(async () => true),
  requestPersonalInfo: jest.fn(async () => true),
};
let mockAssigned = ['C414D50E09F6'];
const mockAuth = {
  // Automatic vitals sync is irrelevant to these connection tests.
  user: { role: 'GUARDIAN', user_id: 'guardian' },
  selectedSenior: { userId: 'senior-1' },
  getAssignedDevicesForSenior: jest.fn(),
  refreshHandBandAssignments: jest.fn(async () => {}),
  syncV8VitalsByDevice: jest.fn(),
};

jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({ ...mockAuth, selectedSeniorHandBandMacs: mockAssigned }),
}));
jest.mock('../src/v8/permissions', () => ({
  requestHandBandPermissions: jest.fn(async () => {}),
}));
jest.mock('../src/v8/nativeV8', () => ({
  isV8NativeAvailable: true,
  get v8Native() {
    return mockNative;
  },
  v8Emitter: {
    addListener: (name: string, callback: (event: any) => void) => {
      mockListeners.set(name, callback);
      return { remove: () => mockListeners.delete(name) };
    },
  },
}));

let manager: ReturnType<typeof useV8Ble>;
function Probe() {
  manager = useV8Ble();
  return null;
}
const tree = () => (
  <V8BleProvider>
    <Probe />
  </V8BleProvider>
);
const iosBand = {
  id: '74DE814A-39EF-4CB4-8F12-B43EB7C987FE',
  name: 'JCV8',
  localName: 'JCV8 0E09F6',
  rssi: -45,
};
const emit = async (name: string, event: any) => {
  await act(async () => {
    mockListeners.get(name)?.(event);
  });
};

describe('hand band connection and ownership', () => {
  let renderer: ReactTestRenderer;
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockAuth.user = { role: 'GUARDIAN', user_id: 'guardian' };
    for (const request of Object.values(mockHistoryRequests))
      request.mockReset().mockResolvedValue(true);
    jest.mocked(Keychain.getGenericPassword).mockResolvedValue(false);
    mockAssigned = ['C414D50E09F6'];
    jest.mocked(requestHandBandPermissions).mockResolvedValue();
    await act(async () => {
      renderer = create(tree());
    });
  });
  afterEach(async () => {
    await act(async () => {
      renderer.unmount();
    });
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('requests permissions before scanning and surfaces denial without starting the scan', async () => {
    jest
      .mocked(requestHandBandPermissions)
      .mockRejectedValueOnce(new Error('Bluetooth permission denied'));
    await act(async () => {
      await manager.startScan();
    });
    expect(manager.scanError).toBe('Bluetooth permission denied');
    expect(mockNative.startScan).not.toHaveBeenCalled();
    await act(async () => {
      await manager.startScan();
    });
    expect(mockNative.startScan).toHaveBeenCalledTimes(1);
  });

  it('reloads assignments on scan and reports a backend failure so it can be retried', async () => {
    mockAuth.refreshHandBandAssignments.mockRejectedValueOnce(
      new Error('Assignment service unavailable'),
    );
    await act(async () => {
      await manager.startScan();
    });
    expect(manager.scanError).toBe('Assignment service unavailable');
    expect(mockNative.startScan).not.toHaveBeenCalled();
    await act(async () => {
      await manager.startScan();
    });
    expect(mockNative.startScan).toHaveBeenCalledTimes(1);
  });

  it('connects an assigned iOS band without requiring a MAC reply and waits for readiness', async () => {
    await emit('V8ScanResult', iosBand);
    let connected = false;
    let pending!: Promise<void>;
    await act(async () => {
      pending = manager.connect(iosBand.id).then(() => {
        connected = true;
      });
    });
    expect(connected).toBe(false);
    expect(mockNative.connect).toHaveBeenCalledWith(iosBand.id);
    await emit('V8ConnectionState', {
      deviceId: iosBand.id,
      state: 'connected',
    });
    await pending;
    expect(connected).toBe(true);
    expect(manager.deviceInfo.mac).toBe('C414D50E09F6');
    await expect(manager.ensureDeviceMac()).resolves.toBe('C414D50E09F6');
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith(
      'v8-session',
      expect.stringContaining(iosBand.id),
      expect.anything(),
    );
  });

  it.each(['JCV8', 'JCV8B'])(
    'connects an assigned Android %s by MAC regardless of product name',
    async name => {
      const band = {
        id: 'C4:14:D5:0E:09:F6',
        name,
        localName: name,
        rssi: -45,
      };
      await emit('V8ScanResult', band);
      let pending!: Promise<void>;
      await act(async () => {
        pending = manager.connect(band.id);
      });
      expect(mockNative.connect).toHaveBeenCalledWith(band.id);
      await emit('V8ConnectionState', {
        deviceId: band.id,
        state: 'connected',
      });
      await pending;
      expect(manager.deviceInfo.mac).toBe('C414D50E09F6');
      expect(manager.connectionStates[band.id.toLowerCase()]).toBe('connected');
    },
  );

  it('rejects another Android band before requesting a native connection', async () => {
    await expect(manager.connect('C4:14:D5:AA:BB:CC')).rejects.toThrow(
      'not assigned',
    );
    expect(mockNative.connect).not.toHaveBeenCalled();
  });

  it('reconnects a saved iOS band after restart using its saved identity', async () => {
    await act(async () => {
      renderer.unmount();
    });
    jest.mocked(Keychain.getGenericPassword).mockImplementation(async options =>
      options?.service === 'healthsoft.v8.session'
        ? ({
            username: 'v8-session',
            password: JSON.stringify({
              lastConnectedDeviceId: iosBand.id,
              device: iosBand,
            }),
            service: 'healthsoft.v8.session',
          } as any)
        : false,
    );
    await act(async () => {
      renderer = create(tree());
    });
    await act(async () => {
      await manager.startScan();
      await manager.stopScan();
    });
    let reconnect!: Promise<void>;
    await act(async () => {
      reconnect = manager.ensureAutoConnect();
    });
    expect(mockNative.connect).toHaveBeenCalledWith(iosBand.id);
    await emit('V8ConnectionState', {
      deviceId: iosBand.id,
      state: 'connected',
    });
    await reconnect;
    expect(manager.deviceInfo.mac).toBe('C414D50E09F6');
  });

  it('does not connect when the selected senior has no assigned band', async () => {
    mockAssigned = [];
    await act(async () => {
      renderer.update(tree());
    });
    await expect(manager.connect(iosBand.id)).rejects.toThrow(
      'No Hand Band MAC',
    );
    expect(mockNative.connect).not.toHaveBeenCalled();
  });

  it('disconnects an iOS band when switching to a senior with a different assignment', async () => {
    await emit('V8ScanResult', iosBand);
    let pending!: Promise<void>;
    await act(async () => {
      pending = manager.connect(iosBand.id);
    });
    await emit('V8ConnectionState', {
      deviceId: iosBand.id,
      state: 'connected',
    });
    await pending;
    mockAssigned = ['C414D5AABBCC'];
    await act(async () => {
      renderer.update(tree());
    });
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(mockNative.disconnect).toHaveBeenCalled();
    expect(manager.deviceInfo.mac).toBeNull();
  });

  it('rejects a reported MAC that contradicts the advertised name', async () => {
    await emit('V8ScanResult', iosBand);
    let pending!: Promise<void>;
    await act(async () => {
      pending = manager.connect(iosBand.id);
    });
    await emit('V8ConnectionState', {
      deviceId: iosBand.id,
      state: 'connected',
    });
    await pending;
    await emit('V8Data', {
      type: 'parsed',
      payload: { mac: 'C4:14:D5:AA:BB:CC' },
    });
    expect(mockNative.disconnect).toHaveBeenCalled();
    expect(manager.scanError).toContain('not assigned');
  });

  it('times out a band that never becomes ready instead of leaving Working forever', async () => {
    await emit('V8ScanResult', iosBand);
    let failure!: Promise<unknown>;
    await act(async () => {
      failure = manager.connect(iosBand.id).catch(error => error);
    });
    await act(async () => {
      jest.advanceTimersByTime(20000);
    });
    expect(await failure).toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Could not connect'),
      }),
    );
    expect(mockNative.disconnect).toHaveBeenCalled();
    expect(manager.connectionStates[iosBand.id.toLowerCase()]).toBe('error');
  });
  it.each(['ios', 'android'] as const)(
    'reads SDK callbacks and uploads null-safe dated vitals on %s',
    async platform => {
      const original = Platform.OS;
      Object.defineProperty(Platform, 'OS', {
        configurable: true,
        value: platform,
      });
      try {
        const device = {
          ...iosBand,
          id: platform === 'android' ? 'C4:14:D5:0E:09:F6' : iosBand.id,
        };
        await emit('V8ScanResult', device);
        await emit('V8ConnectionState', {
          deviceId: device.id,
          state: 'connected',
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(2100);
        });
        const ids =
          platform === 'ios'
            ? ['25', '26', '28', '29', '41', '45', '48']
            : ['24', '25', '27', '28', '42', '68', '59'];
        Object.values(mockHistoryRequests).forEach((request, index) => {
          request.mockImplementation(async () => {
            const entries =
              index === 1
                ? [
                    {
                      date: '2026.09.11 10:00:00',
                      [platform === 'android'
                        ? 'detailMinterStep'
                        : 'step']: 100,
                    },
                    {
                      date: '2026.09.11 10:10:00',
                      [platform === 'android'
                        ? 'detailMinterStep'
                        : 'step']: 200,
                    },
                  ]
                : index === 3
                ? [
                    { date: '2026.09.11 10:00:00', heartRate: 80 },
                    { date: '2026.09.11 09:00:00', heartRate: 60 },
                  ]
                : [];
            mockListeners.get('V8Data')?.({
              type: 'parsed',
              payload: {
                dataType: ids[index],
                dataEnd: true,
                dicData: entries,
              },
            });
            return true;
          });
        });
        let rows!: V8DailyVitalSummary[];
        await act(async () => {
          rows = await manager.buildTodayVitals('2026-09-11');
        });
        expect(rows[0]).toMatchObject({
          date: '2026-09-11',
          steps: 300,
          heartRateLatest: 80,
          heartRateAvg: 70,
          spo2Avg: null,
        });
        expect(manager.historyReadStatus.phase).toBe('complete');
        mockAuth.user = { role: 'SENIOR', user_id: 'senior-1' };
        mockAuth.getAssignedDevicesForSenior.mockResolvedValue([
          { deviceId: 'band-uuid', bluetoothMacAddress: 'C414D50E09F6' },
        ]);
        await act(async () => {
          renderer.update(tree());
        });
        await act(async () => {
          await manager.syncTodayVitalsToBackend('2026-09-11', rows);
        });
        expect(mockAuth.syncV8VitalsByDevice).toHaveBeenCalledWith(
          expect.objectContaining({
            syncFrom: '2026-09-11',
            syncTo: '2026-09-11',
            vitalSummaries: [
              expect.objectContaining({
                recordDate: '2026-09-11',
                steps: 300,
                hrLatest: 80,
                spo2Avg: null,
                tempAvg: null,
              }),
            ],
          }),
        );
        mockAuth.syncV8VitalsByDevice.mockClear();
        await expect(
          manager.syncTodayVitalsToBackend('2026-09-11', [
            { ...rows[0], date: '2026-09-10' },
          ]),
        ).rejects.toThrow('No readings');
        expect(mockAuth.syncV8VitalsByDevice).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(Platform, 'OS', {
          configurable: true,
          value: original,
        });
      }
    },
  );
  it('blocks uploading a partial download even when some valid readings arrived', async () => {
    await emit('V8ScanResult', iosBand);
    await emit('V8ConnectionState', {
      deviceId: iosBand.id,
      state: 'connected',
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2100);
    });
    const ids = ['25', '26', '28', '29', '41', '45', '48'];
    Object.values(mockHistoryRequests).forEach((request, index) => {
      request.mockImplementation(async () => {
        if (index === 4) {
          // A manual HRV result must not complete a pending history read.
          mockListeners.get('V8Data')?.({
            type: 'parsed',
            payload: {
              dataType: '59',
              dataEnd: true,
              dicData: { heartRate: 75 },
            },
          });
        } else {
          mockListeners.get('V8Data')?.({
            type: 'parsed',
            payload: {
              dataType: ids[index],
              dataEnd: true,
              dicData: index === 0 ? [{ date: '2026.09.11', step: 300 }] : [],
            },
          });
        }
        return true;
      });
    });
    let result!: Promise<unknown>;
    await act(async () => {
      result = manager.buildTodayVitals('2026-09-11').catch(error => error);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5100);
    });
    expect(await result).toMatchObject({
      message: expect.stringContaining('incomplete'),
    });
    expect(manager.historyReadStatus).toMatchObject({
      phase: 'partial',
      failedTypes: ['hrv'],
    });
    mockAuth.user = { role: 'SENIOR', user_id: 'senior-1' };
    mockAuth.getAssignedDevicesForSenior.mockResolvedValue([
      { deviceId: 'band-uuid', bluetoothMacAddress: 'C414D50E09F6' },
    ]);
    await act(async () => {
      renderer.update(tree());
    });
    await expect(
      manager.syncTodayVitalsToBackend('2026-09-11', []),
    ).rejects.toThrow('History is incomplete');
    expect(mockAuth.syncV8VitalsByDevice).not.toHaveBeenCalled();
  });
});
