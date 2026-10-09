import { describe, expect, it, vi } from 'vitest';
import type { Instrument } from '../domain/types';
import { apiBase, createQuotesApi, quoteRequest, usdCnyOn } from './quotesApi';
import type { QuotesApi } from './quotesApi';

const inst = (code: string, market: Instrument['market'], currency: Instrument['currency'] = 'CNY'): Instrument => ({
  code,
  name: code,
  market,
  currency,
  exposureId: 'x',
  paysDividend: false,
});

const QUOTES = {
  quotes: [
    { market: 'us', code: 'VOO', price: 700.86, currency: 'USD', asOf: '2026-09-30T20:00:01.000Z', source: 'tencent', stale: false },
    { market: 'fund', code: '050025', price: 5.563, currency: 'CNY', asOf: '2026-09-29', source: 'sina', stale: false },
  ],
  missing: [{ market: 'cn', code: '513500' }],
};
const FX = { date: '2026-09-30', rates: { USD: 6.7045, HKD: 0.8545 }, source: 'frankfurter', stale: false };

function api(reply: unknown, status = 200) {
  const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(reply), { status }));
  return { fetch, api: createQuotesApi('https://api.example.test', fetch as unknown as typeof globalThis.fetch) };
}

describe('quote request', () => {
  // "Invest new money" only suggests instruments with a price, so every instrument in the catalog is priced, not only those held
  it('asks for every instrument in the catalog, grouped by market, without cash', () => {
    const req = quoteRequest([
      inst('VOO', '美股', 'USD'),
      inst('BRK.B', '美股', 'USD'),
      inst('513500', 'A股'),
      inst('050025', '场外基金'),
      inst('USD', '现金', 'USD'),
      inst('VOO', '美股', 'USD'),
    ]);
    expect(req).toEqual({ us: ['VOO', 'BRK.B'], cn: ['513500'], fund: ['050025'] });
  });
});

describe('quote request with codes the Worker cannot read', () => {
  // Codes added in "Add record" are only uppercased and could be in any format; one malformed code makes the Worker reject the whole request
  it('leaves them out instead of failing the whole refresh', () => {
    const req = quoteRequest([
      inst('VOO', '美股', 'USD'),
      inst('00700.HK', '美股', 'USD'),
      inst('BRK B', '美股', 'USD'),
      inst('12345', 'A股'),
      inst('513500', 'A股'),
      inst('F050025', '场外基金'),
    ]);
    // 00700.HK is well-formed; the data sources just don't know it, so it counts as not fetched and doesn't affect the others
    expect(req).toEqual({ us: ['VOO', '00700.HK'], cn: ['513500'], fund: [] });
  });
});

describe('quotes API client', () => {
  it('asks the Worker for quotes by market and reads the reply', async () => {
    const { fetch, api: client } = api(QUOTES);
    expect(await client.quotes({ us: ['VOO', 'BRK.B'], cn: ['513500'], fund: ['050025'] })).toEqual(QUOTES);
    expect(fetch.mock.calls[0]![0]).toBe('https://api.example.test/quote?us=VOO,BRK.B&cn=513500&fund=050025');
    expect(fetch.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not call the Worker when there is nothing to price', async () => {
    const { fetch, api: client } = api(QUOTES);
    expect(await client.quotes({ us: [], cn: [], fund: [] })).toEqual({ quotes: [], missing: [] });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks for exchange rates now or on a given day', async () => {
    const { fetch, api: client } = api(FX);
    expect(await client.fx()).toEqual(FX);
    await client.fx('2026-09-27');
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['https://api.example.test/fx', 'https://api.example.test/fx?date=2026-09-27']);
  });

  it('fails on an error status or a reply it cannot read', async () => {
    await expect(api({ error: 'unavailable' }, 503).api.fx()).rejects.toThrow();
    await expect(api({ quotes: 'x' }).api.quotes({ us: ['VOO'], cn: [], fund: [] })).rejects.toThrow();
    await expect(api({ ...QUOTES, quotes: [{ ...QUOTES.quotes[0], price: 'cheap' }] }).api.quotes({ us: ['VOO'], cn: [], fund: [] })).rejects.toThrow();
    await expect(api({ ...FX, rates: { USD: 6.7 } }).api.fx()).rejects.toThrow();
  });
});

describe('API address', () => {
  // Open source: no default to the author's Worker; without an address there's no quotes API
  it('has no quotes service until VITE_API_BASE names one', () => {
    expect(apiBase({})).toBeNull();
    expect(apiBase({ VITE_API_BASE: ' ' })).toBeNull();
    expect(apiBase({ VITE_API_BASE: 'http://localhost:8787/' })).toBe('http://localhost:8787');
  });
});

describe('dollar rate of a given day', () => {
  const withFx = (fx: QuotesApi['fx']): QuotesApi => ({ quotes: async () => ({ quotes: [], missing: [] }), fx });

  it('gives the rate the Worker found for that day', async () => {
    const fx = vi.fn(async () => FX);
    expect(await usdCnyOn(withFx(fx), '2026-09-27')).toBe(6.7045);
    expect(fx).toHaveBeenCalledWith('2026-09-27');
  });

  // When it can't be found (offline, an API error, only an old cached value), leave it out for now; the next sync tries again
  it('gives null when the rate cannot be confirmed', async () => {
    expect(await usdCnyOn(null, '2026-09-27')).toBeNull();
    expect(await usdCnyOn(withFx(async () => Promise.reject(new TypeError('Failed to fetch'))), '2026-09-27')).toBeNull();
    expect(await usdCnyOn(withFx(async () => ({ ...FX, stale: true })), '2026-09-27')).toBeNull();
  });
});
