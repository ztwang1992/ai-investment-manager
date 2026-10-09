import { describe, expect, it } from 'vitest';
import { calibrationDiff, calibrationDue } from './calibration';
import type { Holding } from './ledger';
import type { Exposure, FxRates, Instrument, Market, Transaction, TxType } from './types';
import { totalValue, valueHoldings } from './valuation';

const exposures: Record<string, Exposure> = {
  eq: { id: 'eq', name: 'eq', groupId: 'us', isStock: false },
  cny: { id: 'cny', name: '人民币现金', groupId: 'cash', isStock: false },
};
const inst = (code: string, market: Market, paysDividend: boolean, exposureId = 'eq'): Instrument => ({
  code,
  name: code,
  market,
  currency: 'CNY',
  exposureId,
  paysDividend,
});
const instruments = Object.fromEntries(
  [
    inst('VOO', '美股', true),
    inst('BRK', '美股', false),
    inst('SMALL', 'A股', false),
    inst('THREE', 'A股', false),
    inst('ETF', 'A股', true),
    inst('CNY', '现金', false, 'cny'),
  ].map((i) => [i.code, i]),
);
const fx: FxRates = { CNY: 1, USD: 7, HKD: 1 };
const holdings: Holding[] = [
  { accountId: 'futu', code: 'VOO', qty: 47, cost: 47 }, // 47%, dividends reinvested
  { accountId: 'ft', code: 'BRK', qty: 38, cost: 38 }, // 38%, large
  { accountId: 'cms', code: 'SMALL', qty: 2, cost: 2 }, // 2%, no reminder
  { accountId: 'cms', code: 'THREE', qty: 3, cost: 3 }, // exactly 3%, counts as large
  { accountId: 'cms', code: 'ETF', qty: 1, cost: 1 }, // 1%, but dividends reinvested
  { accountId: 'cmb', code: 'CNY', qty: 9, cost: 9 }, // cash, no reminder
];
const prices = { VOO: 1, BRK: 1, SMALL: 1, THREE: 1, ETF: 1 };
const rows = valueHoldings({ holdings, instruments, exposures, prices, fx });
const totalCny = totalValue(rows);

const t = (type: TxType, accountId: string, code: string, date: string, reason?: string): Transaction => ({
  id: `${accountId}-${code}-${date}`,
  date,
  createdAt: `${date}T00:00:00.000Z`,
  type,
  accountId,
  instrumentCode: code,
  qty: 1,
  price: 0,
  fee: 0,
  fxToCny: 1,
  ...(reason ? { reason } : {}),
});
const transactions = [
  t('calibrate', 'futu', 'VOO', '2026-06-20', '红利再投'), // last quarter
  t('calibrate', 'ft', 'BRK', '2026-07-15', '已核对'), // this quarter
];

describe('calibrationDue', () => {
  const base = { rows, totalCny, today: '2026-09-29', period: 'quarter' as const };

  it('lists large or dividend-reinvesting holdings not checked this period, largest first', () => {
    const due = calibrationDue({ ...base, transactions });
    expect(due.map((d) => [d.code, d.lastCalibratedOn, d.big, d.paysDividend])).toEqual([
      ['VOO', '2026-06-20', true, true],
      ['THREE', null, true, false],
      ['ETF', null, false, true],
    ]);
  });

  it('uses calendar periods: a July check no longer counts under a monthly period', () => {
    const due = calibrationDue({ ...base, period: 'month', transactions });
    expect(due.map((d) => d.code)).toContain('BRK');
  });

  it('treats the opening entry as checked for its period', () => {
    const opened = [t('opening', 'ft', 'BRK', '2026-09-01'), t('opening', 'cms', 'THREE', '2026-09-01')];
    const due = calibrationDue({ ...base, transactions: opened });
    expect(due.map((d) => d.code)).toEqual(['VOO', 'ETF']);
  });

  it('can lower the large-holding threshold', () => {
    const due = calibrationDue({ ...base, transactions, bigPct: 1 });
    expect(due.map((d) => d.code)).toContain('SMALL');
  });

  it('returns nothing for an empty portfolio', () => {
    expect(calibrationDue({ ...base, rows: [], totalCny: 0, transactions: [] })).toEqual([]);
  });
});

describe('calibrationDiff', () => {
  const row = { qty: 100, valueCny: 7000 };

  it('compares the entered shares with the recorded ones and values the gap at the current price', () => {
    expect(calibrationDiff({ recordedQty: 100, enteredQty: 105, row })).toEqual({ qty: 5, valueCny: 350, changed: true });
    expect(calibrationDiff({ recordedQty: 100, enteredQty: 98, row })).toEqual({ qty: -2, valueCny: -140, changed: true });
  });

  it('shows no difference when the shares match or the input is not a number', () => {
    expect(calibrationDiff({ recordedQty: 100, enteredQty: 100, row })).toEqual({ qty: 0, valueCny: 0, changed: false });
    expect(calibrationDiff({ recordedQty: 100, enteredQty: Number.NaN, row })).toEqual({ qty: 0, valueCny: 0, changed: false });
  });

  it('cannot value the gap for a position that has no shares left', () => {
    expect(calibrationDiff({ recordedQty: 0, enteredQty: 10, row: undefined })).toEqual({ qty: 10, valueCny: 0, changed: true });
  });
});
