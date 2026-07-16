import { buildConfigFrame, parseEv07bFrame } from '../src/bluetooth/ev07bProtocol';
import { encodeEv07bAuthorizedPhone } from '../src/bluetooth/ev07bConfigCodec';

describe('ev07bProtocol', () => {
  test('encodes requested keys inside one F0 read block', () => {
    const frame = buildConfigFrame({
      seqId: 0x0101,
      readKeys: [0x51, 0x53, 0x55, 0x56],
    });

    const parsed = parseEv07bFrame(frame);

    expect(parsed?.command).toBe(0x02);
    expect(parsed?.blocks).toHaveLength(1);
    expect(parsed?.blocks[0].key).toBe(0xf0);
    expect(Array.from(parsed?.blocks[0].value ?? [])).toEqual([0x51, 0x53, 0x55, 0x56]);
  });

  test('preserves repeated key blocks in parsed frames', () => {
    const frame = buildConfigFrame({
      seqId: 0x1234,
      writeBlocks: [
        {
          key: 0x30,
          value: encodeEv07bAuthorizedPhone({
            slot: 0,
            enabled: true,
            acceptSms: true,
            noSimDialing: true,
            acceptPhoneCall: false,
            number: '+1111111111',
          }),
        },
        {
          key: 0x30,
          value: encodeEv07bAuthorizedPhone({
            slot: 1,
            enabled: true,
            acceptSms: true,
            noSimDialing: true,
            acceptPhoneCall: false,
            number: '+2222222222',
          }),
        },
      ],
    });

    const parsed = parseEv07bFrame(frame);

    expect(parsed?.seqId).toBe(0x1234);
    expect(parsed?.blocks).toHaveLength(2);
    expect(parsed?.blocks[0].key).toBe(0x30);
    expect(parsed?.blocks[1].key).toBe(0x30);
    expect(parsed?.keys[0x30]).toEqual(parsed?.blocks[1].value);
  });
});
