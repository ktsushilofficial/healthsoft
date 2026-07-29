import { NativeEventEmitter, NativeModules } from 'react-native';
import type {
  EspBlufiDevice,
  EspBlufiStateEvent,
  EspBlufiWifiNetworksEvent,
  EspBlufiWifiStatusEvent,
} from './types';

type Subscription = { remove: () => void };

type EspBlufiNativeModule = {
  startScan(): Promise<boolean>;
  stopScan(): Promise<boolean>;
  connect(deviceId: string): Promise<boolean>;
  connectCompatibility(deviceId: string): Promise<boolean>;
  disconnect(): Promise<boolean>;
  requestWifiScan(): Promise<boolean>;
  provision(ssid: string, password: string): Promise<boolean>;
  requestWifiStatus(): Promise<boolean>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

export const ESP_BLUFI_EVENTS = {
  deviceFound: 'EspBlufiDeviceFound',
  state: 'EspBlufiState',
  wifiNetworks: 'EspBlufiWifiNetworks',
  wifiStatus: 'EspBlufiWifiStatus',
} as const;

const nativeModule = NativeModules.EspBlufiModule as
  | EspBlufiNativeModule
  | undefined;
const eventEmitter = nativeModule
  ? new NativeEventEmitter(nativeModule as never)
  : null;

function missingModuleError() {
  return new Error(
    'ESP-BluFi native module is unavailable. Rebuild the iOS or Android application.',
  );
}

function requireModule(): EspBlufiNativeModule {
  if (!nativeModule) {
    throw missingModuleError();
  }
  return nativeModule;
}

function subscribe<T>(
  eventName: string,
  listener: (event: T) => void,
): Subscription {
  if (!eventEmitter) {
    return { remove: () => {} };
  }
  return eventEmitter.addListener(eventName, listener);
}

export const espBlufi = {
  isAvailable: !!nativeModule,
  startScan: () => requireModule().startScan(),
  stopScan: () => requireModule().stopScan(),
  connect: (deviceId: string) => requireModule().connect(deviceId),
  connectCompatibility: (deviceId: string) =>
    requireModule().connectCompatibility(deviceId),
  disconnect: () => requireModule().disconnect(),
  requestWifiScan: () => requireModule().requestWifiScan(),
  provision: (ssid: string, password: string) =>
    requireModule().provision(ssid, password),
  requestWifiStatus: () => requireModule().requestWifiStatus(),
  onDeviceFound: (listener: (device: EspBlufiDevice) => void) =>
    subscribe(ESP_BLUFI_EVENTS.deviceFound, listener),
  onState: (listener: (event: EspBlufiStateEvent) => void) =>
    subscribe(ESP_BLUFI_EVENTS.state, listener),
  onWifiNetworks: (listener: (event: EspBlufiWifiNetworksEvent) => void) =>
    subscribe(ESP_BLUFI_EVENTS.wifiNetworks, listener),
  onWifiStatus: (listener: (event: EspBlufiWifiStatusEvent) => void) =>
    subscribe(ESP_BLUFI_EVENTS.wifiStatus, listener),
};
