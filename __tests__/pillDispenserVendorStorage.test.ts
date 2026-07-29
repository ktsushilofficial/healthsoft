import * as Keychain from 'react-native-keychain';
import {
  clearPillDispenserBinding,
  loadPillDispenserRecord,
  savePillDispenserRecord,
} from '../src/pillDispenser/vendorStorage';
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
});
