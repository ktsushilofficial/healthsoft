export interface DevicePositionUpdate {
  latitude: number;
  longitude: number;
  altitude: number | null;
  direction: number | null;
  speed: number | null;
  hdop: number | null;
  satellites: number | null;
  timestamp: number | null;
  serverTimestamp: number | null;
  positionValid: boolean | null;
  raw: Record<string, unknown>;
}

export type DevicePositionStreamListener = (
  position: DevicePositionUpdate,
) => void;

export type DevicePositionStreamErrorListener = (message: string) => void;
