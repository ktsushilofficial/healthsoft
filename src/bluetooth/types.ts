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

export interface BleGeoPoint {
  latitude: number;
  longitude: number;
}

export interface BleDeviceIdentity {
  moduleNumber?: string;
  imei?: string;
  iccid?: string;
  bluetoothMacAddress?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  firmwareRevision?: string;
  firmwareBuildInfo?: string;
  hardwareRevision?: string;
  softwareRevision?: string;
  batteryLevel?: number; // percentage 0-100
  batteryVoltage?: number; // mV
  sosNumber?: string;
  sosSlot?: number;
  sosNumber2?: string;  // authorized number slot 1
  sosSlot2?: number;
  sosNumber3?: string;  // authorized number slot 2
  sosSlot3?: number;
  timezone?: number; // 15-min units
  apn?: string;
  apnUsername?: string;
  apnPassword?: string;
  serverAddress?: string;
  serverPort?: number;
  networkOperator?: string;
  versionInfo?: string;
  heartbeatInterval?: number; // seconds
  uploadInterval?: number; // seconds
  lazyUploadInterval?: number; // seconds
  // Additional writable fields
  workingMode?: number;      // 0x0A: 0=Normal, 1=PowerSave, 2=Sleep
  alarmClockIndex?: number;  // 0x0B: alarm slot index (0-3)
  alarmClockHour?: number;   // 0x0B: hour (0-23)
  alarmClockMinute?: number; // 0x0B: minute (0-59)
  alarmClockEnabled?: boolean; // 0x0B: enabled flag
  alarmClockWorkdayMask?: number; // 0x0B: repeat days bitmask (Mon bit0 ... Sun bit6)
  alarmClockDurationSec?: number; // 0x0B: reminder duration in seconds
  alarmClockRing?: number; // 0x0B: ringtone index (1-10)
  noDisturbStart?: number;   // 0x0C: start time in minutes from midnight
  noDisturbEnd?: number;     // 0x0C: end time in minutes from midnight
  noDisturbEnabled?: boolean;// 0x0C: enabled flag
  enableControl?: number;    // 0x0F: bitmask — bit0=fallDetect, bit1=SOS, bit2=GPS, bit3=WiFi, bit4=BLE, etc.
  ringtoneVolume?: number;   // 0x10: 0-8
  micVolume?: number;        // 0x11: 0-8
  speakerVolume?: number;    // 0x12: 0-8
  bleLocating?: boolean;     // derived from enableControl bit 8
  whitelistDevice?: string;  // 0x16: whitelist MAC address
  smsGpsUrl?: string;        // 0x17: GPS SMS reply URL template
  smsWifiLbsUrl?: string;    // 0x18: WiFi/LBS SMS reply URL template
  voicePromptMask?: number;  // 0x19: 32-bit voice prompt bitmask
  geoAlertIndex?: number;    // 0x51: geo fence slot index
  geoAlertEnabled?: boolean; // 0x51: geo fence enabled flag
  geoAlertDirection?: 'out' | 'in'; // 0x51: exit or enter trigger
  geoAlertType?: 'circle' | 'polygon'; // 0x51: circle or polygon fence
  geoAlertRadiusMeters?: number; // 0x51: circle radius in meters
  geoAlertPoints?: BleGeoPoint[]; // 0x51: one center point or polygon points
  noMotionAlertEnabled?: boolean; // 0x53: no-motion alert enabled
  noMotionAlertDial?: boolean; // 0x53: dial on alert
  noMotionAlertStaticPeriodSec?: number; // 0x53: static period threshold
  tiltAlertEnabled?: boolean; // 0x55: tilt alert enabled
  tiltAlertDial?: boolean; // 0x55: dial on alert
  tiltAlertAngleDeg?: number; // 0x55: angle threshold in degrees
  tiltAlertDurationSec?: number; // 0x55: duration threshold in seconds
  fallDownAlertEnabled?: boolean; // 0x56: fall-down alert enabled
  fallDownAlertDial?: boolean; // 0x56: dial on alert
  fallDownAlertSensitivity?: number; // 0x56: sensitivity level 1-9
  initMileage?: number;      // 0x09: initial mileage in meters (u32le)
}

export interface BleDataSnapshot {
  keys: Record<number, Uint8Array>;
  receivedAt: number; // ms epoch
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
