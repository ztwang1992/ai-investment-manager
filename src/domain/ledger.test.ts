import { describe, expect, it } from 'vitest';
import {
  cashBalance,
  currencyLookup,
  deriveLedger,
  holdingQty,
  netInvestedOn,
  principalEvents,
  sortTransactions,
} from './ledger';
import type { Instrument, Transaction, TxType } from './types';

const instruments: Record<string, Instrument> = {
  VOO: { code: 'VOO', name: 'Vanguard 标普500', market: '美股', currency: 'USD', exposureId: 'sp500', paysDividend: true },
  '513500': { code: '513500', name: '标普500ETF', market: 'A股', currency: 'CNY', exposureId: 'sp500', paysDividend: true },
};
const currencyOf = currencyLookup(instruments);

let seq = 0;
function tx(
  type: TxType,
  instrumentCode: string,
  qty: number,
  extra: Partial<Transaction> = {},
): Transaction {
  seq += 1;
  const date = extra.date ?? '2026-01-01';
  return {
    id: `t${String(seq).padStart(4, '0')}`,
    date,
    createdAt: `${date}T00:00:00.${String(seq % 1000).padStart(3, '0')}Z`,
    type,
    accountId: 'futu',
    instrumentCode,
    qty,
    price: 1,
    fee: 0,
    fxToCny: 1,
    ...extra,
  };
}

const holding = (txns: Transaction[], code: string, accountId = 'futu') =>
  deriveLedger(txns, currencyOf).holdings.find((h) => h.accountId === accountId && h.code === code);

describe('deriveLedger', () => {
  const opening = [
    tx('opening', 'VOO', 10, { price: 100, fxToCny: 7 }),
    tx('opening', 'USD', 2000, { fxToCny: 7 }),
  ];

  it('counts opening holdings and cash as principal', () => {
    const ledger = deriveLedger(opening, currencyOf);
    expect(ledger.netInvestedCny).toBe(21000);
    expect(holding(opening, 'VOO')).toEqual({ accountId: 'futu', code: 'VOO', qty: 10, cost: 1000 });
    expect(cashBalance(ledger, 'futu', 'USD')).toBe(2000);
  });

  it('buy adds shares and cost, pays from same-currency cash, leaves principal alone', () => {
    const txns = [...opening, tx('buy', 'VOO', 5, { price: 110, fee: 1, fxToCny: 7 })];
    const ledger = deriveLedger(txns, currencyOf);
    expect(holding(txns, 'VOO')).toMatchObject({ qty: 15, cost: 1551 });
    expect(cashBalance(ledger, 'futu', 'USD')).toBe(1449);
    expect(ledger.netInvestedCny).toBe(21000);
  });

  it('sell reduces cost at the average cost and adds proceeds net of fee to cash', () => {
    const txns = [
      ...opening,
      tx('buy', 'VOO', 5, { price: 110, fee: 1 }),
      tx('sell', 'VOO', 5, { price: 120, fee: 2 }),
    ];
    const ledger = deriveLedger(txns, currencyOf);
    const voo = holding(txns, 'VOO')!;
    expect(voo.qty).toBe(10);
    expect(voo.cost).toBeCloseTo(1034, 9);
    expect(cashBalance(ledger, 'futu', 'USD')).toBe(2047);
  });

  it('deposit and withdraw move cash and principal at their own fx rate', () => {
    const txns = [
      ...opening,
      tx('deposit', 'USD', 500, { fxToCny: 7.1 }),
      tx('withdraw', 'USD', 300, { fxToCny: 7.1 }),
    ];
    const ledger = deriveLedger(txns, currencyOf);
    expect(ledger.netInvestedCny).toBeCloseTo(21000 + 3550 - 2130, 9);
    expect(cashBalance(ledger, 'futu', 'USD')).toBe(2200);
  });

  it('calibrate sets the actual share count, keeps total cost, and records the difference', () => {
    const calib = tx('calibrate', 'VOO', 10.5, { reason: '红利再投' });
    const ledger = deriveLedger([...opening, calib], currencyOf);
    expect(holdingQty(ledger, 'futu', 'VOO')).toBe(10.5);
    expect(holding([...opening, calib], 'VOO')!.cost).toBe(1000);
    expect(ledger.calibrationDiffs[calib.id]).toBeCloseTo(0.5, 12);
  });

  it('calibrating to zero removes the holding without dividing by zero', () => {
    const txns = [...opening, tx('calibrate', 'VOO', 0, { reason: '手动修正' })];
    const ledger = deriveLedger(txns, currencyOf);
    expect(holding(txns, 'VOO')).toBeUndefined();
    expect(ledger.anomalies).toEqual([]);
  });

  it('drops floating-point residue after selling everything', () => {
    const txns = [
      tx('opening', 'VOO', 0.1 + 0.2, { price: 100 }),
      tx('sell', 'VOO', 0.3, { price: 100 }),
    ];
    const ledger = deriveLedger(txns, currencyOf);
    expect(holding(txns, 'VOO')).toBeUndefined();
    expect(ledger.anomalies).toEqual([]);
  });

  it('flags selling more than held instead of throwing', () => {
    const txns = [...opening, tx('sell', 'VOO', 12, { price: 100 })];
    const ledger = deriveLedger(txns, currencyOf);
    expect(ledger.anomalies).toContainEqual({ kind: 'negative_qty', accountId: 'futu', code: 'VOO', qty: -2 });
  });

  it('flags a buy of an unknown instrument instead of throwing', () => {
    const buy = tx('buy', 'XYZ', 1, { price: 10 });
    const ledger = deriveLedger([...opening, buy], currencyOf);
    expect(ledger.anomalies).toContainEqual({ kind: 'unknown_instrument', txId: buy.id, code: 'XYZ' });
  });
});

describe('ordering and merging', () => {
  it('sorts by date, then createdAt, then id', () => {
    const a = tx('deposit', 'USD', 1, { id: 'b', date: '2026-02-01', createdAt: '2026-02-01T08:00:00.000Z' });
    const b = tx('deposit', 'USD', 1, { id: 'a', date: '2026-02-01', createdAt: '2026-02-01T08:00:00.000Z' });
    const c = tx('deposit', 'USD', 1, { id: 'c', date: '2026-02-01', createdAt: '2026-02-01T07:00:00.000Z' });
    const d = tx('deposit', 'USD', 1, { id: 'd', date: '2026-01-31', createdAt: '2026-02-05T00:00:00.000Z' });
    expect(sortTransactions([a, b, c, d]).map((t) => t.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('two devices recording offline merge to the broker share count in any order', () => {
    const base = [tx('opening', 'VOO', 10, { price: 100, date: '2026-03-01' })];
    // Device A sells 2 shares offline; device B hasn't seen it and calibrates to the 8 shares the broker shows
    const deviceA = [tx('sell', 'VOO', 2, { price: 120, date: '2026-03-02', createdAt: '2026-03-02T10:00:00.000Z' })];
    const deviceB = [tx('calibrate', 'VOO', 8, { reason: '手动修正', date: '2026-03-02', createdAt: '2026-03-02T11:00:00.000Z' })];
    const merged1 = deriveLedger([...base, ...deviceA, ...deviceB], currencyOf);
    const merged2 = deriveLedger([...deviceB, ...base, ...deviceA], currencyOf);
    expect(holdingQty(merged1, 'futu', 'VOO')).toBe(8);
    expect(merged2).toEqual(merged1);
  });

  it('gives the same result for any permutation of the same log', () => {
    const log = [
      tx('opening', 'VOO', 10, { price: 100, date: '2026-01-01' }),
      tx('opening', 'USD', 5000, { date: '2026-01-01' }),
      tx('buy', 'VOO', 3, { price: 105, fee: 1, date: '2026-02-01' }),
      tx('sell', 'VOO', 4, { price: 110, fee: 1, date: '2026-03-01' }),
      tx('deposit', 'USD', 800, { fxToCny: 7.2, date: '2026-03-15' }),
      tx('calibrate', 'VOO', 9.2, { reason: '红利再投', date: '2026-04-01' }),
      tx('withdraw', 'USD', 100, { fxToCny: 7.1, date: '2026-05-01' }),
    ];
    const expected = deriveLedger(log, currencyOf);
    expect(deriveLedger([...log].reverse(), currencyOf)).toEqual(expected);
    expect(deriveLedger([log[3]!, log[0]!, log[6]!, log[1]!, log[5]!, log[2]!, log[4]!], currencyOf)).toEqual(expected);
  });
});

describe('principal helpers', () => {
  const log = [
    tx('opening', '513500', 1000, { price: 2, accountId: 'cms', date: '2026-01-01' }),
    tx('deposit', 'CNY', 5000, { accountId: 'cms', date: '2026-02-01' }),
    tx('buy', '513500', 100, { price: 2.1, accountId: 'cms', date: '2026-02-02' }),
    tx('withdraw', 'USD', 100, { fxToCny: 7.1, date: '2026-03-01' }),
  ];

  it('principalEvents lists deposits and withdrawals only, withdrawals negative', () => {
    expect(principalEvents(log).map((e) => [e.kind, e.date, e.amountCny])).toEqual([
      ['deposit', '2026-02-01', 5000],
      ['withdraw', '2026-03-01', -710],
    ]);
  });

  it('netInvestedOn includes opening and every flow up to that date', () => {
    expect(netInvestedOn(log, '2026-01-31')).toBe(2000);
    expect(netInvestedOn(log, '2026-02-01')).toBe(7000);
    expect(netInvestedOn(log, '2026-12-31')).toBeCloseTo(6290, 9);
  });
});
