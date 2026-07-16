import { Buffer } from 'buffer';

// EV-07B message framing helpers (Command 0x02 Configuration)
// Frame: AB | Properties(1) | Length(2 LE) | CRC16(body)(2 LE) | SeqId(2 LE) | Body
// Body: Command(1) + KeyBlocks..., each KeyBlock = KeyLen(1) + Key(1) + KeyValue(KeyLen-1 bytes)

const HEADER = 0xab;

export interface Ev07bFrame {
  command: number;
  seqId: number;
  blocks: Array<{ key: number; value: Uint8Array }>;
  keys: Record<number, Uint8Array>;
  errorCode?: number;
}

export function crc16Ev07b(data: Uint8Array, initial = 0x0000): number {
  let crc = initial;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc >> 8) | (crc << 8)) & 0xffff;
    crc ^= data[i];
    crc ^= (crc & 0xff) >> 4;
    crc ^= (crc << 12) & 0xffff;
    crc ^= ((crc & 0xff) << 5) & 0xffff;
  }
  return crc & 0xffff;
}

export function buildConfigFrame(options: {
  seqId: number;
  readKeys?: number[];
  writeBlocks?: { key: number; value: Uint8Array }[];
}): Uint8Array {
  const body: number[] = [];
  body.push(0x02); // Command: Configuration

  if (options.readKeys && options.readKeys.length) {
    // 0xF0 is one read block whose value is the list of configuration keys.
    // KeyLen includes the 0xF0 key byte itself. Sending the requested keys as
    // separate empty blocks makes them look like invalid writes on EV-07B.
    body.push((options.readKeys.length + 1) & 0xff);
    body.push(0xf0);
    options.readKeys.forEach(k => {
      body.push(k & 0xff);
    });
  }

  (options.writeBlocks ?? []).forEach(block => {
    body.push((block.value.length + 1) & 0xff); // KeyLen = value + key byte
    body.push(block.key & 0xff);
    body.push(...block.value);
  });

  const bodyArr = Uint8Array.from(body);
  const length = bodyArr.length;
  const crc = crc16Ev07b(bodyArr);

  const frame = new Uint8Array(1 + 1 + 2 + 2 + 2 + length);
  let o = 0;
  frame[o++] = HEADER;
  frame[o++] = 0x10; // Properties: request ACK (bit4), no encryption
  frame[o++] = length & 0xff;
  frame[o++] = (length >> 8) & 0xff;
  frame[o++] = crc & 0xff;
  frame[o++] = (crc >> 8) & 0xff;
  frame[o++] = options.seqId & 0xff;
  frame[o++] = (options.seqId >> 8) & 0xff;
  frame.set(bodyArr, o);
  return frame;
}

export function parseEv07bFrame(raw: Uint8Array): Ev07bFrame | null {
  if (raw.length < 8) return null;
  if (raw[0] !== HEADER) return null;
  const length = raw[2] | (raw[3] << 8);
  if (length + 8 !== raw.length) return null;
  const crcExpected = raw[4] | (raw[5] << 8);
  const seqId = raw[6] | (raw[7] << 8);
  const body = raw.slice(8);
  const crcActual = crc16Ev07b(body);
  if (crcActual !== crcExpected) return null;
  const command = body[0];
  const blocks: Array<{ key: number; value: Uint8Array }> = [];
  const keys: Record<number, Uint8Array> = {};
  let idx = 1;
  while (idx < body.length) {
    if (idx + 1 >= body.length) return null;
    const keyLen = body[idx];
    if (keyLen < 1) return null;
    const key = body[idx + 1];
    const valueStart = idx + 2;
    const valueEnd = valueStart + keyLen - 1;
    if (valueEnd > body.length) return null;
    const value = body.slice(valueStart, valueEnd);
    blocks.push({ key, value });
    keys[key] = value;
    idx = valueEnd;
  }
  const errorCode =
    command === 0x7f && Object.keys(keys).length
      ? Number(Object.keys(keys)[0])
      : undefined;
  return { command, seqId, blocks, keys, errorCode };
}

export function u8(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff]);
}

export function u16le(value: number): Uint8Array {
  const v = Math.max(0, Math.floor(value));
  return Uint8Array.from([v & 0xff, (v >>> 8) & 0xff]);
}

export function u24le(value: number): Uint8Array {
  const v = Math.max(0, Math.floor(value));
  return Uint8Array.from([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff]);
}

export function u32le(value: number): Uint8Array {
  const v = Math.max(0, Math.floor(value));
  return Uint8Array.from([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}

export function s8(value: number): Uint8Array {
  const v = (value << 24) >> 24; // clamp to int8
  return Uint8Array.from([v & 0xff]);
}

export function asciiBytes(str: string): Uint8Array {
  return Uint8Array.from(Buffer.from(str, 'ascii'));
}
