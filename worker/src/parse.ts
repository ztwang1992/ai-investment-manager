// Parsing of each data source's responses. Only the fields needed; when one is missing, the code counts as not found (null, or left out of the result) and the caller moves on to the next source.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** A positive number, also accepted as a string; otherwise null */
export const positive = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v);

/**
 * Keeps only the ASCII part of GBK text: each double-byte (four-byte in GB18030) character becomes one "?".
 * Tencent separates fields with "~", and 0x7E can also be a character's second byte; decoded byte by byte, it adds separators and every later field shifts.
 */
export function gbkAscii(bytes: Uint8Array): string {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    if (b < 0x80) {
      out[n++] = b;
      i += 1;
      continue;
    }
    out[n++] = 0x3f;
    if (b === 0x80 || b === 0xff) i += 1;
    else {
      const next = bytes[i + 1];
      i += next !== undefined && next >= 0x30 && next <= 0x39 ? 4 : 2;
    }
  }
  return new TextDecoder().decode(out.subarray(0, n));
}

/** Each line prefix+code="content"; -> code -> content */
function quoted(text: string, prefix: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of text.matchAll(new RegExp(`^${prefix}([^=\\s"]+)="([^"]*)"`, 'gm'))) map.set(m[1]!, m[2]!);
  return map;
}

/** Tencent: v_code="field~field~…"; [3] price, [30] time (US: New York YYYY-MM-DD HH:MM:SS; A-shares: Beijing YYYYMMDDHHMMSS) */
export function parseTencent(text: string): Map<string, { price: number; time: string }> {
  const out = new Map<string, { price: number; time: string }>();
  for (const [symbol, body] of quoted(text, 'v_')) {
    const f = body.split('~');
    const price = positive(f[3]);
    const time = f[30];
    if (f.length > 30 && price !== null && time) out.set(symbol, { price, time });
  }
  return out;
}

/** Sina: var hq_str_code="field,field,…"; an unknown code gives an empty string and is skipped */
export function parseSina(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [symbol, body] of quoted(text, 'var hq_str_')) if (body) out.set(symbol, body.split(','));
  return out;
}

const yahooResult = (json: unknown): Json | undefined => obj(list(obj(obj(json)?.chart)?.result)[0]);

/** Yahoo chart: meta.regularMarketPrice, regularMarketTime (seconds), currency */
export function parseYahoo(json: unknown): { price: number; time: string; currency: string } | null {
  const meta = obj(yahooResult(json)?.meta);
  const price = positive(meta?.regularMarketPrice);
  const time = meta?.regularMarketTime;
  const currency = meta?.currency;
  if (price === null || typeof time !== 'number' || typeof currency !== 'string') return null;
  return { price, time: new Date(time * 1000).toISOString(), currency };
}

/** Yahoo daily bars. FX bars are stamped 23:00 UTC the day before; adding an hour and taking the UTC date gives the trading day. Bars with no close are skipped. */
export function parseYahooDaily(json: unknown): { date: string; close: number }[] {
  const r = yahooResult(json);
  const stamps = list(r?.timestamp);
  const closes = list(obj(list(obj(r?.indicators)?.quote)[0])?.close);
  const out: { date: string; close: number }[] = [];
  stamps.forEach((t, i) => {
    const close = positive(closes[i]);
    if (typeof t === 'number' && close !== null) out.push({ date: new Date((t + 3600) * 1000).toISOString().slice(0, 10), close });
  });
  return out;
}

/** The Tiantian Fund (Eastmoney) app API: Datas[].FCODE / NAV / PDATE */
export function parseFundApp(json: unknown): Map<string, { nav: number; date: string }> {
  const out = new Map<string, { nav: number; date: string }>();
  for (const item of list(obj(json)?.Datas)) {
    const d = obj(item);
    const nav = positive(d?.NAV);
    if (typeof d?.FCODE === 'string' && nav !== null && isDate(d.PDATE)) out.set(d.FCODE, { nav, date: d.PDATE });
  }
  return out;
}

/** Tiantian Fund F10: Data.LSJZList[0].DWJZ / FSRQ */
export function parseFundF10(json: unknown): { nav: number; date: string } | null {
  const row = obj(list(obj(obj(json)?.Data)?.LSJZList)[0]);
  const nav = positive(row?.DWJZ);
  return nav !== null && isDate(row?.FSRQ) ? { nav, date: row.FSRQ } : null;
}

/** frankfurter (base=USD, symbols=CNY,HKD): how many CNY 1 USD and 1 HKD are each worth */
export function parseFrankfurter(json: unknown): { date: string; usd: number; hkd: number } | null {
  const o = obj(json);
  const rates = obj(o?.rates);
  const cny = positive(rates?.CNY);
  const hkdPerUsd = positive(rates?.HKD);
  if (!isDate(o?.date) || cny === null || hkdPerUsd === null) return null;
  return { date: o.date, usd: cny, hkd: cny / hkdPerUsd };
}
