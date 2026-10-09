import { gbkAscii, isDate, parseFrankfurter, parseFundApp, parseFundF10, parseSina, parseTencent, parseYahoo, parseYahooDaily, positive } from './parse';
import { sinaSymbol, tencentSymbol, yahooSymbol } from './symbols';
import { beijingToUtc, easternToUtc } from './time';
import type { Fetch, MarketKind, Quote } from './types';

// Data sources and fallback order (docs/phase0-feasibility.md section 3). One chain of sources per market; codes one source lacks go to the next.
// To change data sources, change only this file: write a new Provider and put it in CHAINS.

/** The free plan allows at most 50 outside requests per request; keep 5 in reserve */
export const SUBREQUEST_BUDGET = 45;
/** Sources that look up one code at a time (Yahoo, F10) stop when this many are left, saving them for later sources that look up many at once */
const RESERVE_FOR_BATCH = 5;
/** A Worker request can have at most 6 connections open at once */
const PARALLEL = 4;
const TIMEOUT_MS = 5000;
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SINA_HEADERS = { Referer: 'https://finance.sina.com.cn' };
const F10_HEADERS = { Referer: 'https://fundf10.eastmoney.com/' };
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const FRANKFURTER = 'https://api.frankfurter.dev/v1';
const DAY_S = 86_400;

/** How many outside requests this request can still make; one budget shared by all markets and rates */
export interface Budget {
  left: number;
}
export const newBudget = (left = SUBREQUEST_BUDGET): Budget => ({ left });

export interface Provider {
  name: string;
  /** Returns only what was found; throws when the whole source fails (network, non-2xx, timeout) */
  get(kind: MarketKind, codes: string[], fetch: Fetch, budget: Budget): Promise<Quote[]>;
}

/** Makes one outside request: counts against the budget, 5-second timeout, non-2xx counts as a failure */
async function request(fetch: Fetch, budget: Budget, url: string, headers: Record<string, string> = {}): Promise<Response> {
  if (budget.left <= 0) throw new Error('Out of external requests for this call');
  budget.left -= 1;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
}
const requestGbk = async (fetch: Fetch, budget: Budget, url: string, headers?: Record<string, string>) =>
  gbkAscii(new Uint8Array(await (await request(fetch, budget, url, headers)).arrayBuffer()));
const requestJson = async (fetch: Fetch, budget: Budget, url: string, headers?: Record<string, string>): Promise<unknown> =>
  (await request(fetch, budget, url, headers)).json();

/** A source that looks up one code at a time: at most 4 at once; one failure only means that code wasn't found; stops when the budget is nearly spent */
async function eachCode(codes: string[], budget: Budget, one: (code: string) => Promise<Quote | null>): Promise<Quote[]> {
  const out: Quote[] = [];
  let next = 0;
  const lane = async () => {
    while (next < codes.length && budget.left > RESERVE_FOR_BATCH) {
      const code = codes[next++]!;
      try {
        const quote = await one(code);
        if (quote) out.push(quote);
      } catch {
        // This code wasn't found; leave it to the next source
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, codes.length) }, lane));
  return out;
}

const currencyOf = (kind: MarketKind): 'USD' | 'CNY' => (kind === 'us' ? 'USD' : 'CNY');

const tencent: Provider = {
  name: 'tencent',
  async get(kind, codes, fetch, budget) {
    if (kind === 'fund') return [];
    const symbols = codes.map((code) => tencentSymbol(kind, code));
    const rows = parseTencent(await requestGbk(fetch, budget, `https://qt.gtimg.cn/q=${symbols.join(',')}`));
    return codes.flatMap((code, i) => {
      const row = rows.get(symbols[i]!);
      const asOf = row && (kind === 'us' ? easternToUtc(row.time) : beijingToUtc(row.time));
      return row && asOf ? [{ code, price: row.price, currency: currencyOf(kind), asOf, source: 'tencent' }] : [];
    });
  },
};

const yahoo: Provider = {
  name: 'yahoo',
  async get(kind, codes, fetch, budget) {
    if (kind === 'fund') return [];
    return eachCode(codes, budget, async (code) => {
      const r = parseYahoo(await requestJson(fetch, budget, `${YAHOO}/${encodeURIComponent(yahooSymbol(kind, code))}?interval=1d&range=1d`));
      return r && r.currency === currencyOf(kind) ? { code, price: r.price, currency: currencyOf(kind), asOf: r.time, source: 'yahoo' } : null;
    });
  },
};

/** Sina's fields: US [1] price, [3] Beijing time; A-shares [3] price, [30] date, [31] time; funds [1] NAV, [4] NAV date */
function sinaFields(kind: MarketKind, f: string[]): { price: number; asOf: string } | null {
  const price = positive(kind === 'cn' ? f[3] : f[1]);
  const asOf = kind === 'us' ? beijingToUtc(f[3] ?? '') : kind === 'cn' ? beijingToUtc(`${f[30]} ${f[31]}`) : isDate(f[4]) ? f[4] : null;
  return price !== null && asOf ? { price, asOf } : null;
}

const sina: Provider = {
  name: 'sina',
  async get(kind, codes, fetch, budget) {
    const symbols = codes.map((code) => sinaSymbol(kind, code));
    const rows = parseSina(await requestGbk(fetch, budget, `https://hq.sinajs.cn/list=${symbols.join(',')}`, SINA_HEADERS));
    return codes.flatMap((code, i) => {
      const fields = rows.get(symbols[i]!);
      const q = fields && sinaFields(kind, fields);
      return q ? [{ code, currency: currencyOf(kind), source: 'sina', ...q }] : [];
    });
  },
};

const fundApp: Provider = {
  name: 'fundapp',
  async get(kind, codes, fetch, budget) {
    if (kind !== 'fund') return [];
    const url = `https://fundmobapi.eastmoney.com/FundMNewApi/FundMNFInfo?pageIndex=1&pageSize=${codes.length}&plat=Android&appType=ttjj&product=EFund&Version=1&deviceid=invest-api&Fcodes=${codes.join(',')}`;
    const rows = parseFundApp(await requestJson(fetch, budget, url));
    return codes.flatMap((code) => {
      const r = rows.get(code);
      return r ? [{ code, price: r.nav, currency: 'CNY' as const, asOf: r.date, source: 'fundapp' }] : [];
    });
  },
};

const fundF10: Provider = {
  name: 'f10',
  async get(kind, codes, fetch, budget) {
    if (kind !== 'fund') return [];
    return eachCode(codes, budget, async (code) => {
      const r = parseFundF10(await requestJson(fetch, budget, `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${code}&pageIndex=1&pageSize=1`, F10_HEADERS));
      return r ? { code, price: r.nav, currency: 'CNY', asOf: r.date, source: 'f10' } : null;
    });
  },
};

export const CHAINS: Record<MarketKind, Provider[]> = {
  us: [tencent, yahoo, sina],
  cn: [tencent, yahoo, sina],
  fund: [sina, fundApp, fundF10],
};

/** Asks each source in the chain in turn: codes one source lacks go to the next; results in the order of codes */
export async function fetchKind(kind: MarketKind, codes: string[], fetch: Fetch, budget: Budget): Promise<{ quotes: Quote[]; missing: string[] }> {
  const found = new Map<string, Quote>();
  const wanted = [...new Set(codes)];
  for (const provider of CHAINS[kind]) {
    const missing = wanted.filter((code) => !found.has(code));
    if (missing.length === 0) break;
    try {
      for (const q of await provider.get(kind, missing, fetch, budget)) if (missing.includes(q.code) && !found.has(q.code)) found.set(q.code, q);
    } catch {
      // The whole source failed: everything missing goes to the next one
    }
  }
  return {
    quotes: wanted.flatMap((code) => found.get(code) ?? []),
    missing: wanted.filter((code) => !found.has(code)),
  };
}

/** How many CNY 1 USD and 1 HKD are each worth */
export interface FxRates {
  /** The date of the rates (as the data source gives it) */
  date: string;
  usd: number;
  hkd: number;
  source: string;
}

async function firstOf(tries: (() => Promise<FxRates | null>)[]): Promise<FxRates> {
  for (const attempt of tries) {
    try {
      const r = await attempt();
      if (r) return r;
    } catch {
      // try the next source
    }
  }
  throw new Error('Exchange rate not available right now');
}

const fromFrankfurter = async (fetch: Fetch, budget: Budget, path: string): Promise<FxRates | null> => {
  const r = parseFrankfurter(await requestJson(fetch, budget, `${FRANKFURTER}/${path}?base=USD&symbols=CNY,HKD`));
  return r && { ...r, source: 'frankfurter' };
};

/** The current rate: frankfurter (ECB) -> Yahoo -> Sina spot */
export function fetchFxLatest(fetch: Fetch, budget: Budget): Promise<FxRates> {
  return firstOf([
    () => fromFrankfurter(fetch, budget, 'latest'),
    async () => {
      const [usd, hkd] = await Promise.all(
        ['CNY=X', 'HKDCNY=X'].map(async (s) => parseYahoo(await requestJson(fetch, budget, `${YAHOO}/${encodeURIComponent(s)}?interval=1d&range=1d`))),
      );
      return usd && hkd ? { date: usd.time.slice(0, 10), usd: usd.price, hkd: hkd.price, source: 'yahoo' } : null;
    },
    async () => {
      const rows = parseSina(await requestGbk(fetch, budget, 'https://hq.sinajs.cn/list=fx_susdcny,fx_shkdcny', SINA_HEADERS));
      const usd = rows.get('fx_susdcny');
      const rate = positive(usd?.[1]);
      const hkd = positive(rows.get('fx_shkdcny')?.[1]);
      const date = usd?.at(-1);
      return rate !== null && hkd !== null && isDate(date) ? { date, usd: rate, hkd, source: 'sina' } : null;
    },
  ]);
}

const onOrBefore = (bars: { date: string; close: number }[], date: string) => bars.filter((b) => b.date <= date).at(-1) ?? null;

/** A given day's rate: frankfurter history -> Yahoo daily bars. A non-business day gets the previous business day's, as the returned date says. Sina has no historical rates. */
export function fetchFxOn(date: string, fetch: Fetch, budget: Budget): Promise<FxRates> {
  return firstOf([
    () => fromFrankfurter(fetch, budget, date),
    async () => {
      const day = Date.parse(`${date}T00:00:00Z`) / 1000;
      const daily = (symbol: string) =>
        requestJson(fetch, budget, `${YAHOO}/${encodeURIComponent(symbol)}?interval=1d&period1=${day - 10 * DAY_S}&period2=${day + DAY_S}`).then(parseYahooDaily);
      const [usdBars, hkdBars] = await Promise.all([daily('CNY=X'), daily('HKDCNY=X')]);
      const usd = onOrBefore(usdBars, date);
      // HKD from the same day, so the two rates match
      const hkd = usd && onOrBefore(hkdBars, usd.date);
      return usd && hkd ? { date: usd.date, usd: usd.close, hkd: hkd.close, source: 'yahoo' } : null;
    },
  ]);
}
