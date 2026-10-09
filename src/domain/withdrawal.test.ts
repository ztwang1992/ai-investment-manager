import { describe, expect, it } from 'vitest';
import { cashBalance, currencyLookup, deriveLedger, holdingQty } from './ledger';
import type { Holding } from './ledger';
import type { RecordCtx } from './record';
import { computeSlots } from './slots';
import type { Exposure, FxRates, Instrument, Market, Prices, Targets, Transaction } from './types';
import { valueHoldings } from './valuation';
import { planWithdrawal, withdrawalTransactions } from './withdrawal';

const exposureList: Exposure[] = [
  { id: 'X', name: 'X', groupId: 'us', isStock: false },
  { id: 'Y', name: 'Y', groupId: 'bond', isStock: false },
  { id: 'cny', name: '人民币现金', groupId: 'cash', isStock: false },
  { id: 'usd', name: '美元现金', groupId: 'cash', isStock: false },
];
const exposures = Object.fromEntries(exposureList.map((e) => [e.id, e]));
const inst = (code: string, currency: 'CNY' | 'USD', market: Market, exposureId: string): Instrument => ({
  code,
  name: code,
  market,
  currency,
  exposureId,
  paysDividend: false,
});
const instruments = Object.fromEntries(
  [
    inst('X1', 'CNY', 'A股', 'X'),
    inst('X2', 'CNY', '场外基金', 'X'),
    inst('XU', 'USD', '美股', 'X'),
    inst('Y1', 'CNY', 'A股', 'Y'),
    inst('CNY', 'CNY', '现金', 'cny'),
    inst('USD', 'USD', '现金', 'usd'),
  ].map((i) => [i.code, i]),
);
const allPrices: Prices = { X1: 1, X2: 1, XU: 1, Y1: 1 };
const fx: FxRates = { CNY: 1, USD: 7, HKD: 1 };

function setup(holdings: Holding[], targets: Targets, prices: Prices = allPrices) {
  const rows = valueHoldings({ holdings, instruments, exposures, prices, fx });
  const { totalCny, slots } = computeSlots({ rows, targets, ownStock: {}, threshold: 3, undefinedMode: 'sell' });
  return { rows, slots, totalCny, ownStock: {}, fx };
}
const h = (accountId: string, code: string, qty: number): Holding => ({ accountId, code, qty, cost: qty });
const linesOf = (plan: ReturnType<typeof planWithdrawal>) => {
  if (!plan.ok) throw new Error(JSON.stringify(plan.error));
  return plan.lines;
};
const summary = (plan: ReturnType<typeof planWithdrawal>) =>
  linesOf(plan).map((l) => [l.code, l.accountId, Math.round(l.amount * 1e6) / 1e6]);

describe('planWithdrawal', () => {
  it('sells only the overweight slot when its excess covers the amount', () => {
    const s = setup([h('cms', 'X1', 60), h('cms', 'Y1', 40)], { X: 40, Y: 60 });
    expect(summary(planWithdrawal({ ...s, amount: 10, currency: 'CNY' }))).toEqual([['X1', 'cms', 10]]);
  });

  it('sells the excess first, then spreads the rest over remaining same-currency holdings', () => {
    // X is overweight, but only 10 yuan of it is a CNY holding; the rest is USD
    const s = setup([h('cms', 'X1', 10), h('futu', 'XU', 50 / 7), h('cms', 'Y1', 40)], { X: 40, Y: 60 });
    const lines = linesOf(planWithdrawal({ ...s, amount: 20, currency: 'CNY' }));
    expect(lines.map((l) => [l.code, Math.round(l.amount * 1e6) / 1e6])).toEqual([
      ['X1', 10],
      ['Y1', 10],
    ]);
    expect(lines.some((l) => l.code === 'XU')).toBe(false);
  });

  // Phase 5 acceptance: a withdrawal sells only holdings in the same currency; a USD withdrawal leaves CNY holdings alone, and the other way round
  it('only ever sells holdings in the currency being withdrawn', () => {
    let seed = 11;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    let checked = 0;
    for (let round = 0; round < 200; round++) {
      const holdings = [
        h('cms', 'X1', Math.round(random() * 1000)),
        h('cmb', 'X2', Math.round(random() * 500)),
        h('cms', 'Y1', Math.round(random() * 1000)),
        h('cmb', 'CNY', Math.round(random() * 300)),
        h('futu', 'XU', Math.round(random() * 100)),
        h('futu', 'USD', Math.round(random() * 50)),
      ].filter((x) => x.qty > 0);
      const raw = ['X', 'Y', 'cny', 'usd'].map(() => random());
      const sum = raw.reduce((a, b) => a + b, 0);
      const s = setup(holdings, Object.fromEntries(['X', 'Y', 'cny', 'usd'].map((k, j) => [k, (raw[j]! / sum) * 100])));
      for (const currency of ['CNY', 'USD'] as const) {
        const held = s.rows.filter((r) => r.instrument.currency === currency).reduce((a, r) => a + r.valueCny, 0) / fx[currency];
        for (const share of [0.05, 0.5, 1]) {
          const amount = held * share;
          if (!(amount > 0)) continue;
          const lines = linesOf(planWithdrawal({ ...s, amount, currency }));
          for (const l of lines) {
            expect(instruments[l.code]!.currency, `round ${round}, ${currency} ${share}, ${l.code}`).toBe(currency);
            checked += 1;
          }
          expect(lines.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(amount, 6);
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('within a slot sells the larger holding first, and the lines add up to the amount', () => {
    const s = setup([h('cms', 'X1', 30), h('cmb', 'X2', 10), h('cms', 'Y1', 60)], { X: 10, Y: 90 });
    const plan = planWithdrawal({ ...s, amount: 35, currency: 'CNY' });
    expect(summary(plan)).toEqual([
      ['X1', 'cms', 30],
      ['X2', 'cmb', 3.5],
      ['Y1', 'cms', 1.5],
    ]);
    expect(linesOf(plan).reduce((sum, l) => sum + l.amount, 0)).toBeCloseTo(35, 9);
  });

  it('takes cash directly when cash is overweight', () => {
    const s = setup([h('cms', 'X1', 50), h('cmb', 'CNY', 50)], { X: 50, cny: 50 });
    const lines = linesOf(planWithdrawal({ ...s, amount: 10, currency: 'CNY' }));
    expect(lines.map((l) => [l.code, l.isCash, Math.round(l.amount * 1e6) / 1e6])).toEqual([
      ['X1', false, 5],
      ['CNY', true, 5],
    ]);
  });

  it('refuses to take more than the same-currency holdings', () => {
    const s = setup([h('cms', 'X1', 30), h('futu', 'XU', 10), h('cms', 'Y1', 20)], { X: 50, Y: 50 });
    expect(planWithdrawal({ ...s, amount: 60, currency: 'CNY' })).toEqual({
      ok: false,
      error: { kind: 'insufficient_holdings', availableCny: 50, available: 50 },
    });
  });

  it('reports what is available in the currency being withdrawn', () => {
    const s = setup([h('futu', 'XU', 10), h('cms', 'X1', 30)], { X: 100 });
    expect(planWithdrawal({ ...s, amount: 20, currency: 'USD' })).toEqual({
      ok: false,
      error: { kind: 'insufficient_holdings', availableCny: 70, available: 10 },
    });
  });

  it('does not suggest selling a holding that has no price', () => {
    const s = setup([h('cms', 'X1', 30), h('cms', 'Y1', 70)], { X: 50, Y: 50 }, { Y1: 1 });
    const lines = linesOf(planWithdrawal({ ...s, amount: 10, currency: 'CNY' }));
    expect(lines.map((l) => l.code)).toEqual(['Y1']);
  });

  it('reports nothing available for an empty portfolio', () => {
    const empty = setup([], { X: 50, Y: 50 });
    expect(planWithdrawal({ ...empty, amount: 10, currency: 'CNY' })).toEqual({
      ok: false,
      error: { kind: 'insufficient_holdings', availableCny: 0, available: 0 },
    });
  });

  it('returns no lines for a zero amount', () => {
    const s = setup([h('cms', 'X1', 60), h('cms', 'Y1', 40)], { X: 40, Y: 60 });
    expect(planWithdrawal({ ...s, amount: 0, currency: 'CNY' })).toEqual({ ok: true, lines: [] });
  });
});

describe('withdrawalTransactions', () => {
  it('sells, then withdraws per account; principal falls by the amount and sold-out holdings vanish', () => {
    const holdings = [h('cms', 'X1', 30), h('cmb', 'X2', 10), h('cms', 'Y1', 60)];
    const s = setup(holdings, { X: 10, Y: 90 });
    const plan = planWithdrawal({ ...s, amount: 35, currency: 'CNY' });
    let n = 0;
    const ctx: RecordCtx = { newId: () => `w${++n}`, now: () => '2026-09-29T10:00:00.000Z' };
    const txns = withdrawalTransactions({ lines: linesOf(plan), currency: 'CNY', date: '2026-09-29', prices: allPrices, fx, ctx });
    expect(txns.map((t) => [t.type, t.accountId, t.instrumentCode])).toEqual([
      ['sell', 'cms', 'X1'],
      ['sell', 'cmb', 'X2'],
      ['sell', 'cms', 'Y1'],
      ['withdraw', 'cms', 'CNY'],
      ['withdraw', 'cmb', 'CNY'],
    ]);
    expect(txns.at(-1)!.reason).toBe('取钱');

    const opening: Transaction[] = holdings.map((x, k) => ({
      id: `o${k}`, date: '2026-01-01', createdAt: `2026-01-01T00:00:00.00${k}Z`, type: 'opening',
      accountId: x.accountId, instrumentCode: x.code, qty: x.qty, price: 1, fee: 0, fxToCny: 1,
    }));
    const before = deriveLedger(opening, currencyLookup(instruments));
    const after = deriveLedger([...opening, ...txns], currencyLookup(instruments));
    expect(before.netInvestedCny - after.netInvestedCny).toBeCloseTo(35, 9);
    expect(holdingQty(after, 'cms', 'X1')).toBe(0);
    expect(cashBalance(after, 'cms', 'CNY')).toBe(0);
    expect(after.anomalies).toEqual([]);
  });

  it('withdraws the cash taken directly too, so principal still falls by the whole amount', () => {
    const holdings = [h('cms', 'X1', 50), h('cmb', 'CNY', 50)];
    const s = setup(holdings, { X: 50, cny: 50 });
    const plan = planWithdrawal({ ...s, amount: 10, currency: 'CNY' });
    let n = 0;
    const ctx: RecordCtx = { newId: () => `w${++n}`, now: () => '2026-09-29T10:00:00.000Z' };
    const txns = withdrawalTransactions({ lines: linesOf(plan), currency: 'CNY', date: '2026-09-29', prices: allPrices, fx, ctx });
    expect(txns.map((t) => [t.type, t.accountId, t.instrumentCode, Math.round(t.qty * 1e6) / 1e6])).toEqual([
      ['sell', 'cms', 'X1', 5],
      ['withdraw', 'cms', 'CNY', 5],
      ['withdraw', 'cmb', 'CNY', 5],
    ]);

    const opening: Transaction[] = holdings.map((x, k) => ({
      id: `o${k}`, date: '2026-01-01', createdAt: `2026-01-01T00:00:00.00${k}Z`, type: 'opening',
      accountId: x.accountId, instrumentCode: x.code, qty: x.qty, price: 1, fee: 0, fxToCny: 1,
    }));
    const before = deriveLedger(opening, currencyLookup(instruments));
    const after = deriveLedger([...opening, ...txns], currencyLookup(instruments));
    expect(before.netInvestedCny - after.netInvestedCny).toBeCloseTo(10, 9);
    expect(cashBalance(after, 'cmb', 'CNY')).toBeCloseTo(45, 9);
    expect(cashBalance(after, 'cms', 'CNY')).toBeCloseTo(0, 9);
    expect(after.anomalies).toEqual([]);
  });

  it('leaves no floating-point residue when selling a whole foreign holding', () => {
    const holdings = [h('futu', 'XU', 7)];
    const prices = { XU: 1.1 };
    const s = setup(holdings, { X: 100 }, prices);
    const plan = planWithdrawal({ ...s, amount: 7.7, currency: 'USD' });
    let n = 0;
    const ctx: RecordCtx = { newId: () => `u${++n}`, now: () => '2026-09-29T10:00:00.000Z' };
    const txns = withdrawalTransactions({ lines: linesOf(plan), currency: 'USD', date: '2026-09-29', prices, fx, ctx });
    const opening: Transaction = {
      id: 'o', date: '2026-01-01', createdAt: '2026-01-01T00:00:00.000Z', type: 'opening',
      accountId: 'futu', instrumentCode: 'XU', qty: 7, price: 1.1, fee: 0, fxToCny: 7,
    };
    const after = deriveLedger([opening, ...txns], currencyLookup(instruments));
    expect(after.holdings).toEqual([]);
    expect(after.anomalies).toEqual([]);
  });
});
