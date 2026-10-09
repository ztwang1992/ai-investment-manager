import type { Period } from './types';

// Dates are always 'YYYY-MM-DD' strings, computed on the calendar, independent of time zones.

const MONTHS_IN: Record<Period, number> = { month: 1, quarter: 3, year: 12 };
const DAY_MS = 86_400_000;

function parse(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y!, m!, d!];
}

function format(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The first day of the calendar month / quarter / year containing the date. */
export function periodStart(date: string, period: Period): string {
  const [y, m] = parse(date);
  const len = MONTHS_IN[period];
  return format(y, Math.floor((m - 1) / len) * len + 1, 1);
}

/** The first day of the next calendar month / quarter / year. */
export function nextPeriodStart(date: string, period: Period): string {
  const [y, m] = parse(periodStart(date, period));
  const monthIndex = m - 1 + MONTHS_IN[period];
  return format(y + Math.floor(monthIndex / 12), (monthIndex % 12) + 1, 1);
}

/** Counts days forward (backward when negative). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = parse(date);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY_MS);
  return format(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The number of days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = parse(from);
  const [y2, m2, d2] = parse(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

const BEIJING_OFFSET_MS = 8 * 3_600_000;

/** The date in Beijing time (UTC+8, no daylight saving). The app's "today" and transactions' recording dates follow Beijing time. */
export function beijingDate(now: Date): string {
  return new Date(now.getTime() + BEIJING_OFFSET_MS).toISOString().slice(0, 10);
}
