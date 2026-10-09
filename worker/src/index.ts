import { beijingDate } from '../../src/domain/dates';
import { QUOTE_CODE } from '../../src/domain/quoteCodes';
import { getFx, getQuotes } from './cache';
import type { CacheDeps } from './cache';
import { runDailySnapshots } from './daily';
import { newBudget } from './providers';
import type { Fetch, Kv, MarketKind } from './types';

// A relay for quotes and exchange rates. The front end allowed to read cross-origin is set in APP_ORIGIN in wrangler.jsonc.
//   GET /quote?us=VOO,BRK.B&cn=513500&fund=050025 → { quotes: [{ market, code, price, currency, asOf, source, stale }], missing: [{ market, code }] }
//   GET /fx[?date=YYYY-MM-DD]                      → { date, rates: { USD, HKD }, source, stale } (CNY per unit of foreign currency)
//   GET /health                                    → { ok: true }
// Parameters are split by market: a 6-digit code can't tell an A-share from a mutual fund (000001 is both).
// Scheduled: daily snapshots at 06:00 Beijing time, with a rerun at 07:00 (see daily.ts).

export interface Env {
  QUOTES: Kv;
  /** A var in wrangler.jsonc: the front end's production address, allowed to read cross-origin; separate several with commas */
  APP_ORIGIN?: string;
  /** A var in wrangler.jsonc */
  SUPABASE_URL?: string;
  /** wrangler secret put SUPABASE_SECRET_KEY; only in the Worker, never in git */
  SUPABASE_SECRET_KEY?: string;
}

/** 06:00 Beijing time */
export const DAILY_CRON = '0 22 * * *';
/** 07:00 Beijing time: only users still without a snapshot */
export const RETRY_CRON = '0 23 * * *';

export interface Deps {
  fetch: Fetch;
  now: () => Date;
}

const MARKETS: MarketKind[] = ['us', 'cn', 'fund'];
const MAX_CODES = 100;
/** frankfurter's (ECB) data starts on this day */
const FIRST_FX_DATE = '1999-01-04';

/** Development pages on this machine and the LAN are always allowed; the front end's production address comes from APP_ORIGIN */
const DEV_ORIGINS = [
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
  // LAN: opening the computer's dev page on a phone
  /^http:\/\/(10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2})(:\d+)?$/,
];

class BadRequest extends Error {}

function appOrigins(env: Env): string[] {
  return (env.APP_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  if (!origin || !(appOrigins(env).includes(origin) || DEV_ORIGINS.some((re) => re.test(origin)))) return {};
  return { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

function readCodes(url: URL): Record<MarketKind, string[]> {
  const out = { us: [], cn: [], fund: [] } as Record<MarketKind, string[]>;
  for (const market of MARKETS) {
    const raw = url.searchParams.get(market);
    if (raw === null) continue;
    const codes = [...new Set(raw.split(',').map((c) => c.trim()).filter(Boolean))];
    if (codes.length > MAX_CODES) throw new BadRequest(`${market}: at most ${MAX_CODES} codes`);
    const bad = codes.find((c) => !QUOTE_CODE[market].test(c));
    if (bad !== undefined) throw new BadRequest(`Bad code format: ${market}=${bad}`);
    out[market] = codes;
  }
  if (MARKETS.every((m) => out[m].length === 0)) throw new BadRequest('No codes');
  return out;
}

function readDate(url: URL, today: string): string | null {
  const date = url.searchParams.get('date');
  if (date === null) return null;
  const t = Date.parse(`${date}T00:00:00Z`);
  const real = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === date;
  if (!real || date < FIRST_FX_DATE || date > today) throw new BadRequest(`Bad date: ${date}`);
  return date;
}

async function quote(url: URL, deps: CacheDeps) {
  const codes = readCodes(url);
  const groups = await Promise.all(MARKETS.map(async (market) => ({ market, ...(codes[market].length ? await getQuotes(market, codes[market], deps) : { quotes: [], missing: [] }) })));
  return {
    quotes: groups.flatMap((g) => g.quotes.map((q) => ({ market: g.market, ...q }))),
    missing: groups.flatMap((g) => g.missing.map((code) => ({ market: g.market, code }))),
  };
}

export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (request.method === 'OPTIONS') {
    const allow: Record<string, string> = cors['Access-Control-Allow-Origin']
      ? { 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' }
      : {};
    return new Response(null, { status: 204, headers: { ...cors, ...allow } });
  }
  try {
    const url = new URL(request.url);
    const known = ['/quote', '/fx', '/health'].includes(url.pathname);
    if (!known) return json({ error: 'not_found' }, 404, cors);
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { ...cors, Allow: 'GET, OPTIONS' });
    if (url.pathname === '/health') return json({ ok: true }, 200, cors);

    const now = deps.now();
    const cacheDeps: CacheDeps = { kv: env.QUOTES, fetch: deps.fetch, now: () => now, budget: newBudget() };
    if (url.pathname === '/quote') return json(await quote(url, cacheDeps), 200, cors);

    const date = readDate(url, beijingDate(now));
    let fx;
    try {
      fx = await getFx(date, cacheDeps);
    } catch {
      return json({ error: 'unavailable' }, 503, cors);
    }
    return json({ date: fx.date, rates: { USD: fx.usd, HKD: fx.hkd }, source: fx.source, stale: fx.stale }, 200, cors);
  } catch (e) {
    if (e instanceof BadRequest) return json({ error: 'bad_request', message: e.message }, 400, cors);
    return json({ error: 'internal' }, 500, cors);
  }
}

export async function scheduled(cron: string, env: Env, deps: Deps): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    console.log('Snapshots: Supabase is not configured (SUPABASE_URL, SUPABASE_SECRET_KEY); skipping');
    return;
  }
  await runDailySnapshots({ QUOTES: env.QUOTES, SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY }, deps, cron === RETRY_CRON ? 'missing' : 'all');
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env, { fetch: (url, init) => fetch(url, init), now: () => new Date() });
  },
  scheduled(controller: { cron: string; scheduledTime: number }, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): void {
    ctx.waitUntil(scheduled(controller.cron, env, { fetch: (url, init) => fetch(url, init), now: () => new Date(controller.scheduledTime) }));
  },
};
