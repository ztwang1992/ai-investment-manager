import { describe, expect, it } from 'vitest';
import * as mock from '../mock';
import { filterRecords, groupByMonth, inRecordTime } from './records';
import type { RecordKind, RecordSort, RecordTime } from './records';
import type { Transaction, TxType } from './types';

const tx = (id: string, date: string, type: TxType = 'buy', createdAt = `${date}T01:00:00.000Z`): Transaction => ({
  id,
  date,
  createdAt,
  type,
  accountId: 'a',
  instrumentCode: 'VOO',
  qty: 1,
  price: 1,
  fee: 0,
  fxToCny: 1,
});

describe('inRecordTime', () => {
  it('the last 7 and 30 days count today and the days before it', () => {
    expect(inRecordTime('2026-09-29', '7d', '2026-09-29')).toBe(true);
    expect(inRecordTime('2026-09-23', '7d', '2026-09-29')).toBe(true);
    expect(inRecordTime('2026-09-22', '7d', '2026-09-29')).toBe(false);
    expect(inRecordTime('2026-08-31', '30d', '2026-09-29')).toBe(true);
    expect(inRecordTime('2026-08-30', '30d', '2026-09-29')).toBe(false);
  });

  it('last month is the previous calendar month, also across a year end', () => {
    expect(inRecordTime('2026-08-01', 'lastMonth', '2026-09-29')).toBe(true);
    expect(inRecordTime('2026-09-01', 'lastMonth', '2026-09-29')).toBe(false);
    expect(inRecordTime('2026-12-31', 'lastMonth', '2027-01-15')).toBe(true);
    expect(inRecordTime('2027-12-01', 'lastMonth', '2027-01-15')).toBe(false);
  });

  it('this year and last year go by calendar year', () => {
    expect(inRecordTime('2026-01-01', 'thisYear', '2026-09-29')).toBe(true);
    expect(inRecordTime('2025-12-31', 'thisYear', '2026-09-29')).toBe(false);
    expect(inRecordTime('2025-12-31', 'lastYear', '2026-09-29')).toBe(true);
    expect(inRecordTime('2024-12-31', 'lastYear', '2026-09-29')).toBe(false);
  });
});

describe('filterRecords', () => {
  const base: { time: RecordTime; kind: RecordKind; sort: RecordSort; today: string } = {
    time: 'all',
    kind: 'all',
    sort: 'desc',
    today: '2026-09-29',
  };

  it('counts the sample ledger by time and type', () => {
    const count = (f: Partial<typeof base>) => filterRecords(mock.transactions, { ...base, ...f }).length;
    expect(count({})).toBe(36);
    expect(count({ time: '7d' })).toBe(0);
    expect(count({ time: '30d' })).toBe(3);
    expect(count({ time: 'lastMonth' })).toBe(3);
    expect(count({ time: 'thisYear' })).toBe(12);
    expect(count({ time: 'lastYear' })).toBe(24);
    expect(count({ kind: 'calibrate' })).toBe(1);
  });

  it('shows opening records only under All', () => {
    const txns = [tx('o', '2026-01-02', 'opening'), tx('b', '2026-02-01', 'buy')];
    expect(filterRecords(txns, base).map((t) => t.id)).toEqual(['b', 'o']);
    expect(filterRecords(txns, { ...base, kind: 'buy' }).map((t) => t.id)).toEqual(['b']);
  });

  it('sorts by date and creation time, newest or oldest first', () => {
    // On the same day: the automatic deposit is created first, the buy after it
    const txns = [
      tx('buy', '2026-09-18', 'buy', '2026-09-18T01:00:00.002Z'),
      tx('dep', '2026-09-18', 'deposit', '2026-09-18T01:00:00.001Z'),
      tx('old', '2026-09-02'),
    ];
    expect(filterRecords(txns, base).map((t) => t.id)).toEqual(['buy', 'dep', 'old']);
    expect(filterRecords(txns, { ...base, sort: 'asc' }).map((t) => t.id)).toEqual(['old', 'dep', 'buy']);
  });
});

describe('groupByMonth', () => {
  it('groups neighbouring records of the same month, keeping their order', () => {
    const groups = groupByMonth([tx('a', '2026-09-18'), tx('b', '2026-09-02'), tx('c', '2026-08-15')]);
    expect(groups.map((g) => [g.month, g.items.map((t) => t.id)])).toEqual([
      ['2026-09', ['a', 'b']],
      ['2026-08', ['c']],
    ]);
  });

  it('returns nothing for no records', () => {
    expect(groupByMonth([])).toEqual([]);
  });
});
