import { NativeEventEmitter, NativeModules } from 'react-native';

type NativePillBoxModule = {
  startScan(): Promise<boolean>;
  stopScan(): Promise<boolean>;
  connect(deviceId: string): Promise<boolean>;
  disconnect(): Promise<boolean>;
  refreshSnapshot(): Promise<boolean>;
  getCachedSnapshot(): Promise<Record<string, unknown> | null>;
  getState(): Promise<{ state: string }>;
  setAlarm(
    slot: number,
    time: string,
    enabled: boolean,
    repeatDays: Array<number>,
    remark: string,
  ): Promise<boolean>;
  setTimeFormat(timeFormat: number): Promise<boolean>;
  setVolume(volume: number): Promise<boolean>;
  setRingType(ringType: number): Promise<boolean>;
  setReminderDuration(duration: number): Promise<boolean>;
  unbind(): Promise<boolean>;
};

const nativeModule = NativeModules.PillBoxBridgeModule as NativePillBoxModule | undefined;

export const isPillBoxNativeAvailable = !!nativeModule;
export const pillBoxNative = nativeModule;
export const pillBoxEmitter = nativeModule ? new NativeEventEmitter(nativeModule as any) : null;
