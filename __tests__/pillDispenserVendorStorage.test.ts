import * as Keychain from 'react-native-keychain';
import {
  clearPillDispenserBinding,
  loadPillDispenserRecord,
  savePillDispenserRecord,
} from '../src/pillDispenser/vendorStorage';
import {
  PILL_DISPENSER_VENDOR_CONFIG,
  PILL_DISPENSER_VENDOR_HOSTS,
} from '../src/pillDispenser/vendorConfig';
import type { PillDispenserLocalRecord } from '../src/pillDispenser/vendorTypes';

const getGenericPassword = Keychain.getGenericPassword as jest.Mock;
const setGenericPassword = Keychain.setGenericPassword as jest.Mock;

describe('pill dispenser vendor storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getGenericPassword.mockResolvedValue(false);
  });

  it('stores a binding without replacing another senior binding', async () => {
    const existing: PillDispenserLocalRecord = {
      ownerKey: 'senior-1',
      vendorHost: PILL_DISPENSER_VENDOR_CONFIG.host,
      vendorUserId: '100',
      deviceSn: '39-existing',
      model: 'M126',
      updatedAt: 1,
    };
    getGenericPassword.mockResolvedValue({
      username: 'pill-dispenser-records',
      password: JSON.stringify([existing]),
      service: '',
      storage: '',
    });

    await savePillDispenserRecord({
      ownerKey: 'senior-2',
      vendorHost: PILL_DISPENSER_VENDOR_CONFIG.host,
      vendorUserId: '200',
      deviceSn: '39-new',
      model: null,
      updatedAt: 2,
    });

    const saved = JSON.parse(setGenericPassword.mock.calls[0][1]);
    expect(saved).toHaveLength(2);
    expect(
      saved.map((record: PillDispenserLocalRecord) => record.ownerKey),
    ).toEqual(['senior-1', 'senior-2']);
  });

  it('keeps the vendor user mapping when a device is unbound', async () => {
    const existing: PillDispenserLocalRecord = {
      ownerKey: 'senior-1',
      vendorHost: PILL_DISPENSER_VENDOR_CONFIG.host,
      vendorUserId: '100',
      deviceSn: '39-existing',
      model: 'M126',
      updatedAt: 1,
    };
    getGenericPassword.mockResolvedValue({
      username: 'pill-dispenser-records',
      password: JSON.stringify([existing]),
      service: '',
      storage: '',
    });

    const updated = await clearPillDispenserBinding('senior-1');

    expect(updated).toMatchObject({
      ownerKey: 'senior-1',
      vendorUserId: '100',
      deviceSn: null,
      model: null,
    });
  });

  it('returns null when no binding exists for the senior', async () => {
    await expect(loadPillDispenserRecord('missing')).resolves.toBeNull();
  });

  it('does not load a legacy production binding in the test environment', async () => {
    getGenericPassword.mockResolvedValue({
      username: 'pill-dispenser-records',
      password: JSON.stringify([
        {
          ownerKey: 'senior-1',
          vendorUserId: 'production-user',
          deviceSn: '39-production',
          model: 'M126',
          updatedAt: 1,
        },
      ]),
      service: '',
      storage: '',
    });

    await expect(
      loadPillDispenserRecord(
        'senior-1',
        PILL_DISPENSER_VENDOR_HOSTS.testing,
      ),
    ).resolves.toBeNull();
  });

  it('preserves a production record when saving a test record for the same senior', async () => {
    const productionRecord: PillDispenserLocalRecord = {
      ownerKey: 'senior-1',
      vendorHost: PILL_DISPENSER_VENDOR_HOSTS.production,
      vendorUserId: 'production-user',
      deviceSn: '39-production',
      model: 'M126',
      updatedAt: 1,
    };
    getGenericPassword.mockResolvedValue({
      username: 'pill-dispenser-records',
      password: JSON.stringify([productionRecord]),
      service: '',
      storage: '',
    });

    await savePillDispenserRecord({
      ownerKey: 'senior-1',
      vendorHost: PILL_DISPENSER_VENDOR_HOSTS.testing,
      vendorUserId: 'test-user',
      deviceSn: '39-test',
      model: 'M126',
      updatedAt: 2,
    });

    const saved = JSON.parse(setGenericPassword.mock.calls[0][1]);
    expect(saved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          vendorHost: PILL_DISPENSER_VENDOR_HOSTS.production,
          vendorUserId: 'production-user',
        }),
        expect.objectContaining({
          vendorHost: PILL_DISPENSER_VENDOR_HOSTS.testing,
          vendorUserId: 'test-user',
        }),
      ]),
    );
  });
});
