import { afterEach, describe, expect, it, vi } from 'vitest';
import { txToRow } from '../domain/rows';
import { transactions } from '../mock/ledger';
import { RemoteError, createSupabaseRemote } from './remote';
import { AUTH_STORAGE_KEY, createSupabase } from './supabase';

const U = '11111111-1111-1111-1111-111111111111';
const URL_BASE = 'https://proj.supabase.co';

/** A session on this device that hasn't expired */
function signedInStorage() {
  const session = {
    access_token: 'token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'refresh',
    user: { id: U, email: 'me@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
  };
  const map = new Map<string, string>([[AUTH_STORAGE_KEY, JSON.stringify(session)]]);
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
}

type Reply = { status: number; body?: unknown } | 'offline';
function fakeFetch(reply: (url: URL, init: RequestInit) => Reply) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, init });
    const r = reply(url, init);
    if (r === 'offline') throw new TypeError('fetch failed');
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
  return { fn, calls };
}

type Storage = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void };
const setup = (reply: (url: URL, init: RequestInit) => Reply, storage: Storage = signedInStorage()) => {
  const f = fakeFetch(reply);
  const client = createSupabase({ VITE_SUPABASE_URL: URL_BASE, VITE_SUPABASE_ANON_KEY: 'anon' }, { fetch: f.fn as unknown as typeof fetch, storage })!;
  return { remote: createSupabaseRemote(client), calls: f.calls };
};
const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name) ?? '';
afterEach(() => vi.restoreAllMocks());

describe('talking to Supabase', () => {
  it('has no cloud without a project address and key', () => {
    expect(createSupabase({})).toBeNull();
    expect(createSupabase({ VITE_SUPABASE_URL: URL_BASE })).toBeNull();
  });

  it('treats a malformed project address as not set up, instead of failing to start', () => {
    expect(createSupabase({ VITE_SUPABASE_URL: 'proj.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' })).toBeNull();
  });

  it('sends new records so that a record already in the cloud is skipped', async () => {
    const { remote, calls } = setup(() => ({ status: 201 }));
    await remote.insertTransactions([txToRow(transactions[0]!, U)]);
    const post = calls.find((c) => c.url.pathname === '/rest/v1/transactions')!;
    expect(post.init.method).toBe('POST');
    expect(post.url.searchParams.get('on_conflict')).toBe('user_id,id');
    expect(header(post.init, 'Prefer')).toContain('resolution=ignore-duplicates');
    expect(JSON.parse(String(post.init.body))[0]).toMatchObject({ id: 'mock-001', user_id: U });
  });

  it('sends large uploads in batches of 500', async () => {
    const { remote, calls } = setup(() => ({ status: 201 }));
    const rows = Array.from({ length: 1201 }, (_, i) => ({ ...txToRow(transactions[0]!, U), id: `t-${i}` }));
    await remote.insertTransactions(rows);
    expect(calls.filter((c) => c.url.pathname === '/rest/v1/transactions')).toHaveLength(3);
  });

  it('sends settings so that the newest change wins', async () => {
    const { remote, calls } = setup(() => ({ status: 201 }));
    await remote.upsert('instrument', [
      {
        user_id: U,
        code: 'ABCD',
        name: '',
        market: '美股',
        currency: 'USD',
        exposure_id: 'ndx',
        pays_dividend: false,
        position: 24,
        updated_at: '2026-09-30T08:00:00.000Z',
      },
    ]);
    const post = calls.find((c) => c.url.pathname === '/rest/v1/instruments')!;
    expect(post.url.searchParams.get('on_conflict')).toBe('user_id,code');
    expect(header(post.init, 'Prefer')).toContain('resolution=merge-duplicates');
  });

  it('pulls only what changed since the last time, page by page', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ ...txToRow(transactions[0]!, U), id: `t-${i}`, inserted_at: '2026-09-30T08:00:00+00:00' }));
    const { remote, calls } = setup((url) =>
      url.pathname === '/rest/v1/transactions' && url.searchParams.get('offset') === '0' ? { status: 200, body: page } : { status: 200, body: [] },
    );
    const changes = await remote.pull('2026-09-30T07:58:00.000Z');
    expect(changes.transactions).toHaveLength(1000);
    const txCalls = calls.filter((c) => c.url.pathname === '/rest/v1/transactions');
    expect(txCalls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '1000']);
    expect(txCalls[0]!.url.searchParams.get('inserted_at')).toBe('gt.2026-09-30T07:58:00.000Z');
    expect(txCalls[0]!.url.searchParams.get('order')).toBe('inserted_at.asc');
    const accountCall = calls.find((c) => c.url.pathname === '/rest/v1/accounts')!;
    expect(accountCall.url.searchParams.get('server_updated_at')).toBe('gt.2026-09-30T07:58:00.000Z');
  });

  it('pulls everything the first time', async () => {
    const { remote, calls } = setup(() => ({ status: 200, body: [] }));
    await remote.pull(null);
    expect(calls.find((c) => c.url.pathname === '/rest/v1/transactions')!.url.searchParams.has('inserted_at')).toBe(false);
  });

  // Snapshots have no server-time column, so they're pulled by date: from a few days before the latest local day, so the days a rerun rewrote come too
  it('pulls snapshots and their assets from a given day on, page by page', async () => {
    const snapshot = { user_id: U, date: '2026-09-30', total_value_cny: '100', net_invested_cny: '90', usd_cny: '6.7' };
    const item = { user_id: U, date: '2026-09-30', exposure_id: 'sp500', value_cny: '100' };
    const page = Array.from({ length: 1000 }, () => snapshot);
    const { remote, calls } = setup((url) => {
      if (url.pathname === '/rest/v1/snapshots') return { status: 200, body: url.searchParams.get('offset') === '0' ? page : [snapshot] };
      if (url.pathname === '/rest/v1/snapshot_items') return { status: 200, body: [item] };
      return { status: 200, body: [] };
    });
    const r = await remote.pullSnapshots('2026-09-24');
    expect(r.snapshots).toHaveLength(1001);
    expect(r.items).toEqual([item]);
    const snapshotCalls = calls.filter((c) => c.url.pathname === '/rest/v1/snapshots');
    expect(snapshotCalls.map((c) => c.url.searchParams.get('offset'))).toEqual(['0', '1000']);
    expect(snapshotCalls[0]!.url.searchParams.get('date')).toBe('gte.2026-09-24');
    expect(snapshotCalls[0]!.url.searchParams.get('order')).toBe('date.asc');
    expect(calls.find((c) => c.url.pathname === '/rest/v1/snapshot_items')!.url.searchParams.get('date')).toBe('gte.2026-09-24');
    const all = setup(() => ({ status: 200, body: [] }));
    await all.remote.pullSnapshots(null);
    expect(all.calls.find((c) => c.url.pathname === '/rest/v1/snapshots')!.url.searchParams.has('date')).toBe(false);
  });

  it('adds the first snapshot without touching one that is already there', async () => {
    const { remote, calls } = setup(() => ({ status: 201 }));
    await remote.insertSnapshot(
      { user_id: U, date: '2026-09-29', total_value_cny: 100, net_invested_cny: 90, usd_cny: 6.7 },
      [{ user_id: U, date: '2026-09-29', exposure_id: 'sp500', value_cny: 100 }],
    );
    const snapshot = calls.find((c) => c.url.pathname === '/rest/v1/snapshots')!;
    expect(snapshot.init.method).toBe('POST');
    expect(snapshot.url.searchParams.get('on_conflict')).toBe('user_id,date');
    expect(header(snapshot.init, 'Prefer')).toContain('resolution=ignore-duplicates');
    const items = calls.find((c) => c.url.pathname === '/rest/v1/snapshot_items')!;
    expect(items.url.searchParams.get('on_conflict')).toBe('user_id,date,exposure_id');
    expect(header(items.init, 'Prefer')).toContain('resolution=ignore-duplicates');
  });

  it('tells an expired login apart from a network problem', async () => {
    const expired = setup(() => ({ status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }));
    await expect(expired.remote.pull(null)).rejects.toMatchObject({ kind: 'auth' });
    await expect(expired.remote.pullSnapshots(null)).rejects.toMatchObject({ kind: 'auth' });
    const offline = setup(() => 'offline');
    await expect(offline.remote.insertTransactions([txToRow(transactions[0]!, U)])).rejects.toMatchObject({ kind: 'network' });
    const broken = setup(() => ({ status: 500, body: { message: 'boom' } }));
    await expect(broken.remote.pull(null)).rejects.toBeInstanceOf(RemoteError);
    await expect(broken.remote.pull(null)).rejects.toMatchObject({ kind: 'server' });
  });

  it('does not call the cloud without a login', async () => {
    const empty = new Map<string, string>();
    const storage = { getItem: (k: string) => empty.get(k) ?? null, setItem: () => {}, removeItem: () => {} };
    const { remote, calls } = setup(() => ({ status: 200, body: [] }), storage);
    await expect(remote.pull(null)).rejects.toMatchObject({ kind: 'auth' });
    expect(calls.filter((c) => c.url.pathname.startsWith('/rest/'))).toEqual([]);
  });
});
