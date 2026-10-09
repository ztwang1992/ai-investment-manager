import { fetchFxLatest, fetchFxOn, fetchKind } from './providers';
import type { Budget, FxRates } from './providers';
import { freshUntil } from './sessions';
import type { Fetch, Kv, MarketKind, Quote } from './types';

// KV cache: one key per market (quotes:us, quotes:cn, quotes:fund), and rates under fx:latest and fx:YYYY-MM-DD.
// The free plan allows at most 1,000 writes a day, so a request writes each key at most once. When every source is down, the old cached value is returned, marked stale.

export interface CacheDeps {
  kv: Kv;
  fetch: Fetch;
  now: () => Date;
  /** How many outside requests this request can still make, shared by all markets and rates */
  budget: Budget;
}

export type ServedQuote = Quote & { stale: boolean };
export type ServedFx = FxRates & { stale: boolean };
type Cached<T> = T & { fetchedAt: string };

async function read<T>(kv: Kv, key: string): Promise<T | null> {
  try {
    const raw = await kv.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function write(kv: Kv, key: string, value: unknown): Promise<void> {
  try {
    await kv.put(key, JSON.stringify(value));
  } catch {
    // Can't write (e.g. over the daily free quota): don't cache this time; the result is returned as usual
  }
}

const quoteOf = (c: Quote): Quote => ({ code: c.code, price: c.price, currency: c.currency, asOf: c.asOf, source: c.source });
const fxOf = (c: FxRates): FxRates => ({ date: c.date, usd: c.usd, hkd: c.hkd, source: c.source });

export async function getQuotes(kind: MarketKind, codes: string[], deps: CacheDeps): Promise<{ quotes: ServedQuote[]; missing: string[] }> {
  const key = `quotes:${kind}`;
  const cache = (await read<Record<string, Cached<Quote>>>(deps.kv, key)) ?? {};
  const now = deps.now().getTime();
  const isFresh = (c: Cached<Quote> | undefined): c is Cached<Quote> => c !== undefined && now < freshUntil(kind, Date.parse(c.fetchedAt));

  const got = new Map<string, Quote>();
  const due = codes.filter((code) => !isFresh(cache[code]));
  if (due.length > 0) {
    for (const q of (await fetchKind(kind, due, deps.fetch, deps.budget)).quotes) got.set(q.code, q);
    if (got.size > 0) {
      const fetchedAt = new Date(now).toISOString();
      const next = { ...cache };
      for (const q of got.values()) next[q.code] = { ...q, fetchedAt };
      await write(deps.kv, key, next);
    }
  }

  const quotes: ServedQuote[] = [];
  const missing: string[] = [];
  for (const code of codes) {
    const fresh = got.get(code);
    const cached = cache[code];
    if (fresh) quotes.push({ ...fresh, stale: false });
    else if (cached) quotes.push({ ...quoteOf(cached), stale: !isFresh(cached) });
    else missing.push(code);
  }
  return { quotes, missing };
}

/** date is null for the current rate. A past day's value no longer changes once that day has ended (UTC), so the cached one is used for good. */
export async function getFx(date: string | null, deps: CacheDeps): Promise<ServedFx> {
  const key = date ? `fx:${date}` : 'fx:latest';
  const cached = await read<Cached<FxRates>>(deps.kv, key);
  const now = deps.now().getTime();
  if (cached) {
    const settled = date !== null && cached.fetchedAt.slice(0, 10) > date;
    if (settled || now < freshUntil('fx', Date.parse(cached.fetchedAt))) return { ...fxOf(cached), stale: false };
  }
  try {
    const r = date ? await fetchFxOn(date, deps.fetch, deps.budget) : await fetchFxLatest(deps.fetch, deps.budget);
    await write(deps.kv, key, { ...r, fetchedAt: new Date(now).toISOString() });
    return { ...r, stale: false };
  } catch (e) {
    if (cached) return { ...fxOf(cached), stale: true };
    throw e;
  }
}
