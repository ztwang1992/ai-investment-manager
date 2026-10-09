import { describe, expect, it } from 'vitest';
import { rebalanceStatus } from './rebalance';
import { computeSlots } from './slots';
import type { Slot } from './slots';
import type { Plan } from './types';
import type { ValuedHolding } from './valuation';

// Rebalancing reminder (BUILD_PLAN phase 5, item 4): by threshold and check period.
// Remind when this period (month / quarter / year) hasn't been marked done and some asset is off by more than the threshold; once marked, look again next period.

const plan = (patch: Partial<Plan> = {}): Plan => ({
  threshold: 3,
  rebalancePeriod: 'quarter',
  calibPeriod: 'quarter',
  undefinedMode: 'sell',
  annualSpend: 300000,
  targetAmount: 8000000,
  expectedReturnPct: 6,
  inflationPct: 2.5,
  ...patch,
});
const slot = (key: string, off: boolean): Slot => ({ key, valueCny: 1, costCny: 1, curPct: 50, tgtPct: 50, diffPct: 0, off, untargeted: false });
const offTwo = [slot('sp500', true), slot('ust10', true), slot('gold', false)];

describe('when to remind about rebalancing', () => {
  it('reminds at the start of a period when something is off and nothing was checked yet', () => {
    expect(rebalanceStatus({ slots: offTwo, plan: plan(), today: '2026-10-01' })).toEqual({
      due: true,
      offCount: 2,
      checkedThisPeriod: false,
      periodStart: '2026-10-01',
    });
  });

  it('stays quiet for the rest of the period once marked done', () => {
    expect(rebalanceStatus({ slots: offTwo, plan: plan({ lastRebalancedOn: '2026-10-01' }), today: '2026-12-31' })).toMatchObject({ due: false, checkedThisPeriod: true, offCount: 2 });
  });

  it('reminds again in the next period', () => {
    expect(rebalanceStatus({ slots: offTwo, plan: plan({ lastRebalancedOn: '2026-09-30' }), today: '2026-10-01' })).toMatchObject({ due: true, checkedThisPeriod: false });
  });

  it('does not remind when nothing is off', () => {
    expect(rebalanceStatus({ slots: [slot('sp500', false)], plan: plan(), today: '2026-10-01' }).due).toBe(false);
  });

  it('follows a monthly or yearly check period', () => {
    expect(rebalanceStatus({ slots: offTwo, plan: plan({ rebalancePeriod: 'month', lastRebalancedOn: '2026-10-01' }), today: '2026-11-02' })).toMatchObject({ due: true, periodStart: '2026-11-01' });
    expect(rebalanceStatus({ slots: offTwo, plan: plan({ rebalancePeriod: 'year', lastRebalancedOn: '2026-01-15' }), today: '2026-11-02' })).toMatchObject({ due: false, periodStart: '2026-01-01' });
  });

  // Assets not in the target: off target under "Suggest selling", not under "Leave out"
  it('counts an untargeted holding as off only when it should be sold', () => {
    const exposure = { id: 'gold', name: '黄金', groupId: 'gold', isStock: false };
    const rows = [{ accountId: 'a', code: 'GLD', qty: 1, cost: 1, valueCny: 100, costCny: 100, price: 1, priceMissing: false, instrument: { code: 'GLD', name: '', market: '美股', currency: 'USD', exposureId: 'gold', paysDividend: false }, exposure }] as ValuedHolding[];
    const slots = (mode: 'sell' | 'ignore') => computeSlots({ rows, targets: {}, ownStock: {}, threshold: 3, undefinedMode: mode }).slots;
    expect(rebalanceStatus({ slots: slots('sell'), plan: plan(), today: '2026-10-01' })).toMatchObject({ due: true, offCount: 1 });
    expect(rebalanceStatus({ slots: slots('ignore'), plan: plan({ undefinedMode: 'ignore' }), today: '2026-10-01' })).toMatchObject({ due: false, offCount: 0 });
  });
});
