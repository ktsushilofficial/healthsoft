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
    if (malformed) packets[2].dicData = [{ date: '2026.09.11', unsupportedHR: [72] }] as any;
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
      for (const request of Object.values(mockHistoryRequests)) expect(request).toHaveBeenCalledWith(0, expectedStart);
      expect(manager.historyReadStatus.categories.dynamicHR).toMatchObject({
        receivedRecords: 1, extractedSamples: 2, rejectedRecords: 0, outcome: 'downloaded',
      });
      await becomeSenior();
      await act(async () => { await manager.syncTodayVitalsToBackend('2026-09-11', rows); });
      const payload = mockAuth.syncV8VitalsByDevice.mock.calls[0][0];
      expect(payload).toEqual({ deviceUUID: 'band-uuid', syncDays: 1, syncFrom: '2026-09-11', syncTo: '2026-09-11',
        vitalSummaries: [{ recordDate: '2026-09-11', steps: 8000, distanceKm: 5.8, caloriesKcal: 320,
          exerciseMinutes: 65, activeMinutes: platform === 'ios' ? 20 : null, goalPercent: 80,
          hrMin: 60, hrMax: 80, hrAvg: 72, hrLatest: 76,
          spo2Min: 98, spo2Max: 98, spo2Avg: 98, spo2Latest: 98,
          hrvMin: 55, hrvMax: 55, hrvAvg: 55, hrvLatest: 55,
          systolicBpMin: 120, systolicBpMax: 120, systolicBpAvg: 120, systolicBpLatest: 120,
          diastolicBpMin: 80, diastolicBpMax: 80, diastolicBpAvg: 80, diastolicBpLatest: 80,
          tempMin: 36.5, tempMax: 36.5, tempAvg: 36.5, tempLatest: 36.5,
          stressMin: 0, stressMax: 0, stressAvg: 0, stressLatest: 0 }],
      });
      // Repeated uploads of the same read serialize identically, including nulls.
      await act(async () => { await manager.syncTodayVitalsToBackend('2026-09-11', rows); });
      expect(JSON.stringify(mockAuth.syncV8VitalsByDevice.mock.calls[1][0])).toBe(JSON.stringify(payload));
    } finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: original }); }
  });

  it.each(['ios', 'android'] as const)('still uploads the other %s categories when continuous HR is silently rejected', async platform => {
    const original = Platform.OS;
    try {
      await prepareRead(platform, true);
      let rows!: V8DailyVitalSummary[];
      await act(async () => { rows = await manager.buildTodayVitals('2026-09-11'); });
      expect(manager.historyReadStatus).toMatchObject({ phase: 'partial', failedTypes: ['dynamicHR'] });
      expect(manager.historyReadStatus.categories.dynamicHR).toMatchObject({ outcome: 'failed', rejectedRecords: 1 });
      await becomeSenior();
      await act(async () => { await manager.syncTodayVitalsToBackend('2026-09-11', rows); });
      const summary = mockAuth.syncV8VitalsByDevice.mock.calls[0][0].vitalSummaries[0];
      // Continuous HR contributed nothing; the resting HR record and the other
      // categories still upload.
      expect(summary).toMatchObject({ recordDate: '2026-09-11', steps: 8000, spo2Avg: 98, hrvAvg: 55, tempAvg: 36.5 });
    } finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: original }); }
  });

  it('uploads the single value that arrived when every category failed', async () => {
    await emit('V8ScanResult', iosBand);
    await emit('V8ConnectionState', { deviceId: iosBand.id, state: 'connected' });
    await act(async () => { await jest.advanceTimersByTimeAsync(2100); });
    // Only resting HR answers, and it never sends its completion marker, so
    // every one of the seven categories ends up failed.
    Object.values(mockHistoryRequests).forEach((request, index) => {
      request.mockImplementation(async () => {
        if (index === 3) {
          mockListeners.get('V8Data')?.({
            type: 'parsed',
            payload: {
              dataType: '29',
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
      failedTypes: ['totalActivity', 'detailActivity', 'dynamicHR', 'staticHR', 'hrv', 'spo2', 'temperature'],
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
      if (change === 'new read') await act(async () => { await manager.buildTodayVitals('2026-09-10'); });
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
      mockHistoryRequests.requestDynamicHR.mockImplementation(async () => true);
      let result!: Promise<unknown>;
      await act(async () => { result = manager.buildTodayVitals('2026-09-11').catch(error => error); });
      expect(manager.historyReadStatus.currentType).toBe('dynamicHR');
      await emit('V8ConnectionState', { deviceId: device.id, state: 'disconnected', gattStatus: 133 });
      const error = await result as Error;
      expect(error.message).toBe('Hand band history is incomplete. The hand band disconnected during the read (Bluetooth status 133). Nothing was uploaded. Reconnect the band and retry.');
      expect(manager.historyReadStatus).toMatchObject({
        phase: 'partial', failedTypes: [], completedTypes: ['totalActivity', 'detailActivity'],
        categories: { dynamicHR: { outcome: 'cancelled' }, staticHR: { outcome: 'notRead' }, hrv: { outcome: 'notRead' } },
      });
      expect(mockHistoryRequests.requestStaticHR).not.toHaveBeenCalled();
      expect(mockAuth.syncV8VitalsByDevice).not.toHaveBeenCalled();
    } finally { Object.defineProperty(Platform, 'OS', { configurable: true, value: original }); }
  });

});
