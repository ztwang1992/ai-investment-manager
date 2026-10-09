import { describe, expect, it } from 'vitest';
import { gbkAscii, parseFrankfurter, parseFundApp, parseFundF10, parseSina, parseTencent, parseYahoo, parseYahooDaily } from './parse';
import {
  F10,
  F10_EMPTY,
  FRANKFURTER_LATEST,
  FRANKFURTER_WEEKEND,
  FUND_APP,
  SINA,
  TENCENT,
  TENCENT_NONE,
  YAHOO_CNY_DAILY,
  YAHOO_NOT_FOUND,
  YAHOO_VOO,
} from './testdata';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe('GBK text', () => {
  it('keeps ASCII and turns each GBK character into one ?', () => {
    // 「标普」("S&P") in GBK = B1 EA C6 D5
    expect(gbkAscii(new Uint8Array([0xb1, 0xea, 0xc6, 0xd5, ...ascii('500ETF')]))).toBe('??500ETF');
    // A four-byte GB18030 character
    expect(gbkAscii(new Uint8Array([0x81, 0x30, 0x81, 0x30, ...ascii('A')]))).toBe('?A');
  });

  // 0x7E ("~") can also be the second byte of a GBK character; decoded byte by byte, it adds a separator and every later Tencent field shifts
  it('does not split a field on a GBK byte that looks like ~', () => {
    const bytes = new Uint8Array([...ascii('v_usX="200~'), 0x81, 0x7e, ...ascii('~X.N~1.5~";')]);
    expect(gbkAscii(bytes)).toBe('v_usX="200~?~X.N~1.5~";');
  });
});

describe('Tencent', () => {
  it('reads the price and the trade time', () => {
    const q = parseTencent(TENCENT);
    expect(q.get('usVOO')).toEqual({ price: 700.86, time: '2026-09-30 16:00:01' });
    expect(q.get('usBRK.B')).toEqual({ price: 497.95, time: '2026-09-30 16:05:57' });
    expect(q.get('sh513500')).toEqual({ price: 2.688, time: '20260930161435' });
    expect(q.get('sz159915')).toEqual({ price: 3.154, time: '20260930161421' });
    expect(q.size).toBe(5);
  });

  it('finds nothing for an unknown code, a zero price or a short line', () => {
    expect(parseTencent(TENCENT_NONE).size).toBe(0);
    const voo = TENCENT.split('\n')[0]!;
    expect(parseTencent(voo.replace('~700.86~', '~0.00~')).size).toBe(0);
    expect(parseTencent('v_usVOO="200~x~VOO.AM~700.86";').size).toBe(0);
  });
});

describe('Sina', () => {
  it('splits each line into fields', () => {
    const s = parseSina(SINA);
    expect(s.get('gb_voo')?.[1]).toBe('700.8600');
    expect(s.get('gb_brk$b')?.slice(1, 4)).toEqual(['497.9500', '-0.88', '2026-10-01 09:46:25']);
    expect(s.get('sh513500')?.[3]).toBe('2.688');
    expect(s.get('sh513500')?.slice(30, 32)).toEqual(['2026-09-30', '15:34:59']);
    expect(s.get('f_050025')?.[1]).toBe('5.563');
    expect(s.get('f_050025')?.[4]).toBe('2026-09-29');
    expect(s.get('fx_susdcny')?.[1]).toBe('6.7050000000');
    expect(s.get('fx_shkdcny')?.at(-1)).toBe('2026-10-01');
  });

  it('skips the empty lines it sends for unknown codes', () => {
    const s = parseSina(SINA);
    expect(s.has('gb_nope1')).toBe(false);
    expect(s.has('f_999999')).toBe(false);
    expect(s.size).toBe(8);
  });
});

describe('Yahoo', () => {
  it('reads the latest price, its time and currency', () => {
    expect(parseYahoo(YAHOO_VOO)).toEqual({ price: 700.86, time: '2026-09-30T20:00:01.000Z', currency: 'USD' });
  });

  it('finds nothing for an unknown symbol or a broken reply', () => {
    expect(parseYahoo(YAHOO_NOT_FOUND)).toBeNull();
    expect(parseYahoo({})).toBeNull();
    expect(parseYahoo({ chart: { result: [{ meta: { regularMarketPrice: 0, regularMarketTime: 1, currency: 'USD' } }] } })).toBeNull();
  });

  // FX daily bars are stamped 23:00 UTC the day before and must be aligned to the trading day; bars with no close are skipped
  it('dates daily FX bars by their trading day', () => {
    expect(parseYahooDaily(YAHOO_CNY_DAILY)).toEqual([
      { date: '2026-09-24', close: 6.712 },
      { date: '2026-09-25', close: 6.7132 },
      { date: '2026-09-29', close: 6.706 },
      { date: '2026-09-30', close: 6.7045 },
    ]);
    expect(parseYahooDaily(YAHOO_NOT_FOUND)).toEqual([]);
  });
});

describe('fund NAV', () => {
  it('reads NAV and its date from the Tiantian app API', () => {
    expect(parseFundApp(FUND_APP)).toEqual(
      new Map([
        ['050025', { nav: 5.563, date: '2026-09-29' }],
        ['000216', { nav: 3.1359, date: '2026-09-30' }],
      ]),
    );
    expect(parseFundApp({ Datas: null }).size).toBe(0);
  });

  it('reads NAV and its date from Tiantian F10', () => {
    expect(parseFundF10(F10)).toEqual({ nav: 5.563, date: '2026-09-29' });
    expect(parseFundF10(F10_EMPTY)).toBeNull();
  });
});

describe('frankfurter', () => {
  it('gives CNY per dollar and per Hong Kong dollar', () => {
    const r = parseFrankfurter(FRANKFURTER_LATEST)!;
    expect(r.date).toBe('2026-09-30');
    expect(r.usd).toBe(6.7045);
    expect(r.hkd).toBeCloseTo(6.7045 / 7.8463, 8);
    expect(parseFrankfurter(FRANKFURTER_WEEKEND)!.date).toBe('2026-09-25');
  });

  it('rejects a reply without both rates', () => {
    expect(parseFrankfurter({ date: '2026-09-30', rates: { CNY: 6.7 } })).toBeNull();
    expect(parseFrankfurter({ message: 'not found' })).toBeNull();
  });
});
