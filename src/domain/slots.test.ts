import { describe, expect, it } from 'vitest';
import { currencyLookup, deriveLedger } from './ledger';
import { computeSlots, rebalanceSteps, slotKeyOf } from './slots';
import { valueHoldings } from './valuation';
import type { ValuedHolding } from './valuation';
import type { Exposure } from './types';
import * as mock from '../mock';

const EXPOSURES: Record<string, Exposure> = {
  sp500: { id: 'sp500', name: '标普 500', groupId: 'us', isStock: false },
  ndx: { id: 'ndx', name: '纳斯达克 100', groupId: 'us', isStock: false },
  aapl: { id: 'aapl', name: '苹果', groupId: 'stk', isStock: true },
  brk: { id: 'brk', name: '伯克希尔', groupId: 'stk', isStock: true },
  exus: { id: 'exus', name: '全球除美', groupId: 'intl', isStock: false },
  gold: { id: 'gold', name: '黄金', groupId: 'gold', isStock: false },
};

function row(exposureId: string, valueCny: number, costCny = valueCny): ValuedHolding {
  const exposure = EXPOSURES[exposureId]!;
  return {
    accountId: 'a',
    code: exposureId.toUpperCase(),
    qty: 1,
    cost: costCny,
    instrument: { code: exposureId.toUpperCase(), name: exposureId, market: '美股', currency: 'CNY', exposureId, paysDividend: false },
    exposure,
    price: valueCny,
    priceMissing: false,
    valueCny,
    costCny,
  };
}

const base = { ownStock: {}, threshold: 3, undefinedMode: 'sell' as const };
const byKey = (slots: ReturnType<typeof computeSlots>['slots']) => Object.fromEntries(slots.map((s) => [s.key, s]));

describe('slotKeyOf', () => {
  it('puts individual stocks into the stocks bucket unless they have their own target', () => {
    expect(slotKeyOf(EXPOSURES.aapl!, {})).toBe('stocks');
    expect(slotKeyOf(EXPOSURES.aapl!, { aapl: true })).toBe('aapl');
    expect(slotKeyOf(EXPOSURES.sp500!, {})).toBe('sp500');
  });
});

describe('computeSlots', () => {
  const rows = [row('sp500', 600), row('ndx', 200), row('aapl', 100), row('brk', 100)];

  it('computes current share, target and deviation per slot', () => {
    const { totalCny, slots } = computeSlots({ ...base, rows, targets: { sp500: 50, ndx: 30, stocks: 20 } });
    expect(totalCny).toBe(1000);
    expect(byKey(slots)).toMatchObject({
      sp500: { curPct: 60, tgtPct: 50, diffPct: 10, off: true, untargeted: false },
      ndx: { curPct: 20, tgtPct: 30, diffPct: -10, off: true },
      stocks: { valueCny: 200, curPct: 20, tgtPct: 20, diffPct: 0, off: false },
    });
  });

  it('gives a stock with its own target its own slot', () => {
    const { slots } = computeSlots({ ...base, rows, ownStock: { aapl: true }, targets: { sp500: 50, ndx: 30, stocks: 10, aapl: 10 } });
    expect(byKey(slots)).toMatchObject({ aapl: { valueCny: 100, curPct: 10 }, stocks: { valueCny: 100, curPct: 10 } });
  });

  it('treats held assets without a target as 0% (sell) or as their current share (ignore)', () => {
    const held = [row('sp500', 500), row('exus', 500)];
    const sell = byKey(computeSlots({ ...base, rows: held, targets: { sp500: 100 } }).slots);
    expect(sell.exus).toMatchObject({ untargeted: true, tgtPct: 0, diffPct: 50, off: true });
    const ignore = byKey(computeSlots({ ...base, undefinedMode: 'ignore', rows: held, targets: { sp500: 100 } }).slots);
    expect(ignore.exus).toMatchObject({ untargeted: true, tgtPct: 50, diffPct: 0, off: false });
  });

  it('flags a deviation only when it exceeds the threshold', () => {
    const at = byKey(computeSlots({ ...base, rows: [row('sp500', 530), row('ndx', 470)], targets: { sp500: 50, ndx: 50 } }).slots);
    expect(at.sp500!.off).toBe(false);
    const over = byKey(computeSlots({ ...base, rows: [row('sp500', 531), row('ndx', 469)], targets: { sp500: 50, ndx: 50 } }).slots);
    expect(over.sp500!.off).toBe(true);
  });

  it('includes targets that are not held yet', () => {
    const slots = byKey(computeSlots({ ...base, rows: [row('sp500', 1000)], targets: { sp500: 90, gold: 10 } }).slots);
    expect(slots.gold).toMatchObject({ valueCny: 0, curPct: 0, tgtPct: 10, diffPct: -10, off: true, untargeted: false });
  });

  it('returns zero shares, not NaN, for an empty portfolio', () => {
    const { totalCny, slots } = computeSlots({ ...base, rows: [], targets: { sp500: 100 } });
    expect(totalCny).toBe(0);
    expect(slots).toEqual([
      { key: 'sp500', valueCny: 0, costCny: 0, curPct: 0, tgtPct: 100, diffPct: -100, off: true, untargeted: false },
    ]);
  });

  it('orders slots by the given order, unknown keys last', () => {
    const { slots } = computeSlots({ ...base, rows, targets: { stocks: 20, sp500: 50, ndx: 30 }, order: ['sp500', 'ndx'] });
    expect(slots.map((s) => s.key)).toEqual(['sp500', 'ndx', 'stocks']);
  });

  it('adds up to 100% on the mock portfolio', () => {
    const ledger = deriveLedger(mock.transactions, currencyLookup(mock.instrumentByCode));
    const valued = valueHoldings({ holdings: ledger.holdings, instruments: mock.instrumentByCode, exposures: mock.exposureById, prices: mock.prices, fx: mock.fx });
    const { slots } = computeSlots({ rows: valued, targets: mock.targets, ownStock: mock.ownStock, threshold: 3, undefinedMode: 'sell', order: mock.slotOrder });
    expect(slots.reduce((sum, s) => sum + s.curPct, 0)).toBeCloseTo(100, 9);
    expect(slots.map((s) => s.key)).toEqual(['sp500', 'ndx', 'stocks', 'exus', 'csi300', 'ust10', 'gold', 'usd', 'cny']);
    expect(slots.find((s) => s.key === 'exus')!.untargeted).toBe(true);
  });
});

describe('rebalanceSteps', () => {
  it('lists sells before buys and ignores moves under 0.3% of the total', () => {
    const rows = [row('sp500', 600), row('ndx', 200), row('aapl', 100), row('brk', 100)];
    const { totalCny, slots } = computeSlots({ ...base, rows, targets: { sp500: 50, ndx: 30, stocks: 20 } });
    expect(rebalanceSteps(slots, totalCny)).toEqual([
      { slotKey: 'sp500', action: 'sell', amountCny: 100, untargeted: false },
      { slotKey: 'ndx', action: 'buy', amountCny: 100, untargeted: false },
    ]);
  });

  it('sells everything in an untargeted slot in sell mode and leaves it alone in ignore mode', () => {
    const held = [row('sp500', 500), row('exus', 500)];
    const sell = computeSlots({ ...base, rows: held, targets: { sp500: 100 } });
    expect(rebalanceSteps(sell.slots, sell.totalCny)).toEqual([
      { slotKey: 'exus', action: 'sell', amountCny: 500, untargeted: true },
      { slotKey: 'sp500', action: 'buy', amountCny: 500, untargeted: false },
    ]);
    const ignore = computeSlots({ ...base, undefinedMode: 'ignore', rows: held, targets: { sp500: 50 } });
    expect(rebalanceSteps(ignore.slots, ignore.totalCny)).toEqual([]);
  });
});
