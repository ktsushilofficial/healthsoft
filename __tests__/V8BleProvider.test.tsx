import React from 'react';
import { sdkHistoryPackets } from '../test/fixtures/v8History';
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
  requestDeviceName: jest.fn(async () => true),
  requestDeviceTime: jest.fn(async () => true),
  syncDeviceTime: jest.fn(async () => true),
  requestPersonalInfo: jest.fn(async () => true),
};
let mockAssigned = ['C414D50E09F6'];
const mockAuth = {
  // Automatic vitals sync is irrelevant to these connection tests.
  user: { role: 'GUARDIAN', user_id: 'guardian' },
  selectedSenior: { userId: 'senior-1' },
  getAssignedDevicesForSenior: jest.fn(),
  getV8VitalsSummary: jest.fn(async () => [] as unknown),
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
    jest.setSystemTime(new Date('2026-09-11T12:00:00+05:30'));
    jest.clearAllMocks();
    mockNative.syncDeviceTime.mockReset().mockResolvedValue(true);
    mockAuth.user = { role: 'GUARDIAN', user_id: 'guardian' };
    mockAuth.getV8VitalsSummary.mockReset().mockResolvedValue([]);
    for (const request of Object.values(mockHistoryRequests))
      request.mockReset().mockResolvedValue(true);
    const infoReplies = [
      [mockNative.requestDeviceMac, '10', { macAddress: 'C414D50E09F6' }],
      [mockNative.requestBattery, '9', { batteryLevel: 80 }],
      [mockNative.requestDeviceVersion, '11', { deviceVersion: '1.0.2.5' }],
      [mockNative.requestDeviceTime, '0', { strDeviceTime: '2026-09-12 22:37:00' }],
      [mockNative.requestPersonalInfo, '2', { deviceId: '000000' }],
      [mockNative.requestDeviceName, '117', { deviceName: 'JCV8B' }],
    ] as const;
    for (const [request, dataType, dicData] of infoReplies) {
      request.mockReset().mockImplementation(async () => {
        mockListeners.get('V8Data')?.({ type: 'parsed', payload: { dataType, dicData, dataEnd: true } });
        return true;
      });
    }
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

  it.each(['ios', 'android'])('syncs the clock once per connection before reading details on %s', async platform => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: platform });
    try {
      await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
      expect(mockNative.syncDeviceTime).toHaveBeenCalledTimes(1);
      expect(mockNative.syncDeviceTime.mock.invocationCallOrder[0]).toBeLessThan(mockNative.requestDeviceTime.mock.invocationCallOrder[0]);
      expect(mockNative.requestDeviceTime.mock.invocationCallOrder[0]).toBeLessThan(mockNative.requestDeviceMac.mock.invocationCallOrder[0]);
      expect(manager.deviceTimeSyncing).toBe(false);
      expect(manager.deviceTimeSyncError).toBeNull();
      await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
      expect(mockNative.syncDeviceTime).toHaveBeenCalledTimes(1);
      await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'disconnected' });
      await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
      expect(mockNative.syncDeviceTime).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: original });
    }
  });

  it('accepts the iOS empty set-time acknowledgement and subsequent deviceTime readback', async () => {
    await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
    mockNative.requestDeviceTime.mockImplementationOnce(async () => true);
    let completed = false;
    let pending!: Promise<void>;
    await act(async () => {
      pending = manager.syncDeviceTime().then(() => { completed = true; });
    });
    await emit('V8Data', { type: 'parsed', payload: { dataType: 1, dataEnd: true, dicData: {} } });
    expect(completed).toBe(false);
    expect(manager.deviceTimeSyncing).toBe(true);
    await emit('V8Data', {
      type: 'parsed',
      payload: { dataType: 0, dataEnd: true, dicData: { deviceTime: '2026-09-16 18:28:20' } },
    });
    await pending;
    expect(completed).toBe(true);
    expect(manager.deviceInfo.deviceTime).toBe('2026-09-16 18:28:20');
    expect(manager.deviceTimeSyncing).toBe(false);
    expect(manager.deviceTimeSyncError).toBeNull();
  });

  it('rejects time sync while disconnected', async () => {
    await expect(manager.syncDeviceTime()).rejects.toThrow('Connect the hand band');
    expect(mockNative.syncDeviceTime).not.toHaveBeenCalled();
  });

  it('reports a failed automatic time write and allows a manual retry', async () => {
    mockNative.syncDeviceTime.mockRejectedValueOnce(new Error('Bluetooth write failed'));
    await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
    expect(manager.deviceTimeSyncError).toBe('Bluetooth write failed');
    expect(manager.deviceInfo.firmwareVersion).toBe('1.0.2.5');
    await act(async () => { await manager.syncDeviceTime(); });
    expect(mockNative.syncDeviceTime).toHaveBeenCalledTimes(2);
    expect(manager.deviceTimeSyncError).toBeNull();
  });

  it('waits for clock readback, coalesces sync presses and reports missing responses', async () => {
    await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
    mockNative.requestDeviceTime.mockImplementation(async () => true);
    let pending!: Promise<void>;
    let same!: Promise<void>;
    let failure: unknown;
    await act(async () => {
      pending = manager.syncDeviceTime();
      same = manager.syncDeviceTime();
      pending.catch(error => { failure = error; });
    });
    expect(pending).toBe(same);
    expect(manager.deviceTimeSyncing).toBe(true);
    expect(mockNative.syncDeviceTime).toHaveBeenCalledTimes(2);
    await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
    expect(failure).toEqual(new Error('No response from the band after two attempts.'));
    expect(manager.deviceTimeSyncing).toBe(false);
    expect(manager.deviceTimeSyncError).toContain('No response');
  });

  it('cancels clock readback on disconnect and syncs again after reconnecting', async () => {
    await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
    mockNative.requestDeviceTime.mockImplementationOnce(async () => true);
    let failure: unknown;
    await act(async () => { manager.syncDeviceTime().catch(error => { failure = error; }); });
    expect(manager.deviceTimeSyncing).toBe(true);
    await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'disconnected' });
    expect(failure).toBeInstanceOf(Error);
    expect(manager.deviceTimeSyncing).toBe(false);
    await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
    expect(mockNative.syncDeviceTime).toHaveBeenCalledTimes(3);
    expect(manager.deviceTimeSyncError).toBeNull();
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

  it('retries dropped Android firmware details before requesting later fields', async () => {
    const original = Platform.OS;
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'android' });
    try {
      mockNative.requestDeviceVersion.mockImplementationOnce(async () => true);
      await emit('V8ScanResult', { ...iosBand, id: 'C4:14:D5:0E:09:F6' });
      await emit('V8ConnectionState', { deviceId: 'C4:14:D5:0E:09:F6', state: 'connected' });
      expect(manager.deviceInfoReading).toBe(true);
      expect(mockNative.requestDeviceVersion).toHaveBeenCalledTimes(1);
      // Connection time sync reads the clock before the detail queries.
      expect(mockNative.requestDeviceTime).toHaveBeenCalledTimes(1);
      let refresh!: Promise<void>;
      await act(async () => { refresh = manager.refreshDeviceInfo(); });
      const packets = sdkHistoryPackets('android');
      Object.values(mockHistoryRequests).forEach((request, index) => {
        request.mockImplementation(async () => {
          mockListeners.get('V8Data')?.({ type: 'parsed', payload: packets[index] });
          return true;
        });
      });
      let history!: Promise<V8DailyVitalSummary[]>;
      await act(async () => { history = manager.buildTodayVitals('2026-09-11'); });
      expect(mockHistoryRequests.requestTotalActivity).not.toHaveBeenCalled();
      await act(async () => { await jest.advanceTimersByTimeAsync(1500); });
      await refresh;
      await history;
      expect(manager.historyReadStatus.phase).toBe('complete');
      expect(mockNative.requestDeviceVersion).toHaveBeenCalledTimes(2);
      expect(manager.deviceInfo).toMatchObject({ firmwareVersion: '1.0.2.5', deviceTime: '2026-09-12 22:37:00', deviceName: 'JCV8B' });
      expect(manager.deviceInfoReading).toBe(false);
      expect(manager.deviceInfoError).toBeNull();
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: original });
    }
  });

  it('clears old firmware on reconnection and reports an unanswered query while reading other details', async () => {
    await emit('V8ScanResult', iosBand);
    await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
    expect(manager.deviceInfo.firmwareVersion).toBe('1.0.2.5');
    await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'disconnected' });
    mockNative.requestDeviceVersion.mockImplementation(async () => true);
    await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
    expect(manager.deviceInfo.firmwareVersion).toBeNull();
    await act(async () => { await jest.advanceTimersByTimeAsync(3000); });
    expect(manager.deviceInfoReading).toBe(false);
    expect(manager.deviceInfoError).toContain('Firmware: No response');
    expect(manager.deviceInfo.deviceTime).toBe('2026-09-12 22:37:00');
    expect(manager.deviceInfo.firmwareVersion).toBeNull();
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
              // Steps come from the activity totals record; detail intervals are
              // no longer requested during a sync.
              index === 0
                ? [{ date: '2026.09.11', step: 300 }]
                : index === 4
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
        ).rejects.toThrow('do not match');
        expect(mockAuth.syncV8VitalsByDevice).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(Platform, 'OS', {
          configurable: true,
          value: original,
        });
      }
    },
  );
  it('uploads a partial download and sends the missing categories as null', async () => {
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
    let result!: Promise<V8DailyVitalSummary[] | Error>;
    await act(async () => {
      result = manager.buildTodayVitals('2026-09-11').catch(error => error);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5100);
    });
    const rows = await result;
    expect(rows).not.toBeInstanceOf(Error);
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
    let outcome!: { days: number; partial: boolean; missingTypes: string[] };
    await act(async () => {
      outcome = await manager.syncTodayVitalsToBackend(
        '2026-09-11',
        rows as V8DailyVitalSummary[],
      );
    });
    expect(outcome).toMatchObject({ days: 1, partial: true, missingTypes: ['hrv'] });
    const summary = mockAuth.syncV8VitalsByDevice.mock.calls[0][0].vitalSummaries[0];
    expect(summary).toMatchObject({
      recordDate: '2026-09-11',
      steps: 300,
      hrvMin: null,
      hrvMax: null,
      hrvAvg: null,
      hrvLatest: null,
      spo2Avg: null,
      tempAvg: null,
    });
  });

  const prepareRead = async (platform: 'ios' | 'android' = 'ios', malformed = false) => {
    Object.defineProperty(Platform, 'OS', { configurable: true, value: platform });
    const device = { ...iosBand, id: platform === 'ios' ? iosBand.id : 'C4:14:D5:0E:09:F6' };
    await emit('V8ScanResult', device);
    await emit('V8ConnectionState', { deviceId: device.id, state: 'connected' });
    await act(async () => { await jest.advanceTimersByTimeAsync(2100); });
    const packets = sdkHistoryPackets(platform);
    if (malformed) packets[4].dicData = [{ date: '2026.09.11', unsupportedHR: [72] }] as any;
    Object.values(mockHistoryRequests).forEach((request, index) => {
      request.mockImplementation(async () => {
        mockListeners.get('V8Data')?.({ type: 'parsed', payload: packets[index] });
        return true;
      });
    });
    return device;
  };
  const becomeSenior = async () => {
    mockAuth.user = { role: 'SENIOR', user_id: 'senior-1' };
    mockAuth.getAssignedDevicesForSenior.mockResolvedValue([
      { deviceId: 'band-uuid', bluetoothMacAddress: 'C414D50E09F6' },
    ]);
    await act(async () => { renderer.update(tree()); });
  };

  it('rejects requests for yesterday and tomorrow before sending history commands', async () => {
    await prepareRead();
    await expect(manager.buildTodayVitals('2026-09-10')).rejects.toThrow('only be read for today');
    await expect(manager.buildTodayVitals('2026-09-12')).rejects.toThrow('only be read for today');
    expect(mockHistoryRequests.requestHRV).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'] as const)('bounds %s history to today through the read cutoff and stops older pagination', async platform => {
    const original = Platform.OS;
    try {
      jest.setSystemTime(new Date('2026-09-11T12:00:00+05:30'));
      await prepareRead(platform);
      const type = platform === 'ios' ? '41' : '42';
      // Shaped like a real HRV record: heart rate is carried alongside HRV.
      const hr = (value: number) => (platform === 'ios'
        ? { heartRate: value, hrv: 27 }
        : { heartRate: String(value), hrv: '27' });
      mockHistoryRequests.requestHRV.mockImplementation(async () => {
        for (let i = 0; i < 50; i++) {
          const records = i === 0 ? [
            { date: '2026.09.11 13:00:00', ...hr(200) },
            { date: '2026.09.11 11:59:55', ...hr(70) },
            { date: '2026.09.10 23:59:55', ...hr(60) },
            { date: '2026.08.04 19:36:03', ...hr(180) },
          ] : [{ date: '2026.08.04 19:36:03', ...hr(180) }];
          mockListeners.get('V8Data')?.({ type: 'parsed', payload: { dataType: type, dataEnd: false, dicData: records } });
        }
        return true;
      });
      const cutoff = Date.now();
      let rows!: V8DailyVitalSummary[];
      await act(async () => { rows = await manager.buildTodayVitals('2026-09-11'); });
      expect(mockHistoryRequests.requestHRV).toHaveBeenCalledTimes(1);
      expect(manager.historyReadStatus).toMatchObject({ phase: 'complete', requestedEnd: cutoff, categories: { hrv: { stoppedAtDayStart: true, extractedSamples: 1 } } });
      // 13:00 is past the cutoff, 09-10 is before midnight, August is neither.
      expect(manager.historyByType.hrv.entries.map(entry => entry.heartRate)).toEqual([70]);
      expect(rows[0].heartRateMax).toBe(70);
      // Late packets already in flight must not reintroduce August data.
      await emit('V8Data', { type: 'parsed', payload: { dataType: type, dataEnd: true, dicData: [{ date: '2026.08.04 19:00:00', ...hr(240) }] } });
      await act(async () => { await jest.advanceTimersByTimeAsync(100); });
      expect(manager.historyByType.hrv.entries).toHaveLength(1);
      await becomeSenior();
      await act(async () => { await manager.syncTodayVitalsToBackend('2026-09-11', rows); });
      expect(mockAuth.syncV8VitalsByDevice.mock.calls[0][0].vitalSummaries[0].hrMax).toBe(70);
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: original });
    }
  });

  it('never asks the backend for a resume cursor before reading the band', async () => {
    jest.setSystemTime(new Date('2026-09-11T12:00:00+05:30'));
    await prepareRead();
    mockAuth.getAssignedDevicesForSenior.mockResolvedValue([{ deviceId: 'band-uuid', bluetoothMacAddress: 'C414D50E09F6' }]);
    await act(async () => { await manager.buildTodayVitals('2026-09-11'); });
    // The SDK ignores a start date that does not exactly match a stored record,
    // so no saved-summary timestamp can steer the band. The window is ours.
    expect(mockAuth.getV8VitalsSummary).not.toHaveBeenCalled();
    expect(manager.historyReadStatus.requestedStart)
      .toBe(new Date('2026-09-11T00:00:00+05:30').getTime());
  });

  it('takes hrLatest from history without asking the band to measure now', async () => {
    jest.setSystemTime(new Date('2026-09-11T12:00:00+05:30'));
    await prepareRead();
    const native = mockNative as any;
    native.startHeartRateMeasurement = jest.fn(async () => true);
    native.stopHeartRateMeasurement = jest.fn(async () => true);
    try {
      let rows!: V8DailyVitalSummary[];
      await act(async () => { rows = await manager.buildTodayVitals('2026-09-11'); });
      // Each HRV record carries a heart rate measured at the same moment, so a
      // read never spends the vendor minimum of 30 seconds measuring on demand.
      expect(native.startHeartRateMeasurement).not.toHaveBeenCalled();
      expect(native.stopHeartRateMeasurement).not.toHaveBeenCalled();
      expect(rows[0].heartRateLatest).toBe(74);
      expect(rows[0]).toMatchObject({ heartRateMin: 74, heartRateMax: 74 });
    } finally {
      delete native.startHeartRateMeasurement;
      delete native.stopHeartRateMeasurement;
    }
  });

  it('finishes an Android read with partial data when HRV never ends', async () => {
    const original = Platform.OS;
    try {
      await prepareRead('android');
      const hrPacket = { ...sdkHistoryPackets('android')[4], dataEnd: false };
      mockHistoryRequests.requestHRV.mockImplementation(async () => true);
      let result!: Promise<V8DailyVitalSummary[]>;
      await act(async () => { result = manager.buildTodayVitals('2026-09-11'); });
      for (let second = 4; second < 120; second += 4) {
        await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
        await emit('V8Data', { type: 'parsed', payload: hrPacket });
      }
      expect(manager.historyReadStatus.currentType).toBe('hrv');
      await act(async () => { await jest.advanceTimersByTimeAsync(4000); });
      const rows = await result;
      expect(manager.historyReadStatus).toMatchObject({
        phase: 'partial', currentType: null, failedTypes: ['hrv'],
        completedTypes: ['totalActivity', 'spo2'],
      });
      expect(manager.historyReadStatus.categories.hrv.error).toContain('Time limit (120 seconds)');
      expect(rows[0]).toMatchObject({ steps: 8000, spo2Latest: 98 });
      // The completed partial read releases the shared in-flight promise.
      mockHistoryRequests.requestHRV.mockImplementation(async () => {
        mockListeners.get('V8Data')?.({ type: 'parsed', payload: { ...hrPacket, dataEnd: true } });
        return true;
      });
      await act(async () => { await manager.buildTodayVitals('2026-09-11'); });
      expect(manager.historyReadStatus.phase).toBe('complete');
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: original });
    }
  });

  it.each(['resolve', 'reject'] as const)('reports upload progress in order when the API will %s', async outcome => {
    await prepareRead();
    let rows!: V8DailyVitalSummary[];
    await act(async () => { rows = await manager.buildTodayVitals('2026-09-11'); });
    await becomeSenior();
    let resolveUpload!: () => void;
    let rejectUpload!: (error: Error) => void;
    mockAuth.syncV8VitalsByDevice.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      resolveUpload = resolve;
      rejectUpload = reject;
    }));
    const onProgress = jest.fn();
    let result!: Promise<unknown>;
    await act(async () => {
      result = manager.syncTodayVitalsToBackend('2026-09-11', rows, onProgress).catch(error => error);
    });
    expect(onProgress.mock.calls.flat()).toEqual(['verifying', 'uploading']);
    await act(async () => {
      if (outcome === 'resolve') resolveUpload();
      else rejectUpload(new Error('Upload failed'));
      await result;
    });
    expect(onProgress.mock.calls.flat()).toEqual(outcome === 'resolve'
      ? ['verifying', 'uploading', 'finishing'] : ['verifying', 'uploading']);
  });

  it.each(['ios', 'android'] as const)('uploads every metric from SDK-shaped %s responses', async platform => {
    const original = Platform.OS;
    try {
      await prepareRead(platform);
      let rows!: V8DailyVitalSummary[];
      await act(async () => { rows = await manager.buildTodayVitals('2026-09-11'); });
      const expectedStart = platform === 'ios' ? new Date(2026, 8, 11).getTime() : '2026-09-11 00:00:00';
      const { requestDynamicHR, requestDetailActivity, requestStaticHR, requestTemperature, ...requested } = mockHistoryRequests;
      for (const request of Object.values(requested)) expect(request).toHaveBeenCalledWith(0, expectedStart);
      // A sync asks for three categories only: totals, HRV and blood oxygen.
      for (const skipped of [requestDynamicHR, requestDetailActivity, requestStaticHR, requestTemperature]) {
        expect(skipped).not.toHaveBeenCalled();
      }
      expect(manager.historyReadStatus.categories.hrv).toMatchObject({
        receivedRecords: 1, extractedSamples: 1, rejectedRecords: 0, outcome: 'downloaded',
      });
      await becomeSenior();
      await act(async () => { await manager.syncTodayVitalsToBackend('2026-09-11', rows); });
      const payload = mockAuth.syncV8VitalsByDevice.mock.calls[0][0];
      expect(payload).toEqual({ deviceUUID: 'band-uuid', syncDays: 1, syncFrom: '2026-09-11', syncTo: '2026-09-11',
        vitalSummaries: [{ recordDate: '2026-09-11', steps: 8000, distanceKm: 5.8, caloriesKcal: 320,
          exerciseMinutes: 65, activeMinutes: platform === 'ios' ? 20 : null, goalPercent: 80,
          // The HRV record's own heart rate is the only source now.
          hrMin: 74, hrMax: 74, hrAvg: 74, hrLatest: 74,
          spo2Min: 98, spo2Max: 98, spo2Avg: 98, spo2Latest: 98,
          hrvMin: 55, hrvMax: 55, hrvAvg: 55, hrvLatest: 55,
          systolicBpMin: 120, systolicBpMax: 120, systolicBpAvg: 120, systolicBpLatest: 120,
          diastolicBpMin: 80, diastolicBpMax: 80, diastolicBpAvg: 80, diastolicBpLatest: 80,
          // Temperature is never requested, so it always uploads as null.
          tempMin: null, tempMax: null, tempAvg: null, tempLatest: null,
          stressMin: 0, stressMax: 0, stressAvg: 0, stressLatest: 0 }],
      });
      // Repeated uploads of the same read serialize identically, including nulls.
      await act(async () => { await manager.syncTodayVitalsToBackend('2026-09-11', rows); });
      expect(JSON.stringify(mockAuth.syncV8VitalsByDevice.mock.calls[1][0])).toBe(JSON.stringify(payload));
    } finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: original }); }
  });

  // Device Management renders lastReadRows.summary. If it could drift from the
  // uploaded row, a metric on screen would disagree with the backend - which is
  // how a stale stress value outlived the read that produced it.
  it('freezes the same row Live Vitals shows and the sync uploads', async () => {
    const original = Platform.OS;
    try {
      await prepareRead('android');
      let rows!: V8DailyVitalSummary[];
      await act(async () => { rows = await manager.buildTodayVitals('2026-09-11'); });
      await becomeSenior();
      await act(async () => { await manager.syncTodayVitalsToBackend('2026-09-11', rows); });
      const uploaded = mockAuth.syncV8VitalsByDevice.mock.calls[0][0].vitalSummaries[0];
      expect(manager.lastReadRows).toMatchObject({ day: '2026-09-11', rows });
      expect(manager.lastReadRows!.summary).toEqual(uploaded);
      // The fixture's HRV record carries stress '0', the one metric that accepts
      // a zero, so it must survive to both places rather than read as missing.
      expect(uploaded.stressLatest).toBe(0);
    } finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: original }); }
  });

  it.each(['ios', 'android'] as const)('still uploads the other %s categories when HRV is silently rejected', async platform => {
    const original = Platform.OS;
    try {
      await prepareRead(platform, true);
      let rows!: V8DailyVitalSummary[];
      await act(async () => { rows = await manager.buildTodayVitals('2026-09-11'); });
      expect(manager.historyReadStatus).toMatchObject({ phase: 'partial', failedTypes: ['hrv'] });
      expect(manager.historyReadStatus.categories.hrv).toMatchObject({ outcome: 'failed', rejectedRecords: 1 });
      await becomeSenior();
      await act(async () => { await manager.syncTodayVitalsToBackend('2026-09-11', rows); });
      const summary = mockAuth.syncV8VitalsByDevice.mock.calls[0][0].vitalSummaries[0];
      // HRV is the only source of heart rate, stress and blood pressure, so all
      // four go up as null while activity and blood oxygen still upload.
      expect(summary).toMatchObject({ recordDate: '2026-09-11', steps: 8000, spo2Avg: 98,
        hrAvg: null, hrvAvg: null, systolicBpAvg: null, stressAvg: null });
    } finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: original }); }
  });

  it('uploads the single value that arrived when every category failed', async () => {
    await emit('V8ScanResult', iosBand);
    await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
    await act(async () => { await jest.advanceTimersByTimeAsync(2100); });
    // Only HRV answers, and it never sends its completion marker, so every
    // requested category ends up failed.
    Object.values(mockHistoryRequests).forEach((request, index) => {
      request.mockImplementation(async () => {
        if (index === 4) {
          mockListeners.get('V8Data')?.({
            type: 'parsed',
            payload: {
              dataType: '41',
              dataEnd: false,
              dicData: [{ date: '2026.09.11 10:00:00', heartRate: 72 }],
            },
          });
        }
        return true;
      });
    });
    let result!: Promise<V8DailyVitalSummary[] | Error>;
    await act(async () => {
      result = manager.buildTodayVitals('2026-09-11').catch(error => error);
    });
    await act(async () => { await jest.advanceTimersByTimeAsync(40000); });
    const rows = await result;
    expect(rows).not.toBeInstanceOf(Error);
    expect(manager.historyReadStatus).toMatchObject({
      phase: 'partial',
      completedTypes: [],
      failedTypes: ['totalActivity', 'hrv', 'spo2'],
    });
    await becomeSenior();
    let outcome!: { days: number; partial: boolean };
    await act(async () => {
      outcome = await manager.syncTodayVitalsToBackend('2026-09-11', rows as V8DailyVitalSummary[]);
    });
    expect(outcome).toMatchObject({ days: 1, partial: true });
    const summary = mockAuth.syncV8VitalsByDevice.mock.calls[0][0].vitalSummaries[0];
    expect(summary).toMatchObject({
      recordDate: '2026-09-11',
      hrMin: 72, hrMax: 72, hrAvg: 72, hrLatest: 72,
      steps: null, spo2Avg: null, hrvAvg: null, tempAvg: null,
      systolicBpAvg: null, diastolicBpAvg: null, stressAvg: null,
    });
  });

  it('requires a current read even when no prior status exists', async () => {
    await becomeSenior();
    await expect(manager.syncTodayVitalsToBackend('2026-09-11', [])).rejects.toThrow('Read the hand band again');
    expect(mockAuth.getAssignedDevicesForSenior).not.toHaveBeenCalled();
    expect(mockAuth.syncV8VitalsByDevice).not.toHaveBeenCalled();
  });

  it.each(['wrong day', 'changed rows', 'cleared data', 'reconnected', 'different band', 'new read', 'account changed'])(
    'rejects a saved summary after %s', async change => {
      await prepareRead();
      let rows!: V8DailyVitalSummary[];
      await act(async () => { rows = await manager.buildTodayVitals('2026-09-11'); });
      await becomeSenior();
      let day = '2026-09-11';
      if (change === 'wrong day') day = '2026-09-10';
      if (change === 'changed rows') rows[0].steps = 999999;
      if (change === 'cleared data') await act(async () => { await manager.clearSavedData(); });
      if (change === 'reconnected') {
        await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'disconnected' });
        await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
      }
      if (change === 'different band') await emit('V8ConnectionState', { deviceId: 'another-band', state: 'connected' });
      if (change === 'new read') {
        mockHistoryRequests.requestTotalActivity.mockImplementationOnce(async () => {
          mockListeners.get('V8Data')?.({ type: 'parsed', payload: { dataType: '25', dataEnd: true, dicData: [{ date: '2026.09.11', step: 9000 }] } });
          return true;
        });
        await act(async () => { await manager.buildTodayVitals('2026-09-11'); });
      }
      if (change === 'account changed') {
        mockAuth.user = { role: 'SENIOR', user_id: 'senior-2' };
        await act(async () => { renderer.update(tree()); });
      }
      await expect(manager.syncTodayVitalsToBackend(day, rows)).rejects.toThrow(/Read the hand band again|do not match/);
      expect(mockAuth.syncV8VitalsByDevice).not.toHaveBeenCalled();
    },
  );

  it.each(['disconnect', 'new read', 'assignment removed', 'account changed'])(
    'rechecks read ownership after assignment lookup: %s', async change => {
      await prepareRead();
      let rows!: V8DailyVitalSummary[];
      await act(async () => { rows = await manager.buildTodayVitals('2026-09-11'); });
      await becomeSenior();
      let resolveLookup!: (devices: unknown[]) => void;
      mockAuth.getAssignedDevicesForSenior.mockImplementationOnce(() => new Promise(resolve => { resolveLookup = resolve; }));
      const result = manager.syncTodayVitalsToBackend('2026-09-11', rows).catch(error => error);
      if (change === 'disconnect') await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'disconnected' });
      if (change === 'new read') await act(async () => { await manager.buildTodayVitals('2026-09-11'); });
      if (change === 'assignment removed') {
        mockAssigned = [];
        await act(async () => { renderer.update(tree()); });
      }
      if (change === 'account changed') {
        mockAuth.user = { role: 'SENIOR', user_id: 'senior-2' };
        await act(async () => { renderer.update(tree()); });
      }
      resolveLookup([{ deviceId: 'band-uuid', bluetoothMacAddress: 'C414D50E09F6' }]);
      expect(await result).toBeInstanceOf(Error);
      expect(mockAuth.syncV8VitalsByDevice).not.toHaveBeenCalled();
    },
  );


  it('uploads the saved read even if later notifications change visible history', async () => {
    await prepareRead();
    let rows!: V8DailyVitalSummary[];
    await act(async () => { rows = await manager.buildTodayVitals('2026-09-11'); });
    await emit('V8Data', { type: 'parsed', payload: { dataType: '25', dataEnd: true,
      dicData: { arrayTotalActivityData: [{ date: '2026.09.11', step: 99999 }] },
    } });
    await becomeSenior();
    await act(async () => { await manager.syncTodayVitalsToBackend('2026-09-11', rows); });
    expect(mockAuth.syncV8VitalsByDevice.mock.calls[0][0].vitalSummaries[0].steps).toBe(8000);
  });


  it('reports an Android disconnect once and keeps later categories unattempted', async () => {
    const original = Platform.OS;
    try {
      const device = await prepareRead('android');
      mockHistoryRequests.requestHRV.mockImplementation(async () => true);
      let result!: Promise<unknown>;
      await act(async () => { result = manager.buildTodayVitals('2026-09-11').catch(error => error); });
      expect(manager.historyReadStatus.currentType).toBe('hrv');
      await emit('V8ConnectionState', { deviceId: device.id, state: 'disconnected', gattStatus: 133 });
      const error = await result as Error;
      expect(error.message).toBe('Hand band history is incomplete. The hand band disconnected during the read (Bluetooth status 133). Nothing was uploaded. Reconnect the band and retry.');
      expect(manager.historyReadStatus).toMatchObject({
        phase: 'partial', failedTypes: [], completedTypes: ['totalActivity'],
        categories: { hrv: { outcome: 'cancelled' }, spo2: { outcome: 'notRead' } },
      });
      expect(mockHistoryRequests.requestSpo2).not.toHaveBeenCalled();
      expect(mockAuth.syncV8VitalsByDevice).not.toHaveBeenCalled();
    } finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: original }); }
  });

});
