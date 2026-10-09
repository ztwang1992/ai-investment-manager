import type { FxRates, Prices } from '../domain/types';

// The quotes and exchange rates hard-coded in prototype v5.

export const today = '2026-09-29';

export const fx: FxRates = { CNY: 1, USD: 7.1, HKD: 0.91 };

/** Mutual funds use the T-1 NAV; this is the NAV's date (since phase 4 the quotes Worker returns it). */
export const navDates: Record<string, string> = {
  '050025': '2026-09-28',
  '270042': '2026-09-28',
  '000216': '2026-09-28',
  '000051': '2026-09-28',
};

export const prices: Prices = {
  VOO: 540,
  '513500': 2.1,
  '050025': 5.2,
  QQQ: 480,
  AAPL: 230,
  'BRK.B': 470,
  VXUS: 68,
  '510300': 4,
  '600519': 1500,
  IEF: 95,
  GLD: 245,
  '518880': 6.2,
  SPY: 590,
  IVV: 595,
  QQQM: 200,
  '513100': 1.6,
  '159941': 1.2,
  '270042': 6.5,
  VEA: 52,
  '159934': 6.1,
  '000216': 2.4,
  '000051': 1.5,
};
