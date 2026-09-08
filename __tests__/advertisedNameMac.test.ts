import { resolveAssignedMacFromAdvertisedName } from '../src/utils/deviceAssignments';

const ASSIGNED = ['C4:14:D5:0E:09:F6'];

describe('resolving an assigned MAC from the advertised BLE name', () => {
  it('matches the real band: "JCV8 0E09F6" against C4:14:D5:0E:09:F6', () => {
    expect(resolveAssignedMacFromAdvertisedName('JCV8    0E09F6', ASSIGNED)).toBe(
      'C414D50E09F6',
    );
  });

  it('is insensitive to case and separators in the name', () => {
    expect(resolveAssignedMacFromAdvertisedName('jcv8-0e:09:f6', ASSIGNED)).toBe(
      'C414D50E09F6',
    );
  });

  it('does not match a different band', () => {
    expect(resolveAssignedMacFromAdvertisedName('JCV8 AABBCC', ASSIGNED)).toBeNull();
  });

  it('refuses to guess when two assigned bands share the suffix', () => {
    expect(
      resolveAssignedMacFromAdvertisedName('JCV8 0E09F6', [
        'C4:14:D5:0E:09:F6',
        'AA:BB:CC:0E:09:F6',
      ]),
    ).toBeNull();
  });

  it('handles a missing or too-short name', () => {
    expect(resolveAssignedMacFromAdvertisedName(null, ASSIGNED)).toBeNull();
    expect(resolveAssignedMacFromAdvertisedName('JCV8', ASSIGNED)).toBeNull();
  });
});
