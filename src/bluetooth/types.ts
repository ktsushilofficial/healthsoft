export type BleConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'disconnecting'
  | 'error';

export interface BleDiscoveredDevice {
  id: string;
  name?: string | null;
  localName?: string | null;
  rssi?: number | null;
  isConnectable?: boolean | null;
  serviceUUIDs?: string[] | null;
}

export interface BleDeviceIdentity {
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
}

export interface BleCharacteristicSummary {
  uuid: string;
  isReadable: boolean;
  isWritableWithResponse: boolean;
  isWritableWithoutResponse: boolean;
  isNotifiable: boolean;
  isIndicatable: boolean;
}

export interface BleServiceSummary {
  uuid: string;
  characteristics: BleCharacteristicSummary[];
}

export interface BleGattDetails {
  services: BleServiceSummary[];
}

