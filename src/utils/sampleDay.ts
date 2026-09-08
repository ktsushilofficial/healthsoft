import { Platform } from 'react-native';
import { toLocalDayKey } from './vitalsDay';

/** The parts of a band sample needed to date it. */
export type DatableSample = {
  timestamp: string | null;
  receivedAt: number | null;
};

/**
 * The day a band sample belongs to, in the senior's own timezone.
 *
 * The band stamps its samples against the wall clock on the wearer's wrist, so
 * every branch here resolves to the local day - a sample taken at 02:00 on the
 * 8th is the 8th, never the 7th. This lived in two copies before and they
 * drifted apart; one bucket for the band means one function.
 */
export function sampleDayKey(sample: DatableSample): string | null {
  const raw = sample.timestamp?.trim();
  if (raw) {
    if (/^\d{10,13}$/.test(raw)) {
      const epoch = raw.length === 13 ? Number(raw) : Number(raw) * 1000;
      if (Number.isFinite(epoch)) return toLocalDayKey(new Date(epoch));
    }
    const normalized = raw.replace(/\//g, '-').replace(/\./g, '-');
    // A date the band already spelled out is taken as written - it is already
    // the band's own day, and re-parsing it would only invite a zone shift.
    const direct = normalized.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (direct) {
      const y = direct[1];
      const m = direct[2].padStart(2, '0');
      const d = direct[3].padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return toLocalDayKey(parsed);
    if (Platform.OS === 'ios' && sample.receivedAt != null) {
      return toLocalDayKey(new Date(sample.receivedAt));
    }
    return null;
  }
  if (sample.receivedAt != null) return toLocalDayKey(new Date(sample.receivedAt));
  return null;
}
