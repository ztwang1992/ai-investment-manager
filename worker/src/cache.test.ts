import { describe, expect, it } from 'vitest';
import { getFx, getQuotes } from './cache';
import type { CacheDeps } from './cache';
import { newBudget } from './providers';
import { FRANKFURTER_LATEST, FRANKFURTER_WEEKEND, TENCENT } from './testdata';
import type { Fetch } from './types';

const MIN = 60_000;

/** A fake KV, fake data sources, an adjustable clock */
function setup(start: string) {
  const map = new Map<string, string>();
  let puts = 0;
  let putFails = false;
  let getFails = false;
  let sourcesDown = false;
  let now = Date.parse(start);
  const upstream: string[] = [];
  const fetch: Fetch = async (input) => {
    const url = new URL(input);
    upstream.push(url.hostname);
    if (sourcesDown) throw new TypeError('network down');
    if (url.hostname === 'qt.gtimg.cn') return new Response(TENCENT);
    if (url.hostname === 'api.frankfurter.dev') {
      return Response.json(url.pathname === '/v1/2026-09-27' ? FRANKFURTER_WEEKEND : FRANKFURTER_LATEST);
    }
    return new Response('', { status: 404 });
  };
  const deps = (): CacheDeps => ({
    kv: {
      get: async (key) => {
        if (getFails) throw new Error('KV unavailable');
        return map.get(key) ?? null;
      },
      put: async (key, value) => {
        puts += 1;
        if (putFails) throw new Error('KV put limit exceeded');
        map.set(key, value);
      },
    },
    fetch,
    now: () => new Date(now),
    budget: newBudget(),
  });
  return {
    deps,
    upstream,
    map,
    puts: () => puts,
    later: (ms: number) => {
      now += ms;
    },
    breakSources: () => {
      sourcesDown = true;
    },
    breakPuts: () => {
      putFails = true;
    },
    breakGets: () => {
      getFails = true;
    },
  };
}

describe('quote cache', () => {
  it('answers from the cache for 15 minutes in session', async () => {
    const t = setup('2026-09-30T15:00:00Z'); // 11:00 EDT
    const first = await getQuotes('us', ['VOO'], t.deps());
    expect(first.quotes).toEqual([{ code: 'VOO', price: 700.86, currency: 'USD', asOf: '2026-09-30T20:00:01.000Z', source: 'tencent', stale: false }]);
    t.later(14 * MIN);
    expect((await getQuotes('us', ['VOO'], t.deps())).quotes[0]!.stale).toBe(false);
    expect(t.upstream).toHaveLength(1);
    t.later(2 * MIN);
    await getQuotes('us', ['VOO'], t.deps());
    expect(t.upstream).toHaveLength(2);
  });

  it('keeps the closing price for 6 hours', async () => {
    const t = setup('2026-09-30T20:40:00Z'); // 16:40 EDT
    await getQuotes('us', ['VOO'], t.deps());
    t.later(359 * MIN);
    await getQuotes('us', ['VOO'], t.deps());
    expect(t.upstream).toHaveLength(1);
    t.later(2 * MIN);
    await getQuotes('us', ['VOO'], t.deps());
    expect(t.upstream).toHaveLength(2);
  });

  it('asks only for the codes that are not fresh', async () => {
    const t = setup('2026-09-30T15:00:00Z');
    await getQuotes('us', ['VOO'], t.deps());
    const both = await getQuotes('us', ['VOO', 'BRK.B'], t.deps());
    expect(both.quotes.map((q) => q.code)).toEqual(['VOO', 'BRK.B']);
    expect(JSON.parse(t.map.get('quotes:us')!)).toHaveProperty('BRK.B');
    expect(JSON.parse(t.map.get('quotes:us')!)).toHaveProperty('VOO');
  });

  it('serves the last price marked stale when every source fails', async () => {
    const t = setup('2026-09-30T15:00:00Z');
    await getQuotes('us', ['VOO'], t.deps());
    t.breakSources();
    t.later(20 * MIN);
    const r = await getQuotes('us', ['VOO', 'QQQ'], t.deps());
    expect(r.quotes).toEqual([{ code: 'VOO', price: 700.86, currency: 'USD', asOf: '2026-09-30T20:00:01.000Z', source: 'tencent', stale: true }]);
    expect(r.missing).toEqual(['QQQ']);
  });

  it('writes the cache once per request, and not at all when nothing came back', async () => {
    const t = setup('2026-09-30T15:00:00Z');
    await getQuotes('us', ['VOO', 'BRK.B'], t.deps());
    expect(t.puts()).toBe(1);
    t.later(20 * MIN);
    t.breakSources();
    await getQuotes('us', ['VOO', 'BRK.B'], t.deps());
    expect(t.puts()).toBe(1);
  });

  // The free plan allows at most 1,000 writes a day; beyond that writes fail
  it('still answers when the cache cannot be written or read', async () => {
    const t = setup('2026-09-30T15:00:00Z');
    t.breakPuts();
    expect((await getQuotes('us', ['VOO'], t.deps())).quotes).toHaveLength(1);
    t.breakGets();
    expect((await getQuotes('us', ['VOO'], t.deps())).quotes).toHaveLength(1);
  });
});

describe('exchange rate cache', () => {
  it('serves the latest rates and refreshes them like quotes', async () => {
    const t = setup('2026-09-30T15:00:00Z');
    const r = await getFx(null, t.deps());
    expect(r).toMatchObject({ date: '2026-09-30', usd: 6.7045, source: 'frankfurter', stale: false });
    t.later(10 * MIN);
    await getFx(null, t.deps());
    expect(t.upstream).toHaveLength(1);
    t.later(10 * MIN);
    await getFx(null, t.deps());
    expect(t.upstream).toHaveLength(2);
  });

  it('keeps a past day for good once that day is over', async () => {
    const t = setup('2026-10-01T03:00:00Z');
    expect(await getFx('2026-09-27', t.deps())).toMatchObject({ date: '2026-09-25', usd: 6.7132, stale: false });
    t.later(3 * 24 * 60 * MIN);
    await getFx('2026-09-27', t.deps());
    expect(t.upstream).toHaveLength(1);
  });

  // On the morning of 10-01 in Beijing it's still 09-30 in UTC: that day's rate isn't published yet, so give the previous day's and check again later
  it('does not keep a day that is not over yet', async () => {
    const t = setup('2026-09-30T23:00:00Z');
    await getFx('2026-10-01', t.deps());
    t.later(20 * MIN);
    await getFx('2026-10-01', t.deps());
    expect(t.upstream).toHaveLength(2);
  });

  it('serves the last rates marked stale when every source fails, and fails with nothing cached', async () => {
    const t = setup('2026-09-30T15:00:00Z');
    await getFx(null, t.deps());
    t.breakSources();
    t.later(20 * MIN);
    expect(await getFx(null, t.deps())).toMatchObject({ usd: 6.7045, stale: true });
    await expect(getFx('2026-09-20', t.deps())).rejects.toThrow();
  });
});
