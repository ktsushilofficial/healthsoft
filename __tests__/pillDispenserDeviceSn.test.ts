import { parsePillDispenserCode } from '../src/pillDispenser/deviceSn';

describe('parsePillDispenserCode', () => {
  it('accepts the DN printed on the dispenser label', () => {
    expect(parsePillDispenserCode('39-00002442e347aa5e')).toEqual({
      deviceSn: '39-00002442e347aa5e',
      model: null,
    });
  });

  it('extracts DN and model from the Zoomcare QR payload', () => {
    expect(
      parsePillDispenserCode(
        'http://dl-en.zoomcare.tech/dl/zayacare/?model=M126&dn=39-00002442e347aa5e',
      ),
    ).toEqual({
      deviceSn: '39-00002442e347aa5e',
      model: 'M126',
    });
  });

  it('accepts a DN label prefix', () => {
    expect(parsePillDispenserCode('DN: 39-00002442e347aa5e').deviceSn).toBe(
      '39-00002442e347aa5e',
    );
  });

  it('rejects malformed input', () => {
    expect(() => parsePillDispenserCode('not a valid code')).toThrow(
      'Enter the DN code',
    );
  });
});
