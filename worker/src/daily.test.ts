import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDailySnapshots } from './daily';
import { FRANKFURTER_LATEST, SINA, TENCENT } from './testdata';
import { createFakeSupabase, SUPABASE_URL } from './testsupabase';
import type { Fetch } from './types';

const KEY = 'sb_secret_abcdefghijklmnop';
const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';
const C = 'cccccccc-0000-0000-0000-000000000003';
const D = 'dddddddd-0000-0000-0000-000000000004';
// 06:00 on 2026-10-02 in Beijing: recorded as the day before, 2026-10-01
const RUN_AT = new Date('2026-10-01T22:00:00Z');

afterEach(() => {
  vi.restoreAllMocks();
});

const preset = { position: 0, updated_at: '2026-09-30T00:00:00Z' };
const exposure = (id: string) => ({ user_id: null, id, name: id, group_id: 'g', is_stock: false, ...preset });
const instrument = (userId: string | null, code: string, market: string, currency: string, exposureId: string) => ({
  user_id: userId,
  code,
  name: code,
  market,
  currency,
  exposure_id: exposureId,
  pays_dividend: false,
  ...preset,
});
let n = 0;
const tx = (userId: string, date: string, type: string, accountId: string, code: string, qty: number, price: number, fx: number, createdAt = `${date}T08:00:00Z`) => ({
  user_id: userId,
  id: `t${++n}`,
  date,
  created_at: createdAt,
  type,
  account_id: accountId,
  instrument_code: code,
  qty: String(qty),
  price: String(price),
  fee: '0',
  reason: null,
  fx_to_cny: String(fx),
});

/** 000001: user A treats it as an A-share (Ping An Bank), user B as a mutual fund */
function tables() {
  return {
    accounts: [
      { user_id: A, id: 'cmb' },
      { user_id: A, id: 'futu' },
      { user_id: B, id: 'cmb' },
      { user_id: C, id: 'cmb' },
    ],
    exposures: ['sp500', 'csi300', 'cny', 'usd'].map(exposure),
    instruments: [
      instrument(null, 'CNY', '现金', 'CNY', 'cny'),
      instrument(null, 'USD', '现金', 'USD', 'usd'),
      instrument(null, 'VOO', '美股', 'USD', 'sp500'),
      instrument(A, '000001', 'A股', 'CNY', 'csi300'),
      instrument(B, '000001', '场外基金', 'CNY', 'csi300'),
    ],
    transactions: [
      tx(A, '2026-09-01', 'opening', 'cmb', 'CNY', 10000, 1, 1),
      tx(A, '2026-09-01', 'opening', 'futu', 'VOO', 2, 500, 7.1),
      tx(A, '2026-09-01', 'opening', 'cmb', '000001', 100, 10, 1),
      tx(A, '2026-10-02', 'deposit', 'cmb', 'CNY', 99999, 1, 1),
      tx(B, '2026-09-15', 'opening', 'cmb', 'CNY', 5000, 1, 1),
      tx(B, '2026-09-15', 'opening', 'cmb', 'VOO', 1, 600, 7),
      tx(B, '2026-09-15', 'opening', 'cmb', '000001', 1000, 1, 1),
      // C has only created an account and recorded nothing yet
    ],
  };
}

const sz000001 = `v_sz000001="51~????~000001~11.50~11.40~11.41~1~1~1~${Array(21).fill('0').join('~')}~20260930150000~0~0";`;
const f000001 = 'var hq_str_f_000001="????,1.2345,1.2,1.2,2026-09-30,0";';

function setup(opts: { sources?: 'up' | 'down'; tables?: ReturnType<typeof tables>; kv?: Record<string, string> } = {}) {
  const db = createFakeSupabase(opts.tables ?? tables());
  const kvMap = new Map(Object.entries(opts.kv ?? {}));
  const upstream: string[] = [];
  const fetch: Fetch = async (input, init) => {
    const url = new URL(input);
    const supabase = db.handle(url, init);
    if (supabase) return supabase;
    upstream.push(url.hostname + url.pathname);
    if (opts.sources === 'down') throw new TypeError('network down');
    if (url.hostname === 'qt.gtimg.cn') return new Response(`${TENCENT}${sz000001}\n`);
    if (url.hostname === 'hq.sinajs.cn') return new Response(`${SINA}${f000001}\n`);
    if (url.hostname === 'api.frankfurter.dev') return Response.json(FRANKFURTER_LATEST);
    return new Response('', { status: 404 });
  };
  const env = { QUOTES: { get: async (k: string) => kvMap.get(k) ?? null, put: async (k: string, v: string) => void kvMap.set(k, v) }, SUPABASE_URL, SUPABASE_SECRET_KEY: KEY };
  const run = (mode: 'all' | 'missing') => runDailySnapshots(env, { fetch, now: () => RUN_AT }, mode);
  return { db, upstream, run };
}

const itemsOf = (rows: Record<string, unknown>[], user: string) =>
  Object.fromEntries(rows.filter((r) => r.user_id === user).map((r) => [r.exposure_id, r.value_cny]));

describe('daily snapshots', () => {
  it('writes each user\'s snapshot for the day before, from their own records', async () => {
    const { db, run } = setup();
    expect(await run('all')).toEqual({ date: '2026-10-01', written: 2, skipped: 1, failed: 0 });
    const voo = 700.86 * 6.7045;
    expect(itemsOf(db.tables.snapshot_items!, A)).toEqual({ cny: 10000, sp500: 2 * voo, csi300: 100 * 11.5 });
    expect(itemsOf(db.tables.snapshot_items!, B)).toEqual({ cny: 5000, sp500: voo, csi300: 1000 * 1.2345 });
    const a = db.tables.snapshots!.find((r) => r.user_id === A)!;
    expect(a).toMatchObject({ date: '2026-10-01', net_invested_cny: 10000 + 7100 + 1000, usd_cny: 6.7045 });
    expect(a.total_value_cny).toBeCloseTo(10000 + 2 * voo + 1150, 6);
  });

  // A user who did onboarding today: all transactions are after this day, so no snapshot of all zeros may be written
  it('skips a user whose records all come after the day', async () => {
    const t = tables();
    t.accounts.push({ user_id: D, id: 'cmb' });
    t.transactions.push(tx(D, '2026-10-02', 'opening', 'cmb', 'CNY', 500, 1, 1));
    const { db, run } = setup({ tables: t });
    expect(await run('all')).toMatchObject({ written: 2, skipped: 2 });
    expect(db.tables.snapshots!.some((r) => r.user_id === D)).toBe(false);
  });

  it('asks each source once for everyone', async () => {
    const { upstream, run } = setup();
    await run('all');
    expect(upstream.filter((u) => u.includes('usVOO'))).toHaveLength(1);
    expect(upstream.filter((u) => u.includes('sz000001'))).toHaveLength(1);
    expect(upstream.filter((u) => u.includes('f_000001'))).toHaveLength(1);
  });

  it('at the catch-up run, writes only users who still have no snapshot for the day', async () => {
    const t = tables();
    const { db, run } = setup({ tables: { ...t, snapshots: [{ user_id: A, date: '2026-10-01', total_value_cny: 1, net_invested_cny: 1, usd_cny: 7 }] } as ReturnType<typeof tables> });
    expect(await run('missing')).toMatchObject({ written: 1, failed: 0 });
    expect(db.tables.snapshots!.find((r) => r.user_id === A)!.total_value_cny).toBe(1);
    expect(db.tables.snapshots!.some((r) => r.user_id === B)).toBe(true);
  });

  it('writes nothing when no exchange rate can be found', async () => {
    const { db, run } = setup({ sources: 'down' });
    expect(await run('all')).toMatchObject({ written: 0 });
    expect(db.tables.snapshots).toEqual([]);
    expect(db.tables.snapshot_items).toEqual([]);
  });

  it('uses cached prices when every source is down, and cost when there is none', async () => {
    const old = '2026-09-25T00:00:00.000Z';
    const { db, run } = setup({
      sources: 'down',
      kv: {
        'quotes:us': JSON.stringify({ VOO: { code: 'VOO', price: 690, currency: 'USD', asOf: old, source: 'tencent', fetchedAt: old } }),
        'fx:latest': JSON.stringify({ date: '2026-09-24', usd: 6.8, hkd: 0.87, source: 'frankfurter', fetchedAt: old }),
      },
    });
    expect(await run('all')).toMatchObject({ written: 2 });
    // VOO uses the cached 690; 000001 has no price at all, so it's at cost (A paid 10 yuan a share)
    expect(itemsOf(db.tables.snapshot_items!, A)).toEqual({ cny: 10000, sp500: 2 * 690 * 6.8, csi300: 1000 });
  });

  it('skips a user whose data cannot be read and still writes the others', async () => {
    const t = tables();
    t.transactions.push(tx(B, '2026-09-20', 'deposit', 'cmb', 'CNY', 1, 1, 1, 'not a time'));
    const { db, run } = setup({ tables: t });
    expect(await run('all')).toMatchObject({ written: 1, failed: 1 });
    expect(db.tables.snapshots!.map((r) => r.user_id)).toEqual([A]);
  });

  it('logs only the day and how many users, never amounts or the key', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await setup().run('all');
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]![0]);
    expect(line).toContain('2026-10-01');
    expect(line).not.toContain(KEY);
    expect(line).not.toMatch(/18100|10000|700\.86/);
  });
});
