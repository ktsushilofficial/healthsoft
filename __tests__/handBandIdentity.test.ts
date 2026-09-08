import { resolveHandBandIdentity } from '../src/utils/deviceAssignments';

const own = 'C414D50E09F6';
const other = 'C414D5AABBCC';
const iosId = '74DE814A-39EF-4CB4-8F12-B43EB7C987FE';

describe('hand band ownership across phones', () => {
  it('matches each Android band to its full MAC independently of its name', () => {
    expect(
      resolveHandBandIdentity({ id: 'C4:14:D5:0E:09:F6', name: 'Band' }, [own]),
    ).toBe(own);
    expect(
      resolveHandBandIdentity({ id: 'C4:14:D5:AA:BB:CC', name: 'Band' }, [own]),
    ).toBe(other);
  });

  it('uses the current iOS advertised name instead of a stale cached name', () => {
    const band = { id: iosId, name: 'JCV8 AABBCC', localName: 'JCV8 0E09F6' };
    expect(resolveHandBandIdentity(band, [own])).toBe(own);
    expect(resolveHandBandIdentity(band, [other])).toBeNull();
  });

  it('does not treat a generic product name or another person’s suffix as ownership', () => {
    expect(
      resolveHandBandIdentity({ id: iosId, name: 'JCV8' }, [own]),
    ).toBeNull();
    expect(
      resolveHandBandIdentity({ id: iosId, name: 'JCV8 AABBCC' }, [own]),
    ).toBeNull();
    expect(
      resolveHandBandIdentity({ id: iosId, name: 'JCV8 0E09F6' }, []),
    ).toBeNull();
  });

  it('refuses ambiguous suffixes and substring matches', () => {
    expect(
      resolveHandBandIdentity({ id: iosId, name: 'JCV8 0E09F6' }, [
        own,
        'AABBCC0E09F6',
      ]),
    ).toBeNull();
    expect(
      resolveHandBandIdentity({ id: iosId, name: 'JCV8 0E09F600' }, [own]),
    ).toBeNull();
    expect(
      resolveHandBandIdentity({ id: iosId, name: 'JCV8 AA:BB:CC:0E:09:F6' }, [
        own,
      ]),
    ).toBeNull();
  });

  it('a reported different MAC overrides an apparently matching advertised name', () => {
    expect(
      resolveHandBandIdentity({ id: iosId, name: 'JCV8 0E09F6' }, [own], other),
    ).toBe(other);
  });
});
