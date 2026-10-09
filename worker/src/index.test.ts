import { describe, expect, it } from 'vitest';
import { DAILY_CRON, handle, RETRY_CRON, scheduled } from './index';
import { createFakeSupabase, SUPABASE_URL } from './testsupabase';
import { FRANKFURTER_LATEST, FRANKFURTER_WEEKEND, SINA, TENCENT } from './testdata';
import type { Fetch, Kv } from './types';

// 11:00 on 2026-10-01, Beijing time
const NOW = new Date('2026-10-01T03:00:00Z');

function setup(opts: { down?: boolean; now?: () => Date; appOrigin?: string } = {}) {
  const map = new Map<string, string>();
  const kv: Kv = { get: async (k) => map.get(k) ?? null, put: async (k, v) => void map.set(k, v) };
  const fetch: Fetch = async (input) => {
    const url = new URL(input);
    if (opts.down) throw new TypeError('network down');
    if (url.hostname === 'qt.gtimg.cn') return new Response(TENCENT);
    if (url.hostname === 'hq.sinajs.cn') return new Response(SINA);
    if (url.hostname === 'api.frankfurter.dev') return Response.json(url.pathname === '/v1/2026-09-27' ? FRANKFURTER_WEEKEND : FRANKFURTER_LATEST);
    return new Response('', { status: 404 });
  };
  const env = { QUOTES: kv, ...(opts.appOrigin === undefined ? {} : { APP_ORIGIN: opts.appOrigin }) };
  const call = (path: string, init: RequestInit = {}) =>
    handle(new Request(`https://api.example.com${path}`, init), env, { fetch, now: opts.now ?? (() => NOW) });
  return { call };
}

describe('GET /quote', () => {
  it('answers all three markets in one request', async () => {
    const res = await setup().call('/quote?us=VOO,BRK.B&cn=513500&fund=050025');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({
      quotes: [
        { market: 'us', code: 'VOO', price: 700.86, currency: 'USD', asOf: '2026-09-30T20:00:01.000Z', source: 'tencent', stale: false },
        { market: 'us', code: 'BRK.B', price: 497.95, currency: 'USD', asOf: '2026-09-30T20:05:57.000Z', source: 'tencent', stale: false },
        { market: 'cn', code: '513500', price: 2.688, currency: 'CNY', asOf: '2026-09-30T08:14:35.000Z', source: 'tencent', stale: false },
        { market: 'fund', code: '050025', price: 5.563, currency: 'CNY', asOf: '2026-09-29', source: 'sina', stale: false },
      ],
      missing: [],
    });
  });

  // The same 6-digit code can be both an A-share and a fund; market tells them apart
  it('keeps the same code apart in different markets, and lists what no source knows', async () => {
    const res = await setup().call('/quote?us=VOO,NOPE&cn=000216&fund=000216');
    const body = (await res.json()) as { quotes: { market: string; code: string }[]; missing: unknown[] };
    expect(body.quotes.map((q) => `${q.market}:${q.code}`)).toEqual(['us:VOO', 'fund:000216']);
    expect(body.missing).toEqual([
      { market: 'us', code: 'NOPE' },
      { market: 'cn', code: '000216' },
    ]);
  });

  it('rejects requests it cannot read', async () => {
    const { call } = setup();
    const many = Array.from({ length: 101 }, (_, i) => String(100000 + i)).join(',');
    for (const path of ['/quote', '/quote?us=', '/quote?cn=51350', '/quote?fund=abc', '/quote?us=VOO;DROP', '/quote?us=voo', `/quote?cn=${many}`]) {
      const res = await call(path);
      expect(res.status, path).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'bad_request' });
    }
  });
});

describe('GET /fx', () => {
  it('gives CNY per dollar and per Hong Kong dollar, now and on a past day', async () => {
    const { call } = setup();
    const now = await (await call('/fx')).json();
    expect(now).toEqual({ date: '2026-09-30', rates: { USD: 6.7045, HKD: 6.7045 / 7.8463 }, source: 'frankfurter', stale: false });
    expect(await (await call('/fx?date=2026-09-27')).json()).toMatchObject({ date: '2026-09-25', rates: { USD: 6.7132 } });
    // Today (Beijing time) can be looked up too
    expect((await call('/fx?date=2026-10-01')).status).toBe(200);
  });

  it('rejects a date it cannot answer', async () => {
    const { call } = setup();
    for (const date of ['2026-10-02', '2026-02-30', '1998-12-31', 'today']) {
      const res = await call(`/fx?date=${date}`);
      expect(res.status, date).toBe(400);
    }
  });

  it('says the rates are unavailable when no source answers and nothing is cached', async () => {
    const res = await setup({ down: true }).call('/fx');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
  });
});

describe('other requests', () => {
  it('answers /health, and 404 or 405 for anything else', async () => {
    const { call } = setup();
    expect(await (await call('/health')).json()).toEqual({ ok: true });
    expect((await call('/nope')).status).toBe(404);
    expect((await call('/quote?us=VOO', { method: 'POST' })).status).toBe(405);
  });

  it('hides the details of an internal error', async () => {
    const res = await setup({ now: () => { throw new Error('secret detail'); } }).call('/quote?us=VOO');
    expect(res.status).toBe(500);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ error: 'internal' });
    expect(body).not.toContain('secret');
  });
});

describe('cross-origin access', () => {
  const APP = 'https://app.example.com';
  /** appOrigin is APP_ORIGIN in wrangler.jsonc; null when not set */
  const origin = (value: string, method = 'GET', appOrigin: string | null = APP) =>
    setup(appOrigin === null ? {} : { appOrigin }).call('/health', { method, headers: { Origin: value } });

  it('lets the app and local development pages read the answers', async () => {
    for (const allowed of [APP, 'http://localhost:5173', 'http://127.0.0.1:5199', 'http://192.168.1.23:5173', 'http://10.0.0.8:5173', 'http://172.20.1.2:5173']) {
      const res = await origin(allowed);
      expect(res.headers.get('Access-Control-Allow-Origin'), allowed).toBe(allowed);
      expect(res.headers.get('Vary')).toBe('Origin');
    }
  });

  it('does not let other sites read them', async () => {
    for (const blocked of ['https://evil.example', 'http://app.example.com', 'https://app.example.com.evil.example', 'https://app.example.com:8443', 'http://172.32.0.1:5173']) {
      expect((await origin(blocked)).headers.get('Access-Control-Allow-Origin'), blocked).toBeNull();
    }
  });

  // The front end's address goes in APP_ORIGIN in wrangler.jsonc: someone deploying their own changes the config, not the code
  it('takes the app address from APP_ORIGIN, several separated by commas', async () => {
    const both = ' https://app.example.com/ , https://demo.example.com';
    for (const allowed of [APP, 'https://demo.example.com']) {
      expect((await origin(allowed, 'GET', both)).headers.get('Access-Control-Allow-Origin'), allowed).toBe(allowed);
    }
  });

  // No front-end address is built into the code
  it('only lets local development pages in when APP_ORIGIN is not set', async () => {
    for (const blocked of [APP, 'https://invest.example.org']) {
      expect((await origin(blocked, 'GET', null)).headers.get('Access-Control-Allow-Origin'), blocked).toBeNull();
    }
    expect((await origin('http://localhost:5173', 'GET', null)).headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('answers preflight requests', async () => {
    const ok = await origin(APP, 'OPTIONS');
    expect(ok.status).toBe(204);
    expect(ok.headers.get('Access-Control-Allow-Methods')).toBe('GET, OPTIONS');
    const no = await origin('https://evil.example', 'OPTIONS');
    expect(no.status).toBe(204);
    expect(no.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('scheduled snapshots', () => {
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const kv: Kv = { get: async () => null, put: async () => {} };

  it('runs the full job at 22:00 UTC and the catch-up at 23:00 UTC', async () => {
    const tables = () => createFakeSupabase({ accounts: [{ user_id: A, id: 'cmb' }] });
    for (const [cron, checksExisting] of [
      [DAILY_CRON, false],
      [RETRY_CRON, true],
    ] as const) {
      const db = tables();
      const fetch: Fetch = async (input, init) => db.handle(new URL(input), init) ?? new Response('', { status: 404 });
      await scheduled(cron, { QUOTES: kv, SUPABASE_URL, SUPABASE_SECRET_KEY: 'sb_secret_x' }, { fetch, now: () => new Date('2026-10-01T22:00:00Z') });
      expect(db.requests.some((r) => r.table === 'snapshots' && r.method === 'GET'), cron).toBe(checksExisting);
      expect(db.requests[0]!.table).toBe('accounts');
    }
  });

  it('does nothing until Supabase is set up', async () => {
    const calls: string[] = [];
    const fetch: Fetch = async (input) => {
      calls.push(input);
      return new Response('');
    };
    await scheduled(DAILY_CRON, { QUOTES: kv }, { fetch, now: () => NOW });
    await scheduled(DAILY_CRON, { QUOTES: kv, SUPABASE_URL }, { fetch, now: () => NOW });
    expect(calls).toEqual([]);
  });
});
