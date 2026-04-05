import {
  decodeEv07bAlarmClock,
  decodeEv07bAsciiSetting,
  decodeEv07bAuthorizedPhone,
  decodeEv07bFlagMask,
  decodeEv07bNoDisturb,
  encodeEv07bAlarmClock,
  encodeEv07bAsciiSetting,
  encodeEv07bAuthorizedPhone,
  encodeEv07bNoDisturb,
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
      noSimDialing: true,
      acceptPhoneCall: false,
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
      noSimDialing: true,
      acceptPhoneCall: false,
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
});
