import type { BleDeviceIdentity, BleDiscoveredDevice } from '../bluetooth/types';

type UnknownRecord = Record<string, unknown>;

export interface SeniorAssignedDevice {
  id: string;
  assignmentId: string | null;
  deviceId: string | null;
  deviceIdentifier: string | null;
  imei: string | null;
  serialNumber: string | null;
  bluetoothMacAddress: string | null;
  name: string | null;
  status: string | null;
  raw: UnknownRecord;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function readPath(record: UnknownRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    const next = asRecord(current);
    return next ? next[segment] : undefined;
  }, record);
}

function firstString(record: UnknownRecord, paths: string[]): string | null {
  for (const path of paths) {
    const value = readPath(record, path);
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function firstArray(payload: UnknownRecord, paths: string[]): unknown[] | null {
  for (const path of paths) {
    const value = readPath(payload, path);
    if (Array.isArray(value)) {
      return value;
    }
  }
  return null;
}

function normalizeImei(value?: string | null): string | null {
  if (!value) return null;
  const digitsOnly = value.replace(/\D/g, '');
  return digitsOnly.length > 0 ? digitsOnly : null;
}

function normalizeMac(value?: string | null): string | null {
  if (!value) return null;
  const hexOnly = value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  return hexOnly.length > 0 ? hexOnly : null;
}

function normalizeLabel(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractSeniorAssignedDevices(payload: unknown): SeniorAssignedDevice[] {
  const source =
    Array.isArray(payload)
      ? payload
      : firstArray(asRecord(payload) ?? {}, [
          'data',
          'items',
          'content',
          'devices',
          'data.items',
          'data.content',
          'data.devices',
        ]);

  if (!source) {
    return [];
  }

  return source
    .map((item, index) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }

      const imei = firstString(record, [
        'imei',
        'imeiNumber',
        'deviceImei',
        'device.imei',
        'device.imeiNumber',
      ]);

      const assignmentId = firstString(record, [
        'assignmentId',
        'seniorDeviceAssignmentId',
        'id',
      ]);

      const deviceId = firstString(record, [
        'deviceId',
        'assignedDeviceId',
        'trackingDeviceId',
        'device.id',
      ]);

      const deviceIdentifier = firstString(record, [
        'deviceIdentifier',
        'identifier',
        'deviceIdentifierValue',
        'device.deviceIdentifier',
        'device.identifier',
      ]);

      const serialNumber = firstString(record, [
        'serialNumber',
        'serial',
        'deviceSerialNumber',
        'device.serialNumber',
      ]);

      const bluetoothMacAddress = firstString(record, [
        'bluetoothMacAddress',
        'bluetoothMac',
        'bleMacAddress',
        'macAddress',
        'device.bluetoothMacAddress',
        'device.bluetoothMac',
        'device.macAddress',
      ]);

      const name = firstString(record, [
        'name',
        'deviceName',
        'model',
        'device.name',
        'device.deviceName',
        'device.model',
      ]);

      const status = firstString(record, [
        'status',
        'assignmentStatus',
        'device.status',
      ]);

      return {
        id: assignmentId ?? deviceId ?? imei ?? deviceIdentifier ?? serialNumber ?? `assigned-device-${index}`,
        assignmentId,
        deviceId,
        deviceIdentifier,
        imei,
        serialNumber,
        bluetoothMacAddress,
        name,
        status,
        raw: record,
      };
    })
    .filter((item): item is SeniorAssignedDevice => item !== null);
}

export function findAssignedDeviceForBleDevice(
  device: BleDiscoveredDevice,
  identity: BleDeviceIdentity | undefined,
  assignedDevices: SeniorAssignedDevice[],
): SeniorAssignedDevice | null {
  const bleImeiCandidates = [
    identity?.imei,
    identity?.serialNumber,
    device.name,
    device.localName,
  ]
    .map(value => normalizeImei(value ?? null))
    .filter((value): value is string => !!value);

  const bleMacCandidates = [
    identity?.bluetoothMacAddress,
    device.id,
    device.name,
    device.localName,
  ]
    .map(value => normalizeMac(value ?? null))
    .filter((value): value is string => !!value);

  const bleId = normalizeLabel(device.id);
  const bleNameCandidates = [device.name, device.localName]
    .map(value => normalizeLabel(value ?? null))
    .filter((value): value is string => !!value);

  for (const assignedDevice of assignedDevices) {
    const assignedImeiCandidates = [assignedDevice.imei, assignedDevice.deviceIdentifier, assignedDevice.serialNumber]
      .map(value => normalizeImei(value ?? null))
      .filter((value): value is string => !!value);

    if (
      assignedImeiCandidates.length > 0 &&
      bleImeiCandidates.some(candidate => assignedImeiCandidates.includes(candidate))
    ) {
      return assignedDevice;
    }

    const assignedMac = normalizeMac(assignedDevice.bluetoothMacAddress ?? null);
    if (assignedMac && bleMacCandidates.includes(assignedMac)) {
      return assignedDevice;
    }

    const assignedDeviceId = normalizeLabel(assignedDevice.deviceId ?? null);
    if (assignedDeviceId && assignedDeviceId === bleId) {
      return assignedDevice;
    }

    const assignedName = normalizeLabel(assignedDevice.name ?? null);
    if (assignedName && bleNameCandidates.includes(assignedName)) {
      return assignedDevice;
    }
  }

  return null;
}

export function resolveDisplayedImei(
  identity: BleDeviceIdentity | undefined,
  assignedDevice?: SeniorAssignedDevice | null,
): string | null {
  return (
    identity?.imei ??
    assignedDevice?.imei ??
    assignedDevice?.deviceIdentifier ??
    identity?.serialNumber ??
    assignedDevice?.serialNumber ??
    null
  );
}
