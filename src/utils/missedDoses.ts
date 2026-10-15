// Shaping the guardian missed-doses feed for display.
//
// The dispenser's `date` and `alarmTime` are its own wall-clock values, so they
// are shown as-is and grouped by that day key - never re-derived from
// `reportedAt`, which is only used for ordering and the "reported" time.

import type { MissedDoseDrug, MissedDoseEvent } from '../types/missedDoses';
import { addVitalsDays, toLocalDayKey, vitalsDayStart } from './vitalsDay';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface MissedDoseDayGroup {
  dayKey: string;
  label: string;
  doses: MissedDoseEvent[];
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function parseDrug(raw: unknown): MissedDoseDrug | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const drugName = asText(row.drugName);
  if (!drugName) return null;
  return { drugName, drugAmount: asText(row.drugAmount) };
}

/** Drops malformed rows and sorts newest alarm first. */
export function parseMissedDoses(raw: unknown): MissedDoseEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: MissedDoseEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const date = asText(row.date);
    if (!DAY_KEY.test(date)) continue;
    const reportedAt = Number(row.reportedAt);
    events.push({
      date,
      alarmTime: asText(row.alarmTime),
      deviceSn: asText(row.deviceSn),
      drugs: Array.isArray(row.drugs)
        ? row.drugs.map(parseDrug).filter((d): d is MissedDoseDrug => d !== null)
        : [],
      reportedAt: Number.isFinite(reportedAt) ? reportedAt : 0,
    });
  }
  return events.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      b.alarmTime.localeCompare(a.alarmTime) ||
      b.reportedAt - a.reportedAt,
  );
}

/** `'12:54'` -> `'12:54 PM'`; unparseable values pass through. */
export function formatAlarmTime(alarmTime: string): string {
  const match = alarmTime.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return alarmTime;
  const hours = Number(match[1]);
  if (hours > 23) return alarmTime;
  const suffix = hours < 12 ? 'AM' : 'PM';
  return `${hours % 12 || 12}:${match[2]} ${suffix}`;
}

/** `'Today'`, `'Yesterday'`, or e.g. `'Mon, 12 Oct 2026'`. */
export function missedDoseDayLabel(dayKey: string, now: Date = new Date()): string {
  if (dayKey === toLocalDayKey(now)) return 'Today';
  if (dayKey === toLocalDayKey(addVitalsDays(now, -1))) return 'Yesterday';
  const day = vitalsDayStart(dayKey);
  if (!day) return dayKey;
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.getDay()];
  return `${weekday}, ${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
}

/** Groups already-sorted events by the dispenser's day, preserving order. */
export function groupMissedDosesByDay(
  events: MissedDoseEvent[],
  now: Date = new Date(),
): MissedDoseDayGroup[] {
  const groups: MissedDoseDayGroup[] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last && last.dayKey === event.date) {
      last.doses.push(event);
    } else {
      groups.push({
        dayKey: event.date,
        label: missedDoseDayLabel(event.date, now),
        doses: [event],
      });
    }
  }
  return groups;
}

export function countMissedDosesOnDay(events: MissedDoseEvent[], dayKey: string): number {
  return events.filter(event => event.date === dayKey).length;
}

/** `'Dolo × 1'`; amount omitted when the dispenser didn't send one. */
export function formatMissedDoseDrug(drug: MissedDoseDrug): string {
  return drug.drugAmount ? `${drug.drugName} × ${drug.drugAmount}` : drug.drugName;
}
