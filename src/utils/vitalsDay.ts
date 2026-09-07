// Which calendar day a vitals row belongs to.
//
// This is UTC, deliberately, and it is a workaround rather than the right
// answer. POST /api/v1/vitals/sync requires syncTo to equal the server's
// current UTC date, and separately rejects any row whose recordDate falls
// outside syncFrom..syncTo:
//
//   "Each DailyVitalSummary.recordDate must be between syncFrom and syncTo"
//
// So the app cannot write a row dated by the senior's local day while the
// server is still on the previous UTC day, and GET /vitals/summary anchors its
// `days=N` window to the same UTC date when reading back. Keying the UI on the
// local day therefore looks up rows that cannot exist, which is what rendered
// NA across the home and activity screens between 00:00 and 05:30 IST.
//
// The cost of matching the server: the day boundary lands at 05:30 IST rather
// than midnight, so a step count appears to reset mid-morning and activity
// before 05:30 is attributed to the previous day. Once the backend accepts a
// client-supplied window (or a timezone), this file should key on the senior's
// local day instead and the boundary moves back to their midnight.

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Day key for `date`, matching the day the backend files a row under. */
export function vitalsDayKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
    date.getUTCDate(),
  )}`;
}

/** The day the backend currently considers "today". */
export function todayVitalsDayKey(): string {
  return vitalsDayKey(new Date());
}

/**
 * Start of the day `ymd` names, as an instant. Comparisons between values from
 * this function and from `startOfVitalsDay(new Date())` stay on one timeline.
 */
export function vitalsDayStart(ymd: string): Date | null {
  const match = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Start of the day that `date` falls in, on the same timeline. */
export function startOfVitalsDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** `date` shifted by whole days, staying on day boundaries. */
export function addVitalsDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
