export interface GeofenceExitAlarm {
  id?: number;
  'device.id'?: number;
  'device.name'?: string;
  'device.serial.number'?: string;
  'event.enum'?: number;
  'geofence.alarm.1'?: boolean;
  'geofence.alarm.2'?: boolean;
  'geofence.status.1'?: boolean;
  ident?: string;
  timestamp?: number;
  'server.timestamp'?: number;
  'position.latitude'?: number;
  'position.longitude'?: number;
  isResolved?: boolean;
  resolvedAt?: number | null;
  ticketId?: string;
  createdAt?: number;
}

export interface GeofenceLatestPosition {
  id?: number;
  deviceUUID?: string;
  deviceId?: number;
  deviceName?: string;
  deviceSerialNumber?: string;
  ident?: string;
  positionLatitude?: number;
  positionLongitude?: number;
  positionAltitude?: number;
  positionDirection?: number;
  positionHdop?: number;
  positionSatellites?: number;
  positionSpeed?: number;
  positionValid?: boolean;
  serverTimestamp?: number;
  timestamp?: number;
  createdAt?: number;
}

export interface GeofenceExitTicket {
  id?: string;
  ident?: string;
  deviceId?: string;
  seniorId?: string;
  alertType?: string;
  severity?: string;
  status?: string;
  alarmEventId?: number;
  positionEventId?: number;
  raisedAt?: number;
  acknowledgedAt?: number | null;
  resolvedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
  resolutionRemark?: string | null;
  ticketNote?: string | null;
}

export interface GeofenceExitApiResponse {
  geofenceAlarm?: GeofenceExitAlarm | null;
  latestPosition?: GeofenceLatestPosition | null;
  ticket?: GeofenceExitTicket | null;
}
