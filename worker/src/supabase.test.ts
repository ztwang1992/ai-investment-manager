import { describe, expect, it } from 'vitest';
import { createAdmin } from './supabase';
import { createFakeSupabase, SUPABASE_URL } from './testsupabase';
import type { Fetch } from './types';

const NEW_KEY = 'sb_secret_abcdefghijklmnop';
const OLD_KEY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2lnbmF0dXJl';
const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';

function setup(key = NEW_KEY, tables = {}) {
  const db = createFakeSupabase(tables);
  const fetch: Fetch = async (input, init) => db.handle(new URL(input), init) ?? new Response('', { status: 404 });
  return { db, admin: createAdmin({ SUPABASE_URL: `${SUPABASE_URL}/`, SUPABASE_SECRET_KEY: key }, fetch) };
}

describe('Supabase with the service key', () => {
  // The new sb_secret_ keys aren't JWTs and can only go in the apikey header; the old service_role key is a JWT and goes in both headers
  it('sends the key the way each kind of key needs', async () => {
    const fresh = setup(NEW_KEY);
    await fresh.admin.userIds();
    expect(fresh.db.requests[0]!.headers.get('apikey')).toBe(NEW_KEY);
    expect(fresh.db.requests[0]!.headers.get('Authorization')).toBeNull();
    const legacy = setup(OLD_KEY);
    await legacy.admin.userIds();
    expect(legacy.db.requests[0]!.headers.get('apikey')).toBe(OLD_KEY);
    expect(legacy.db.requests[0]!.headers.get('Authorization')).toBe(`Bearer ${OLD_KEY}`);
  });

  it('lists every user that has accounts, reading page after page', async () => {
    const accounts = Array.from({ length: 1500 }, (_, i) => ({ user_id: i < 1200 ? A : B, id: `acc-${i}` }));
    const { db, admin } = setup(NEW_KEY, { accounts });
    expect((await admin.userIds()).sort()).toEqual([A, B]);
    expect(db.requests.map((r) => r.query.get('offset'))).toEqual(['0', '1000']);
  });

  it('loads records, instruments and assets of all users, presets included', async () => {
    const { db, admin } = setup(NEW_KEY, {
      transactions: [{ user_id: A, id: 't1', date: '2026-09-01', created_at: '2026-09-01T08:00:00Z', type: 'deposit', account_id: 'cmb', instrument_code: 'CNY', qty: '100', price: '1', fee: '0', reason: null, fx_to_cny: '1' }],
      instruments: [{ user_id: null, code: 'VOO', name: 'VOO', market: '美股', currency: 'USD', exposure_id: 'sp500', pays_dividend: true, position: 0, updated_at: '2026-09-30T00:00:00Z' }],
      exposures: [{ user_id: null, id: 'sp500', name: '标普 500', group_id: 'us', is_stock: false, position: 0, updated_at: '2026-09-30T00:00:00Z' }],
    });
    const all = await admin.loadAll();
    expect(all.transactions).toHaveLength(1);
    expect(all.transactions[0]).toMatchObject({ user_id: A, qty: '100', fx_to_cny: '1' });
    expect(all.instruments[0]).toMatchObject({ user_id: null, code: 'VOO', exposure_id: 'sp500' });
    expect(all.exposures[0]).toMatchObject({ user_id: null, id: 'sp500' });
    expect(db.requests.every((r) => r.method === 'GET')).toBe(true);
  });

  it('finds who already has a snapshot for a day', async () => {
    const { admin } = setup(NEW_KEY, { snapshots: [{ user_id: A, date: '2026-10-01' }, { user_id: B, date: '2026-09-30' }] });
    expect(await admin.usersWithSnapshot('2026-10-01')).toEqual(new Set([A]));
  });

  // Rewriting the same day: first delete the old per-asset values and write the new ones, finally overwrite the snapshot. If it fails midway the snapshot isn't written yet, and the 07:00 rerun redoes it all
  it('rewrites a day without leaving assets that were sold', async () => {
    const { db, admin } = setup(NEW_KEY, {
      snapshots: [{ user_id: A, date: '2026-10-01', total_value_cny: 1, net_invested_cny: 1, usd_cny: 7 }],
      snapshot_items: [
        { user_id: A, date: '2026-10-01', exposure_id: 'moutai', value_cny: 1 },
        { user_id: A, date: '2026-09-30', exposure_id: 'moutai', value_cny: 1 },
      ],
    });
    await admin.writeSnapshots('2026-10-01', [
      {
        userId: A,
        snapshot: { date: '2026-10-01', totalValueCny: 300, netInvestedCny: 250, usdCny: 6.7 },
        items: [
          { date: '2026-10-01', exposureId: 'sp500', valueCny: 200 },
          { date: '2026-10-01', exposureId: 'cny', valueCny: 100 },
        ],
      },
    ]);
    expect(db.tables.snapshots).toEqual([{ user_id: A, date: '2026-10-01', total_value_cny: 300, net_invested_cny: 250, usd_cny: 6.7 }]);
    expect(db.tables.snapshot_items!.map((r) => `${r.date} ${r.exposure_id}`).sort()).toEqual(['2026-09-30 moutai', '2026-10-01 cny', '2026-10-01 sp500']);
    expect(db.requests.map((r) => `${r.method} ${r.table}`)).toEqual(['DELETE snapshot_items', 'POST snapshot_items', 'POST snapshots']);
    const upsert = db.requests.at(-1)!;
    expect(upsert.query.get('on_conflict')).toBe('user_id,date');
    expect(upsert.headers.get('Prefer')).toContain('resolution=merge-duplicates');
  });

  it('does not put the key in its errors', async () => {
    const { db, admin } = setup();
    db.failNext('GET', 'accounts', 401);
    const error = await admin.userIds().catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('401');
    expect((error as Error).message).not.toContain(NEW_KEY);
  });
});
