import type { BleDiscoveredDevice } from './types';

const EV07B_MODEL_TOKEN = 'ev07b';

function compactIdentifier(value?: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function advertisedNames(device: BleDiscoveredDevice): string[] {
  return [device.name, device.localName]
    .map(compactIdentifier)
    .filter(value => value.length > 0);
}

export function isKnownPendantName(value?: string | null): boolean {
  const compact = compactIdentifier(value);
  return compact.includes(EV07B_MODEL_TOKEN);
}

export function isPendantScanDevice(
  device: BleDiscoveredDevice,
  assignedPendantHints: readonly string[] = [],
): boolean {
  if (!device.id || device.isConnectable === false) {
    return false;
  }

  const names = advertisedNames(device);
  if (names.some(name => isKnownPendantName(name))) {
    return true;
  }

  const hints = assignedPendantHints
    .map(compactIdentifier)
    .filter(hint => hint.length >= 4);

  return names.some(name => hints.some(hint => name === hint));
}

