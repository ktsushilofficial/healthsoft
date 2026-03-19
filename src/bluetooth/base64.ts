import { Buffer } from 'buffer';

export function decodeBase64ToUtf8(base64: string): string {
  // react-native-ble-plx returns characteristic values as Base64 strings.
  // These are typically UTF-8 strings for standard Device Information characteristics.
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function encodeUtf8ToBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

