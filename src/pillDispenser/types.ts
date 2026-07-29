export type EspBlufiDevice = {
  id: string;
  name: string;
  rssi: number | null;
  isConnectable?: boolean;
  isLikelyBluFi?: boolean;
};

export type EspBlufiWifiNetwork = {
  ssid: string;
  rssi: number;
};

export type EspBlufiConnectionStage =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'securing'
  | 'ready'
  | 'provisioning'
  | 'connected'
  | 'error';

export type EspBlufiStateEvent = {
  state:
    | 'scanning'
    | 'scanStopped'
    | 'connecting'
    | 'connected'
    | 'secure'
    | 'compatible'
    | 'securityUnsupported'
    | 'provisioning'
    | 'configured'
    | 'wifiConnected'
    | 'disconnected'
    | 'error';
  deviceId?: string;
  ssid?: string;
  message?: string;
  blufiVersion?: string;
};

export type EspBlufiWifiNetworksEvent = {
  networks: EspBlufiWifiNetwork[];
};

export type EspBlufiWifiStatusEvent = {
  connected: boolean;
  ssid?: string;
  statusCode?: number;
  message?: string;
};
