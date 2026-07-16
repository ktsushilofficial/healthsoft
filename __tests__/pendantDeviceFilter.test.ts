import {
  isKnownPendantName,
  isPendantScanDevice,
} from '../src/bluetooth/pendantDeviceFilter';

describe('pendantDeviceFilter', () => {
  test.each(['EV07B', 'EV-07B', 'EV_07B_1234', 'Eview EV-07B']) (
    'accepts supported pendant name %s',
    name => {
      expect(isKnownPendantName(name)).toBe(true);
      expect(isPendantScanDevice({ id: '1', name })).toBe(true);
    },
  );

  test.each(['AirPods', 'Apple Watch', 'Samsung TV', 'JStyle V8', 'Unknown device']) (
    'rejects unrelated Bluetooth device %s',
    name => {
      expect(isPendantScanDevice({ id: '1', name })).toBe(false);
    },
  );

  test('accepts a renamed pendant only when it exactly matches an assigned-device hint', () => {
    const device = { id: '1', name: 'Mum Emergency Button' };

    expect(isPendantScanDevice(device)).toBe(false);
    expect(isPendantScanDevice(device, ['Mum Emergency Button'])).toBe(true);
  });

  test('rejects non-connectable advertisements even when the name looks supported', () => {
    expect(isPendantScanDevice({ id: '1', name: 'EV07B', isConnectable: false })).toBe(false);
  });
});

