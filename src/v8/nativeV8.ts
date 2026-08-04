import { NativeEventEmitter, NativeModules } from 'react-native';

type NativeV8Module = {
  startScan(nameFilters: string[]): Promise<boolean>;
  stopScan(): Promise<boolean>;
  connect(deviceId: string): Promise<boolean>;
  disconnect(): Promise<boolean>;
  requestDeviceVersion(): Promise<boolean>;
  requestBattery(): Promise<boolean>;
  requestDeviceMac(): Promise<boolean>;
  requestDeviceName(): Promise<boolean>;
  setDeviceName(name: string): Promise<boolean>;
  setDeviceId(deviceId: string): Promise<boolean>;
  requestDeviceTime(): Promise<boolean>;
  syncDeviceTime(): Promise<boolean>;
  requestPersonalInfo(): Promise<boolean>;
  setPersonalInfo(
    sex: number,
    age: number,
    height: number,
    weight: number,
    stepLength: number,
  ): Promise<boolean>;
  setRealtimeStepEnabled(enabled: boolean, includeTemperature: boolean): Promise<boolean>;
  requestTotalActivity(mode: number, startDate: string | number): Promise<boolean>;
  requestDetailActivity(mode: number, startDate: string | number): Promise<boolean>;
  requestSleep(mode: number, startDate: string | number): Promise<boolean>;
  requestDynamicHR(mode: number, startDate: string | number): Promise<boolean>;
  requestStaticHR(mode: number, startDate: string | number): Promise<boolean>;
  requestHRV(mode: number, startDate: string | number): Promise<boolean>;
  requestSpo2?(mode: number, startDate: string | number): Promise<boolean>;
  requestTemperature?(mode: number, startDate: string | number): Promise<boolean>;
  setEcgRealtimeEnabled(enabled: boolean): Promise<boolean>;
  startEcgMeasurement(): Promise<boolean>;
  stopEcgMeasurement(): Promise<boolean>;
  exitEcgMeasurement(): Promise<boolean>;
  startPpgMeasurement(): Promise<boolean>;
  stopPpgMeasurement(): Promise<boolean>;
  exitPpgMeasurement(): Promise<boolean>;
};

const nativeModule = NativeModules.V8BleModule as NativeV8Module | undefined;

export const isV8NativeAvailable = !!nativeModule;
export const v8Native = nativeModule;
export const v8Emitter = nativeModule ? new NativeEventEmitter(nativeModule as any) : null;
