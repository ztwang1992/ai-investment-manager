import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import migration from '../../supabase/migrations/20260930000000_init.sql?raw';
import presets from '../../supabase/migrations/20261002000000_presets.sql?raw';
import planRebalanced from '../../supabase/migrations/20261003000000_plan_rebalanced.sql?raw';
import aiSync from '../../supabase/migrations/20261003100000_ai_sync.sql?raw';
import { QUOTE_CODE } from '../domain/quoteCodes';
import { MARKET } from '../domain/types';
import { EXPOSURE_NAMES, INSTRUMENT_NAMES } from '../i18n/catalog';
import { exposures, instruments } from '../mock/catalog';

// Runs the migrations in a real Postgres (PGlite), simulating what Supabase already has: auth.users, auth.uid(),
// the anon / authenticated / service_role roles (service_role bypasses RLS; the Worker writes snapshots with it),
// and the public table grants Supabase gives them by default (the migrations must revoke what isn't needed).
const SUPABASE = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;
const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const T0 = '2026-09-30T08:00:00.000Z';
const T1 = '2026-09-30T09:00:00.000Z';
const T2 = '2026-09-30T10:00:00.000Z';

let db: PGlite;
beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(SUPABASE);
  await db.exec(migration);
  await db.exec(`insert into auth.users values ('${A}'), ('${B}')`);
});
afterAll(async () => {
  await db.close();
});

/** Runs as a signed-in user (null for signed out); returns the error message on failure, for assertions */
async function as<T>(user: string | null, sql: string, params: unknown[] = []): Promise<T[] | string> {
  await db.exec(user ? `set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false)` : 'set role anon');
  try {
    return (await db.query<T>(sql, params)).rows;
  } catch (e) {
    return (e as Error).message;
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
  }
}

const deposit = (owner: string, id: string, qty = 1, actor = owner) =>
  as(
    actor,
    `insert into public.transactions (user_id, id, date, created_at, type, account_id, instrument_code, qty, price, fee, reason, fx_to_cny)
     values ($1, $2, '2026-09-29', '2026-09-29T01:00:00.000Z', 'deposit', 'futu', 'USD', $3, 1, 0, null, 7.1)
     on conflict (user_id, id) do nothing`,
    [owner, id, qty],
  );

// This is the statement PostgREST's upsert (merge-duplicates) runs
const saveAccount = (user: string, name: string, updatedAt: string) =>
  as(
    user,
    `insert into public.accounts (user_id, id, name, type, currency, market, color, position, updated_at)
     values ($1, 'futu', $2, 'broker', 'USD', '美股', null, 0, $3)
     on conflict (user_id, id) do update set name = excluded.name, updated_at = excluded.updated_at`,
    [user, name, updatedAt],
  );

describe('cloud tables', () => {
  it('turns on row-level security for every table', async () => {
    const rows = (
      await db.query<{ relname: string; relrowsecurity: boolean }>(
        `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' order by c.relname`,
      )
    ).rows;
    expect(rows.map((r) => r.relname)).toEqual([
      'accounts',
      'ai_conversations',
      'ai_messages',
      'exposures',
      'instruments',
      'plans',
      'snapshot_items',
      'snapshots',
      'targets',
      'transactions',
    ]);
    expect(rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it('creates the global presets from the sample catalog', async () => {
    const ex = (await db.query('select id, name, group_id, is_stock from public.exposures where user_id is null order by position')).rows;
    expect(ex).toEqual(exposures.map((e) => ({ id: e.id, name: e.name, group_id: e.groupId, is_stock: e.isStock })));
    const ins = (
      await db.query(
        'select code, name, market, currency, exposure_id, pays_dividend from public.instruments where user_id is null order by position',
      )
    ).rows;
    expect(ins).toEqual(
      instruments.map((i) => ({
        code: i.code,
        name: i.name,
        market: i.market,
        currency: i.currency,
        exposure_id: i.exposureId,
        pays_dividend: i.paysDividend,
      })),
    );
  });

  it('shows each user only their own rows plus the global presets', async () => {
    await deposit(A, 'a-1');
    await deposit(B, 'b-1');
    await as(
      A,
      `insert into public.exposures (user_id, id, name, group_id, is_stock, position, updated_at) values ($1, 'custom-a', '比特币', 'other', false, 11, $2)`,
      [A, T0],
    );
    expect(await as(A, 'select id from public.transactions')).toEqual([{ id: 'a-1' }]);
    const seen = (await as<{ id: string; user_id: string | null }>(A, 'select id, user_id from public.exposures')) as {
      id: string;
      user_id: string | null;
    }[];
    expect(seen.map((r) => r.id)).toContain('custom-a');
    expect(seen.filter((r) => r.user_id === null)).toHaveLength(exposures.length);
    expect(seen.every((r) => r.user_id === null || r.user_id === A)).toBe(true);
    expect(await as(B, `select id from public.exposures where id = 'custom-a'`)).toEqual([]);
  });

  it('refuses rows written for another user', async () => {
    expect(await deposit(B, 'x-1', 1, A)).toMatch(/row-level security/);
  });

  it('keeps transactions append-only', async () => {
    await deposit(A, 'keep-1');
    expect(await as(A, `update public.transactions set qty = 99 where id = 'keep-1'`)).toMatch(/permission denied/);
    expect(await as(A, `delete from public.transactions where id = 'keep-1'`)).toMatch(/permission denied/);
  });

  it('stores a re-sent transaction only once', async () => {
    await deposit(A, 'dup-1', 5);
    await deposit(A, 'dup-1', 99);
    expect(await as(A, `select qty from public.transactions where id = 'dup-1'`)).toEqual([{ qty: '5' }]);
  });

  it('keeps the latest setting when an older change arrives later', async () => {
    await saveAccount(A, '富途', T1);
    await saveAccount(A, '旧名字', T0);
    expect(await as(A, `select name from public.accounts where id = 'futu'`)).toEqual([{ name: '富途' }]);
    await saveAccount(A, '富途证券', T2);
    const rows = (await as<{ name: string; server_updated_at: Date | null }>(
      A,
      `select name, server_updated_at from public.accounts where id = 'futu'`,
    )) as { name: string; server_updated_at: Date | null }[];
    expect(rows[0]!.name).toBe('富途证券');
    expect(rows[0]!.server_updated_at).not.toBeNull();
  });

  it('keeps the latest targets and plan too', async () => {
    const targets = (slots: string, at: string) =>
      as(
        A,
        `insert into public.targets (user_id, slots, own_stock, updated_at) values ($1, $2::jsonb, '{}'::jsonb, $3)
         on conflict (user_id) do update set slots = excluded.slots, updated_at = excluded.updated_at`,
        [A, slots, at],
      );
    await targets('{"sp500":100}', T1);
    await targets('{"ndx":100}', T0);
    expect(await as(A, 'select slots from public.targets')).toEqual([{ slots: { sp500: 100 } }]);
    const plan = (threshold: number, at: string) =>
      as(
        A,
        `insert into public.plans (user_id, threshold, rebalance_period, calib_period, undefined_mode, annual_spend, target_amount, expected_return, inflation, updated_at)
         values ($1, $2, 'quarter', 'quarter', 'sell', 0, 0, 7, 2.5, $3)
         on conflict (user_id) do update set threshold = excluded.threshold, updated_at = excluded.updated_at`,
        [A, threshold, at],
      );
    await plan(3, T1);
    await plan(9, T0);
    expect(await as(A, 'select threshold from public.plans')).toEqual([{ threshold: '3' }]);
  });

  it('lets nobody in without signing in', async () => {
    expect(await as(null, 'select * from public.transactions')).toMatch(/permission denied/);
    expect(await as(null, 'select * from public.exposures')).toMatch(/permission denied/);
  });

  it('keeps the global presets read-only for users', async () => {
    expect(await as(A, `update public.exposures set name = '改了' where id = 'sp500' returning id`)).toEqual([]);
    expect(
      await as(
        A,
        `insert into public.exposures (user_id, id, name, group_id, is_stock, position, updated_at) values (null, 'hack', 'x', 'other', false, 0, $1)`,
        [T0],
      ),
    ).toMatch(/row-level security/);
  });
});

describe('daily snapshots', () => {
  /** Runs as the Worker (service role) */
  async function asService<T>(sql: string, params: unknown[] = []): Promise<T[] | string> {
    await db.exec('set role service_role');
    try {
      return (await db.query<T>(sql, params)).rows;
    } catch (e) {
      return (e as Error).message;
    } finally {
      await db.exec('reset role');
    }
  }
  // This is the statement PostgREST's upsert (merge-duplicates) runs
  const writeSnapshot = (user: string, date: string, total: number) =>
    asService(
      `insert into public.snapshots (user_id, date, total_value_cny, net_invested_cny, usd_cny) values ($1, $2, $3, 90, 6.7)
       on conflict (user_id, date) do update set total_value_cny = excluded.total_value_cny, net_invested_cny = excluded.net_invested_cny, usd_cny = excluded.usd_cny`,
      [user, date, total],
    );
  const writeItem = (user: string, date: string, exposure: string) =>
    asService(`insert into public.snapshot_items (user_id, date, exposure_id, value_cny) values ($1, $2, $3, 1)`, [user, date, exposure]);

  it('lets the Worker overwrite a day and replace its assets', async () => {
    expect(await writeSnapshot(A, '2026-09-28', 100)).toEqual([]);
    expect(await writeSnapshot(A, '2026-09-28', 120)).toEqual([]);
    await writeItem(A, '2026-09-28', 'moutai');
    expect(await asService(`delete from public.snapshot_items where date = '2026-09-28' and user_id in ($1)`, [A])).toEqual([]);
    await writeItem(A, '2026-09-28', 'sp500');
    expect(await asService(`select total_value_cny from public.snapshots where user_id = $1 and date = '2026-09-28'`, [A])).toEqual([{ total_value_cny: '120' }]);
    expect(await asService(`select exposure_id from public.snapshot_items where user_id = $1 and date = '2026-09-28'`, [A])).toEqual([{ exposure_id: 'sp500' }]);
  });

  it('lets each user read only their own snapshots', async () => {
    await writeSnapshot(B, '2026-09-28', 999);
    await writeItem(B, '2026-09-28', 'gold');
    expect(await as(A, `select user_id, total_value_cny from public.snapshots where date = '2026-09-28'`)).toEqual([{ user_id: A, total_value_cny: '120' }]);
    expect(await as(A, `select exposure_id from public.snapshot_items where date = '2026-09-28'`)).toEqual([{ exposure_id: 'sp500' }]);
    expect(await as(null, `select * from public.snapshots`)).toMatch(/permission denied/);
  });

  // On finishing onboarding, the app writes the day's first snapshot as the signed-in user: insert only; skipped when that day already exists (PostgREST's ignore-duplicates)
  it('lets a user add their own first snapshot once, and nobody else\'s', async () => {
    const insert = (owner: string, actor: string, total: number) =>
      as(
        actor,
        `insert into public.snapshots (user_id, date, total_value_cny, net_invested_cny, usd_cny) values ($1, '2026-09-26', $2, 90, 6.7)
         on conflict (user_id, date) do nothing`,
        [owner, total],
      );
    expect(await insert(A, A, 100)).toEqual([]);
    expect(await insert(A, A, 999)).toEqual([]);
    expect(await as(A, `select total_value_cny from public.snapshots where date = '2026-09-26'`)).toEqual([{ total_value_cny: '100' }]);
    expect(await insert(B, A, 100)).toMatch(/row-level security/);
    expect(
      await as(A, `insert into public.snapshot_items (user_id, date, exposure_id, value_cny) values ($1, '2026-09-26', 'sp500', 100) on conflict (user_id, date, exposure_id) do nothing`, [A]),
    ).toEqual([]);
  });

  it('does not let users change or delete snapshots', async () => {
    expect(await as(A, `update public.snapshots set total_value_cny = 1 where user_id = '${A}'`)).toMatch(/permission denied/);
    expect(await as(A, `delete from public.snapshots where user_id = '${A}'`)).toMatch(/permission denied/);
    expect(await as(A, `delete from public.snapshot_items where user_id = '${A}'`)).toMatch(/permission denied/);
  });
});

// Phase 3: more global presets (common US ETFs, A-share ETFs, QDII funds), each code's name and price checked against a quote source
describe('preset catalog', () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await PGlite.create();
    await pg.exec(SUPABASE);
    await pg.exec(migration);
    await pg.exec(presets);
    // Running again neither fails nor duplicates
    await pg.exec(presets);
  });
  afterAll(async () => {
    await pg.close();
  });
  const rows = async <T,>(sql: string) => (await pg.query<T>(sql)).rows;

  it('can run twice and leaves one global row per code', async () => {
    expect(await rows(`select code from public.instruments where user_id is null group by code having count(*) > 1`)).toEqual([]);
    expect(await rows(`select id from public.exposures where user_id is null group by id having count(*) > 1`)).toEqual([]);
    expect(await rows<{ n: number }>(`select count(*)::int as n from public.instruments where user_id is null`)).toEqual([{ n: 72 }]);
  });

  it('maps every instrument to an existing asset, with a market, currency and code that fit', async () => {
    expect(
      await rows(`select i.code from public.instruments i left join public.exposures e on e.id = i.exposure_id and e.user_id is null
                  where i.user_id is null and e.id is null`),
    ).toEqual([]);
    const all = await rows<{ code: string; market: string; currency: string }>(`select code, market, currency from public.instruments where user_id is null`);
    for (const r of all) {
      expect(r.currency, r.code).toBe(r.market === '美股' ? 'USD' : r.market === '现金' ? r.code : 'CNY');
      const kind = r.market === '美股' ? 'us' : r.market === 'A股' ? 'cn' : r.market === '场外基金' ? 'fund' : null;
      if (kind) expect(QUOTE_CODE[kind].test(r.code), r.code).toBe(true);
    }
  });

  it('keeps the original presets as they were', async () => {
    const old = await rows<{ code: string; name: string; exposure_id: string }>(
      `select code, name, exposure_id from public.instruments where user_id is null and updated_at = '2026-09-30T00:00:00Z' order by position`,
    );
    expect(old).toHaveLength(24);
    expect(old[0]).toEqual({ code: 'VOO', name: 'Vanguard 标普500', exposure_id: 'sp500' });
  });

  it('knows the assets of common US ETFs, A-share ETFs and QDII funds', async () => {
    const map = Object.fromEntries(
      (await rows<{ code: string; exposure_id: string }>(`select code, exposure_id from public.instruments where user_id is null`)).map((r) => [r.code, r.exposure_id]),
    );
    expect(map).toMatchObject({ VTI: 'total_us', TLT: 'ust_long', SGOV: 'ust_short', VWO: 'em', '588000': 'star50', '513180': 'hstech', '161125': 'sp500', '040046': 'ndx', '511260': 'cn_bond' });
  });

  // The English interface translates presets by their stored Chinese name (src/i18n/catalog.ts): every asset and
  // every US-listed or cash instrument needs an entry that matches the database exactly. A-shares, Chinese funds
  // and the A-share asset 贵州茅台 keep their Chinese names.
  it('has an English name for every preset asset and every US-listed or cash instrument', async () => {
    const assets = await rows<{ id: string; name: string }>(`select id, name from public.exposures where user_id is null`);
    const named = assets.filter((e) => e.id !== 'moutai');
    for (const e of named) expect(EXPOSURE_NAMES[e.id]?.zh, e.id).toBe(e.name);
    expect(Object.keys(EXPOSURE_NAMES).sort()).toEqual(named.map((e) => e.id).sort());

    const all = await rows<{ code: string; name: string; market: string }>(`select code, name, market from public.instruments where user_id is null`);
    const english = all.filter((i) => i.market === MARKET.us || i.market === MARKET.cash);
    for (const i of english) expect(INSTRUMENT_NAMES[i.code]?.zh, i.code).toBe(i.name);
    expect(Object.keys(INSTRUMENT_NAMES).sort()).toEqual(english.map((i) => i.code).sort());
  });
});

// Phase 5: the plan records the date rebalancing was last marked done
describe('plans remember the last rebalance', () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await PGlite.create();
    await pg.exec(SUPABASE);
    await pg.exec(migration);
    await pg.exec(planRebalanced);
    await pg.exec(planRebalanced);
    await pg.exec(`insert into auth.users values ('${A}')`);
  });
  afterAll(async () => {
    await pg.close();
  });

  it('stores the date for the signed-in user and runs twice without trouble', async () => {
    await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A}', false)`);
    try {
      await pg.query(
        `insert into public.plans (user_id, threshold, rebalance_period, calib_period, undefined_mode, annual_spend, target_amount, expected_return, inflation, updated_at, last_rebalanced_on)
         values ($1, 3, 'quarter', 'quarter', 'sell', 300000, 8000000, 6, 2.5, '2026-10-03T00:00:00Z', '2026-10-03')`,
        [A],
      );
      const rows = (await pg.query<{ d: string }>(`select last_rebalanced_on::text as d from public.plans`)).rows;
      expect(rows).toEqual([{ d: '2026-10-03' }]);
    } finally {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
    }
  });
});

// Phase 6: AI conversation sync. Conversations: last change wins, with the server time recorded; messages are only added, with the time the server received them
describe('AI conversations sync like the other tables', () => {
  let pg: PGlite;
  beforeAll(async () => {
    pg = await PGlite.create();
    await pg.exec(SUPABASE);
    await pg.exec(migration);
    await pg.exec(aiSync);
    // Running again doesn't fail
    await pg.exec(aiSync);
    await pg.exec(`insert into auth.users values ('${A}'), ('${B}')`);
  });
  afterAll(async () => {
    await pg.close();
  });

  async function act<T>(user: string, sql: string, params: unknown[] = []): Promise<T[] | string> {
    await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false)`);
    try {
      return (await pg.query<T>(sql, params)).rows;
    } catch (e) {
      return (e as Error).message;
    } finally {
      await pg.exec(`reset role; select set_config('request.jwt.claim.sub', '', false)`);
    }
  }
  const upsertConversation = (owner: string, id: string, title: string, updatedAt: string, actor = owner) =>
    act(
      actor,
      `insert into public.ai_conversations (user_id, id, title, created_at, updated_at) values ($1, $2, $3, $4, $4)
       on conflict (user_id, id) do update set title = excluded.title, updated_at = excluded.updated_at`,
      [owner, id, title, updatedAt],
    );
  const addMessage = (owner: string, id: string, actor = owner) =>
    act(
      actor,
      `insert into public.ai_messages (user_id, id, conversation_id, role, content, created_at)
       values ($1, $2, 'c1', 'user', '美债超配要不要现在调？', '2026-10-03T08:00:00Z') on conflict (user_id, id) do nothing`,
      [owner, id],
    );

  it('stamps a new conversation with the server time and keeps the latest title', async () => {
    await upsertConversation(A, 'c1', '新标题', T1);
    const first = (await act<{ server_updated_at: string }>(A, `select server_updated_at::text from public.ai_conversations`)) as { server_updated_at: string }[];
    expect(first).toHaveLength(1);
    expect(first[0]!.server_updated_at).toBeTruthy();
    await upsertConversation(A, 'c1', '更早的改动', T0);
    expect(await act(A, `select title from public.ai_conversations`)).toEqual([{ title: '新标题' }]);
    await upsertConversation(A, 'c1', '更晚的改动', T2);
    expect(await act(A, `select title from public.ai_conversations`)).toEqual([{ title: '更晚的改动' }]);
  });

  it('stamps messages with the time the server got them and stores a re-sent message once', async () => {
    await addMessage(A, 'm1');
    await addMessage(A, 'm1');
    const rows = (await act<{ id: string; inserted_at: string | null }>(A, `select id, inserted_at::text from public.ai_messages`)) as { id: string; inserted_at: string | null }[];
    expect(rows.map((r) => r.id)).toEqual(['m1']);
    expect(rows[0]!.inserted_at).toBeTruthy();
  });

  it("keeps each user's conversations to themselves", async () => {
    expect(await act(B, `select id from public.ai_conversations`)).toEqual([]);
    expect(await act(B, `select id from public.ai_messages`)).toEqual([]);
    expect(await upsertConversation(A, 'c9', '冒名', T1, B)).toMatch(/row-level security/);
    expect(await addMessage(A, 'm9', B)).toMatch(/row-level security/);
  });
});
