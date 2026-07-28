import {
  canAccessPendantTracking,
  parseDevicePositionUpdate,
  parseSseEventBlock,
} from '../src/utils/devicePositionStream';

describe('device position stream helpers', () => {
  it('allows pendant tracking only for caretakers and guardians', () => {
    expect(canAccessPendantTracking('CARE_TAKER')).toBe(true);
    expect(canAccessPendantTracking('GUARDIAN')).toBe(true);
    expect(canAccessPendantTracking('SENIOR')).toBe(false);
    expect(canAccessPendantTracking('ADMIN')).toBe(false);
    expect(canAccessPendantTracking(null)).toBe(false);
  });

  it('parses a direct backend position DTO', () => {
    expect(
      parseDevicePositionUpdate({
        deviceUUID: 'device-1',
        positionLatitude: 28.612901,
        positionLongitude: 77.229471,
        positionSpeed: 4,
        positionValid: true,
      }),
    ).toEqual(
      expect.objectContaining({
        latitude: 28.612901,
        longitude: 77.229471,
        speed: 4,
        positionValid: true,
      }),
    );
  });

  it('parses a nested latestPosition payload with dotted coordinates', () => {
    expect(
      parseDevicePositionUpdate({
        latestPosition: {
          'position.latitude': 28.61,
          'position.longitude': 77.22,
        },
      }),
    ).toEqual(
      expect.objectContaining({
        latitude: 28.61,
        longitude: 77.22,
      }),
    );
  });

  it('extracts JSON from an SSE data block', () => {
    expect(
      parseSseEventBlock(
        'event:position\ndata:{"positionLatitude":28.6,"positionLongitude":77.2}',
      ),
    ).toEqual({
      positionLatitude: 28.6,
      positionLongitude: 77.2,
    });
  });
});
