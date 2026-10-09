import type { Account, Exposure, ExposureGroup, Instrument, Market } from '../domain/types';

// The sample catalog of prototype v5: groups, assets, instruments, accounts.

export const groups: ExposureGroup[] = [
  { id: 'us', name: '美股指数' },
  { id: 'stk', name: '个股' },
  { id: 'intl', name: '国际股' },
  { id: 'cn', name: '中国股' },
  { id: 'bond', name: '债券' },
  { id: 'gold', name: '黄金' },
  { id: 'cash', name: '现金' },
  { id: 'other', name: '其他' },
];

export const exposures: Exposure[] = [
  { id: 'sp500', name: '标普 500', groupId: 'us', isStock: false },
  { id: 'ndx', name: '纳斯达克 100', groupId: 'us', isStock: false },
  { id: 'brk', name: '伯克希尔', groupId: 'stk', isStock: true },
  { id: 'aapl', name: '苹果', groupId: 'stk', isStock: true },
  { id: 'moutai', name: '贵州茅台', groupId: 'stk', isStock: true },
  { id: 'exus', name: '全球除美', groupId: 'intl', isStock: false },
  { id: 'csi300', name: '沪深 300', groupId: 'cn', isStock: false },
  { id: 'ust10', name: '10 年期美债', groupId: 'bond', isStock: false },
  { id: 'gold', name: '黄金', groupId: 'gold', isStock: false },
  { id: 'usd', name: '美元现金', groupId: 'cash', isStock: false },
  { id: 'cny', name: '人民币现金', groupId: 'cash', isStock: false },
];

/** The display order of the slots (the prototype's SLOT_ORDER). */
export const slotOrder = ['sp500', 'ndx', 'stocks', 'brk', 'aapl', 'moutai', 'exus', 'csi300', 'ust10', 'gold', 'usd', 'cny'];

const DIVIDEND_REINVESTED = new Set(['VOO', 'QQQ', 'IEF', 'VXUS', '050025', '510300', '513500', 'AAPL']);

type Row = [code: string, name: string, currency: 'CNY' | 'USD', market: Market, exposureId: string];

const ROWS: Row[] = [
  // Instruments held in the prototype
  ['VOO', 'Vanguard 标普500', 'USD', '美股', 'sp500'],
  ['513500', '标普500ETF', 'CNY', 'A股', 'sp500'],
  ['050025', '博时标普500 QDII', 'CNY', '场外基金', 'sp500'],
  ['QQQ', 'Invesco 纳指100', 'USD', '美股', 'ndx'],
  ['AAPL', '苹果', 'USD', '美股', 'aapl'],
  ['BRK.B', '伯克希尔 B', 'USD', '美股', 'brk'],
  ['VXUS', 'Vanguard 全球除美', 'USD', '美股', 'exus'],
  ['510300', '沪深300ETF', 'CNY', 'A股', 'csi300'],
  ['600519', '贵州茅台', 'CNY', 'A股', 'moutai'],
  ['IEF', 'iShares 7-10年美债', 'USD', '美股', 'ust10'],
  ['GLD', 'SPDR 黄金', 'USD', '美股', 'gold'],
  ['518880', '黄金ETF', 'CNY', 'A股', 'gold'],
  ['USD', '美元现金', 'USD', '现金', 'usd'],
  ['CNY', '人民币现金', 'CNY', '现金', 'cny'],
  // Instruments the mapping knows but that aren't held (the prototype's KNOWN)
  ['SPY', 'SPDR 标普500', 'USD', '美股', 'sp500'],
  ['IVV', 'iShares 标普500', 'USD', '美股', 'sp500'],
  ['QQQM', 'Invesco 纳指100', 'USD', '美股', 'ndx'],
  ['513100', '纳指ETF', 'CNY', 'A股', 'ndx'],
  ['159941', '纳指ETF', 'CNY', 'A股', 'ndx'],
  ['270042', '广发纳指100 QDII', 'CNY', '场外基金', 'ndx'],
  ['VEA', 'Vanguard 发达市场', 'USD', '美股', 'exus'],
  ['159934', '黄金ETF', 'CNY', 'A股', 'gold'],
  ['000216', '华安黄金', 'CNY', '场外基金', 'gold'],
  ['000051', '华夏沪深300', 'CNY', '场外基金', 'csi300'],
];

export const instruments: Instrument[] = ROWS.map(([code, name, currency, market, exposureId]) => ({
  code,
  name,
  market,
  currency,
  exposureId,
  paysDividend: DIVIDEND_REINVESTED.has(code),
}));

export const accounts: Account[] = [
  { id: 'futu', name: '富途', type: 'broker', currency: 'USD', market: '美股', color: 'var(--color-accent-700)' },
  { id: 'ibkr', name: '盈透 IBKR', type: 'broker', currency: 'USD', market: '美股', color: 'var(--color-accent-400)' },
  { id: 'schwab', name: '嘉信 Schwab', type: 'broker', currency: 'USD', market: '美股', color: 'var(--color-accent-2-700)' },
  { id: 'ft', name: 'Firstrade', type: 'broker', currency: 'USD', market: '美股', color: 'var(--color-accent-2-400)' },
  { id: 'cms', name: '招商证券', type: 'broker', currency: 'CNY', market: 'A股', color: 'var(--color-neutral-600)' },
  { id: 'cmb', name: '招商银行', type: 'bank', currency: 'CNY', market: '场外基金', color: 'var(--color-neutral-400)' },
];

const byKey = <T>(list: readonly T[], key: (x: T) => string): Record<string, T> =>
  Object.fromEntries(list.map((x) => [key(x), x]));

export const exposureById = byKey(exposures, (e) => e.id);
export const instrumentByCode = byKey(instruments, (i) => i.code);
export const accountById = byKey(accounts, (a) => a.id);
