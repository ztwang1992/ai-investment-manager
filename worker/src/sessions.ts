import { beijingClock, newYorkClock, newYorkToUtc } from './time';
import type { MarketKind } from './types';

// How long to cache: 15 minutes during trading hours, 6 hours otherwise, but never past the start of the next session.
// Holidays are ignored: they count as trading days, which only means a few more lookups.

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;
const IN_SESSION_MS = 15 * MIN_MS;
const OFF_SESSION_MS = 6 * HOUR_MS;

export type CacheKind = MarketKind | 'fx';

/** Trading hours (local time, in minutes). Half an hour extra after the close, for the closing price. */
const HOURS: Record<MarketKind, [open: number, close: number]> = {
  us: [9 * 60 + 30, 16 * 60 + 30],
  cn: [9 * 60 + 30, 15 * 60 + 30],
  fund: [9 * 60 + 30, 15 * 60 + 30],
};

/** US stocks on New York time (with daylight saving), A-shares and funds on Beijing time, Monday to Friday; rates all day Monday to Friday (UTC) */
export function inSession(kind: CacheKind, at: number): boolean {
  if (kind === 'fx') {
    const day = new Date(at).getUTCDay();
    return day >= 1 && day <= 5;
  }
  const { wall, weekday } = kind === 'us' ? newYorkClock(at) : beijingClock(at);
  if (weekday < 1 || weekday > 5) return false;
  const minutes = Math.floor((wall % DAY_MS) / MIN_MS);
  const [open, close] = HOURS[kind];
  return minutes >= open && minutes < close;
}

const isWeekday = (day: number) => day >= 1 && day <= 5;

/**
 * Outside trading hours, the moment (ms) of the next open. Computed directly rather than stepping forward:
 * the Worker free plan gets about 10 ms of CPU per request, and each New York time conversion costs a few microseconds.
 */
function nextOpen(kind: CacheKind, at: number): number {
  if (kind === 'fx') {
    const d = new Date(at);
    const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return midnight + (d.getUTCDay() === 6 ? 2 : 1) * DAY_MS;
  }
  const { wall, weekday } = kind === 'us' ? newYorkClock(at) : beijingClock(at);
  const dayStart = wall - (wall % DAY_MS);
  const open = HOURS[kind][0] * MIN_MS;
  let days = 0;
  let day = weekday;
  // A business day before the open: today; otherwise the first business day after
  if (!(isWeekday(day) && wall < dayStart + open)) {
    do {
      days += 1;
      day = (day + 1) % 7;
    } while (!isWeekday(day));
  }
  const openWall = dayStart + days * DAY_MS + open;
  return kind === 'us' ? newYorkToUtc(openWall) : openWall - 8 * HOUR_MS;
}

/** Until when (ms) data fetched at fetchedAt still counts as fresh */
export function freshUntil(kind: CacheKind, fetchedAt: number): number {
  if (inSession(kind, fetchedAt)) return fetchedAt + IN_SESSION_MS;
  return Math.min(fetchedAt + OFF_SESSION_MS, nextOpen(kind, fetchedAt));
}
