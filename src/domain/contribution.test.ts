import { describe, expect, it } from 'vitest';
import { contributionTransactions, planContribution } from './contribution';
import { cashBalance, currencyLookup, deriveLedger, holdingQty } from './ledger';
import type { Holding } from './ledger';
import type { RecordCtx } from './record';
import { computeSlots } from './slots';
import type { Account, Exposure, FxRates, Instrument, Market, Targets, Transaction } from './types';
import { valueHoldings } from './valuation';

const exposureList: Exposure[] = [
  { id: 'X', name: 'X', groupId: 'us', isStock: false },
  { id: 'Y', name: 'Y', groupId: 'us', isStock: false },
  { id: 'Z', name: 'Z', groupId: 'bond', isStock: false },
  { id: 'W', name: 'W', groupId: 'bond', isStock: false },
  { id: 'cny', name: '人民币现金', groupId: 'cash', isStock: false },
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
// The candidate list is in mapping order: when none is held, the first one is taken
const candidates: Instrument[] = [
  inst('X1', 'CNY', 'A股', 'X'),
  inst('X2', 'CNY', '场外基金', 'X'),
  inst('XU', 'USD', '美股', 'X'),
  inst('Y1', 'CNY', 'A股', 'Y'),
  inst('Z1', 'CNY', 'A股', 'Z'),
  inst('W1', 'USD', '美股', 'W'),
  inst('CNY', 'CNY', '现金', 'cny'),
];
const instruments = Object.fromEntries(candidates.map((i) => [i.code, i]));
const prices = { X1: 1, X2: 1, XU: 1, Y1: 1, Z1: 1, W1: 1 };
const fx: FxRates = { CNY: 1, USD: 7, HKD: 1 };

const cms: Account = { id: 'cms', name: '招商证券', type: 'broker', currency: 'CNY', market: 'A股' };
const cmb: Account = { id: 'cmb', name: '招商银行', type: 'bank', currency: 'CNY', market: '场外基金' };
const futu: Account = { id: 'futu', name: '富途', type: 'broker', currency: 'USD', market: '美股' };
const accounts = [cms, cmb, futu];

function setup(holdings: Holding[], targets: Targets) {
  const rows = valueHoldings({ holdings, instruments, exposures, prices, fx });
  const { totalCny, slots } = computeSlots({ rows, targets, ownStock: {}, threshold: 3, undefinedMode: 'sell' });
  return { rows, slots, totalCny };
}
const h = (accountId: string, code: string, qty: number): Holding => ({ accountId, code, qty, cost: qty });
const common = { currency: 'CNY' as const, candidates, exposures, ownStock: {}, accounts, fx, prices };

describe('planContribution — water filling', () => {
  // The example in item 11 of the README's revision history
  const example = setup([h('cms', 'X1', 39), h('cms', 'Y1', 1), h('cms', 'Z1', 60)], { X: 40, Y: 10, Z: 50 });

  it('fills the most underweight slot first and never pushes a bought slot over target', () => {
    const plan = planContribution({ ...common, ...example, amount: 10, mode: 'any' });
    // Water-filling would give X 1 yuan, but after that buy X's share would still fall from 39% to about 36.4% (total assets become 110):
    // under the user's phase 5 rule such a buy is skipped and the money goes to the other underweight assets; Y gets all 10 yuan, reaching its 10% target exactly
    expect(plan.lines.map((l) => [l.slotKey, l.code, l.accountId])).toEqual([['Y', 'Y1', 'cms']]);
    expect(plan.lines[0]!.amountCny).toBeCloseTo(10, 9);
    expect(plan.lines[0]!.afterPct).toBeCloseTo(10, 9);
    for (const line of plan.lines) {
      const slot = example.slots.find((s) => s.key === line.slotKey)!;
      expect(line.afterPct).toBeLessThanOrEqual(slot.tgtPct + 1e-9);
    }
  });

  // When nothing would be diluted, it's plain water-filling: Y and X are topped up to the same level 0.62 (value ÷ target)
  it('spreads the money like plain water filling when no bought slot would be diluted', () => {
    const s = setup([h('cms', 'X1', 20), h('cms', 'Y1', 1), h('cms', 'Z1', 79)], { X: 40, Y: 10, Z: 50 });
    const plan = planContribution({ ...common, ...s, amount: 10, mode: 'any' });
    expect(plan.lines.map((l) => [l.slotKey, Math.round(l.amountCny * 1e9) / 1e9])).toEqual([
      ['Y', 5.2],
      ['X', 4.8],
    ]);
  });

  // When it doesn't fit, buy back only the necessary ones: buying X at its floor is enough; cash (9.9%, target 10%) isn't bought at its floor, and the money goes to the most underweight, Y
  it('buys back only as many skipped slots as needed to stay within target', () => {
    const s = setup([h('cms', 'X1', 39), h('cms', 'Y1', 1), h('cmb', 'CNY', 9.9), h('cms', 'Z1', 50.1)], {
      X: 40,
      Y: 10,
      cny: 10,
      Z: 40,
    });
    const plan = planContribution({ ...common, ...s, amount: 12, mode: 'any' });
    expect(plan.lines.map((l) => [l.slotKey, Math.round(l.amountCny * 1e9) / 1e9])).toEqual([
      ['Y', 7.32],
      ['X', 4.68],
    ]);
  });

  // Investing 12 in the example: Y alone can't take it all (giving it everything would reach 11.6%, over target), so X is bought at its floor 39 × 12 ÷ 100 = 4.68, holding its share at 39%
  it('buys a skipped slot just enough to keep its share when the others cannot take the money within target', () => {
    const plan = planContribution({ ...common, ...example, amount: 12, mode: 'any' });
    expect(plan.lines.map((l) => l.slotKey)).toEqual(['Y', 'X']);
    expect(plan.lines[0]!.amountCny).toBeCloseTo(7.32, 9);
    expect(plan.lines[1]!.amountCny).toBeCloseTo(4.68, 9);
    expect(plan.lines[1]!.afterPct).toBeCloseTo(39, 9);
    for (const line of plan.lines) {
      const slot = example.slots.find((s) => s.key === line.slotKey)!;
      expect(line.afterPct).toBeLessThanOrEqual(slot.tgtPct + 1e-9);
    }
  });

  // An overweight X (31%, target 30%) is only topped back up to its target: plain water-filling would give it 1.7 and it would fall to 29.7%, below target
  it('brings an overweight slot back to its target, never below it', () => {
    const s = setup([h('cms', 'X1', 31), h('cms', 'Y1', 68), h('futu', 'W1', 1 / 7)], { X: 30, Y: 70 });
    const plan = planContribution({ ...common, ...s, amount: 10, mode: 'any' });
    expect(plan.lines.map((l) => [l.slotKey, Math.round(l.amountCny * 1e9) / 1e9])).toEqual([
      ['Y', 8],
      ['X', 2],
    ]);
    expect(plan.lines[1]!.afterPct).toBeCloseTo(30, 9);
  });

  // Phase 5 acceptance: after investing, no slot that was bought has a lower share than before; one that was overweight is topped up to its target at most (slots not bought being diluted is expected)
  it('never leaves a bought slot with a smaller share than before, unless it was overweight and ends at target', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    let checked = 0;
    for (let round = 0; round < 200; round++) {
      const holdings = [
        h('cms', 'X1', Math.round(random() * 1000)),
        h('cms', 'Y1', Math.round(random() * 1000)),
        h('cms', 'Z1', Math.round(random() * 1000)),
        h('futu', 'XU', Math.round(random() * 100)),
        h('futu', 'W1', Math.round(random() * 100)),
        h('cmb', 'CNY', Math.round(random() * 500)),
      ].filter((x) => x.qty > 0);
      const raw = ['X', 'Y', 'Z', 'W', 'cny'].map(() => random());
      const sum = raw.reduce((a, b) => a + b, 0);
      const targets = Object.fromEntries(['X', 'Y', 'Z', 'W', 'cny'].map((k, j) => [k, (raw[j]! / sum) * 100]));
      const p = setup(holdings, targets);
      for (const [amount, currency] of [[100000, 'CNY'], [50, 'CNY'], [3000, 'CNY'], [2000, 'USD']] as const) {
        const plan = planContribution({ ...common, ...p, currency, amount, mode: 'any' });
        for (const line of plan.lines) {
          const target = p.slots.find((x) => x.key === line.slotKey)!.tgtPct;
          const floor = Math.min(line.beforePct, target);
          expect(line.afterPct, `round ${round}, ${amount} ${currency}, ${line.slotKey}`).toBeGreaterThanOrEqual(floor - 1e-9);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });

  it('only buys, and the lines add up to the amount', () => {
    const plan = planContribution({ ...common, ...example, amount: 10, mode: 'any' });
    expect(plan.lines.every((l) => l.amountCny >= 0)).toBe(true);
    expect(plan.lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(10, 9);
  });

  it('reports the largest deviation before and after', () => {
    const plan = planContribution({ ...common, ...example, amount: 10, mode: 'any' });
    expect(plan.maxDeviationBefore).toBeCloseTo(10, 9);
    expect(plan.maxDeviationAfter).toBeCloseTo((60 / 110) * 100 - 50, 9);
  });

  it('folds lines under 0.2% of the amount into the largest line', () => {
    const tiny = setup([h('cms', 'X1', 400), h('cms', 'Y1', 1), h('cms', 'Z1', 599)], { X: 40, Y: 10, Z: 50 });
    const plan = planContribution({ ...common, ...tiny, amount: 99.1, mode: 'any' });
    expect(plan.lines.map((l) => l.code)).toEqual(['Y1']);
    expect(plan.lines[0]!.amount).toBeCloseTo(99.1, 9);
  });

  it('when money suffices, every buyable slot reaches its target and the rest follows target weights', () => {
    // W only has USD instruments; CNY can't buy it
    const s = setup([h('cms', 'X1', 30), h('cms', 'Y1', 10), h('futu', 'W1', 60 / 7)], { X: 30, Y: 20, W: 50 });
    const plan = planContribution({ ...common, ...s, amount: 100, mode: 'any' });
    expect(plan.lines.map((l) => [l.code, Math.round(l.amount * 1e6) / 1e6])).toEqual([
      ['X1', 54],
      ['Y1', 46],
    ]);
    expect(plan.missingSlots).toEqual([]);
  });

  it('splits the first contribution by target weights when nothing is held yet', () => {
    const empty = setup([], { X: 50, Y: 50 });
    const plan = planContribution({ ...common, ...empty, amount: 100, mode: 'any' });
    expect(plan.lines.map((l) => [l.code, l.amount, l.beforePct, l.afterPct])).toEqual([
      ['X1', 50, 0, 50],
      ['Y1', 50, 0, 50],
    ]);
    expect(plan.maxDeviationBefore).toBe(50);
    expect(plan.maxDeviationAfter).toBe(0);
  });

  it('returns an empty plan for a zero or invalid amount', () => {
    expect(planContribution({ ...common, ...example, amount: 0, mode: 'any' }).lines).toEqual([]);
    expect(planContribution({ ...common, ...example, amount: Number.NaN, mode: 'any' }).lines).toEqual([]);
  });
});

describe('planContribution — which instrument and account', () => {
  it('only suggests same-currency instruments and lists underweight slots it cannot buy', () => {
    const s = setup([h('cms', 'X1', 50), h('futu', 'W1', 10 / 7)], { X: 50, W: 50 });
    const plan = planContribution({ ...common, ...s, amount: 20, mode: 'any' });
    expect(plan.lines.map((l) => [l.code, l.amount])).toEqual([['X1', 20]]);
    expect(plan.missingSlots).toEqual(['W']);
  });

  it('in single-account mode only suggests what that account can buy', () => {
    const s = setup([h('cms', 'X1', 39), h('cms', 'Y1', 1), h('cms', 'Z1', 60)], { X: 40, Y: 10, Z: 50 });
    const plan = planContribution({ ...common, ...s, amount: 10, mode: 'account', account: cmb });
    expect(plan.lines.map((l) => [l.code, l.accountId, l.isNewInstrument])).toEqual([['X2', 'cmb', true]]);
    expect(plan.lines[0]!.amount).toBeCloseTo(10, 9);
    expect(plan.missingSlots).toEqual(['Y']);
  });

  it('returns no lines rather than failing when nothing can be bought', () => {
    const s = setup([h('cms', 'X1', 39), h('cms', 'Y1', 1), h('cms', 'Z1', 60)], { X: 40, Y: 10, Z: 50 });
    const plan = planContribution({ ...common, ...s, amount: 10, mode: 'account', account: futu });
    expect(plan.lines).toEqual([]);
    expect(plan.missingSlots).toEqual(['X', 'Y']);
  });

  it('suggests the instrument already held the most, in the account holding it', () => {
    const s = setup([h('cms', 'X1', 10), h('cmb', 'X2', 30), h('cms', 'Y1', 60)], { X: 50, Y: 50 });
    const plan = planContribution({ ...common, ...s, amount: 10, mode: 'any' });
    expect(plan.lines.map((l) => [l.code, l.accountId, l.isNewInstrument])).toEqual([['X2', 'cmb', false]]);
  });

  it('falls back to the first mapped instrument and a matching account when nothing is held', () => {
    const s = setup([h('cms', 'Y1', 100)], { X: 50, Y: 50 });
    const plan = planContribution({ ...common, ...s, amount: 10, mode: 'any' });
    expect(plan.lines.map((l) => [l.code, l.accountId, l.isNewInstrument])).toEqual([['X1', 'cms', true]]);
  });

  it('can keep part of the money as cash when cash has a target', () => {
    const s = setup([h('cms', 'X1', 90), h('cmb', 'CNY', 10)], { X: 80, cny: 20 });
    const plan = planContribution({ ...common, ...s, amount: 20, mode: 'any' });
    expect(plan.lines.map((l) => [l.code, l.accountId, l.isCash, Math.round(l.amount * 1e6) / 1e6])).toEqual([
      ['CNY', 'cmb', true, 14],
      ['X1', 'cms', false, 6],
    ]);
  });

  it('skips instruments without a price', () => {
    const s = setup([h('cms', 'Y1', 100)], { X: 50, Y: 50 });
    const plan = planContribution({ ...common, ...s, prices: { Y1: 1, X2: 1 }, amount: 10, mode: 'any' });
    expect(plan.lines.map((l) => l.code)).toEqual(['X2']);
  });
});

describe('contributionTransactions', () => {
  it('writes one deposit per account, then the buys; principal rises by the amount and cash is unchanged', () => {
    const holdings = [h('cms', 'X1', 39), h('cms', 'Y1', 1), h('cms', 'Z1', 60)];
    const s = setup(holdings, { X: 40, Y: 10, Z: 50 });
    const plan = planContribution({ ...common, ...s, amount: 10, mode: 'any' });
    let n = 0;
    const ctx: RecordCtx = { newId: () => `c${++n}`, now: () => '2026-09-29T10:00:00.000Z' };
    const txns = contributionTransactions({ lines: plan.lines, currency: 'CNY', date: '2026-09-29', prices, fx, ctx });
    expect(txns.map((t) => [t.type, t.accountId, t.instrumentCode])).toEqual([
      ['deposit', 'cms', 'CNY'],
      ['buy', 'cms', 'Y1'],
    ]);
    expect(txns[0]!.qty).toBeCloseTo(10, 9);
    expect(txns[0]!.reason).toBe('投入一笔钱');

    const opening: Transaction[] = holdings.map((x, k) => ({
      id: `o${k}`, date: '2026-01-01', createdAt: `2026-01-01T00:00:00.00${k}Z`, type: 'opening',
      accountId: x.accountId, instrumentCode: x.code, qty: x.qty, price: 1, fee: 0, fxToCny: 1,
    }));
    const before = deriveLedger(opening, currencyLookup(instruments));
    const after = deriveLedger([...opening, ...txns], currencyLookup(instruments));
    expect(after.netInvestedCny - before.netInvestedCny).toBeCloseTo(10, 9);
    expect(cashBalance(after, 'cms', 'CNY')).toBe(0);
    expect(holdingQty(after, 'cms', 'Y1')).toBeCloseTo(11, 9);
    expect(after.anomalies).toEqual([]);
  });

  it('deposits the part kept as cash too, so principal rises by the whole amount', () => {
    const holdings = [h('cms', 'X1', 90), h('cmb', 'CNY', 10)];
    const s = setup(holdings, { X: 80, cny: 20 });
    const plan = planContribution({ ...common, ...s, amount: 20, mode: 'any' });
    let n = 0;
    const ctx: RecordCtx = { newId: () => `c${++n}`, now: () => '2026-09-29T10:00:00.000Z' };
    const txns = contributionTransactions({ lines: plan.lines, currency: 'CNY', date: '2026-09-29', prices, fx, ctx });
    expect(txns.map((t) => [t.type, t.accountId, t.instrumentCode, Math.round(t.qty * 1e6) / 1e6])).toEqual([
      ['deposit', 'cmb', 'CNY', 14],
      ['deposit', 'cms', 'CNY', 6],
      ['buy', 'cms', 'X1', 6],
    ]);

    const opening: Transaction[] = holdings.map((x, k) => ({
      id: `o${k}`, date: '2026-01-01', createdAt: `2026-01-01T00:00:00.00${k}Z`, type: 'opening',
      accountId: x.accountId, instrumentCode: x.code, qty: x.qty, price: 1, fee: 0, fxToCny: 1,
    }));
    const before = deriveLedger(opening, currencyLookup(instruments));
    const after = deriveLedger([...opening, ...txns], currencyLookup(instruments));
    expect(after.netInvestedCny - before.netInvestedCny).toBeCloseTo(20, 9);
    expect(cashBalance(after, 'cmb', 'CNY')).toBeCloseTo(24, 9);
    expect(cashBalance(after, 'cms', 'CNY')).toBeCloseTo(0, 9);
    expect(after.anomalies).toEqual([]);
  });
});
