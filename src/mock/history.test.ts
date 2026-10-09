import { describe, expect, it } from 'vitest';
import { daysBetween } from '../domain/dates';
import { currencyLookup, deriveLedger, netInvestedOn } from '../domain/ledger';
import { totalValue, valueHoldings } from '../domain/valuation';
import { simulateHistory } from './history';
import { exposureById, fx, instrumentByCode, prices, today, transactions } from './index';

const history = simulateHistory({ transactions, instruments: instrumentByCode, prices, fx, end: today });

describe('simulateHistory', () => {
  it('has one snapshot per day from the first transaction to today', () => {
    const { snapshots } = history;
    expect(snapshots[0]!.date).toBe('2025-01-02');
    expect(snapshots.at(-1)!.date).toBe(today);
    expect(snapshots).toHaveLength(daysBetween('2025-01-02', today) + 1);
  });

  it('keeps each day’s principal equal to what the transactions say', () => {
    for (const s of history.snapshots.filter((_, k) => k % 30 === 0)) {
      expect(s.netInvestedCny, s.date).toBeCloseTo(netInvestedOn(transactions, s.date), 6);
    }
  });

  it('ends exactly at today’s valuation and exchange rate', () => {
    const ledger = deriveLedger(transactions, currencyLookup(instrumentByCode));
    const current = totalValue(valueHoldings({ holdings: ledger.holdings, instruments: instrumentByCode, exposures: exposureById, prices, fx }));
    const last = history.snapshots.at(-1)!;
    expect(last.totalValueCny).toBeCloseTo(current, 6);
    expect(last.usdCny).toBeCloseTo(fx.USD, 12);
  });

  it('splits every day’s total across exposures', () => {
    for (const s of history.snapshots.filter((_, k) => k % 45 === 0)) {
      const sum = history.items.filter((it) => it.date === s.date).reduce((acc, it) => acc + it.valueCny, 0);
      expect(sum, s.date).toBeCloseTo(s.totalValueCny, 6);
    }
  });
});
