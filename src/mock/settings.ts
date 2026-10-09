import type { OwnStock, Plan, Targets } from '../domain/types';

// The targets and plan parameters of prototype v5.

export const targets: Targets = { sp500: 40, ndx: 15, stocks: 10, csi300: 5, ust10: 15, gold: 5, usd: 5, cny: 5 };

export const ownStock: OwnStock = {};

export const plan: Plan = {
  threshold: 3,
  rebalancePeriod: 'quarter',
  calibPeriod: 'quarter',
  undefinedMode: 'sell',
  annualSpend: 300000,
  targetAmount: 8000000,
  expectedReturnPct: 7,
  inflationPct: 2.5,
};
