import { NativeEventEmitter, NativeModules } from 'react-native';

type PillDispenserScanResult = {
  id: string;
  name?: string | null;
  localName?: string | null;
  rssi?: number | null;
  isConnectable?: boolean | null;
  serviceUUIDs?: string[] | null;
  isLikelyBlufi?: boolean | null;
};

type PillDispenserConnectionEvent = {
  state: 'connecting' | 'connected' | 'disconnected' | 'error' | string;
  deviceId?: string | null;
};

type PillDispenserStatusEvent = {
  status?: number;
  opMode?: number;
  softApSecurity?: number;
  softApConnectionCount?: number;
  softApMaxConnection?: number;
  softApChannel?: number;
  softApPassword?: string | null;
  softApSsid?: string | null;
  staConnectionStatus?: number;
  staBssid?: string | null;
  staSsid?: string | null;
  staPassword?: string | null;
};

type PillDispenserVersionEvent = {
  status?: number;
  versionString?: string | null;
  bigVer?: number;
  smallVer?: number;
};

type PillDispenserWifiScanEvent = {
  status?: number;
  results?: Array<{
    ssid?: string | null;
    rssi?: number | null;
    type?: number | null;
  }>;
};

type PillDispenserCustomDataEvent = {
  status?: number;
  direction?: 'sent' | 'received';
  dataBase64?: string | null;
  dataUtf8?: string | null;
};

type PillDispenserErrorEvent = {
  code?: string;
  message?: string;
};

type NativePillDispenserModule = {
  startScan(nameFilters?: string[] | null): Promise<boolean>;
  stopScan(): Promise<boolean>;
  connect(deviceId: string): Promise<boolean>;
  disconnect(): Promise<boolean>;
  requestCloseConnection(): Promise<boolean>;
  negotiateSecurity(): Promise<boolean>;
  requestDeviceVersion(): Promise<boolean>;
  requestDeviceStatus(): Promise<boolean>;
  requestDeviceScan(): Promise<boolean>;
  postCustomData(base64Data: string): Promise<boolean>;
  configureStation(ssid: string, password: string, bssid?: string | null): Promise<boolean>;
};

const nativeModule = NativeModules.PillDispenserBridge as NativePillDispenserModule | undefined;

export const isPillDispenserBridgeAvailable = !!nativeModule;
export const pillDispenserBridge = nativeModule;
export const pillDispenserEmitter = nativeModule
  ? new NativeEventEmitter(nativeModule as any)
  : null;

export type {
  PillDispenserScanResult,
  PillDispenserConnectionEvent,
  PillDispenserStatusEvent,
  PillDispenserVersionEvent,
  PillDispenserWifiScanEvent,
  PillDispenserCustomDataEvent,
  PillDispenserErrorEvent,
};
