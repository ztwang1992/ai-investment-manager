// Names of the preset groups, assets and instruments (the global presets in supabase/migrations and the
// sample catalog in src/mock/catalog.ts). They are stored in Chinese. In English a preset shows its English
// name while the stored name is still the original Chinese one; a renamed preset or a name the user typed is
// shown as typed. A-share and Chinese fund names are product names: they have no English entry and show in
// Chinese in both languages.
import type { Locale } from './locale';

type NameTable = Readonly<Record<string, { zh: string; en: string }>>;

/** Asset groups (client-side presets, by id) */
export const GROUP_NAMES: NameTable = {
  us: { zh: '美股指数', en: 'US stock indexes' },
  stk: { zh: '个股', en: 'Individual stocks' },
  intl: { zh: '国际股', en: 'International stocks' },
  cn: { zh: '中国股', en: 'Chinese stocks' },
  bond: { zh: '债券', en: 'Bonds' },
  gold: { zh: '黄金', en: 'Gold' },
  cash: { zh: '现金', en: 'Cash' },
  other: { zh: '其他', en: 'Other' },
};

/** Underlying assets, by id. 贵州茅台 is an A-share and keeps its Chinese name */
export const EXPOSURE_NAMES: NameTable = {
  sp500: { zh: '标普 500', en: 'S&P 500' },
  ndx: { zh: '纳斯达克 100', en: 'Nasdaq 100' },
  brk: { zh: '伯克希尔', en: 'Berkshire Hathaway' },
  aapl: { zh: '苹果', en: 'Apple' },
  exus: { zh: '全球除美', en: 'International ex-US' },
  csi300: { zh: '沪深 300', en: 'CSI 300' },
  ust10: { zh: '10 年期美债', en: '10-year Treasuries' },
  gold: { zh: '黄金', en: 'Gold' },
  usd: { zh: '美元现金', en: 'USD cash' },
  cny: { zh: '人民币现金', en: 'CNY cash' },
  total_us: { zh: '全美股市', en: 'Total US market' },
  r2000: { zh: '罗素 2000', en: 'Russell 2000' },
  us_div: { zh: '美股红利', en: 'US dividend stocks' },
  global: { zh: '全球股市', en: 'Global stocks' },
  em: { zh: '新兴市场', en: 'Emerging markets' },
  csi500: { zh: '中证 500', en: 'CSI 500' },
  chinext: { zh: '创业板', en: 'ChiNext' },
  star50: { zh: '科创 50', en: 'STAR 50' },
  cn_div: { zh: '中证红利', en: 'CSI Dividend' },
  hsi: { zh: '恒生指数', en: 'Hang Seng Index' },
  hstech: { zh: '恒生科技', en: 'Hang Seng Tech' },
  us_bond: { zh: '美国综合债', en: 'US aggregate bonds' },
  ust_long: { zh: '美国长期国债', en: 'Long-term Treasuries' },
  ust_short: { zh: '美国短期国债', en: 'Short-term Treasuries' },
  cn_bond: { zh: '中国国债', en: 'Chinese government bonds' },
  reit: { zh: '美国房地产', en: 'US real estate' },
};

/** US-listed instruments and cash, by code */
export const INSTRUMENT_NAMES: NameTable = {
  VOO: { zh: 'Vanguard 标普500', en: 'Vanguard S&P 500' },
  QQQ: { zh: 'Invesco 纳指100', en: 'Invesco QQQ Trust' },
  AAPL: { zh: '苹果', en: 'Apple' },
  'BRK.B': { zh: '伯克希尔 B', en: 'Berkshire Hathaway B' },
  VXUS: { zh: 'Vanguard 全球除美', en: 'Vanguard Total International' },
  IEF: { zh: 'iShares 7-10年美债', en: 'iShares 7-10 Year Treasury' },
  GLD: { zh: 'SPDR 黄金', en: 'SPDR Gold' },
  SPY: { zh: 'SPDR 标普500', en: 'SPDR S&P 500' },
  IVV: { zh: 'iShares 标普500', en: 'iShares Core S&P 500' },
  QQQM: { zh: 'Invesco 纳指100', en: 'Invesco Nasdaq 100' },
  VEA: { zh: 'Vanguard 发达市场', en: 'Vanguard Developed Markets' },
  SPLG: { zh: 'SPDR 投资组合标普500', en: 'SPDR Portfolio S&P 500' },
  VTI: { zh: 'Vanguard 全美股市', en: 'Vanguard Total Stock Market' },
  ITOT: { zh: 'iShares 全美股市', en: 'iShares Total US Stock Market' },
  SCHB: { zh: 'Schwab 全美股市', en: 'Schwab US Broad Market' },
  IWM: { zh: 'iShares 罗素2000', en: 'iShares Russell 2000' },
  SCHD: { zh: 'Schwab 美股红利', en: 'Schwab US Dividend Equity' },
  VYM: { zh: 'Vanguard 高股息', en: 'Vanguard High Dividend Yield' },
  VT: { zh: 'Vanguard 全球股市', en: 'Vanguard Total World Stock' },
  IEFA: { zh: 'iShares 发达市场', en: 'iShares Core MSCI EAFE' },
  VWO: { zh: 'Vanguard 新兴市场', en: 'Vanguard Emerging Markets' },
  IEMG: { zh: 'iShares 新兴市场', en: 'iShares Core MSCI Emerging Markets' },
  BND: { zh: 'Vanguard 美国全债市', en: 'Vanguard Total Bond Market' },
  AGG: { zh: 'iShares 美国全债市', en: 'iShares Core US Aggregate Bond' },
  TLT: { zh: 'iShares 20年以上美债', en: 'iShares 20+ Year Treasury' },
  SGOV: { zh: 'iShares 0-3个月美债', en: 'iShares 0-3 Month Treasury' },
  BIL: { zh: 'SPDR 1-3个月美债', en: 'SPDR 1-3 Month T-Bill' },
  SHY: { zh: 'iShares 1-3年美债', en: 'iShares 1-3 Year Treasury' },
  IAU: { zh: 'iShares 黄金', en: 'iShares Gold Trust' },
  GLDM: { zh: 'SPDR 迷你黄金', en: 'SPDR Gold MiniShares' },
  VNQ: { zh: 'Vanguard 美国房地产', en: 'Vanguard Real Estate' },
  USD: { zh: '美元现金', en: 'USD cash' },
  CNY: { zh: '人民币现金', en: 'CNY cash' },
};

function translated(table: NameTable, key: string, stored: string, locale: Locale): string {
  const entry = table[key];
  return locale === 'en' && entry !== undefined && entry.zh === stored ? entry.en : stored;
}

/** Display names in one language. Never write these back into the data: the stored names stay as they are */
export function namesFor(locale: Locale) {
  return {
    group: (g: { id: string; name: string }) => translated(GROUP_NAMES, g.id, g.name, locale),
    exposure: (e: { id: string; name: string }) => translated(EXPOSURE_NAMES, e.id, e.name, locale),
    instrument: (i: { code: string; name: string }) => translated(INSTRUMENT_NAMES, i.code, i.name, locale),
  };
}
