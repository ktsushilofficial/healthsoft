import {
  decodeEv07bAlarmClock,
  decodeEv07bAsciiSetting,
  decodeEv07bAuthorizedPhone,
  decodeEv07bFallDownAlert,
  decodeEv07bFlagMask,
  decodeEv07bGeoAlert,
  decodeEv07bNoMotionAlert,
  decodeEv07bNoDisturb,
  decodeEv07bTiltAlert,
  encodeEv07bAlarmClock,
  encodeEv07bAsciiSetting,
  encodeEv07bAuthorizedPhone,
  encodeEv07bFallDownAlert,
  encodeEv07bGeoAlert,
  encodeEv07bNoMotionAlert,
  encodeEv07bNoDisturb,
  encodeEv07bTiltAlert,
  ev07bGeoAlertValuesMatch,
  hasEv07bFlag,
  normalizeEv07bWorkdayMask,
  toggleEv07bFlag,
} from '../src/bluetooth/ev07bConfigCodec';
import { u32le } from '../src/bluetooth/ev07bProtocol';

describe('ev07bConfigCodec', () => {
  test('encodes alarm clock with enable flag and slot index', () => {
    const encoded = encodeEv07bAlarmClock({
      index: 1,
      enabled: true,
      hour: 8,
      minute: 30,
      workdayMask: 0b00011111,
      durationSec: 45,
      ring: 3,
    });

    expect(Array.from(encoded)).toEqual([0x81, 8, 30, 0b00011111, 45, 3]);
  });

  test('defaults enabled alarm with empty weekday mask to everyday', () => {
    const encoded = encodeEv07bAlarmClock({
      index: 1,
      enabled: true,
      hour: 7,
      minute: 0,
      workdayMask: 0,
      durationSec: 30,
      ring: 1,
    });

    expect(encoded[0]).toBe(0x81);
    expect(encoded[3]).toBe(0x7f);
    expect(normalizeEv07bWorkdayMask(0, true)).toBe(0x7f);
  });

  test('decodes alarm clock payload including slot, repeat mask, duration, and ring', () => {
    const decoded = decodeEv07bAlarmClock(Uint8Array.from([0x82, 6, 15, 0b0111110, 90, 6]));

    expect(decoded).toEqual({
      index: 2,
      enabled: true,
      hour: 6,
      minute: 15,
      workdayMask: 0b0111110,
      durationSec: 90,
      ring: 6,
    });
  });

  test('keeps disabled alarm with empty weekday mask empty', () => {
    const encoded = encodeEv07bAlarmClock({
      index: 0,
      enabled: false,
      hour: 0,
      minute: 0,
      workdayMask: 0,
      durationSec: 30,
      ring: 1,
    });

    expect(Array.from(encoded)).toEqual([0x00, 0, 0, 0x00, 30, 1]);
  });

  test('encodes and decodes do not disturb payload', () => {
    const encoded = encodeEv07bNoDisturb({
      enabled: true,
      startHour: 22,
      startMinute: 15,
      endHour: 7,
      endMinute: 45,
    });

    expect(Array.from(encoded)).toEqual([0x80, 22, 15, 7, 45]);
    expect(decodeEv07bNoDisturb(encoded)).toEqual({
      enabled: true,
      startHour: 22,
      startMinute: 15,
      endHour: 7,
      endMinute: 45,
    });
  });

  test('encodes and decodes authorized phone payload with slot metadata', () => {
    const encoded = encodeEv07bAuthorizedPhone({
      slot: 2,
      enabled: true,
      acceptSms: true,
      noSimDialing: false,
      acceptPhoneCall: true,
      number: '+919876543210',
    });

    expect(Array.from(encoded)).toEqual([
      0xe2,
      0x2b,
      0x39,
      0x31,
      0x39,
      0x38,
      0x37,
      0x36,
      0x35,
      0x34,
      0x33,
      0x32,
      0x31,
      0x30,
    ]);
    expect(decodeEv07bAuthorizedPhone(encoded)).toEqual({
      slot: 2,
      enabled: true,
      acceptSms: true,
      noSimDialing: false,
      acceptPhoneCall: true,
      number: '+919876543210',
    });
  });

  test('encodes and decodes SMS URL settings with trimming and max length', () => {
    const trimmedValue = 'https://maps.example/device/location?id=123';
    const encoded = encodeEv07bAsciiSetting(` ${trimmedValue} `, 40);

    expect(encoded).toHaveLength(40);
    expect(decodeEv07bAsciiSetting(encoded)).toBe(trimmedValue.slice(0, 40));
    expect(decodeEv07bAsciiSetting(Uint8Array.from([]))).toBe('');
  });

  test('decodes and toggles 32-bit feature masks including high bits', () => {
    const decoded = decodeEv07bFlagMask(u32le(0x80000100));

    expect(decoded).toBe(0x80000100);
    expect(hasEv07bFlag(decoded, 8)).toBe(true);
    expect(hasEv07bFlag(decoded, 31)).toBe(true);
    expect(toggleEv07bFlag(decoded ?? 0, 8)).toBe(0x80000000);
  });

  test('encodes and decodes no-motion alert payload', () => {
    const encoded = encodeEv07bNoMotionAlert({
      enabled: true,
      dial: true,
      staticPeriodSec: 900,
    });

    expect(Array.from(encoded)).toEqual(Array.from(u32le(0xc0000384)));
    expect(decodeEv07bNoMotionAlert(encoded)).toEqual({
      enabled: true,
      dial: true,
      staticPeriodSec: 900,
    });
  });

  test('encodes and decodes tilt alert payload', () => {
    const encoded = encodeEv07bTiltAlert({
      enabled: true,
      dial: false,
      angleDeg: 60,
      durationSec: 120,
    });

    expect(Array.from(encoded)).toEqual(Array.from(u32le(0x803c0078)));
    expect(decodeEv07bTiltAlert(encoded)).toEqual({
      enabled: true,
      dial: false,
      angleDeg: 60,
      durationSec: 120,
    });
  });

  test('encodes and decodes fall-down alert payload', () => {
    const encoded = encodeEv07bFallDownAlert({
      enabled: true,
      dial: true,
      alwaysOn: true,
      sensitivity: 7,
    });

    expect(Array.from(encoded)).toEqual([0xe7]);
    expect(decodeEv07bFallDownAlert(encoded)).toEqual({
      enabled: true,
      dial: true,
      alwaysOn: true,
      sensitivity: 7,
    });
  });

  test('encodes and decodes circle geo alert payload', () => {
    const encoded = encodeEv07bGeoAlert({
      index: 2,
      enabled: true,
      direction: 'in',
      type: 'circle',
      radiusMeters: 150,
      points: [{ latitude: 12.9716, longitude: 77.5946 }],
    });
    const decoded = decodeEv07bGeoAlert(encoded);

    expect(Array.from(encoded.slice(0, 4))).toEqual([0x12, 0x03, 0x96, 0x00]);
    expect(decoded).toMatchObject({
      index: 2,
      enabled: true,
      direction: 'in',
      type: 'circle',
      radiusMeters: 150,
    });
    expect(decoded?.points[0].latitude).toBeCloseTo(12.9716, 5);
    expect(decoded?.points[0].longitude).toBeCloseTo(77.5946, 5);
  });

  test('encodes and decodes polygon geo alert payload', () => {
    const encoded = encodeEv07bGeoAlert({
      index: 1,
      enabled: false,
      direction: 'out',
      type: 'polygon',
      radiusMeters: 0,
      points: [
        { latitude: 12.97, longitude: 77.59 },
        { latitude: 12.98, longitude: 77.60 },
        { latitude: 12.98, longitude: 77.59 },
        { latitude: 12.97, longitude: 77.60 },
      ],
    });
    const decoded = decodeEv07bGeoAlert(encoded);

    expect(Array.from(encoded.slice(0, 4))).toEqual([0x41, 0x04, 0x00, 0x00]);
    expect(decoded).toMatchObject({
      index: 1,
      enabled: false,
      direction: 'out',
      type: 'polygon',
      radiusMeters: 0,
    });
    expect(decoded?.points).toHaveLength(4);
  });

  test('limits polygon geo alert payload to four points', () => {
    const decoded = decodeEv07bGeoAlert(encodeEv07bGeoAlert({
      index: 1,
      enabled: true,
      direction: 'out',
      type: 'polygon',
      radiusMeters: 0,
      points: [
        { latitude: 12, longitude: 77 },
        { latitude: 13, longitude: 78 },
        { latitude: 13, longitude: 77 },
        { latitude: 12, longitude: 78 },
        { latitude: 14, longitude: 79 },
      ],
    }));

    expect(decoded?.points).toHaveLength(4);
    expect(decoded?.points).not.toContainEqual({ latitude: 14, longitude: 79 });
  });

  test('rejects a triangle polygon geo alert payload', () => {
    expect(() => encodeEv07bGeoAlert({
      index: 1,
      enabled: true,
      direction: 'out',
      type: 'polygon',
      radiusMeters: 0,
      points: [
        { latitude: 12, longitude: 77 },
        { latitude: 13, longitude: 78 },
        { latitude: 13, longitude: 77 },
      ],
    })).toThrow('requires exactly 4 points');
  });

  test('normalizes invalid circle radius and unused polygon radius', () => {
    const circle = decodeEv07bGeoAlert(encodeEv07bGeoAlert({
      index: 0,
      enabled: true,
      direction: 'out',
      type: 'circle',
      radiusMeters: 50,
      points: [{ latitude: 12.9716, longitude: 77.5946 }],
    }));
    const polygon = decodeEv07bGeoAlert(encodeEv07bGeoAlert({
      index: 0,
      enabled: true,
      direction: 'out',
      type: 'polygon',
      radiusMeters: 500,
      points: [
        { latitude: 12.97, longitude: 77.59 },
        { latitude: 12.98, longitude: 77.60 },
        { latitude: 12.98, longitude: 77.59 },
        { latitude: 12.97, longitude: 77.60 },
      ],
    }));

    expect(circle?.radiusMeters).toBe(100);
    expect(polygon?.radiusMeters).toBe(0);
  });

  test('matches firmware-normalized circle and polygon values semantically', () => {
    const circle = encodeEv07bGeoAlert({
      index: 2,
      enabled: true,
      direction: 'in',
      type: 'circle',
      radiusMeters: 150,
      points: [{ latitude: 12.9716, longitude: 77.5946 }],
    });
    const normalizedCircle = circle.slice();
    normalizedCircle[0] &= 0x0f;

    const polygon = encodeEv07bGeoAlert({
      index: 1,
      enabled: true,
      direction: 'out',
      type: 'polygon',
      radiusMeters: 0,
      points: [
        { latitude: 12.97, longitude: 77.59 },
        { latitude: 12.98, longitude: 77.60 },
        { latitude: 12.98, longitude: 77.59 },
        { latitude: 12.97, longitude: 77.60 },
      ],
    });
    const normalizedPolygon = polygon.slice();
    normalizedPolygon[2] = 0x7b;

    expect(ev07bGeoAlertValuesMatch(circle, normalizedCircle)).toBe(true);
    expect(ev07bGeoAlertValuesMatch(polygon, normalizedPolygon)).toBe(true);
    expect(ev07bGeoAlertValuesMatch(circle, polygon)).toBe(false);
  });
});
