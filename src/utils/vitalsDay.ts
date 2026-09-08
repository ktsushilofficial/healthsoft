// Which calendar day a vitals row belongs to.
//
// There is one day concept, and it is the senior's own: the band timestamps
// every sample against the wall clock on the wearer's wrist, so that is the
// only bucket its data can honestly go into. A row read on the band's 8th of
// September is stored, synced and displayed as the 8th of September.
//
// The date is a key, not an instant. It travels to the backend as the string
// the band's clock produced and comes back the same way, matched verbatim -
// nothing on either side converts it to a timezone or compares it to a server
// clock. That is what keeps all three clocks (band, phone, server) from
// disagreeing about which day a reading belongs to.

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Day key for `date` in the senior's timezone - the day the band recorded. */
export function toLocalDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

/** Today in the senior's timezone - the day the band is filling in now. */
export function todayLocalDayKey(): string {
  return toLocalDayKey(new Date());
}

/**
 * Start of the day `ymd` names, as an instant. Comparisons between values from
 * this function and from `startOfVitalsDay(new Date())` stay on one timeline.
 */
export function vitalsDayStart(ymd: string): Date | null {
  const match = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Start of the day that `date` falls in, on the same timeline. */
export function startOfVitalsDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * `date` shifted by whole days, staying on day boundaries. Steps the calendar
 * rather than adding 24h, so a DST change cannot land it mid-day.
 */
export function addVitalsDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
  );
}
