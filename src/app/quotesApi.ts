import { QUOTE_CODE } from '../domain/quoteCodes';
import { MARKET, isCashCode } from '../domain/types';
import type { Instrument, Market } from '../domain/types';

// Client of the quotes Worker (worker/). Fetches prices and exchange rates at cold start, on pull-to-refresh and after calibration; before an offline transaction is uploaded, looks up the rate of its recording day.

export type QuoteMarket = 'us' | 'cn' | 'fund';

export interface LiveQuote {
  market: QuoteMarket;
  code: string;
  price: number;
  currency: 'USD' | 'CNY';
  /** The time of the price (ISO); for mutual funds, the NAV date YYYY-MM-DD */
  asOf: string;
  source: string;
  /** None of the data sources had it; this is an old value from the Worker's cache */
  stale: boolean;
}

export interface QuotesReply {
  quotes: LiveQuote[];
  /** Codes no data source recognizes and the cache doesn't have either */
  missing: { market: QuoteMarket; code: string }[];
}

/** How many CNY one unit of the foreign currency is worth */
export interface FxReply {
  date: string;
  rates: { USD: number; HKD: number };
  source: string;
  stale: boolean;
}

export type QuoteRequest = Record<QuoteMarket, string[]>;

export interface QuotesApi {
  quotes(req: QuoteRequest): Promise<QuotesReply>;
  /** Without a date, the current rate; with a date, that day's (a non-business day gets the previous business day's) */
  fx(date?: string): Promise<FxReply>;
}

/** On a cache miss the Worker asks several data sources in turn, so wait a little longer */
const TIMEOUT_MS = 15_000;
const MARKETS: QuoteMarket[] = ['us', 'cn', 'fund'];
const MARKET_OF: Partial<Record<Market, QuoteMarket>> = { [MARKET.us]: 'us', [MARKET.cn]: 'cn', [MARKET.fund]: 'fund' };

/** The quotes Worker's address: VITE_API_BASE in .env.local or the build variables (the wrangler dev address for local debugging). Without it, no quotes */
export function apiBase(env: { VITE_API_BASE?: string }): string | null {
  const base = env.VITE_API_BASE?.trim();
  return base ? base.replace(/\/+$/, '') : null;
}

/**
 * Prices every instrument in the catalog ("Invest new money" only suggests instruments with a price), grouped by market; cash needs none.
 * Malformed codes (an instrument the user added could be anything) aren't requested: one malformed code makes the Worker reject the whole request. They have no price and are valued at cost.
 */
export function quoteRequest(instruments: readonly Instrument[]): QuoteRequest {
  const req: QuoteRequest = { us: [], cn: [], fund: [] };
  for (const i of instruments) {
    const market = MARKET_OF[i.market];
    if (market && !isCashCode(i.code) && QUOTE_CODE[market].test(i.code) && !req[market].includes(i.code)) req[market].push(i.code);
  }
  return req;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const isMarket = (v: unknown): v is QuoteMarket => MARKETS.includes(v as QuoteMarket);

function isQuote(v: unknown): v is LiveQuote {
  const q = obj(v);
  return (
    q !== null &&
    isMarket(q.market) &&
    typeof q.code === 'string' &&
    positive(q.price) &&
    (q.currency === 'USD' || q.currency === 'CNY') &&
    typeof q.asOf === 'string' &&
    typeof q.source === 'string' &&
    typeof q.stale === 'boolean'
  );
}

function isQuotesReply(v: unknown): v is QuotesReply {
  const r = obj(v);
  return (
    r !== null &&
    Array.isArray(r.quotes) &&
    r.quotes.every(isQuote) &&
    Array.isArray(r.missing) &&
    r.missing.every((m) => isMarket(obj(m)?.market) && typeof obj(m)?.code === 'string')
  );
}

function isFxReply(v: unknown): v is FxReply {
  const r = obj(v);
  const rates = obj(r?.rates);
  return r !== null && typeof r.date === 'string' && positive(rates?.USD) && positive(rates?.HKD) && typeof r.source === 'string' && typeof r.stale === 'boolean';
}

export function createQuotesApi(base: string, fetchImpl: typeof fetch = (input, init) => fetch(input, init)): QuotesApi {
  const get = async (path: string): Promise<unknown> => {
    const res = await fetchImpl(`${base}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Quotes service returned ${res.status}`);
    return res.json();
  };
  return {
    async quotes(req) {
      const params = MARKETS.filter((m) => req[m].length > 0).map((m) => `${m}=${req[m].map(encodeURIComponent).join(',')}`);
      if (params.length === 0) return { quotes: [], missing: [] };
      const body = await get(`/quote?${params.join('&')}`);
      if (!isQuotesReply(body)) throw new Error('Unexpected reply from the quotes service');
      return body;
    },
    async fx(date) {
      const body = await get(date ? `/fx?date=${encodeURIComponent(date)}` : '/fx');
      if (!isFxReply(body)) throw new Error('Unexpected reply from the exchange rate service');
      return body;
    },
  };
}

/** How many CNY 1 USD was worth on a given day, for an offline transaction before upload; null when it can't be found (offline, an API error, only an old cached value) */
export async function usdCnyOn(api: QuotesApi | null, date: string): Promise<number | null> {
  if (!api) return null;
  try {
    const r = await api.fx(date);
    return r.stale ? null : r.rates.USD;
  } catch {
    return null;
  }
}

let configured: QuotesApi | null = null;

/** Set at start-up (boot); before that and in tests there is none, and refresh does nothing */
export function setQuotesApi(api: QuotesApi | null): void {
  configured = api;
}

export function getQuotesApi(): QuotesApi | null {
  return configured;
}
