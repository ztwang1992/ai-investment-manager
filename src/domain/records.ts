import { daysBetween } from './dates';
import { sortTransactions } from './ledger';
import type { Transaction, TxType } from './types';

// The Records page: filters transactions by time and type, sorts them, then groups them by month. Dates compare by recording date (YYYY-MM-DD).

/** The time filter on Records; the labels are in the messages */
export type RecordTime = 'all' | '7d' | '30d' | 'lastMonth' | 'thisYear' | 'lastYear';
export const RECORD_TIMES: readonly RecordTime[] = ['all', '7d', '30d', 'lastMonth', 'thisYear', 'lastYear'];
/** Openings have no filter of their own; they appear only under All. */
export type RecordKind = 'all' | Exclude<TxType, 'opening'>;
export type RecordSort = 'desc' | 'asc';

/** "Last N days" is N days, today included. */
const withinDays = (date: string, today: string, days: number) => {
  const ago = daysBetween(date, today);
  return ago >= 0 && ago < days;
};

/** "Last month" is the calendar month before the current one. */
export function inRecordTime(date: string, time: RecordTime, today: string): boolean {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (time) {
    case 'all':
      return true;
    case '7d':
      return withinDays(date, today, 7);
    case '30d':
      return withinDays(date, today, 30);
    case 'lastMonth': {
      const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
      return date.slice(0, 7) === prev;
    }
    case 'thisYear':
      return date.slice(0, 4) === String(year);
    case 'lastYear':
      return date.slice(0, 4) === String(year - 1);
  }
}

export function filterRecords(
  txns: readonly Transaction[],
  f: { time: RecordTime; kind: RecordKind; sort: RecordSort; today: string },
): Transaction[] {
  const kept = sortTransactions(txns).filter(
    (t) => inRecordTime(t.date, f.time, f.today) && (f.kind === 'all' || t.type === f.kind),
  );
  return f.sort === 'desc' ? kept.reverse() : kept;
}

export interface MonthGroup {
  /** YYYY-MM */
  month: string;
  items: Transaction[];
}

/** Adjacent transactions of the same month form a group, in the order given. */
export function groupByMonth(txns: readonly Transaction[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const t of txns) {
    const month = t.date.slice(0, 7);
    const last = groups.at(-1);
    if (last?.month === month) last.items.push(t);
    else groups.push({ month, items: [t] });
  }
  return groups;
}
