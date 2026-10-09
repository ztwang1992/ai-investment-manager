// Data sources give the exchange's local time: New York time for US stocks (with daylight saving), Beijing time for A-shares and funds (UTC+8, no daylight saving).

const LOCAL = /^(\d{4})-?(\d{2})-?(\d{2})[ T]?(\d{2}):?(\d{2}):?(\d{2})$/;
const HOUR_MS = 3_600_000;

/** 'YYYY-MM-DD HH:MM:SS' or 'YYYYMMDDHHMMSS', read as a wall-clock time in UTC (ms); null when it isn't a valid time */
function wallClock(text: string): number | null {
  const m = LOCAL.exec(text.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  if (h > 23 || mi > 59 || s > 59) return null;
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(t);
  return back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}

const NEW_YORK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  weekday: 'short',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** New York's wall-clock time at the moment `at` (as UTC milliseconds) and the weekday (0 is Sunday) */
export function newYorkClock(at: number): { wall: number; weekday: number } {
  const p = Object.fromEntries(NEW_YORK.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return { wall, weekday: WEEKDAYS.indexOf(p.weekday ?? '') };
}

/** Beijing's wall-clock time and weekday at the moment `at` */
export function beijingClock(at: number): { wall: number; weekday: number } {
  const wall = at + 8 * HOUR_MS;
  return { wall, weekday: new Date(wall).getUTCDay() };
}

/** New York wall-clock time (as UTC milliseconds) -> UTC milliseconds. Guesses the offset by treating the wall-clock time as UTC, then corrects with the offset at the guessed moment, so it's right around daylight saving changes too. */
export function newYorkToUtc(wall: number): number {
  const offset = (at: number) => newYorkClock(at).wall - Math.floor(at / 1000) * 1000;
  const guess = wall - offset(wall);
  return wall - offset(guess);
}

/** New York time -> UTC (ISO) */
export function easternToUtc(text: string): string | null {
  const wall = wallClock(text);
  return wall === null ? null : new Date(newYorkToUtc(wall)).toISOString();
}

/** Beijing time -> UTC (ISO) */
export function beijingToUtc(text: string): string | null {
  const wall = wallClock(text);
  return wall === null ? null : new Date(wall - 8 * HOUR_MS).toISOString();
}
