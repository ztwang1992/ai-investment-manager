import { describe, expect, it } from 'vitest';
import { currencyLookup, deriveLedger } from '../domain/ledger';
import { accountById, accounts, exposureById, exposures, instrumentByCode, instruments, transactions } from './index';

// Prototype v5's holdings (POS): the sample transactions must derive exactly these.
const PROTOTYPE_POSITIONS: Record<string, number> = {
  'futu|VOO': 120,
  'ibkr|VOO': 80,
  'schwab|VOO': 60,
  'cms|513500': 60000,
  'cmb|050025': 30000,
  'ibkr|QQQ': 50,
  'ft|AAPL': 60,
  'ft|BRK.B': 40,
  'schwab|VXUS': 200,
  'cms|510300': 30000,
  'cms|600519': 60,
  'ibkr|IEF': 900,
  'schwab|IEF': 300,
  'cms|518880': 15000,
  'futu|USD': 8000,
  'cmb|CNY': 150000,
};

describe('mock data', () => {
  it('derives exactly the prototype positions with no anomalies', () => {
    const ledger = deriveLedger(transactions, currencyLookup(instrumentByCode));
    expect(ledger.anomalies).toEqual([]);
    const derived = Object.fromEntries(ledger.holdings.map((h) => [`${h.accountId}|${h.code}`, h.qty]));
    expect(Object.keys(derived).sort()).toEqual(Object.keys(PROTOTYPE_POSITIONS).sort());
    for (const [key, qty] of Object.entries(PROTOTYPE_POSITIONS)) {
      expect(derived[key], key).toBeCloseTo(qty, 9);
    }
  });

  it('only references known accounts, instruments and exposures', () => {
    for (const t of transactions) {
      expect(accountById[t.accountId], t.id).toBeDefined();
      expect(instrumentByCode[t.instrumentCode], t.id).toBeDefined();
    }
    for (const inst of instruments) expect(exposureById[inst.exposureId], inst.code).toBeDefined();
  });

  it('matches the prototype catalogue size', () => {
    expect(accounts).toHaveLength(6);
    expect(exposures).toHaveLength(11);
    expect(instruments).toHaveLength(24);
  });
});
