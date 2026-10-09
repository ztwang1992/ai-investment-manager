import { describe, expect, it } from 'vitest';
import { fetchFxLatest, fetchFxOn, fetchKind, newBudget, SUBREQUEST_BUDGET } from './providers';
import {
  F10,
  FRANKFURTER_LATEST,
  FRANKFURTER_WEEKEND,
  FUND_APP,
  SINA,
  TENCENT,
  YAHOO_513500,
  YAHOO_BRK,
  YAHOO_CNY,
  YAHOO_CNY_DAILY,
  YAHOO_HKD,
  YAHOO_HKD_DAILY,
  YAHOO_NOT_FOUND,
  YAHOO_VOO,
} from './testdata';
import type { Fetch } from './types';

type Reply = Response | Error;
type Route = (url: URL, headers: Headers) => Reply | undefined;

/** A fake fetch answering by URL; records each request and the most requests in flight at once */
function fakeFetch(...routes: Route[]) {
  const calls: { url: URL; headers: Headers }[] = [];
  let active = 0;
  let maxActive = 0;
  const fetch: Fetch = async (input, init) => {
    const url = new URL(input);
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 1));
    active -= 1;
    for (const route of routes) {
      const reply = route(url, headers);
      if (reply instanceof Error) throw reply;
      if (reply) return reply;
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls, hosts: () => calls.map((c) => c.url.hostname), maxActive: () => maxActive };
}

const text = (body: string) => new Response(new TextEncoder().encode(body));
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const host = (name: string, reply: (url: URL, headers: Headers) => Reply | undefined): Route => (url, headers) =>
  url.hostname === name ? reply(url, headers) : undefined;

const tencentOk = host('qt.gtimg.cn', () => text(TENCENT));
const tencentDown = host('qt.gtimg.cn', () => new Response('busy', { status: 502 }));
const sinaOk = host('hq.sinajs.cn', () => text(SINA));
const yahooBySymbol = (replies: Record<string, unknown>) =>
  host('query1.finance.yahoo.com', (url) => {
    const symbol = decodeURIComponent(url.pathname.split('/').pop()!);
    return symbol in replies ? json(replies[symbol]) : json(YAHOO_NOT_FOUND, 404);
  });

describe('quotes with fallback', () => {
  it('asks only the main source when it has everything', async () => {
    const f = fakeFetch(tencentOk);
    const r = await fetchKind('us', ['VOO', 'BRK.B'], f.fetch, newBudget());
    expect(r.missing).toEqual([]);
    expect(r.quotes).toEqual([
      { code: 'VOO', price: 700.86, currency: 'USD', asOf: '2026-09-30T20:00:01.000Z', source: 'tencent' },
      { code: 'BRK.B', price: 497.95, currency: 'USD', asOf: '2026-09-30T20:05:57.000Z', source: 'tencent' },
    ]);
    expect(f.hosts()).toEqual(['qt.gtimg.cn']);
    expect(f.calls[0]!.url.pathname).toBe('/q=usVOO,usBRK.B');
    expect(f.calls[0]!.headers.get('User-Agent')).toMatch(/Mozilla/);
  });

  it('reads A-share times as Beijing time', async () => {
    const f = fakeFetch(tencentOk);
    const r = await fetchKind('cn', ['513500'], f.fetch, newBudget());
    expect(r.quotes).toEqual([{ code: '513500', price: 2.688, currency: 'CNY', asOf: '2026-09-30T08:14:35.000Z', source: 'tencent' }]);
  });

  it('passes the codes one source lacks to the next', async () => {
    const f = fakeFetch(tencentOk, yahooBySymbol({ AAPL: { ...YAHOO_VOO, chart: { ...YAHOO_VOO.chart, result: [{ meta: { currency: 'USD', regularMarketPrice: 255.5, regularMarketTime: 1790798401 } }] } } }));
    const r = await fetchKind('us', ['VOO', 'AAPL'], f.fetch, newBudget());
    expect(r.missing).toEqual([]);
    expect(r.quotes.map((q) => [q.code, q.price, q.source])).toEqual([
      ['VOO', 700.86, 'tencent'],
      ['AAPL', 255.5, 'yahoo'],
    ]);
    expect(f.hosts()).toEqual(['qt.gtimg.cn', 'query1.finance.yahoo.com']);
  });

  it('moves the whole group on when the main source fails or times out', async () => {
    const f = fakeFetch(tencentDown, yahooBySymbol({ VOO: YAHOO_VOO, 'BRK-B': YAHOO_BRK }));
    const r = await fetchKind('us', ['VOO', 'BRK.B'], f.fetch, newBudget());
    expect(r.quotes.map((q) => [q.code, q.source])).toEqual([
      ['VOO', 'yahoo'],
      ['BRK.B', 'yahoo'],
    ]);
    const slow = fakeFetch(host('qt.gtimg.cn', () => new DOMException('timed out', 'TimeoutError')), yahooBySymbol({ '513500.SS': YAHOO_513500 }));
    const cn = await fetchKind('cn', ['513500'], slow.fetch, newBudget());
    expect(cn.quotes).toEqual([{ code: '513500', price: 2.688, currency: 'CNY', asOf: '2026-09-30T07:00:00.000Z', source: 'yahoo' }]);
  });

  it('asks Sina last, with the referer it requires', async () => {
    const f = fakeFetch(tencentDown, yahooBySymbol({}), sinaOk);
    const r = await fetchKind('us', ['VOO', 'BRK.B'], f.fetch, newBudget());
    expect(r.quotes).toEqual([
      { code: 'VOO', price: 700.86, currency: 'USD', asOf: '2026-10-01T01:42:58.000Z', source: 'sina' },
      { code: 'BRK.B', price: 497.95, currency: 'USD', asOf: '2026-10-01T01:46:25.000Z', source: 'sina' },
    ]);
    const sina = f.calls.find((c) => c.url.hostname === 'hq.sinajs.cn')!;
    expect(sina.url.pathname).toBe('/list=gb_voo,gb_brk$b');
    expect(sina.headers.get('Referer')).toBe('https://finance.sina.com.cn');
    const cn = await fetchKind('cn', ['513500'], fakeFetch(tencentDown, sinaOk).fetch, newBudget());
    expect(cn.quotes).toEqual([{ code: '513500', price: 2.688, currency: 'CNY', asOf: '2026-09-30T07:34:59.000Z', source: 'sina' }]);
  });

  it('reports every code as missing when all sources fail', async () => {
    const f = fakeFetch(() => new TypeError('network down'));
    const r = await fetchKind('us', ['VOO', 'QQQ'], f.fetch, newBudget());
    expect(r).toEqual({ quotes: [], missing: ['VOO', 'QQQ'] });
  });

  it('gives fund NAVs with their NAV date, falling back through the Tiantian APIs', async () => {
    const f = fakeFetch(
      host('hq.sinajs.cn', () => text('var hq_str_f_050025="";\nvar hq_str_f_000216="????ETF??A,3.1359,3.1359,3.103,2026-09-30,31.9511";\n')),
      host('fundmobapi.eastmoney.com', () => json({ ...FUND_APP, Datas: [] })),
      host('api.fund.eastmoney.com', (url, headers) => (url.searchParams.get('fundCode') === '050025' && headers.get('Referer') === 'https://fundf10.eastmoney.com/' ? json(F10) : undefined)),
    );
    const r = await fetchKind('fund', ['000216', '050025'], f.fetch, newBudget());
    expect(r.quotes).toEqual([
      { code: '000216', price: 3.1359, currency: 'CNY', asOf: '2026-09-30', source: 'sina' },
      { code: '050025', price: 5.563, currency: 'CNY', asOf: '2026-09-29', source: 'f10' },
    ]);
    expect(f.hosts()).toEqual(['hq.sinajs.cn', 'fundmobapi.eastmoney.com', 'api.fund.eastmoney.com']);
    const app = fakeFetch(host('hq.sinajs.cn', () => new Response('', { status: 503 })), host('fundmobapi.eastmoney.com', () => json(FUND_APP)));
    const viaApp = await fetchKind('fund', ['050025'], app.fetch, newBudget());
    expect(viaApp.quotes).toEqual([{ code: '050025', price: 5.563, currency: 'CNY', asOf: '2026-09-29', source: 'fundapp' }]);
  });

  // The free plan allows at most 50 outside requests per request. With Tencent down, Yahoo can only look up one code at a time and must leave a few for Sina, which looks up many at once
  it('stays within the subrequest budget and leaves room for Sina', async () => {
    const codes = Array.from({ length: 60 }, (_, i) => `T${i}`);
    const anyYahoo = host('query1.finance.yahoo.com', () => json({ chart: { result: [{ meta: { currency: 'USD', regularMarketPrice: 10, regularMarketTime: 1790798401 } }] } }));
    const anySina = host('hq.sinajs.cn', (url) =>
      text(url.pathname.slice('/list='.length).split(',').map((s) => `var hq_str_${s}="X,20.0000,0.1,2026-10-01 09:42:58,0";`).join('\n')),
    );
    const f = fakeFetch(tencentDown, anyYahoo, anySina);
    const budget = newBudget();
    const r = await fetchKind('us', codes, f.fetch, budget);
    expect(r.missing).toEqual([]);
    expect(r.quotes).toHaveLength(60);
    expect(f.calls.length).toBeLessThanOrEqual(SUBREQUEST_BUDGET);
    expect(f.hosts().at(-1)).toBe('hq.sinajs.cn');
    expect(r.quotes.filter((q) => q.source === 'sina').length).toBeGreaterThan(0);
    expect(f.maxActive()).toBeLessThanOrEqual(4);
    expect(budget.left).toBeGreaterThanOrEqual(0);
  });

  it('sends nothing once the budget is spent', async () => {
    const f = fakeFetch(tencentOk);
    const r = await fetchKind('us', ['VOO'], f.fetch, { left: 0 });
    expect(r.missing).toEqual(['VOO']);
    expect(f.calls).toHaveLength(0);
  });
});

describe('exchange rates with fallback', () => {
  const frankfurter = (reply: (url: URL) => Reply | undefined) => host('api.frankfurter.dev', reply);

  it('takes the latest ECB rates from frankfurter', async () => {
    const f = fakeFetch(frankfurter(() => json(FRANKFURTER_LATEST)));
    const r = await fetchFxLatest(f.fetch, newBudget());
    expect(r).toMatchObject({ date: '2026-09-30', usd: 6.7045, source: 'frankfurter' });
    expect(r.hkd).toBeCloseTo(6.7045 / 7.8463, 10);
    expect(f.calls[0]!.url.pathname + f.calls[0]!.url.search).toBe('/v1/latest?base=USD&symbols=CNY,HKD');
  });

  it('falls back to Yahoo, then to Sina', async () => {
    const down = frankfurter(() => new Response('', { status: 500 }));
    const y = await fetchFxLatest(fakeFetch(down, yahooBySymbol({ 'CNY=X': YAHOO_CNY, 'HKDCNY=X': YAHOO_HKD })).fetch, newBudget());
    expect(y).toEqual({ date: '2026-09-30', usd: 6.7052, hkd: 0.8545, source: 'yahoo' });
    const s = await fetchFxLatest(fakeFetch(down, yahooBySymbol({}), sinaOk).fetch, newBudget());
    expect(s).toEqual({ date: '2026-10-01', usd: 6.705, hkd: 0.8544890583, source: 'sina' });
    await expect(fetchFxLatest(fakeFetch(() => new TypeError('offline')).fetch, newBudget())).rejects.toThrow();
  });

  it('looks up a past day, taking the date the source answers for', async () => {
    const f = fakeFetch(frankfurter((url) => (url.pathname === '/v1/2026-09-27' ? json(FRANKFURTER_WEEKEND) : undefined)));
    const r = await fetchFxOn('2026-09-27', f.fetch, newBudget());
    expect(r).toMatchObject({ date: '2026-09-25', usd: 6.7132, source: 'frankfurter' });
  });

  it('reads a past day from Yahoo daily bars when frankfurter is down', async () => {
    const f = fakeFetch(frankfurter(() => new TypeError('down')), yahooBySymbol({ 'CNY=X': YAHOO_CNY_DAILY, 'HKDCNY=X': YAHOO_HKD_DAILY }));
    // The close of the 09-28 bar is empty: take the nearest day before it
    expect(await fetchFxOn('2026-09-28', f.fetch, newBudget())).toEqual({ date: '2026-09-25', usd: 6.7132, hkd: 0.8558, source: 'yahoo' });
    expect(await fetchFxOn('2026-09-29', f.fetch, newBudget())).toEqual({ date: '2026-09-29', usd: 6.706, hkd: 0.8547, source: 'yahoo' });
    const yahoo = f.calls.find((c) => c.url.hostname === 'query1.finance.yahoo.com')!;
    expect(Number(yahoo.url.searchParams.get('period2'))).toBeGreaterThan(Date.parse('2026-09-28T00:00:00Z') / 1000);
  });
});
