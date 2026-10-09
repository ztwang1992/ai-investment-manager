# 阶段 2b：Supabase 登录 + 云端同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用邮箱 6 位验证码登录；数据在本机和云端各存一份。离线照常记账，联网后自动上传和拉取；多台设备合并后的结果一致。

**Architecture:**
- **云端**：Supabase 用一份迁移建表，开 RLS，并用触发器实现「以最后修改为准」。前端用 supabase-js。
- **本机**：Dexie 库按账号分开，新增待同步队列（outbox）。界面状态一变，写本机库和入队在同一个事务里完成。
- **同步引擎**：先按队列顺序上传。流水按 (user_id, id) 去重；设置由数据库保证旧的改动不覆盖新的。然后按服务器时间增量拉取，合并进本机库和界面。
- **测试**：同步引擎只依赖 `Remote` 接口，测试用语义相同的内存假云端。迁移 SQL 放进 PGlite（真实 Postgres）里跑，测 RLS。

**Tech Stack:**
- 已有：Vite + React 19 + TypeScript 7，Zustand 5，Dexie 4，Vitest 5 + happy-dom + fake-indexeddb。
- 新增（要先征得用户同意再装）：`@supabase/supabase-js` ^2.117（运行时），`@electric-sql/pglite` ^0.5（开发依赖，测迁移和 RLS）。

**Spec:**
- README：「技术栈」「数据模型」「流水类型」「本地优先与同步」。
- BUILD_PLAN：阶段 2。
- 对话里确认的方案（2026-09-30）：待同步提示用方案 A（记录页标题下一行 + 「记录」标签上的圆点）；目标组合整组一行；账户、底层资产、品种存位置；服务器时间用来增量拉取；「恢复示例数据」改为「导入示例数据」，只在账号还没有流水时显示；离线汇率修正放阶段 4；负数标记放阶段 3。

## Global Constraints

- 「所有表都开启 RLS」（CLAUDE.md）。策略是「只能读写自己的数据」；`exposures`、`instruments` 例外：「`user_id` 为空的行是全局预置，所有人只读，由迁移文件维护」（README）。
- 「流水表只允许新增和读取自己的行」（BUILD_PLAN 阶段 2）；「流水只增不改，同一笔重复上传也只记一次」（README）。
- 「账户、底层资产、品种、目标组合、计划这些设置按 updated_at，以最后修改的为准」（README）。
- 「登录方式用邮箱 6 位验证码（OTP），不要用 magic link」（BUILD_PLAN）。
- 「以下密钥不能进入 git 仓库：`.env.local`、Supabase service role key、用户的 AI Key。」前端只用 anon / publishable key，从 `.env.local` 的 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY` 读取。
- 「所有金额和比例的计算都写成纯函数，放在 `src/domain/`」；「`src/domain/` 只写纯 TypeScript，不能引用 React 或浏览器 API」。
- 「颜色、字体、圆角只能用 `src/styles/tokens.css` 里的变量」。
- 「界面文案用简体中文，语气冷静、简洁。」
- 本地优先，以下均出自 README：
  - 「记一笔等操作先写本地、立即显示，同时放进待同步队列；联网后按顺序上传，失败自动重试」
  - 「App 启动、回到前台、网络恢复时，拉取其他设备新增的流水和改过的设置」
  - 「必须联网的只有：登录、刷新行情、AI 投顾」
- 不跨阶段：
  - 离线流水上传前换成当天汇率：阶段 4。
  - 合并后份额为负的标记：阶段 3。
  - 快照写入：阶段 3 / 4。
  - AI 会话同步：阶段 6。本阶段只建表。

## Review Focus

1. **离线打开 App 时登录已过期**（access token 一小时就过期）：仍能看、能记账；联网后自动续上，续不上时提示重新登录，队列不丢。→ Task 5（auth 错误保留队列）、Task 6（离线时按本机记住的用户打开）
2. **上传请求到了服务器、回应却丢了**：重试时不能重复记账。→ Task 1（ON CONFLICT DO NOTHING）、Task 5（假云端「存了再报错」）
3. **两台设备先后改同一项设置，而且时钟有偏差**：以 updated_at 更新的为准，旧的改动晚到也不覆盖新的。→ Task 1（触发器）、Task 5
4. **新账号（没导入示例）打开各页**：不崩溃。→ Task 8
5. **同一台设备换另一个账号登录**：看不到上一个账号的数据。→ Task 7

另外：2a 的本机库（version 1）升级到 version 2 不能丢数据 → Task 4。

---

### Task 1：云端表结构（迁移 + RLS）

**Files:**
- Create: `supabase/migrations/20260930000000_init.sql`
- Create: `src/app/remoteSchema.test.ts`
- Modify: `package.json`（devDependency `@electric-sql/pglite`）

**Interfaces:**
- Produces（Task 2 的行类型、Task 3 的冲突键都照这里）：
  - `transactions`：`user_id, id, date, created_at, type, account_id, instrument_code, qty, price, fee, reason, fx_to_cny, inserted_at`，冲突键 `(user_id, id)`
  - `accounts`：`user_id, id, name, type, currency, market, color, position, updated_at, server_updated_at`，冲突键 `(user_id, id)`
  - `exposures`：`user_id（可空）, id, name, group_id, is_stock, position, updated_at, server_updated_at`，冲突键 `(user_id, id)`（nulls not distinct）
  - `instruments`：`user_id（可空）, code, name, market, currency, exposure_id, pays_dividend, position, updated_at, server_updated_at`，冲突键 `(user_id, code)`
  - `targets`：`user_id, slots jsonb, own_stock jsonb, updated_at, server_updated_at`，冲突键 `(user_id)`
  - `plans`：`user_id, threshold, rebalance_period, calib_period, undefined_mode, annual_spend, target_amount, expected_return, inflation, updated_at, server_updated_at`，冲突键 `(user_id)`
  - 全局预置的 `updated_at` 固定为 `2026-09-30T00:00:00Z`（Task 4 的 `PRESET_STAMP` 用同一个值）

- [ ] **Step 1：装 PGlite**（用户同意之后）

Run: `npm install -D @electric-sql/pglite@^0.5`
Expected: `added 1 package`

- [ ] **Step 2：写失败的测试** `src/app/remoteSchema.test.ts`

```ts
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import migration from '../../supabase/migrations/20260930000000_init.sql?raw';
import { exposures, instruments } from '../mock/catalog';

// 在真实的 Postgres（PGlite）里跑迁移。模拟 Supabase 已有的部分：auth.users、auth.uid()、
// anon / authenticated 两个角色，以及 Supabase 默认给它们的 public 表权限（迁移要自己收回多余的）。
const SUPABASE = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role anon nologin;
  create role authenticated nologin;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
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

/** 以某个登录用户（null 表示未登录）的身份执行；出错时返回错误信息，方便断言 */
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

// PostgREST 的 upsert（merge-duplicates）就是这样的语句
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
      'accounts', 'ai_conversations', 'ai_messages', 'exposures', 'instruments',
      'plans', 'snapshot_items', 'snapshots', 'targets', 'transactions',
    ]);
    expect(rows.filter((r) => !r.relrowsecurity)).toEqual([]);
  });

  it('creates the global presets from the sample catalog', async () => {
    const ex = (await db.query('select id, name, group_id, is_stock from public.exposures where user_id is null order by position')).rows;
    expect(ex).toEqual(exposures.map((e) => ({ id: e.id, name: e.name, group_id: e.groupId, is_stock: e.isStock })));
    const ins = (
      await db.query('select code, name, market, currency, exposure_id, pays_dividend from public.instruments where user_id is null order by position')
    ).rows;
    expect(ins).toEqual(
      instruments.map((i) => ({ code: i.code, name: i.name, market: i.market, currency: i.currency, exposure_id: i.exposureId, pays_dividend: i.paysDividend })),
    );
  });

  it('shows each user only their own rows plus the global presets', async () => {
    await deposit(A, 'a-1');
    await deposit(B, 'b-1');
    await as(A, `insert into public.exposures (user_id, id, name, group_id, is_stock, position, updated_at) values ($1, 'custom-a', '比特币', 'other', false, 11, $2)`, [A, T0]);
    expect(await as(A, 'select id from public.transactions')).toEqual([{ id: 'a-1' }]);
    const seen = (await as<{ id: string; user_id: string | null }>(A, 'select id, user_id from public.exposures')) as { id: string; user_id: string | null }[];
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
    const rows = (await as<{ name: string; server_updated_at: Date | null }>(A, `select name, server_updated_at from public.accounts where id = 'futu'`)) as {
      name: string;
      server_updated_at: Date | null;
    }[];
    expect(rows[0]!.name).toBe('富途证券');
    expect(rows[0]!.server_updated_at).not.toBeNull();
  });

  it('keeps the latest targets and plan too', async () => {
    const targets = (slots: string, at: string) =>
      as(A, `insert into public.targets (user_id, slots, own_stock, updated_at) values ($1, $2::jsonb, '{}'::jsonb, $3)
             on conflict (user_id) do update set slots = excluded.slots, updated_at = excluded.updated_at`, [A, slots, at]);
    await targets('{"sp500":100}', T1);
    await targets('{"ndx":100}', T0);
    expect(await as(A, 'select slots from public.targets')).toEqual([{ slots: { sp500: 100 } }]);
    const plan = (threshold: number, at: string) =>
      as(A, `insert into public.plans (user_id, threshold, rebalance_period, calib_period, undefined_mode, annual_spend, target_amount, expected_return, inflation, updated_at)
             values ($1, $2, 'quarter', 'quarter', 'sell', 0, 0, 7, 2.5, $3)
             on conflict (user_id) do update set threshold = excluded.threshold, updated_at = excluded.updated_at`, [A, threshold, at]);
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
      await as(A, `insert into public.exposures (user_id, id, name, group_id, is_stock, position, updated_at) values (null, 'hack', 'x', 'other', false, 0, $1)`, [T0]),
    ).toMatch(/row-level security/);
  });
});
```

- [ ] **Step 3：跑测试，确认失败**

Run: `npx vitest run src/app/remoteSchema.test.ts`
Expected: FAIL，找不到 `20260930000000_init.sql`

- [ ] **Step 4：写迁移** `supabase/migrations/20260930000000_init.sql`

```sql
-- 阶段 2 初始表结构。规则见 design_handoff_investment_manager/README.md「数据模型」「本地优先与同步」。
-- 用法：在 Supabase 控制台的 SQL Editor 里整段执行一次（见 docs/supabase-setup.md）。

-- 设置类数据「以最后修改的为准」：updated_at 不比现有的新的改动直接跳过；
-- 每次写入记下服务器时间（server_updated_at），其他设备按它增量拉取。
create function public.keep_latest() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at <= old.updated_at then
    return null;
  end if;
  new.server_updated_at := now();
  return new;
end;
$$;

create table public.accounts (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  type text not null check (type in ('broker', 'bank')),
  currency text not null check (currency in ('CNY', 'USD')),
  market text not null,
  color text,
  position integer not null default 0,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- user_id 为空的行是全局预置（所有人只读，由迁移维护）；不为空的是用户自建。
-- 可空列不能进主键，所以另加自增主键，(user_id, id) 用 nulls not distinct 保证唯一。
create table public.exposures (
  pk bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  id text not null,
  name text not null,
  group_id text not null,
  is_stock boolean not null default false,
  position integer not null default 0,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  unique nulls not distinct (user_id, id)
);

create table public.instruments (
  pk bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  code text not null,
  name text not null,
  market text not null,
  currency text not null check (currency in ('CNY', 'USD')),
  exposure_id text not null,
  pays_dividend boolean not null default false,
  position integer not null default 0,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default now(),
  unique nulls not distinct (user_id, code)
);

-- 流水只增不改：只给读取和新增；同一笔重复上传按 (user_id, id) 只记一次。
-- inserted_at 是服务器收到的时间：离线补传的旧日期流水，其他设备也能按它拉到。
create table public.transactions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  date date not null,
  created_at timestamptz not null,
  type text not null check (type in ('opening', 'buy', 'sell', 'deposit', 'withdraw', 'calibrate')),
  account_id text not null,
  instrument_code text not null,
  qty numeric not null,
  price numeric not null,
  fee numeric not null default 0,
  reason text,
  fx_to_cny numeric not null,
  inserted_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index transactions_user_inserted_at on public.transactions (user_id, inserted_at);

-- 目标组合整组一行：合计必须 100%，按槽位分行各自「以最后修改为准」可能合出不等于 100% 的组合
create table public.targets (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  slots jsonb not null,
  own_stock jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default now()
);

create table public.plans (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  threshold numeric not null,
  rebalance_period text not null check (rebalance_period in ('month', 'quarter', 'year')),
  calib_period text not null check (calib_period in ('month', 'quarter', 'year')),
  undefined_mode text not null check (undefined_mode in ('sell', 'ignore')),
  annual_spend numeric not null,
  target_amount numeric not null,
  expected_return numeric not null,
  inflation numeric not null,
  updated_at timestamptz not null,
  server_updated_at timestamptz not null default now()
);

-- 以下几张表这一阶段只建好，写入在阶段 3 / 4 / 6
create table public.snapshots (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  total_value_cny numeric not null,
  net_invested_cny numeric not null,
  usd_cny numeric not null,
  primary key (user_id, date)
);

create table public.snapshot_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  exposure_id text not null,
  value_cny numeric not null,
  primary key (user_id, date, exposure_id)
);

create table public.ai_conversations (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  title text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (user_id, id)
);

create table public.ai_messages (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  conversation_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null,
  primary key (user_id, id)
);

create trigger accounts_keep_latest before insert or update on public.accounts for each row execute function public.keep_latest();
create trigger exposures_keep_latest before insert or update on public.exposures for each row execute function public.keep_latest();
create trigger instruments_keep_latest before insert or update on public.instruments for each row execute function public.keep_latest();
create trigger targets_keep_latest before insert or update on public.targets for each row execute function public.keep_latest();
create trigger plans_keep_latest before insert or update on public.plans for each row execute function public.keep_latest();

-- 权限：未登录（anon）什么都碰不到；登录用户再由下面的 RLS 限定到自己的行
revoke all on public.accounts, public.exposures, public.instruments, public.transactions, public.targets, public.plans,
  public.snapshots, public.snapshot_items, public.ai_conversations, public.ai_messages from anon, authenticated;
grant select, insert, update, delete on public.accounts, public.exposures, public.instruments, public.targets, public.plans,
  public.ai_conversations, public.ai_messages to authenticated;
grant select, insert on public.transactions, public.snapshots, public.snapshot_items to authenticated;

alter table public.accounts enable row level security;
alter table public.exposures enable row level security;
alter table public.instruments enable row level security;
alter table public.transactions enable row level security;
alter table public.targets enable row level security;
alter table public.plans enable row level security;
alter table public.snapshots enable row level security;
alter table public.snapshot_items enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

create policy "own rows" on public.accounts for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.targets for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.plans for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.ai_conversations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows" on public.ai_messages for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "read own and global" on public.exposures for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy "insert own" on public.exposures for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own" on public.exposures for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own" on public.exposures for delete to authenticated using (user_id = (select auth.uid()));

create policy "read own and global" on public.instruments for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy "insert own" on public.instruments for insert to authenticated with check (user_id = (select auth.uid()));
create policy "update own" on public.instruments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "delete own" on public.instruments for delete to authenticated using (user_id = (select auth.uid()));

create policy "read own" on public.transactions for select to authenticated using (user_id = (select auth.uid()));
create policy "insert own" on public.transactions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "read own" on public.snapshots for select to authenticated using (user_id = (select auth.uid()));
create policy "insert own" on public.snapshots for insert to authenticated with check (user_id = (select auth.uid()));
create policy "read own" on public.snapshot_items for select to authenticated using (user_id = (select auth.uid()));
create policy "insert own" on public.snapshot_items for insert to authenticated with check (user_id = (select auth.uid()));

-- 全局预置：底层资产和品种（和 src/mock/catalog.ts 一致，测试会逐项核对）
insert into public.exposures (user_id, id, name, group_id, is_stock, position, updated_at) values
  (null, 'sp500', '标普 500', 'us', false, 0, '2026-09-30T00:00:00Z'),
  (null, 'ndx', '纳斯达克 100', 'us', false, 1, '2026-09-30T00:00:00Z'),
  (null, 'brk', '伯克希尔', 'stk', true, 2, '2026-09-30T00:00:00Z'),
  (null, 'aapl', '苹果', 'stk', true, 3, '2026-09-30T00:00:00Z'),
  (null, 'moutai', '贵州茅台', 'stk', true, 4, '2026-09-30T00:00:00Z'),
  (null, 'exus', '全球除美', 'intl', false, 5, '2026-09-30T00:00:00Z'),
  (null, 'csi300', '沪深 300', 'cn', false, 6, '2026-09-30T00:00:00Z'),
  (null, 'ust10', '10 年期美债', 'bond', false, 7, '2026-09-30T00:00:00Z'),
  (null, 'gold', '黄金', 'gold', false, 8, '2026-09-30T00:00:00Z'),
  (null, 'usd', '美元现金', 'cash', false, 9, '2026-09-30T00:00:00Z'),
  (null, 'cny', '人民币现金', 'cash', false, 10, '2026-09-30T00:00:00Z');

insert into public.instruments (user_id, code, name, market, currency, exposure_id, pays_dividend, position, updated_at) values
  (null, 'VOO', 'Vanguard 标普500', '美股', 'USD', 'sp500', true, 0, '2026-09-30T00:00:00Z'),
  (null, '513500', '标普500ETF', 'A股', 'CNY', 'sp500', true, 1, '2026-09-30T00:00:00Z'),
  (null, '050025', '博时标普500 QDII', '场外基金', 'CNY', 'sp500', true, 2, '2026-09-30T00:00:00Z'),
  (null, 'QQQ', 'Invesco 纳指100', '美股', 'USD', 'ndx', true, 3, '2026-09-30T00:00:00Z'),
  (null, 'AAPL', '苹果', '美股', 'USD', 'aapl', true, 4, '2026-09-30T00:00:00Z'),
  (null, 'BRK.B', '伯克希尔 B', '美股', 'USD', 'brk', false, 5, '2026-09-30T00:00:00Z'),
  (null, 'VXUS', 'Vanguard 全球除美', '美股', 'USD', 'exus', true, 6, '2026-09-30T00:00:00Z'),
  (null, '510300', '沪深300ETF', 'A股', 'CNY', 'csi300', true, 7, '2026-09-30T00:00:00Z'),
  (null, '600519', '贵州茅台', 'A股', 'CNY', 'moutai', false, 8, '2026-09-30T00:00:00Z'),
  (null, 'IEF', 'iShares 7-10年美债', '美股', 'USD', 'ust10', true, 9, '2026-09-30T00:00:00Z'),
  (null, 'GLD', 'SPDR 黄金', '美股', 'USD', 'gold', false, 10, '2026-09-30T00:00:00Z'),
  (null, '518880', '黄金ETF', 'A股', 'CNY', 'gold', false, 11, '2026-09-30T00:00:00Z'),
  (null, 'USD', '美元现金', '现金', 'USD', 'usd', false, 12, '2026-09-30T00:00:00Z'),
  (null, 'CNY', '人民币现金', '现金', 'CNY', 'cny', false, 13, '2026-09-30T00:00:00Z'),
  (null, 'SPY', 'SPDR 标普500', '美股', 'USD', 'sp500', false, 14, '2026-09-30T00:00:00Z'),
  (null, 'IVV', 'iShares 标普500', '美股', 'USD', 'sp500', false, 15, '2026-09-30T00:00:00Z'),
  (null, 'QQQM', 'Invesco 纳指100', '美股', 'USD', 'ndx', false, 16, '2026-09-30T00:00:00Z'),
  (null, '513100', '纳指ETF', 'A股', 'CNY', 'ndx', false, 17, '2026-09-30T00:00:00Z'),
  (null, '159941', '纳指ETF', 'A股', 'CNY', 'ndx', false, 18, '2026-09-30T00:00:00Z'),
  (null, '270042', '广发纳指100 QDII', '场外基金', 'CNY', 'ndx', false, 19, '2026-09-30T00:00:00Z'),
  (null, 'VEA', 'Vanguard 发达市场', '美股', 'USD', 'exus', false, 20, '2026-09-30T00:00:00Z'),
  (null, '159934', '黄金ETF', 'A股', 'CNY', 'gold', false, 21, '2026-09-30T00:00:00Z'),
  (null, '000216', '华安黄金', '场外基金', 'CNY', 'gold', false, 22, '2026-09-30T00:00:00Z'),
  (null, '000051', '华夏沪深300', '场外基金', 'CNY', 'csi300', false, 23, '2026-09-30T00:00:00Z');
```

- [ ] **Step 5：跑测试，确认通过**

Run: `npx vitest run src/app/remoteSchema.test.ts`
Expected: PASS 10/10。如果 `exposures` 插入报 `permission denied for sequence`，给 identity 序列补 `grant usage`，并记一条 Ruling。

- [ ] **Step 6：类型检查** `npm run typecheck` → 通过（`?raw` 由 vite/client 的类型声明成 string）

---

### Task 2：本机数据 ↔ 云端行

**Files:**
- Create: `src/domain/rows.ts`、`src/domain/rows.test.ts`

**Interfaces:**
- Consumes：Task 1 的列名。
- Produces：
  - `type Num = number | string`
  - `interface RowStamp { updatedAt: string; order: number }`
  - `TxRow`、`AccountRow`、`ExposureRow`、`InstrumentRow`、`TargetsRow`、`PlanRow`（字段见代码）
  - `isoTime(t: string): string`
  - `txToRow(t, userId)` / `rowToTx(r)`
  - `accountToRow(a, stamp, userId)` / `rowToAccount(r)`
  - `exposureToRow(e, stamp, userId)` / `rowToExposure(r)`
  - `instrumentToRow(i, stamp, userId)` / `rowToInstrument(r)`
  - `targetsToRow(targets, ownStock, updatedAt, userId)`
  - `planToRow(p, updatedAt, userId)` / `rowToPlan(r)`
  - `rowStamp(r: { updated_at: string; position: number }): RowStamp`

- [ ] **Step 1：写失败的测试** `src/domain/rows.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { accounts, exposures, instruments } from '../mock/catalog';
import { transactions } from '../mock/ledger';
import { plan } from '../mock/settings';
import {
  accountToRow, exposureToRow, instrumentToRow, isoTime, planToRow, rowStamp, rowToAccount, rowToExposure,
  rowToInstrument, rowToPlan, rowToTx, targetsToRow, txToRow,
} from './rows';

const U = '11111111-1111-1111-1111-111111111111';
const STAMP = { updatedAt: '2026-09-30T08:00:00.000Z', order: 3 };

describe('rows for the cloud', () => {
  it('turns every sample transaction into a row and back unchanged', () => {
    for (const t of transactions) expect(rowToTx(txToRow(t, U))).toEqual(t);
    expect(txToRow(transactions[0]!, U).user_id).toBe(U);
  });

  it('reads times and numbers the way Postgres returns them', () => {
    const row = { ...txToRow(transactions[0]!, U), created_at: '2026-09-29T01:00:00.001+00:00', qty: '5.5', price: '1', fee: '0', fx_to_cny: '7.2' };
    const t = rowToTx(row);
    expect(t.createdAt).toBe('2026-09-29T01:00:00.001Z');
    expect(t.qty).toBe(5.5);
    expect(t.fxToCny).toBe(7.2);
  });

  it('keeps accounts, assets and instruments with their position', () => {
    for (const a of accounts) expect(rowToAccount(accountToRow(a, STAMP, U))).toEqual(a);
    expect(rowToAccount({ ...accountToRow(accounts[0]!, STAMP, U), color: null })).not.toHaveProperty('color');
    for (const e of exposures) expect(rowToExposure(exposureToRow(e, STAMP, U))).toEqual(e);
    for (const i of instruments) expect(rowToInstrument(instrumentToRow(i, STAMP, U))).toEqual(i);
    expect(accountToRow(accounts[0]!, STAMP, U)).toMatchObject({ position: 3, updated_at: STAMP.updatedAt });
    expect(rowStamp({ updated_at: '2026-09-30T08:00:00+00:00', position: 3 })).toEqual(STAMP);
  });

  it('keeps the plan and the whole target set', () => {
    expect(rowToPlan(planToRow(plan, STAMP.updatedAt, U))).toEqual(plan);
    expect(rowToPlan({ ...planToRow(plan, STAMP.updatedAt, U), threshold: '3' })).toEqual(plan);
    expect(targetsToRow({ sp500: 100 }, { AAPL: true }, STAMP.updatedAt, U)).toEqual({
      user_id: U, slots: { sp500: 100 }, own_stock: { AAPL: true }, updated_at: STAMP.updatedAt,
    });
  });

  it('writes times in one format so they sort correctly', () => {
    expect(isoTime('2026-09-30T08:00:00+00:00')).toBe('2026-09-30T08:00:00.000Z');
  });
});
```

- [ ] **Step 2：跑测试，确认失败**：`npx vitest run src/domain/rows.test.ts` → FAIL（找不到 `./rows`）

- [ ] **Step 3：实现** `src/domain/rows.ts`

```ts
import type {
  Account, AccountType, CashCurrency, Exposure, Instrument, Market, OwnStock, Period, Plan, Targets, Transaction, TxType, UndefinedMode,
} from './types';

// 本机数据 ↔ Supabase 表的一行。列名同 supabase/migrations；阶段 4 的 Worker 读流水时也用这里的转换。

/** Postgres 的 numeric 经 PostgREST 返回数字，经 PGlite 返回字符串；读的时候统一转成数字 */
export type Num = number | string;

/** 设置类数据的版本：最后修改时间（ISO）和在列表里的位置 */
export interface RowStamp {
  updatedAt: string;
  order: number;
}

export interface TxRow {
  user_id: string;
  id: string;
  date: string;
  created_at: string;
  type: TxType;
  account_id: string;
  instrument_code: string;
  qty: Num;
  price: Num;
  fee: Num;
  reason: string | null;
  fx_to_cny: Num;
  /** 服务器收到的时间，其他设备按它增量拉取 */
  inserted_at?: string;
}

export interface AccountRow {
  user_id: string;
  id: string;
  name: string;
  type: AccountType;
  currency: CashCurrency;
  market: Market;
  color: string | null;
  position: number;
  updated_at: string;
  server_updated_at?: string;
}

export interface ExposureRow {
  /** 为空表示全局预置 */
  user_id: string | null;
  id: string;
  name: string;
  group_id: string;
  is_stock: boolean;
  position: number;
  updated_at: string;
  server_updated_at?: string;
}

export interface InstrumentRow {
  /** 为空表示全局预置 */
  user_id: string | null;
  code: string;
  name: string;
  market: Market;
  currency: CashCurrency;
  exposure_id: string;
  pays_dividend: boolean;
  position: number;
  updated_at: string;
  server_updated_at?: string;
}

export interface TargetsRow {
  user_id: string;
  slots: Targets;
  own_stock: OwnStock;
  updated_at: string;
  server_updated_at?: string;
}

export interface PlanRow {
  user_id: string;
  threshold: Num;
  rebalance_period: Period;
  calib_period: Period;
  undefined_mode: UndefinedMode;
  annual_spend: Num;
  target_amount: Num;
  expected_return: Num;
  inflation: Num;
  updated_at: string;
  server_updated_at?: string;
}

/** 时间统一成 toISOString 的格式（Postgres 返回 +00:00）；比较先后和排序都按字符串，格式必须一致 */
export const isoTime = (t: string): string => new Date(t).toISOString();

export function txToRow(t: Transaction, userId: string): TxRow {
  return {
    user_id: userId,
    id: t.id,
    date: t.date,
    created_at: t.createdAt,
    type: t.type,
    account_id: t.accountId,
    instrument_code: t.instrumentCode,
    qty: t.qty,
    price: t.price,
    fee: t.fee,
    reason: t.reason ?? null,
    fx_to_cny: t.fxToCny,
  };
}

export function rowToTx(r: TxRow): Transaction {
  return {
    id: r.id,
    date: r.date,
    createdAt: isoTime(r.created_at),
    type: r.type,
    accountId: r.account_id,
    instrumentCode: r.instrument_code,
    qty: Number(r.qty),
    price: Number(r.price),
    fee: Number(r.fee),
    ...(r.reason != null ? { reason: r.reason } : {}),
    fxToCny: Number(r.fx_to_cny),
  };
}

export function accountToRow(a: Account, s: RowStamp, userId: string): AccountRow {
  return {
    user_id: userId,
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency,
    market: a.market,
    color: a.color ?? null,
    position: s.order,
    updated_at: s.updatedAt,
  };
}

export function rowToAccount(r: AccountRow): Account {
  return { id: r.id, name: r.name, type: r.type, currency: r.currency, market: r.market, ...(r.color != null ? { color: r.color } : {}) };
}

export function exposureToRow(e: Exposure, s: RowStamp, userId: string): ExposureRow {
  return { user_id: userId, id: e.id, name: e.name, group_id: e.groupId, is_stock: e.isStock, position: s.order, updated_at: s.updatedAt };
}

export function rowToExposure(r: ExposureRow): Exposure {
  return { id: r.id, name: r.name, groupId: r.group_id, isStock: r.is_stock };
}

export function instrumentToRow(i: Instrument, s: RowStamp, userId: string): InstrumentRow {
  return {
    user_id: userId,
    code: i.code,
    name: i.name,
    market: i.market,
    currency: i.currency,
    exposure_id: i.exposureId,
    pays_dividend: i.paysDividend,
    position: s.order,
    updated_at: s.updatedAt,
  };
}

export function rowToInstrument(r: InstrumentRow): Instrument {
  return { code: r.code, name: r.name, market: r.market, currency: r.currency, exposureId: r.exposure_id, paysDividend: r.pays_dividend };
}

export function targetsToRow(targets: Targets, ownStock: OwnStock, updatedAt: string, userId: string): TargetsRow {
  return { user_id: userId, slots: targets, own_stock: ownStock, updated_at: updatedAt };
}

export function planToRow(p: Plan, updatedAt: string, userId: string): PlanRow {
  return {
    user_id: userId,
    threshold: p.threshold,
    rebalance_period: p.rebalancePeriod,
    calib_period: p.calibPeriod,
    undefined_mode: p.undefinedMode,
    annual_spend: p.annualSpend,
    target_amount: p.targetAmount,
    expected_return: p.expectedReturnPct,
    inflation: p.inflationPct,
    updated_at: updatedAt,
  };
}

export function rowToPlan(r: PlanRow): Plan {
  return {
    threshold: Number(r.threshold),
    rebalancePeriod: r.rebalance_period,
    calibPeriod: r.calib_period,
    undefinedMode: r.undefined_mode,
    annualSpend: Number(r.annual_spend),
    targetAmount: Number(r.target_amount),
    expectedReturnPct: Number(r.expected_return),
    inflationPct: Number(r.inflation),
  };
}

export const rowStamp = (r: { updated_at: string; position: number }): RowStamp => ({ updatedAt: isoTime(r.updated_at), order: r.position });
```

- [ ] **Step 4：跑测试，确认通过**：`npx vitest run src/domain/rows.test.ts` → PASS 5/5；`npm run typecheck` 通过（含 tsconfig.domain.json）

---

### Task 3：云端连接（supabase-js）

**Files:**
- Create: `src/env.d.ts`、`src/app/supabase.ts`、`src/app/remote.ts`、`src/app/remote.test.ts`
- Modify: `package.json`（dependency `@supabase/supabase-js`）

**Interfaces:**
- Consumes：Task 2 的行类型。
- Produces：
  - `createSupabase(env: SupabaseEnv, options?: { fetch?: typeof fetch; storage?: SupportedStorage }): SupabaseClient | null`
  - `AUTH_STORAGE_KEY = 'invest-manager-auth'`
  - `type SettingsKind = 'account' | 'exposure' | 'instrument' | 'targets' | 'plan'`
  - `interface SettingsRows { account: AccountRow; exposure: ExposureRow; instrument: InstrumentRow; targets: TargetsRow; plan: PlanRow }`
  - `interface RemoteChanges { transactions; accounts; exposures; instruments; targets; plans }`（各为对应行数组）
  - `class RemoteError extends Error { kind: 'auth' | 'network' | 'server' }`
  - `interface Remote`：
    - `insertTransactions(rows: readonly TxRow[]): Promise<void>`
    - `upsert<K extends SettingsKind>(kind: K, rows: readonly SettingsRows[K][]): Promise<void>`
    - `pull(since: string | null): Promise<RemoteChanges>`
  - `createSupabaseRemote(client: SupabaseClient): Remote`

- [ ] **Step 1：装 supabase-js**（用户同意之后）：`npm install @supabase/supabase-js@^2.117` → `added N packages`

- [ ] **Step 2：写失败的测试** `src/app/remote.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { txToRow } from '../domain/rows';
import { transactions } from '../mock/ledger';
import { RemoteError, createSupabaseRemote } from './remote';
import { AUTH_STORAGE_KEY, createSupabase } from './supabase';

const U = '11111111-1111-1111-1111-111111111111';
const URL_BASE = 'https://proj.supabase.co';

/** 本机存着一个还没过期的登录 */
function signedInStorage() {
  const session = {
    access_token: 'token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'refresh', user: { id: U, email: 'me@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
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

const setup = (reply: (url: URL, init: RequestInit) => Reply, storage = signedInStorage()) => {
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
      { user_id: U, code: 'ABCD', name: '', market: '美股', currency: 'USD', exposure_id: 'ndx', pays_dividend: false, position: 24, updated_at: '2026-09-30T08:00:00.000Z' },
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

  it('tells an expired login apart from a network problem', async () => {
    const expired = setup(() => ({ status: 401, body: { code: 'PGRST301', message: 'JWT expired' } }));
    await expect(expired.remote.pull(null)).rejects.toMatchObject({ kind: 'auth' });
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
```

- [ ] **Step 3：跑测试，确认失败**：`npx vitest run src/app/remote.test.ts` → FAIL（找不到 `./remote`）

- [ ] **Step 4：实现**

`src/env.d.ts`：

```ts
// .env.local 里的云端配置（不进 git）；缺了就进不了登录页，显示配置说明
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}
```

`src/app/supabase.ts`：

```ts
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient, SupportedStorage } from '@supabase/supabase-js';

// 云端连接。Project URL 和 anon key 放在 .env.local（不进 git），这里只读；service role key 不放前端。

export interface SupabaseEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/** 登录状态存在本机的这个键下；登录要长期有效，离线时也要能读到 */
export const AUTH_STORAGE_KEY = 'invest-manager-auth';

export function createSupabase(env: SupabaseEnv, options: { fetch?: typeof fetch; storage?: SupportedStorage } = {}): SupabaseClient | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      ...(options.storage ? { storage: options.storage } : {}),
    },
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
  });
}
```

`src/app/remote.ts`：

```ts
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AccountRow, ExposureRow, InstrumentRow, PlanRow, TargetsRow, TxRow } from '../domain/rows';

// 同步引擎要用的云端操作。真实实现走 supabase-js（PostgREST）；测试用 fakeRemote.ts 里语义相同的内存版本。

export type SettingsKind = 'account' | 'exposure' | 'instrument' | 'targets' | 'plan';

export interface SettingsRows {
  account: AccountRow;
  exposure: ExposureRow;
  instrument: InstrumentRow;
  targets: TargetsRow;
  plan: PlanRow;
}

export interface RemoteChanges {
  transactions: TxRow[];
  accounts: AccountRow[];
  exposures: ExposureRow[];
  instruments: InstrumentRow[];
  targets: TargetsRow[];
  plans: PlanRow[];
}

export type RemoteErrorKind = 'auth' | 'network' | 'server';

export class RemoteError extends Error {
  readonly kind: RemoteErrorKind;
  constructor(kind: RemoteErrorKind, message: string) {
    super(message);
    this.name = 'RemoteError';
    this.kind = kind;
  }
}

export interface Remote {
  /** 上传流水；同一笔（user_id, id）已经在云端的跳过，不报错 */
  insertTransactions(rows: readonly TxRow[]): Promise<void>;
  /** 上传设置；云端只接受 updated_at 比现有更晚的（数据库触发器保证） */
  upsert<K extends SettingsKind>(kind: K, rows: readonly SettingsRows[K][]): Promise<void>;
  /** 拉取服务器时间 since 之后新增或改过的行（含全局预置）；since 为 null 时拉全部 */
  pull(since: string | null): Promise<RemoteChanges>;
}

const PAGE = 1000;
const BATCH = 500;

const SETTINGS: Record<SettingsKind, { table: string; conflict: string }> = {
  account: { table: 'accounts', conflict: 'user_id,id' },
  exposure: { table: 'exposures', conflict: 'user_id,id' },
  instrument: { table: 'instruments', conflict: 'user_id,code' },
  targets: { table: 'targets', conflict: 'user_id' },
  plan: { table: 'plans', conflict: 'user_id' },
};

interface Result {
  error: { message: string; code?: string } | null;
  status: number;
}

function check(r: Result): void {
  if (!r.error) return;
  if (r.status === 401 || r.error.code === 'PGRST301' || r.error.code === 'PGRST302') throw new RemoteError('auth', r.error.message);
  if (r.status === 0) throw new RemoteError('network', r.error.message);
  throw new RemoteError('server', r.error.message);
}

export function createSupabaseRemote(client: SupabaseClient): Remote {
  // 先确认本机有有效的登录：续登录时连不上算网络问题（下次再试），没有登录算需要重新登录
  const ensureSession = async () => {
    const { data, error } = await client.auth.getSession();
    if (data.session) return;
    if (error && isAuthRetryableFetchError(error)) throw new RemoteError('network', error.message);
    throw new RemoteError('auth', '需要重新登录');
  };

  const pullTable = async <T>(table: string, column: string, since: string | null): Promise<T[]> => {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = client.from(table).select('*');
      if (since) query = query.gt(column, since);
      const r = await query.order(column, { ascending: true }).range(from, from + PAGE - 1);
      check(r);
      const page = (r.data ?? []) as T[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  };

  return {
    async insertTransactions(rows) {
      if (rows.length === 0) return;
      await ensureSession();
      for (let i = 0; i < rows.length; i += BATCH) {
        check(await client.from('transactions').upsert(rows.slice(i, i + BATCH), { onConflict: 'user_id,id', ignoreDuplicates: true }));
      }
    },
    async upsert(kind, rows) {
      if (rows.length === 0) return;
      await ensureSession();
      const { table, conflict } = SETTINGS[kind];
      check(await client.from(table).upsert([...rows], { onConflict: conflict }));
    },
    async pull(since) {
      await ensureSession();
      const [transactions, accounts, exposures, instruments, targets, plans] = await Promise.all([
        pullTable<TxRow>('transactions', 'inserted_at', since),
        pullTable<AccountRow>('accounts', 'server_updated_at', since),
        pullTable<ExposureRow>('exposures', 'server_updated_at', since),
        pullTable<InstrumentRow>('instruments', 'server_updated_at', since),
        pullTable<TargetsRow>('targets', 'server_updated_at', since),
        pullTable<PlanRow>('plans', 'server_updated_at', since),
      ]);
      return { transactions, accounts, exposures, instruments, targets, plans };
    },
  };
}
```

- [ ] **Step 5：跑测试，确认通过**：`npx vitest run src/app/remote.test.ts` → PASS 8/8；`npm run typecheck` 通过

---

### Task 4：本机库 v2（待同步队列）+ 写入云端改动

**Files:**
- Modify: `src/app/localDb.ts`、`src/app/persistence.ts`、`src/app/persistence.test.ts`
- Create: `src/app/merge.ts`、`src/app/merge.test.ts`

**Interfaces:**
- Consumes：Task 2 的 `rowToTx`、`rowToAccount`、`rowToExposure`、`rowToInstrument`、`rowToPlan`、`rowStamp`、`isoTime`；Task 3 的 `RemoteChanges`、`SettingsKind`。
- Produces：
  - `type OutboxKind = 'tx' | SettingsKind`
  - `interface OutboxRow { seq?: number; kind: OutboxKind; key: string }`
  - `LocalDb.outbox: EntityTable<OutboxRow, 'seq'>`
  - `Stamped<T> = T & { updatedAt: string; order: number; own?: boolean }`：`own` 为 true 表示用户自建的底层资产 / 品种，要上传
  - `userDbName(userId: string): string`
  - `PRESET_STAMP = '2026-09-30T00:00:00.000Z'`
  - `emptyData(prefs): LocalData`：没有账户和流水，底层资产和品种是全局预置
  - `attachLocalDb(store, db, now, onError, onQueued?: () => void): LocalController`
  - `LocalController { flush(): Promise<void>; applyRemote(changes: RemoteChanges): Promise<void>; detach(): void }`：去掉 `resetToSample`
  - `mergeLatest<T>(current, local, remote, key): { list: T[]; won: Versioned<T>[] }`
  - `interface Versioned<T> { value: T; updatedAt: string; order: number; own?: boolean }`

- [ ] **Step 1：写失败的测试** `src/app/merge.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { mergeLatest } from './merge';

type Item = { id: string; name: string };
const key = (x: Item) => x.id;
const local = new Map([
  ['a', { updatedAt: '2026-09-30T08:00:00.000Z', order: 0 }],
  ['b', { updatedAt: '2026-09-30T08:00:00.000Z', order: 1 }],
]);
const current: Item[] = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];

describe('merging cloud changes into this device', () => {
  it('takes a newer version from the cloud and ignores an older one', () => {
    const r = mergeLatest(current, local, [
      { value: { id: 'a', name: 'A2' }, updatedAt: '2026-09-30T09:00:00.000Z', order: 0 },
      { value: { id: 'b', name: 'B-old' }, updatedAt: '2026-09-30T07:00:00.000Z', order: 1 },
    ], key);
    expect(r.list).toEqual([{ id: 'a', name: 'A2' }, { id: 'b', name: 'B' }]);
    expect(r.won.map((w) => w.value.id)).toEqual(['a']);
  });

  it('adds new items in their position', () => {
    const r = mergeLatest(current, local, [{ value: { id: 'z', name: 'Z' }, updatedAt: '2026-09-30T09:00:00.000Z', order: 1 }], key);
    expect(r.list.map((x) => x.id)).toEqual(['a', 'z', 'b']);
  });

  it('never lets a global preset replace something the user made', () => {
    const own = new Map([['a', { updatedAt: '2026-09-30T08:00:00.000Z', order: 0, own: true }]]);
    const r = mergeLatest([{ id: 'a', name: '我的' }], own, [
      { value: { id: 'a', name: '预置' }, updatedAt: '2026-10-09T00:00:00.000Z', order: 0, own: false },
    ], key);
    expect(r.list).toEqual([{ id: 'a', name: '我的' }]);
    expect(r.won).toEqual([]);
  });

  it('keeps items only this device has, such as ones not uploaded yet', () => {
    const withNew = [...current, { id: 'n', name: 'New' }];
    const r = mergeLatest(withNew, local, [{ value: { id: 'a', name: 'A2' }, updatedAt: '2026-09-30T09:00:00.000Z', order: 0 }], key);
    expect(r.list.map((x) => x.id)).toEqual(['a', 'b', 'n']);
  });
});
```

- [ ] **Step 2：跑测试，确认失败**：`npx vitest run src/app/merge.test.ts` → FAIL（找不到 `./merge`）

- [ ] **Step 3：实现** `src/app/merge.ts`

```ts
// 把云端拉来的设置并进本机：比本机新的覆盖本机（以最后修改为准），本机没有的加进来，按位置排序。
// 全局预置（own 为 false）不覆盖用户自建的同名项。

export interface Versioned<T> {
  value: T;
  updatedAt: string;
  order: number;
  own?: boolean;
}

export interface LocalVersion {
  updatedAt: string;
  order: number;
  own?: boolean;
}

/**
 * current 是界面上现在的列表（可能含还没写库的新改动）；local 是本机库里各项的版本。
 * 返回合并后的列表和胜出的远端版本（要写进本机库）。
 */
export function mergeLatest<T>(
  current: readonly T[],
  local: ReadonlyMap<string, LocalVersion>,
  remote: readonly Versioned<T>[],
  key: (x: T) => string,
): { list: T[]; won: Versioned<T>[] } {
  const won = remote.filter((r) => {
    const l = local.get(key(r.value));
    if (!l) return true;
    if (r.own === false && l.own) return false;
    return r.updatedAt > l.updatedAt;
  });
  if (won.length === 0) return { list: [...current], won };
  const winner = new Map(won.map((w) => [key(w.value), w]));
  const orderOf = (x: T, index: number) => winner.get(key(x))?.order ?? local.get(key(x))?.order ?? Number.MAX_SAFE_INTEGER - current.length + index;
  const merged = current.map((x) => winner.get(key(x))?.value ?? x);
  const known = new Set(current.map(key));
  const added = won.filter((w) => !known.has(key(w.value))).map((w) => w.value);
  const list = [...merged, ...added]
    .map((x, index) => ({ x, order: orderOf(x, index), index }))
    .sort((p, q) => p.order - q.order || p.index - q.index)
    .map((p) => p.x);
  return { list, won };
}
```

- [ ] **Step 4：跑测试，确认通过**：`npx vitest run src/app/merge.test.ts` → PASS 4/4

- [ ] **Step 5：写失败的测试**（改 `src/app/persistence.test.ts`）
  - 删掉 `resetting to the sample data` 整组（两条），恢复示例改为 Task 8 的「导入示例数据」。
  - 在 `writing changes back` 组里加：

```ts
  it('queues each new record for upload in the order it was made', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    const base = store.getState().transactions[0]!;
    store.getState().appendTransactions([{ ...base, id: 'n-1' }]);
    store.getState().appendTransactions([{ ...base, id: 'n-2' }]);
    await local.flush();
    expect((await db.outbox.orderBy('seq').toArray()).map((e) => `${e.kind}:${e.key}`)).toEqual(['tx:n-1', 'tx:n-2']);
  });

  it('queues changed settings but not display preferences or quotes', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    const s = store.getState();
    s.addAccount({ id: 'tiger', name: '老虎', type: 'broker', currency: 'USD', market: '美股' });
    s.addExposure({ id: 'custom-btc', name: '比特币', groupId: 'other', isStock: false });
    s.saveTargets({ sp500: 100 }, {});
    s.updatePlan({ threshold: 5 });
    s.toggleHideAmounts();
    store.setState({ prices: { ...s.prices, VOO: 1 } });
    await local.flush();
    expect((await db.outbox.toArray()).map((e) => `${e.kind}:${e.key}`).sort()).toEqual(['account:tiger', 'exposure:custom-btc', 'plan:plan', 'targets:targets']);
    expect((await db.exposures.get('custom-btc'))!.own).toBe(true);
  });

  it('tells the sync that something new is waiting', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    let queued = 0;
    const local = attachLocalDb(store, db, () => NOW, () => {}, () => (queued += 1));
    store.getState().updatePlan({ threshold: 5 });
    await local.flush();
    expect(queued).toBe(1);
  });
```

  - 新增一组 `upgrading the device database`：

```ts
describe('upgrading the device database', () => {
  it('keeps the data saved before the upload queue existed', async () => {
    const name = `test-v1-${++n}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ transactions: 'id, date, createdAt', accounts: 'id', exposures: 'id', instruments: 'code', kv: 'key' });
    await v1.open();
    const store = createAppStore(deps);
    await saveAll(v1 as unknown as LocalDb, dataFromState(store.getState()), NOW);
    v1.close();
    const v2 = openLocalDb(name);
    dbs.push(v2);
    const back = await loadData(v2);
    expect(back!.transactions).toHaveLength(36);
    expect(await v2.outbox.count()).toBe(0);
  });
});
```

  - 新增一组 `applying changes from the cloud`（`U`、`row`、`cloudTx` 为测试内的帮助函数）：

```ts
describe('applying changes from the cloud', () => {
  const U = '11111111-1111-1111-1111-111111111111';
  const none = { transactions: [], accounts: [], exposures: [], instruments: [], targets: [], plans: [] };
  const setup = async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    return { db, store, local };
  };
  const cloudTx = (id: string) => ({ ...txToRow({ ...createAppStore(deps).getState().transactions[0]!, id }, U), inserted_at: '2026-09-30T09:00:00+00:00' });

  it('adds records from another device without sending them back', async () => {
    const { db, store, local } = await setup();
    await local.applyRemote({ ...none, transactions: [cloudTx('other-1')] });
    await local.flush();
    expect(store.getState().transactions.map((t) => t.id)).toContain('other-1');
    expect(await db.transactions.get('other-1')).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
    // 之后本机再记一笔，拉来的那笔也不会被当成新的再写一遍
    store.getState().appendTransactions([{ ...store.getState().transactions[0]!, id: 'mine-1' }]);
    await local.flush();
    expect((await db.outbox.toArray()).map((e) => e.key)).toEqual(['mine-1']);
  });

  it('takes a newer setting from the cloud and keeps its time', async () => {
    const { db, store, local } = await setup();
    const account = { ...accountToRow(store.getState().accounts[0]!, { updatedAt: '2026-09-30T09:00:00.000Z', order: 0 }, U), name: '富途牛牛' };
    await local.applyRemote({ ...none, accounts: [account] });
    expect(store.getState().accounts[0]!.name).toBe('富途牛牛');
    expect((await db.accounts.get('futu'))!.updatedAt).toBe('2026-09-30T09:00:00.000Z');
    expect(await db.outbox.count()).toBe(0);
  });

  it('keeps a newer change made on this device', async () => {
    const { store, local } = await setup();
    // 本机 08:00（NOW）改的，云端那份是 07:00 的
    store.getState().updatePlan({ threshold: 6 });
    await local.flush();
    await local.applyRemote({ ...none, plans: [{ ...planToRow(store.getState().plan, '2026-09-30T07:00:00.000Z', U), threshold: 9 }] });
    expect(store.getState().plan.threshold).toBe(6);
  });

  it('drops a queued change that a newer one from the cloud replaced', async () => {
    const { db, store, local } = await setup();
    store.getState().updatePlan({ threshold: 6 });
    await local.flush();
    expect(await db.outbox.count()).toBe(1);
    await local.applyRemote({ ...none, plans: [{ ...planToRow(store.getState().plan, '2026-09-30T09:00:00.000Z', U), threshold: 9 }] });
    expect(store.getState().plan.threshold).toBe(9);
    expect(await db.outbox.count()).toBe(0);
  });
});
```

- [ ] **Step 6：跑测试，确认失败**：`npx vitest run src/app/persistence.test.ts` → FAIL（`db.outbox` 不存在、`applyRemote` 不是函数）

- [ ] **Step 7：实现**

`src/app/localDb.ts`（整体替换）：

```ts
import Dexie from 'dexie';
import type { EntityTable } from 'dexie';
import type { Account, Exposure, Instrument, Transaction } from '../domain/types';
import type { SettingsKind } from './remote';

// 本机数据库（IndexedDB，经 Dexie），每个账号一个库。表结构改动时加新版本并写升级步骤，不要改已有的版本。

export interface KvRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * 设置类数据存进本机时多带几个字段：
 * - updatedAt：最后修改时间，同步时按它「以最后修改为准」；
 * - order：在列表里的位置（IndexedDB 按主键排序返回，不带它刷新后顺序会乱）；
 * - own：底层资产、品种是用户自建的（要上传），还是全局预置。
 */
export type Stamped<T> = T & { updatedAt: string; order: number; own?: boolean };

export type OutboxKind = 'tx' | SettingsKind;

/** 待同步队列的一项：按 seq 顺序上传；上传时读本机库里这一项的最新内容 */
export interface OutboxRow {
  seq?: number;
  kind: OutboxKind;
  key: string;
}

export type LocalDb = Dexie & {
  transactions: EntityTable<Transaction, 'id'>;
  accounts: EntityTable<Stamped<Account>, 'id'>;
  exposures: EntityTable<Stamped<Exposure>, 'id'>;
  instruments: EntityTable<Stamped<Instrument>, 'code'>;
  kv: EntityTable<KvRow, 'key'>;
  outbox: EntityTable<OutboxRow, 'seq'>;
};

export const userDbName = (userId: string) => `invest-manager-${userId}`;

export function openLocalDb(name = 'invest-manager'): LocalDb {
  const db = new Dexie(name) as LocalDb;
  db.version(1).stores({
    transactions: 'id, date, createdAt',
    accounts: 'id',
    exposures: 'id',
    instruments: 'code',
    kv: 'key',
  });
  // 第 2 版：待同步队列
  db.version(2).stores({ outbox: '++seq, kind' });
  return db;
}
```

`src/app/persistence.ts` 的改动：

1. 新增导入：

```ts
import type { Table } from 'dexie';
import { isoTime, rowStamp, rowToAccount, rowToExposure, rowToInstrument, rowToPlan, rowToTx } from '../domain/rows';
import { mergeLatest } from './merge';
import type { LocalVersion, Versioned } from './merge';
import type { OutboxKind } from './localDb';
import type { RemoteChanges } from './remote';
```

2. 新增常量和 `emptyData`（放在 `sampleData` 后面）：

```ts
/** 全局预置的版本时间，和迁移文件里的 updated_at 一致：迁移以后更新预置时用更晚的时间，本机才会跟着换 */
export const PRESET_STAMP = '2026-09-30T00:00:00.000Z';

/** 新账号：没有账户和流水；底层资产、品种是全局预置；计划先用示例的参数（阶段 3 首次录入时再设） */
export function emptyData(prefs: LocalData['prefs']): LocalData {
  const sample = sampleData(prefs);
  const preset = <T extends object>(rows: readonly T[]) => rows.map((r, order) => ({ ...r, updatedAt: PRESET_STAMP, order, own: false }));
  return {
    ...sample,
    transactions: [],
    accounts: [],
    exposures: preset(sample.exposures),
    instruments: preset(sample.instruments),
    targets: {},
    ownStock: {},
  };
}
```

3. `saveAll` 里的 `stamp` 改为保留行上已有的版本时间：

```ts
  const stamp = <T extends object>(rows: readonly T[]) =>
    rows.map((r, order) => ({ ...r, updatedAt: (r as { updatedAt?: string }).updatedAt ?? now, order }));
```

4. `LocalController` 和 `attachLocalDb`：

```ts
export interface LocalController {
  /** 等所有进行中的写入完成（测试用，也在关闭账号前调用） */
  flush: () => Promise<void>;
  /** 把云端拉来的改动并进本机库和界面：不写回、不进待同步队列；被云端更新覆盖掉的本机改动移出队列 */
  applyRemote: (changes: RemoteChanges) => Promise<void>;
  detach: () => void;
}

/**
 * 状态一变就写回本机，并在同一个事务里放进待同步队列：
 * 流水只写新增的（bulkAdd，同 id 不会被覆盖）；账户、底层资产、品种只写新增或改过的那条；
 * 目标组合、计划整条写；行情和显示偏好只存本机，不同步。
 */
export function attachLocalDb(
  store: Store,
  db: LocalDb,
  now: () => string,
  onError: (error: unknown) => void,
  onQueued: () => void = () => {},
): LocalController {
  let paused = false;
  let saved = new Set(store.getState().transactions.map((t) => t.id));
  const pending = new Set<Promise<unknown>>();
  const track = (write: Promise<unknown>) => {
    const p: Promise<unknown> = write.catch(onError).finally(() => pending.delete(p));
    pending.add(p);
  };
  const queue = (tables: Table[], write: () => Promise<unknown>) => track(db.transaction('rw', [...tables, db.outbox], write).then(onQueued));
  const entries = (kind: OutboxKind, keys: readonly string[]) => keys.map((key) => ({ kind, key }));
  // 数组里引用变了的元素就是新增或改过的；order 记下它在列表里的位置
  const changed = <T extends object>(list: readonly T[], before: readonly T[], time: string) => {
    const old = new Set(before);
    return list.flatMap((x, order) => (old.has(x) ? [] : [{ ...x, updatedAt: time, order }]));
  };

  const unsubscribe = store.subscribe((s, prev) => {
    if (paused) return;
    const time = now();
    if (s.transactions !== prev.transactions) {
      const added = s.transactions.filter((t) => !saved.has(t.id));
      for (const t of added) saved.add(t.id);
      if (added.length > 0) {
        queue([db.transactions], async () => {
          await db.transactions.bulkAdd(added);
          await db.outbox.bulkAdd(entries('tx', added.map((t) => t.id)));
        });
      }
    }
    if (s.accounts !== prev.accounts) {
      const rows = changed(s.accounts, prev.accounts, time);
      if (rows.length > 0) {
        queue([db.accounts], async () => {
          await db.accounts.bulkPut(rows);
          await db.outbox.bulkAdd(entries('account', rows.map((r) => r.id)));
        });
      }
    }
    if (s.exposures !== prev.exposures) {
      const rows = changed(s.exposures, prev.exposures, time).map((r) => ({ ...r, own: true }));
      if (rows.length > 0) {
        queue([db.exposures], async () => {
          await db.exposures.bulkPut(rows);
          await db.outbox.bulkAdd(entries('exposure', rows.map((r) => r.id)));
        });
      }
    }
    if (s.instruments !== prev.instruments) {
      const rows = changed(s.instruments, prev.instruments, time).map((r) => ({ ...r, own: true }));
      if (rows.length > 0) {
        queue([db.instruments], async () => {
          await db.instruments.bulkPut(rows);
          await db.outbox.bulkAdd(entries('instrument', rows.map((r) => r.code)));
        });
      }
    }
    if (s.targets !== prev.targets || s.ownStock !== prev.ownStock) {
      queue([db.kv], async () => {
        await db.kv.put(kv('targets', { targets: s.targets, ownStock: s.ownStock }, time));
        await db.outbox.add({ kind: 'targets', key: 'targets' });
      });
    }
    if (s.plan !== prev.plan) {
      queue([db.kv], async () => {
        await db.kv.put(kv('plan', s.plan, time));
        await db.outbox.add({ kind: 'plan', key: 'plan' });
      });
    }
    if (s.prices !== prev.prices || s.fx !== prev.fx || s.navDates !== prev.navDates || s.quotesUpdatedAt !== prev.quotesUpdatedAt) {
      track(db.kv.put(kv('quotes', dataFromState(s).quotes, time)));
    }
    if (s.displayCurrency !== prev.displayCurrency || s.hideAmounts !== prev.hideAmounts) {
      track(db.kv.put(kv('prefs', dataFromState(s).prefs, time)));
    }
  });

  const versions = <T extends { updatedAt: string; order: number; own?: boolean }>(rows: readonly T[], key: (r: T) => string) =>
    new Map<string, LocalVersion>(rows.map((r) => [key(r), { updatedAt: r.updatedAt, order: r.order, ...(r.own !== undefined ? { own: r.own } : {}) }]));

  const applyRemote = async (remote: RemoteChanges) => {
    // 1) 本机各项的版本
    const [accountRows, exposureRows, instrumentRows, targetsRow, planRow] = await Promise.all([
      db.accounts.toArray(),
      db.exposures.toArray(),
      db.instruments.toArray(),
      db.kv.get('targets'),
      db.kv.get('plan'),
    ]);
    // 2) 按界面上现在的状态合并（其间用户的新改动也在里面），暂停写回
    const s = store.getState();
    const newTx = remote.transactions.map(rowToTx).filter((t) => !saved.has(t.id));
    const accounts = mergeLatest(
      s.accounts,
      versions(accountRows, (r) => r.id),
      remote.accounts.map((r): Versioned<Account> => ({ value: rowToAccount(r), ...rowStamp(r) })),
      (a) => a.id,
    );
    const exposures = mergeLatest(
      s.exposures,
      versions(exposureRows, (r) => r.id),
      remote.exposures.map((r): Versioned<Exposure> => ({ value: rowToExposure(r), ...rowStamp(r), own: r.user_id !== null })),
      (e) => e.id,
    );
    const instruments = mergeLatest(
      s.instruments,
      versions(instrumentRows, (r) => r.code),
      remote.instruments.map((r): Versioned<Instrument> => ({ value: rowToInstrument(r), ...rowStamp(r), own: r.user_id !== null })),
      (i) => i.code,
    );
    const t = remote.targets[0];
    const takeTargets = t !== undefined && isoTime(t.updated_at) > (targetsRow?.updatedAt ?? '');
    const p = remote.plans[0];
    const takePlan = p !== undefined && isoTime(p.updated_at) > (planRow?.updatedAt ?? '');
    if (!newTx.length && !accounts.won.length && !exposures.won.length && !instruments.won.length && !takeTargets && !takePlan) return;

    const patch: Partial<AppState> = {};
    if (newTx.length) patch.transactions = sortTransactions([...s.transactions, ...newTx]);
    if (accounts.won.length) patch.accounts = accounts.list;
    if (exposures.won.length) patch.exposures = exposures.list;
    if (instruments.won.length) patch.instruments = instruments.list;
    if (takeTargets) {
      patch.targets = t.slots;
      patch.ownStock = t.own_stock;
    }
    if (takePlan) patch.plan = rowToPlan(p);
    if (patch.transactions || patch.instruments) {
      // 收益历史跟着流水重算（阶段 4 换成云端快照）
      Object.assign(patch, historyState({ ...s, ...patch }));
    }
    paused = true;
    try {
      for (const tx of newTx) saved.add(tx.id);
      store.setState(patch);
    } finally {
      paused = false;
    }

    // 3) 写进本机库；被云端更新覆盖掉的本机改动不再上传
    const stamp = <T>(w: Versioned<T>) => ({ ...w.value, updatedAt: w.updatedAt, order: w.order });
    const stale = new Set([
      ...accounts.won.map((w) => `account:${w.value.id}`),
      ...exposures.won.map((w) => `exposure:${w.value.id}`),
      ...instruments.won.map((w) => `instrument:${w.value.code}`),
      ...(takeTargets ? ['targets:targets'] : []),
      ...(takePlan ? ['plan:plan'] : []),
    ]);
    track(
      db.transaction('rw', [db.transactions, db.accounts, db.exposures, db.instruments, db.kv, db.outbox], async () => {
        await db.transactions.bulkPut(newTx);
        await db.accounts.bulkPut(accounts.won.map(stamp));
        await db.exposures.bulkPut(exposures.won.map((w) => ({ ...stamp(w), own: w.own ?? false })));
        await db.instruments.bulkPut(instruments.won.map((w) => ({ ...stamp(w), own: w.own ?? false })));
        if (takeTargets) await db.kv.put(kv('targets', { targets: t.slots, ownStock: t.own_stock }, isoTime(t.updated_at)));
        if (takePlan) await db.kv.put(kv('plan', rowToPlan(p), isoTime(p.updated_at)));
        const queued = await db.outbox.toArray();
        await db.outbox.bulkDelete(queued.filter((e) => stale.has(`${e.kind}:${e.key}`)).map((e) => e.seq!));
      }),
    );
    await Promise.all([...pending]);
  };

  return {
    flush: async () => {
      await Promise.all([...pending]);
    },
    applyRemote,
    detach: unsubscribe,
  };
}
```

5. 把 `stateFromData` 里算收益历史的部分提成 `historyState`，`stateFromData` 和 `applyRemote` 共用：

```ts
/** 收益历史：阶段 1 由流水和模拟行情逐日推出（阶段 4 换成云端快照） */
export function historyState(s: Pick<AppState, 'transactions' | 'instruments' | 'prices' | 'fx' | 'today'>): Pick<AppState, 'snapshots' | 'snapshotItems'> {
  const history = simulateHistory({
    transactions: s.transactions,
    instruments: Object.fromEntries(s.instruments.map((i) => [i.code, i])),
    prices: s.prices,
    fx: s.fx,
    end: s.today,
  });
  return { snapshots: history.snapshots, snapshotItems: history.items };
}
```

  `stateFromData` 改为返回 `{ …各字段…, ...historyState({ transactions: d.transactions, instruments: d.instruments, prices: d.quotes.prices, fx: d.quotes.fx, today }) }`。

6. 删掉 `resetToSample`：删掉 `LocalController` 里的这一项、`attachLocalDb` 里的实现，以及文件头「重置期间暂停自动写回」那段注释。`paused` 留着，给 `applyRemote` 用。

- [ ] **Step 8：跑测试，确认通过**：`npx vitest run src/app/persistence.test.ts src/app/merge.test.ts` → PASS

- [ ] **Step 9：过渡改动 + 全量测试 + 类型检查**

  `LocalController` 没有 `resetToSample` 了，`src/app/localData.ts` 的 `resetToSample` 只保留内存那一支（Task 7 会删掉整个文件）：

```ts
/** 恢复示例数据：只换界面上的数据（Task 7 起由「导入示例数据」取代） */
export async function resetToSample(): Promise<void> {
  const s = useAppStore.getState();
  useAppStore.setState(stateFromData(sampleData({ displayCurrency: s.displayCurrency, hideAmounts: s.hideAmounts }), s.today));
}
```

  `startLocalData` 保持不变。Run：`npx vitest run` → 全部通过；`npm run typecheck` → 通过。

---

### Task 5：同步引擎

**Files:**
- Create: `src/app/sync.ts`、`src/app/fakeRemote.ts`、`src/app/sync.test.ts`

**Interfaces:**
- Consumes：
  - Task 2 的 `txToRow`、`accountToRow`、`exposureToRow`、`instrumentToRow`、`targetsToRow`、`planToRow`、`isoTime`；
  - Task 3 的 `Remote`、`RemoteChanges`、`RemoteError`；
  - Task 4 的 `LocalDb`、`LocalController`、`emptyData`、`PRESET_STAMP`。
- Produces：
  - `type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signedOut'`
  - `interface SyncStatus { state: SyncState; pending: number; lastSyncedAt: string | null }`
  - `INITIAL_SYNC`、`useSyncStore`
  - `RETRY_MS = [5000, 30000, 120000, 600000]`、`DEBOUNCE_MS = 1500`、`PULL_OVERLAP_MS = 120000`
  - `interface SyncDeps { remote; db; local; userId; isOnline(); now(); schedule(fn, ms); setStatus(patch) }`
  - `startSync(deps): SyncController`，其中 `SyncController = { syncNow(): Promise<void>; requestSync(): void; stop(): void }`
  - `createFakeCloud(): FakeCloud`，其中 `FakeCloud = { remoteFor(userId): Remote & { sinceSeen: (string | null)[] }; rows; failNext(kind, opts?) }`

- [ ] **Step 1：写测试用的假云端** `src/app/fakeRemote.ts`

```ts
import { isoTime } from '../domain/rows';
import type { AccountRow, ExposureRow, InstrumentRow, PlanRow, TargetsRow, TxRow } from '../domain/rows';
import { exposures, instruments } from '../mock/catalog';
import { RemoteError } from './remote';
import type { Remote, RemoteChanges, RemoteErrorKind, SettingsKind, SettingsRows } from './remote';

// 测试用的内存云端，行为和 supabase/migrations 一致：
// - 流水按 (user_id, id) 去重，只增不改；
// - 设置以 updated_at 更新的为准（旧的改动跳过）；
// - 每次写入记服务器时间，拉取按服务器时间过滤；只能看到自己的行和全局预置。

const PRESET = '2026-09-30T00:00:00.000Z';

export interface FakeCloud {
  remoteFor(userId: string): Remote & { sinceSeen: (string | null)[] };
  rows: {
    transactions: TxRow[];
    accounts: AccountRow[];
    exposures: ExposureRow[];
    instruments: InstrumentRow[];
    targets: TargetsRow[];
    plans: PlanRow[];
  };
  /** 下一次调用失败；afterStoring 为 true 时先存下再报错（请求到了、回应丢了） */
  failNext(kind: RemoteErrorKind, opts?: { afterStoring?: boolean }): void;
}

export function createFakeCloud(): FakeCloud {
  let tick = Date.parse('2026-09-30T12:00:00.000Z');
  const serverNow = () => new Date((tick += 1000)).toISOString();
  const rows: FakeCloud['rows'] = {
    transactions: [],
    accounts: [],
    exposures: exposures.map((e, position) => ({
      user_id: null, id: e.id, name: e.name, group_id: e.groupId, is_stock: e.isStock, position, updated_at: PRESET, server_updated_at: PRESET,
    })),
    instruments: instruments.map((i, position) => ({
      user_id: null, code: i.code, name: i.name, market: i.market, currency: i.currency, exposure_id: i.exposureId,
      pays_dividend: i.paysDividend, position, updated_at: PRESET, server_updated_at: PRESET,
    })),
    targets: [],
    plans: [],
  };
  let failure: { kind: RemoteErrorKind; afterStoring: boolean } | null = null;
  const maybeFail = (stage: 'before' | 'after') => {
    if (!failure) return;
    if ((stage === 'before') === failure.afterStoring) return;
    const kind = failure.kind;
    failure = null;
    throw new RemoteError(kind, `fake ${kind}`);
  };

  const keyOf: { [K in SettingsKind]: (r: SettingsRows[K]) => string } = {
    account: (r) => `${r.user_id}:${r.id}`,
    exposure: (r) => `${r.user_id}:${r.id}`,
    instrument: (r) => `${r.user_id}:${r.code}`,
    targets: (r) => r.user_id,
    plan: (r) => r.user_id,
  };
  const tableOf = { account: 'accounts', exposure: 'exposures', instrument: 'instruments', targets: 'targets', plan: 'plans' } as const;

  return {
    rows,
    failNext(kind, opts = {}) {
      failure = { kind, afterStoring: opts.afterStoring ?? false };
    },
    remoteFor(userId) {
      const sinceSeen: (string | null)[] = [];
      const mine = <T extends { user_id: string | null }>(list: T[], global = false) => list.filter((r) => r.user_id === userId || (global && r.user_id === null));
      const after = <T>(list: T[], time: (r: T) => string | undefined, since: string | null) =>
        since === null ? list : list.filter((r) => isoTime(time(r) ?? PRESET) > since);
      return {
        sinceSeen,
        async insertTransactions(txs) {
          maybeFail('before');
          for (const r of txs) {
            if (r.user_id !== userId) throw new RemoteError('server', 'new row violates row-level security policy');
            if (!rows.transactions.some((x) => x.user_id === r.user_id && x.id === r.id)) rows.transactions.push({ ...r, inserted_at: serverNow() });
          }
          maybeFail('after');
        },
        async upsert(kind, list) {
          maybeFail('before');
          const table = rows[tableOf[kind]] as SettingsRows[typeof kind][];
          const key = keyOf[kind] as (r: SettingsRows[typeof kind]) => string;
          for (const r of list) {
            if (r.user_id !== userId) throw new RemoteError('server', 'new row violates row-level security policy');
            const i = table.findIndex((x) => key(x) === key(r));
            if (i >= 0 && !(isoTime(r.updated_at) > isoTime(table[i]!.updated_at))) continue;
            const next = { ...r, server_updated_at: serverNow() };
            if (i >= 0) table[i] = next;
            else table.push(next);
          }
          maybeFail('after');
        },
        async pull(since): Promise<RemoteChanges> {
          maybeFail('before');
          sinceSeen.push(since);
          return {
            transactions: after(mine(rows.transactions), (r) => r.inserted_at, since),
            accounts: after(mine(rows.accounts), (r) => r.server_updated_at, since),
            exposures: after(mine(rows.exposures, true), (r) => r.server_updated_at, since),
            instruments: after(mine(rows.instruments, true), (r) => r.server_updated_at, since),
            targets: after(mine(rows.targets), (r) => r.server_updated_at, since),
            plans: after(mine(rows.plans), (r) => r.server_updated_at, since),
          };
        },
      };
    },
  };
}
```

- [ ] **Step 2：写失败的测试** `src/app/sync.test.ts`

```ts
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveLedger } from '../domain/ledger';
import { createFakeCloud } from './fakeRemote';
import type { FakeCloud } from './fakeRemote';
import { openLocalDb } from './localDb';
import type { LocalDb } from './localDb';
import { attachLocalDb, emptyData, hydrate, stateFromData } from './persistence';
import { createAppStore } from './store';
import { DEBOUNCE_MS, INITIAL_SYNC, PULL_OVERLAP_MS, RETRY_MS, startSync } from './sync';
import type { SyncStatus } from './sync';

const U = '11111111-1111-1111-1111-111111111111';
const storeDeps = { random: () => 0.5, delay: async () => {}, now: () => new Date(2026, 8, 29, 9, 30), schedule: () => () => {} };
let n = 0;
const dbs: LocalDb[] = [];
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete();
});

/** 一台登录了同一账号的设备：本机库、界面状态、同步引擎；定时器手动触发 */
async function device(cloud: FakeCloud, userId = U) {
  const db = openLocalDb(`sync-${++n}`);
  dbs.push(db);
  const store = createAppStore(storeDeps);
  store.setState(stateFromData(emptyData({ displayCurrency: 'CNY', hideAmounts: false }), store.getState().today));
  let clock = Date.parse('2026-09-30T08:00:00.000Z');
  const now = () => new Date((clock += 1000)).toISOString();
  await hydrate(store, db, now);
  let online = true;
  let status: SyncStatus = { ...INITIAL_SYNC };
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const remote = cloud.remoteFor(userId);
  // 先建引擎，再接本机库（onQueued 要调用引擎）
  let requestSync = () => {};
  const local = attachLocalDb(store, db, now, (e) => { throw e; }, () => requestSync());
  const sync = startSync({
    remote, db, local, userId,
    isOnline: () => online,
    now: () => new Date(clock),
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => (t.cancelled = true);
    },
    setStatus: (patch) => (status = { ...status, ...patch }),
  });
  requestSync = sync.requestSync;
  const base = () => store.getState().transactions[0];
  const record = (id: string, qty = 100) =>
    store.getState().appendTransactions([
      { id, date: '2026-09-29', createdAt: now(), type: 'deposit', accountId: 'futu', instrumentCode: 'USD', qty, price: 1, fee: 0, fxToCny: 7.1 },
    ]);
  return {
    db, store, local, sync, remote, timers, base, record,
    status: () => status,
    setOnline: (v: boolean) => (online = v),
    settle: async () => {
      await local.flush();
      await sync.syncNow();
      await local.flush();
    },
  };
}

describe('syncing with the cloud', () => {
  it('uploads new records in the order they were made and empties the queue', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.record('r-1');
    d.record('r-2');
    await d.settle();
    expect(cloud.rows.transactions.map((r) => r.id)).toEqual(['r-1', 'r-2']);
    expect(await d.db.outbox.count()).toBe(0);
    expect(d.status()).toMatchObject({ state: 'idle', pending: 0 });
  });

  it('keeps records while offline and uploads them once back online', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.setOnline(false);
    d.record('r-1');
    d.record('r-2');
    await d.settle();
    expect(cloud.rows.transactions).toEqual([]);
    expect(d.status()).toMatchObject({ state: 'offline', pending: 2 });
    d.setOnline(true);
    await d.settle();
    expect(cloud.rows.transactions).toHaveLength(2);
    expect(d.status().pending).toBe(0);
  });

  it('retries after a lost reply without recording anything twice', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.record('r-1');
    cloud.failNext('network', { afterStoring: true });
    await d.settle();
    expect(d.status()).toMatchObject({ state: 'error', pending: 1 });
    expect(d.timers.at(-1)!.ms).toBe(RETRY_MS[0]);
    d.timers.at(-1)!.fn();
    await d.settle();
    expect(cloud.rows.transactions.filter((r) => r.id === 'r-1')).toHaveLength(1);
    expect(d.status()).toMatchObject({ state: 'idle', pending: 0 });
  });

  it('waits longer after each failed try', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.record('r-1');
    cloud.failNext('server');
    await d.settle();
    cloud.failNext('server');
    d.timers.at(-1)!.fn();
    await d.settle();
    expect(d.timers.filter((t) => RETRY_MS.includes(t.ms as never)).map((t) => t.ms)).toEqual([RETRY_MS[0], RETRY_MS[1]]);
  });

  it('syncs a moment after a change instead of right away', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.record('r-1');
    await d.local.flush();
    expect(d.timers.at(-1)!.ms).toBe(DEBOUNCE_MS);
  });

  it('brings in records made on another device without sending them back', async () => {
    const cloud = createFakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    a.record('from-a');
    await a.settle();
    await b.settle();
    expect(b.store.getState().transactions.map((t) => t.id)).toContain('from-a');
    expect(await b.db.outbox.count()).toBe(0);
  });

  it('keeps the most recent setting whichever device changed it', async () => {
    const cloud = createFakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    a.store.getState().updatePlan({ threshold: 4 });
    await a.settle();
    await b.settle();
    expect(b.store.getState().plan.threshold).toBe(4);
    b.store.getState().updatePlan({ threshold: 7 });
    await b.settle();
    await a.settle();
    expect(a.store.getState().plan.threshold).toBe(7);
  });

  it('ends with the same holdings on two devices that both recorded offline', async () => {
    const cloud = createFakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    a.setOnline(false);
    b.setOnline(false);
    a.record('a-offline', 300);
    b.record('b-offline', 500);
    await a.settle();
    await b.settle();
    a.setOnline(true);
    b.setOnline(true);
    await a.settle();
    await b.settle();
    await a.settle();
    const ids = (d: typeof a) => d.store.getState().transactions.map((t) => t.id).sort();
    expect(ids(a)).toEqual(['a-offline', 'b-offline']);
    expect(ids(b)).toEqual(ids(a));
    const ledger = (d: typeof a) => {
      const s = d.store.getState();
      return deriveLedger(s.transactions, (code) => s.instruments.find((i) => i.code === code)!.currency);
    };
    expect(ledger(b).holdings).toEqual(ledger(a).holdings);
    expect(ledger(a).netInvestedCny).toBeGreaterThan(0);
  });

  it('stops and asks to sign in again when the login has expired, keeping the queue', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.record('r-1');
    cloud.failNext('auth');
    await d.settle();
    expect(d.status()).toMatchObject({ state: 'signedOut', pending: 1 });
    expect(d.timers.some((t) => RETRY_MS.includes(t.ms as never))).toBe(false);
    expect(await d.db.outbox.count()).toBe(1);
  });

  it('counts only records as waiting', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.setOnline(false);
    d.store.getState().updatePlan({ threshold: 4 });
    await d.settle();
    expect(d.status().pending).toBe(0);
  });

  it('looks back a little when pulling so late arrivals are not missed', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    await d.settle();
    d.record('r-1');
    await d.settle();
    await d.settle();
    const [first, , third] = d.remote.sinceSeen;
    expect(first).toBeNull();
    const cursor = (await d.db.kv.get('pulledAt'))!.value as string;
    expect(third).toBe(new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString());
  });

  it('does nothing after it has been stopped', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.sync.stop();
    d.record('r-1');
    await d.settle();
    expect(cloud.rows.transactions).toEqual([]);
  });
});
```

- [ ] **Step 3：跑测试，确认失败**：`npx vitest run src/app/sync.test.ts` → FAIL（找不到 `./sync`）

- [ ] **Step 4：实现** `src/app/sync.ts`

```ts
import { create } from 'zustand';
import { accountToRow, exposureToRow, instrumentToRow, isoTime, planToRow, targetsToRow, txToRow } from '../domain/rows';
import type { OwnStock, Plan, Targets } from '../domain/types';
import type { LocalDb, OutboxKind } from './localDb';
import type { LocalController } from './persistence';
import { RemoteError } from './remote';
import type { Remote, RemoteChanges } from './remote';

// 同步引擎：先按队列顺序上传，再按服务器时间增量拉取，合并进本机。
// 触发时机：启动、本机有改动（稍等片刻合并成一次）、网络恢复、回到前台、失败后按间隔重试。

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signedOut';

export interface SyncStatus {
  state: SyncState;
  /** 还没上传的流水笔数（设置的改动不计） */
  pending: number;
  lastSyncedAt: string | null;
}

export const INITIAL_SYNC: SyncStatus = { state: 'idle', pending: 0, lastSyncedAt: null };

/** 同步状态，界面用（不存进本机库） */
export const useSyncStore = create<SyncStatus>()(() => INITIAL_SYNC);

/** 失败后等多久再试：5 秒、30 秒、2 分钟，之后每 10 分钟 */
export const RETRY_MS = [5_000, 30_000, 120_000, 600_000] as const;
/** 本机改动后等一会儿再同步，连着记几笔只传一次 */
export const DEBOUNCE_MS = 1_500;
/** 拉取时往回多看 2 分钟，提交得晚的行也拉得到（重复的按 id 去掉） */
export const PULL_OVERLAP_MS = 120_000;

export interface SyncDeps {
  remote: Remote;
  db: LocalDb;
  local: LocalController;
  userId: string;
  isOnline: () => boolean;
  now: () => Date;
  /** 延时执行，返回取消函数 */
  schedule: (fn: () => void, ms: number) => () => void;
  setStatus: (patch: Partial<SyncStatus>) => void;
}

export interface SyncController {
  syncNow: () => Promise<void>;
  /** 本机有新改动：稍等片刻再同步 */
  requestSync: () => void;
  stop: () => void;
}

const isDefined = <T>(x: T | undefined): x is T => x !== undefined;

function latestServerTime(c: RemoteChanges): string | null {
  const times = [
    ...c.transactions.map((r) => r.inserted_at),
    ...[...c.accounts, ...c.exposures, ...c.instruments, ...c.targets, ...c.plans].map((r) => r.server_updated_at),
  ]
    .filter(isDefined)
    .map(isoTime);
  return times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
}

export function startSync(deps: SyncDeps): SyncController {
  const { remote, db, local, userId } = deps;
  let stopped = false;
  let running: Promise<void> | null = null;
  let again = false;
  let failures = 0;
  let cancelTimer: (() => void) | null = null;

  const later = (ms: number) => {
    cancelTimer?.();
    cancelTimer = deps.schedule(() => {
      cancelTimer = null;
      void syncNow();
    }, ms);
  };
  const countPending = async () => {
    if (!stopped) deps.setStatus({ pending: await db.outbox.where('kind').equals('tx').count() });
  };

  async function push() {
    const entries = await db.outbox.orderBy('seq').toArray();
    if (entries.length === 0) return;
    const keys = (kind: OutboxKind) => [...new Set(entries.filter((e) => e.kind === kind).map((e) => e.key))];
    const accounts = (await db.accounts.bulkGet(keys('account'))).filter(isDefined);
    const exposures = (await db.exposures.bulkGet(keys('exposure'))).filter((r) => r?.own === true).filter(isDefined);
    const instruments = (await db.instruments.bulkGet(keys('instrument'))).filter((r) => r?.own === true).filter(isDefined);
    await remote.upsert('account', accounts.map((a) => accountToRow(a, a, userId)));
    await remote.upsert('exposure', exposures.map((e) => exposureToRow(e, e, userId)));
    await remote.upsert('instrument', instruments.map((i) => instrumentToRow(i, i, userId)));
    if (keys('targets').length) {
      const row = await db.kv.get('targets');
      if (row) {
        const v = row.value as { targets: Targets; ownStock: OwnStock };
        await remote.upsert('targets', [targetsToRow(v.targets, v.ownStock, row.updatedAt, userId)]);
      }
    }
    if (keys('plan').length) {
      const row = await db.kv.get('plan');
      if (row) await remote.upsert('plan', [planToRow(row.value as Plan, row.updatedAt, userId)]);
    }
    const txIds = keys('tx');
    const txs = (await db.transactions.bulkGet(txIds)).filter(isDefined);
    await remote.insertTransactions(txs.map((t) => txToRow(t, userId)));
    // 只删这次读到的；上传期间新进队列的留到下一次
    await db.outbox.bulkDelete(entries.map((e) => e.seq!));
  }

  async function pull() {
    const cursor = (await db.kv.get('pulledAt'))?.value as string | undefined;
    const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;
    const changes = await remote.pull(since);
    await local.applyRemote(changes);
    const latest = latestServerTime(changes);
    if (latest && (!cursor || latest > cursor)) await db.kv.put({ key: 'pulledAt', value: latest, updatedAt: latest });
  }

  async function run() {
    if (!deps.isOnline()) {
      deps.setStatus({ state: 'offline' });
      return;
    }
    deps.setStatus({ state: 'syncing' });
    try {
      await push();
      await pull();
      failures = 0;
      deps.setStatus({ state: 'idle', lastSyncedAt: deps.now().toISOString() });
    } catch (e) {
      if (stopped) return;
      if (e instanceof RemoteError && e.kind === 'auth') {
        deps.setStatus({ state: 'signedOut' });
        return;
      }
      failures += 1;
      deps.setStatus({ state: 'error' });
      later(RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]!);
    }
  }

  async function syncNow(): Promise<void> {
    if (stopped) return;
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        await run();
      } finally {
        await countPending();
        running = null;
      }
    })();
    await running;
    if (again && !stopped) {
      again = false;
      await syncNow();
    }
  }

  void countPending();
  return {
    syncNow,
    requestSync: () => {
      if (stopped) return;
      void countPending();
      later(DEBOUNCE_MS);
    },
    stop: () => {
      stopped = true;
      cancelTimer?.();
    },
  };
}
```

- [ ] **Step 5：跑测试，确认通过**：`npx vitest run src/app/sync.test.ts` → PASS 12/12；`npm run typecheck` 通过

---

### Task 6：登录（邮箱验证码）

**Files:**
- Create: `src/app/auth.ts`、`src/app/auth.test.ts`、`src/pages/login/LoginPage.tsx`、`src/pages/login/login.css`、`src/pages/login/LoginPage.test.tsx`

**Interfaces:**
- Consumes：Task 3 的 `createSupabase`、`AUTH_STORAGE_KEY`。
- Produces：
  - `interface AuthUser { id: string; email: string }`
  - `type AuthErrorKind = 'bad_email' | 'rate_limited' | 'bad_code' | 'network' | 'unknown'`
  - `class AuthError extends Error { kind }`
  - `AUTH_ERROR_TEXT: Record<AuthErrorKind, string>`
  - `LAST_USER_KEY = 'invest-manager-user'`
  - `interface AuthClient { currentUser(): Promise<AuthUser | null>; sendCode(email): Promise<void>; verifyCode(email, code): Promise<AuthUser>; signOut(): Promise<void> }`
  - `createSupabaseAuth(client, storage: KeyValueStorage, options?: { sessionTimeoutMs?: number }): AuthClient`
  - `LoginPage({ auth, onSignedIn })`
  - `RESEND_SECONDS = 60`

- [ ] **Step 1：写失败的测试** `src/app/auth.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest';
import { AuthError, LAST_USER_KEY, createSupabaseAuth } from './auth';
import { AUTH_STORAGE_KEY, createSupabase } from './supabase';

const U = { id: '11111111-1111-1111-1111-111111111111', email: 'me@example.com' };
const memory = (init: Record<string, string> = {}) => {
  const map = new Map(Object.entries(init));
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};
const session = (expiresInSec: number) =>
  JSON.stringify({
    access_token: 'token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
    refresh_token: 'refresh', user: { ...U, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
  });

function setup(reply: (url: URL, body: unknown) => { status: number; body?: unknown } | 'offline' | 'hang', storage = memory()) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const r = reply(url, init.body ? JSON.parse(String(init.body)) : undefined);
    if (r === 'offline') throw new TypeError('fetch failed');
    if (r === 'hang') return new Promise<Response>(() => {});
    return new Response(r.body === undefined ? '{}' : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
  const client = createSupabase({ VITE_SUPABASE_URL: 'https://proj.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' }, { fetch: fetch as unknown as typeof globalThis.fetch, storage })!;
  return { auth: createSupabaseAuth(client, storage, { sessionTimeoutMs: 50 }), fetch, storage };
}

describe('signing in with an email code', () => {
  it('asks the cloud to email a code, creating the account the first time', async () => {
    let sent: unknown;
    const { auth } = setup((url, body) => {
      if (url.pathname === '/auth/v1/otp') sent = body;
      return { status: 200 };
    });
    await auth.sendCode('me@example.com');
    expect(sent).toMatchObject({ email: 'me@example.com', create_user: true });
  });

  it('explains why a code could not be sent or used', async () => {
    const limited = setup(() => ({ status: 429, body: { code: 'over_email_send_rate_limit', msg: 'rate limit' } }));
    await expect(limited.auth.sendCode('me@example.com')).rejects.toMatchObject({ kind: 'rate_limited' });
    const wrong = setup(() => ({ status: 403, body: { code: 'otp_expired', msg: 'Token has expired or is invalid' } }));
    await expect(wrong.auth.verifyCode('me@example.com', '123456')).rejects.toMatchObject({ kind: 'bad_code' });
    const offline = setup(() => 'offline');
    await expect(offline.auth.sendCode('me@example.com')).rejects.toBeInstanceOf(AuthError);
    await expect(offline.auth.sendCode('me@example.com')).rejects.toMatchObject({ kind: 'network' });
  });

  it('signs in with the code and remembers who signed in', async () => {
    const { auth, storage } = setup((url) =>
      url.pathname === '/auth/v1/verify'
        ? { status: 200, body: { access_token: 't', refresh_token: 'r', expires_in: 3600, token_type: 'bearer', user: { ...U, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' } } }
        : { status: 200 },
    );
    expect(await auth.verifyCode('me@example.com', '123456')).toEqual(U);
    expect(JSON.parse(storage.getItem(LAST_USER_KEY)!)).toEqual(U);
  });

  it('knows who is signed in on this device', async () => {
    const { auth } = setup(() => ({ status: 200 }), memory({ [AUTH_STORAGE_KEY]: session(3600) }));
    expect(await auth.currentUser()).toEqual(U);
  });

  it('still opens offline after the login has expired', async () => {
    const stored = memory({ [AUTH_STORAGE_KEY]: session(-60), [LAST_USER_KEY]: JSON.stringify(U) });
    const offline = setup(() => 'offline', stored);
    expect(await offline.auth.currentUser()).toEqual(U);
    const slow = setup(() => 'hang', memory({ [AUTH_STORAGE_KEY]: session(-60), [LAST_USER_KEY]: JSON.stringify(U) }));
    expect(await slow.auth.currentUser()).toEqual(U);
  });

  it('has nobody signed in on a new device', async () => {
    const { auth } = setup(() => ({ status: 200 }));
    expect(await auth.currentUser()).toBeNull();
  });

  it('signs out on this device even without a network', async () => {
    const stored = memory({ [AUTH_STORAGE_KEY]: session(3600), [LAST_USER_KEY]: JSON.stringify(U) });
    const { auth, storage } = setup(() => 'offline', stored);
    await auth.signOut();
    expect(storage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LAST_USER_KEY)).toBeNull();
    expect(await auth.currentUser()).toBeNull();
  });
});
```

- [ ] **Step 2：跑测试，确认失败**：`npx vitest run src/app/auth.test.ts` → FAIL（找不到 `./auth`）

- [ ] **Step 3：实现** `src/app/auth.ts`

```ts
import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY } from './supabase';

// 登录：邮箱收 6 位验证码（不用 magic link：添加到主屏幕的 App 和 Safari 存储隔离，点链接只会在 Safari 里登录）。

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthErrorKind = 'bad_email' | 'rate_limited' | 'bad_code' | 'network' | 'unknown';

export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  constructor(kind: AuthErrorKind, message: string) {
    super(message);
    this.name = 'AuthError';
    this.kind = kind;
  }
}

export const AUTH_ERROR_TEXT: Record<AuthErrorKind, string> = {
  bad_email: '邮箱格式不对',
  rate_limited: '发送太频繁，请过一会儿再试',
  bad_code: '验证码不对或已过期',
  network: '连不上服务器，检查一下网络再试',
  unknown: '没有成功，请稍后再试',
};

/** 本机记下最后登录的是谁（只存 id 和邮箱，不存令牌），离线打开 App 时用 */
export const LAST_USER_KEY = 'invest-manager-user';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AuthClient {
  /** 这台设备上登录的用户。离线、登录一时续不上时，按本机记住的用户返回，保证离线能看、能记账 */
  currentUser(): Promise<AuthUser | null>;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<AuthUser>;
  /** 只清这台设备上的登录，不需要联网 */
  signOut(): Promise<void>;
}

function toAuthError(error: unknown): AuthError {
  const message = error instanceof Error ? error.message : String(error);
  if (isAuthRetryableFetchError(error)) return new AuthError('network', message);
  if (isAuthApiError(error)) {
    if (error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') return new AuthError('rate_limited', message);
    if (error.code === 'otp_expired' || error.code === 'invalid_credentials' || error.status === 403) return new AuthError('bad_code', message);
    if (error.code === 'email_address_invalid' || error.code === 'validation_failed') return new AuthError('bad_email', message);
  }
  return new AuthError('unknown', message);
}

export function createSupabaseAuth(client: SupabaseClient, storage: KeyValueStorage, options: { sessionTimeoutMs?: number } = {}): AuthClient {
  const timeoutMs = options.sessionTimeoutMs ?? 3000;
  const remember = (u: AuthUser) => {
    try {
      storage.setItem(LAST_USER_KEY, JSON.stringify(u));
    } catch {
      // 存不下也不影响这次登录
    }
  };
  const remembered = (): AuthUser | null => {
    try {
      const v = storage.getItem(LAST_USER_KEY);
      return v ? (JSON.parse(v) as AuthUser) : null;
    } catch {
      return null;
    }
  };
  const toUser = (u: { id: string; email?: string | undefined }): AuthUser => ({ id: u.id, email: u.email ?? '' });

  return {
    async currentUser() {
      // 登录过期时 getSession 会联网续期；离线或网络很慢时不等它
      const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
      const result = await Promise.race([client.auth.getSession(), timeout]);
      if (result === 'timeout') return remembered();
      const { data, error } = result;
      if (data.session) {
        const user = toUser(data.session.user);
        remember(user);
        return user;
      }
      if (error && isAuthRetryableFetchError(error)) return remembered();
      return null;
    },
    async sendCode(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw toAuthError(error);
    },
    async verifyCode(email, code) {
      const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error || !data.user) throw toAuthError(error ?? new Error('没有返回用户'));
      const user = toUser(data.user);
      remember(user);
      return user;
    },
    async signOut() {
      try {
        storage.removeItem(LAST_USER_KEY);
      } catch {
        // 忽略
      }
      const { error } = await client.auth.signOut({ scope: 'local' });
      // 离线时 supabase-js 不会清掉本机的登录，这里直接删
      if (error) storage.removeItem(AUTH_STORAGE_KEY);
    },
  };
}
```

- [ ] **Step 4：跑测试，确认通过**：`npx vitest run src/app/auth.test.ts` → PASS 7/7

- [ ] **Step 5：写失败的测试** `src/pages/login/LoginPage.test.tsx`

```tsx
// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError } from '../../app/auth';
import type { AuthClient } from '../../app/auth';
import { LoginPage, RESEND_SECONDS } from './LoginPage';

const USER = { id: 'u-1', email: 'me@example.com' };
const fakeAuth = (overrides: Partial<AuthClient> = {}): AuthClient => ({
  currentUser: vi.fn(async () => null),
  sendCode: vi.fn(async () => {}),
  verifyCode: vi.fn(async () => USER),
  signOut: vi.fn(async () => {}),
  ...overrides,
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const typeEmail = (value: string) => fireEvent.change(screen.getByLabelText('邮箱'), { target: { value } });
const click = async (name: string) => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }));
  });
};

describe('login page', () => {
  it('sends a code to the email and asks for it', async () => {
    const auth = fakeAuth();
    render(<LoginPage auth={auth} onSignedIn={() => {}} />);
    typeEmail(' me@example.com ');
    await click('发送验证码');
    expect(auth.sendCode).toHaveBeenCalledWith('me@example.com');
    expect(screen.getByText('验证码已发到 me@example.com')).toBeTruthy();
  });

  it('checks the email before sending', async () => {
    const auth = fakeAuth();
    render(<LoginPage auth={auth} onSignedIn={() => {}} />);
    typeEmail('me@');
    await click('发送验证码');
    expect(screen.getByText('邮箱格式不对')).toBeTruthy();
    expect(auth.sendCode).not.toHaveBeenCalled();
  });

  it('signs in with the 6-digit code', async () => {
    const auth = fakeAuth();
    const onSignedIn = vi.fn();
    render(<LoginPage auth={auth} onSignedIn={onSignedIn} />);
    typeEmail('me@example.com');
    await click('发送验证码');
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '12a3456' } });
    expect((screen.getByLabelText('验证码') as HTMLInputElement).value).toBe('123456');
    await click('登录');
    expect(auth.verifyCode).toHaveBeenCalledWith('me@example.com', '123456');
    expect(onSignedIn).toHaveBeenCalledWith(USER);
  });

  it('asks for all six digits', async () => {
    const auth = fakeAuth();
    render(<LoginPage auth={auth} onSignedIn={() => {}} />);
    typeEmail('me@example.com');
    await click('发送验证码');
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123' } });
    await click('登录');
    expect(screen.getByText('请输入 6 位验证码')).toBeTruthy();
    expect(auth.verifyCode).not.toHaveBeenCalled();
  });

  it('says what went wrong in plain words', async () => {
    const auth = fakeAuth({
      sendCode: vi.fn(async () => {
        throw new AuthError('rate_limited', 'x');
      }),
    });
    render(<LoginPage auth={auth} onSignedIn={() => {}} />);
    typeEmail('me@example.com');
    await click('发送验证码');
    expect(screen.getByText('发送太频繁，请过一会儿再试')).toBeTruthy();

    cleanup();
    const wrong = fakeAuth({
      verifyCode: vi.fn(async () => {
        throw new AuthError('bad_code', 'x');
      }),
    });
    render(<LoginPage auth={wrong} onSignedIn={() => {}} />);
    typeEmail('me@example.com');
    await click('发送验证码');
    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '000000' } });
    await click('登录');
    expect(screen.getByText('验证码不对或已过期')).toBeTruthy();
    expect(screen.getByLabelText('验证码')).toBeTruthy();
  });

  it('waits a minute before sending the code again', async () => {
    vi.useFakeTimers();
    const auth = fakeAuth();
    render(<LoginPage auth={auth} onSignedIn={() => {}} />);
    typeEmail('me@example.com');
    await click('发送验证码');
    const resend = () => screen.getByRole('button', { name: /重新发送/ }) as HTMLButtonElement;
    expect(resend().textContent).toBe(`重新发送（${RESEND_SECONDS} 秒）`);
    expect(resend().disabled).toBe(true);
    for (let i = 0; i < RESEND_SECONDS; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(resend().textContent).toBe('重新发送');
    await click('重新发送');
    expect(auth.sendCode).toHaveBeenCalledTimes(2);
  });

  it('goes back to change the email', async () => {
    render(<LoginPage auth={fakeAuth()} onSignedIn={() => {}} />);
    typeEmail('me@example.com');
    await click('发送验证码');
    await click('换个邮箱');
    expect(screen.getByLabelText('邮箱')).toBeTruthy();
  });
});
```

- [ ] **Step 6：跑测试，确认失败**：`npx vitest run src/pages/login/LoginPage.test.tsx` → FAIL（找不到 `./LoginPage`）

- [ ] **Step 7：实现**

`src/pages/login/LoginPage.tsx`：

```tsx
import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { AUTH_ERROR_TEXT, AuthError } from '../../app/auth';
import type { AuthClient, AuthUser } from '../../app/auth';
import '../../app/shell.css';
import '../../app/ui.css';
import './login.css';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** 重新发送验证码前要等的秒数 */
export const RESEND_SECONDS = 60;

/** 登录页：邮箱收 6 位验证码。外框和 App 一样（宽屏显示成手机框），没有底部标签栏。 */
export function LoginPage({ auth, onSignedIn }: { auth: AuthClient; onSignedIn: (user: AuthUser) => void }) {
  const id = useId();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const fail = (e: unknown) => setError(AUTH_ERROR_TEXT[e instanceof AuthError ? e.kind : 'unknown']);

  const send = async () => {
    const address = email.trim();
    if (!EMAIL.test(address)) return setError(AUTH_ERROR_TEXT.bad_email);
    setBusy(true);
    setError(null);
    try {
      await auth.sendCode(address);
      setEmail(address);
      setCode('');
      setStep('code');
      setWait(RESEND_SECONDS);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!/^\d{6}$/.test(code)) return setError('请输入 6 位验证码');
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await auth.verifyCode(email, code));
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void (step === 'email' ? send() : verify());
  };

  return (
    <div className="app-backdrop">
      <div className="app-frame">
        <main className="app-main login-main">
          <form className="page login" onSubmit={submit} noValidate>
            <h1 className="page-title">投资管理器</h1>
            {step === 'email' ? (
              <>
                <span className="text-hint">用邮箱收验证码登录，不用设密码。</span>
                <div className="field">
                  <label htmlFor={`${id}-email`}>邮箱</label>
                  <input
                    id={`${id}-email`}
                    className="input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError(null);
                    }}
                  />
                </div>
                {error && <span className="text-error">{error}</span>}
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? '正在发送…' : '发送验证码'}
                </button>
              </>
            ) : (
              <>
                <span className="text-hint">验证码已发到 {email}</span>
                <div className="field">
                  <label htmlFor={`${id}-code`}>验证码</label>
                  <input
                    id={`${id}-code`}
                    className="input login-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                      setError(null);
                    }}
                  />
                </div>
                {error && <span className="text-error">{error}</span>}
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? '正在登录…' : '登录'}
                </button>
                <div className="login-links">
                  <button type="button" className="btn btn-ghost" disabled={busy || wait > 0} onClick={() => void send()}>
                    {wait > 0 ? `重新发送（${wait} 秒）` : '重新发送'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => {
                      setStep('email');
                      setError(null);
                    }}
                  >
                    换个邮箱
                  </button>
                </div>
              </>
            )}
          </form>
        </main>
      </div>
    </div>
  );
}
```

  `maxLength={6}` 在 `fireEvent.change` 里不生效，所以用 `slice(0, 6)` 保证只留 6 位。测试「12a3456」得到的是「123456」。

`src/pages/login/login.css`：

```css
/* 登录页：没有底部标签栏，内容区铺满 */
.login-main { bottom: 0; }
.login { gap: 14px; padding-top: 48px; }
.login .btn-primary { align-self: flex-start; }
.login-code { letter-spacing: 0.3em; font-variant-numeric: tabular-nums; }
.login-links { display: flex; gap: 8px; flex-wrap: wrap; }
```

- [ ] **Step 8：跑测试，确认通过**：`npx vitest run src/pages/login` → PASS 7/7；`npm run typecheck` 通过

---

### Task 7：按账号打开数据、启动和退出

**Files:**
- Create: `src/app/session.ts`、`src/app/session.test.ts`、`src/app/boot.ts`、`src/Root.tsx`、`src/Root.test.tsx`
- Modify: `src/main.tsx`
- Delete: `src/app/localData.ts`、`src/app/localData.test.ts`（功能并入 session / boot）

**Interfaces:**
- Consumes：Task 4 的 `openLocalDb`、`userDbName`、`hydrate`、`attachLocalDb`、`emptyData`、`sampleData`、`stateFromData`、`dataFromState`；Task 5 的 `startSync`、`useSyncStore`、`INITIAL_SYNC`；Task 6 的 `AuthClient`、`AuthUser`、`LoginPage`。
- Produces：
  - `openSession(user, deps: SessionDeps): Promise<Session | 'unavailable'>`
  - `Session { user; syncNow(); importSample(); close() }`
  - `useBootStore`（`BootState`：`loading | misconfigured | unavailable | signedOut{auth} | ready{auth, session}`）
  - `boot(env)`、`enter(user)`、`signOut()`
  - `Root`

- [ ] **Step 1：写失败的测试** `src/app/session.test.ts`

```ts
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeCloud } from './fakeRemote';
import { openLocalDb, userDbName } from './localDb';
import type { LocalDb } from './localDb';
import { openSession } from './session';
import type { Session, SessionDeps } from './session';
import { createAppStore } from './store';

const A = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'a@example.com' };
const B = { id: 'bbbbbbbb-0000-0000-0000-000000000002', email: 'b@example.com' };
const storeDeps = { random: () => 0.5, delay: async () => {}, now: () => new Date(2026, 8, 29, 9, 30), schedule: () => () => {} };
const opened: LocalDb[] = [];
const sessions: Session[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const db of opened.splice(0)) await db.delete();
});

function deps(cloud = createFakeCloud(), userId = A.id, online = true): SessionDeps & { store: ReturnType<typeof createAppStore> } {
  const store = createAppStore(storeDeps);
  return {
    store,
    remote: cloud.remoteFor(userId),
    openDb: (name) => {
      const db = openLocalDb(name);
      opened.push(db);
      return db;
    },
    isOnline: () => online,
    schedule: () => () => {},
  };
}
const open = async (user: typeof A, d: SessionDeps) => {
  const s = await openSession(user, d);
  if (s === 'unavailable') throw new Error('unavailable');
  sessions.push(s);
  return s;
};

describe('opening an account on this device', () => {
  it('starts a new account empty instead of with the sample data', async () => {
    const d = deps();
    const s = await open(A, d);
    await s.syncNow();
    expect(d.store.getState().transactions).toEqual([]);
    expect(d.store.getState().accounts).toEqual([]);
    expect(d.store.getState().exposures.length).toBeGreaterThan(0);
  });

  it('fills the device from the cloud', async () => {
    const cloud = createFakeCloud();
    const first = deps(cloud);
    const s1 = await open(A, first);
    s1.importSample();
    await s1.syncNow();
    await s1.close();
    sessions.splice(sessions.indexOf(s1), 1);
    const other = deps(cloud);
    other.openDb = (name) => {
      const db = openLocalDb(`${name}-second-device`);
      opened.push(db);
      return db;
    };
    const s2 = await open(A, other);
    await s2.syncNow();
    expect(other.store.getState().transactions).toHaveLength(36);
    expect(other.store.getState().accounts).toHaveLength(6);
  });

  it('imports the sample data only into an empty account and uploads it', async () => {
    const cloud = createFakeCloud();
    const d = deps(cloud);
    const s = await open(A, d);
    s.importSample();
    await s.syncNow();
    expect(cloud.rows.transactions).toHaveLength(36);
    expect(cloud.rows.accounts).toHaveLength(6);
    expect(cloud.rows.targets).toHaveLength(1);
    expect(cloud.rows.plans).toHaveLength(1);
    s.importSample();
    expect(d.store.getState().transactions).toHaveLength(36);
  });

  it('keeps each account on this device separate', async () => {
    const cloud = createFakeCloud();
    const a = deps(cloud, A.id);
    const sa = await open(A, a);
    sa.importSample();
    await sa.syncNow();
    await sa.close();
    sessions.splice(sessions.indexOf(sa), 1);
    const b = deps(cloud, B.id);
    b.store = a.store; // 同一台设备、同一个界面状态
    const sb = await open(B, b);
    await sb.syncNow();
    expect(b.store.getState().transactions).toEqual([]);
    expect(opened.map((db) => db.name)).toEqual([userDbName(A.id), userDbName(B.id)]);
  });

  it('keeps unsent records when signing out and sends them after signing in again', async () => {
    const cloud = createFakeCloud();
    const offline = deps(cloud, A.id, false);
    const s = await open(A, offline);
    offline.store.getState().appendTransactions([
      { id: 'late-1', date: '2026-09-29', createdAt: '2026-09-30T08:00:00.000Z', type: 'deposit', accountId: 'futu', instrumentCode: 'USD', qty: 10, price: 1, fee: 0, fxToCny: 7.1 },
    ]);
    await s.close();
    sessions.splice(sessions.indexOf(s), 1);
    const again = deps(cloud, A.id, true);
    const s2 = await open(A, again);
    await s2.syncNow();
    expect(cloud.rows.transactions.map((r) => r.id)).toEqual(['late-1']);
  });

  it('reports a device that cannot store data', async () => {
    const d = deps();
    d.openDb = () => {
      throw new Error('blocked');
    };
    expect(await openSession(A, d)).toBe('unavailable');
  });
});
```

- [ ] **Step 2：跑测试，确认失败**：`npx vitest run src/app/session.test.ts` → FAIL（找不到 `./session`）

- [ ] **Step 3：实现** `src/app/session.ts`

```ts
import type { StoreApi } from 'zustand';
import { sortTransactions } from '../domain/ledger';
import type { AuthUser } from './auth';
import { openLocalDb, userDbName } from './localDb';
import type { LocalDb } from './localDb';
import { attachLocalDb, dataFromState, emptyData, hydrate, sampleData, stateFromData } from './persistence';
import type { Remote } from './remote';
import type { AppState } from './store';
import { INITIAL_SYNC, startSync, useSyncStore } from './sync';
import type { SyncController } from './sync';

// 一个登录账号在这台设备上的数据：本机库（每个账号一个）、写回、同步。

export interface SessionDeps {
  store: Pick<StoreApi<AppState>, 'getState' | 'setState' | 'subscribe'>;
  remote: Remote;
  openDb?: (name: string) => LocalDb;
  now?: () => Date;
  isOnline?: () => boolean;
  schedule?: (fn: () => void, ms: number) => () => void;
  /** 网络恢复、回到前台时调用 onWake；返回取消监听的函数 */
  listen?: (onWake: () => void) => () => void;
  onWriteError?: (error: unknown) => void;
}

export interface Session {
  user: AuthUser;
  syncNow: () => Promise<void>;
  /** 把示例数据写进这个账号；账号里已有流水时不做任何事 */
  importSample: () => void;
  /** 停止同步、关掉本机库；本机数据和待同步队列都留着，下次登录继续 */
  close: () => Promise<void>;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export async function openSession(user: AuthUser, deps: SessionDeps): Promise<Session | 'unavailable'> {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const iso = () => now().toISOString();
  const s0 = store.getState();
  const prefs = { displayCurrency: s0.displayCurrency, hideAmounts: s0.hideAmounts };
  // 先换成空账号，免得短暂露出上一个账号的数据
  store.setState(stateFromData(emptyData(prefs), s0.today));
  let db: LocalDb;
  try {
    db = (deps.openDb ?? openLocalDb)(userDbName(user.id));
    await hydrate(store, db, iso);
  } catch {
    return 'unavailable';
  }
  useSyncStore.setState(INITIAL_SYNC, true);
  let sync: SyncController | null = null;
  const local = attachLocalDb(store, db, iso, deps.onWriteError ?? (() => {}), () => sync?.requestSync());
  const engine = startSync({
    remote: deps.remote,
    db,
    local,
    userId: user.id,
    isOnline: deps.isOnline ?? (() => navigator.onLine),
    now,
    schedule: deps.schedule ?? defaultSchedule,
    setStatus: (patch) => useSyncStore.setState(patch),
  });
  sync = engine;
  const unlisten = deps.listen?.(() => void engine.syncNow()) ?? (() => {});
  void engine.syncNow();

  return {
    user,
    syncNow: () => engine.syncNow(),
    importSample: () => {
      const s = store.getState();
      if (s.transactions.length > 0) return;
      const sample = sampleData(prefs);
      store.setState(
        stateFromData(
          {
            ...dataFromState(s),
            accounts: sample.accounts,
            transactions: sortTransactions(sample.transactions),
            targets: sample.targets,
            ownStock: sample.ownStock,
            plan: sample.plan,
          },
          s.today,
        ),
      );
    },
    close: async () => {
      engine.stop();
      unlisten();
      await local.flush();
      local.detach();
      db.close();
      useSyncStore.setState(INITIAL_SYNC, true);
    },
  };
}
```

- [ ] **Step 4：跑测试，确认通过**：`npx vitest run src/app/session.test.ts` → PASS 6/6

- [ ] **Step 5：写失败的测试** `src/Root.test.tsx`

```tsx
// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthClient } from './app/auth';
import { useBootStore } from './app/boot';
import type { Session } from './app/session';
import { Root } from './Root';

const auth: AuthClient = { currentUser: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), signOut: vi.fn() };
const session: Session = { user: { id: 'u', email: 'me@example.com' }, syncNow: vi.fn(), importSample: vi.fn(), close: vi.fn() };
afterEach(() => {
  cleanup();
  useBootStore.setState({ kind: 'loading' }, true);
});

describe('what the app shows first', () => {
  it('shows the login page when nobody is signed in', () => {
    useBootStore.setState({ kind: 'signedOut', auth }, true);
    render(<Root />);
    expect(screen.getByRole('button', { name: '发送验证码' })).toBeTruthy();
  });

  it('shows the app once signed in', () => {
    useBootStore.setState({ kind: 'ready', auth, session }, true);
    render(<Root />);
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy();
  });

  it('explains a missing cloud setup', () => {
    useBootStore.setState({ kind: 'misconfigured' }, true);
    render(<Root />);
    expect(screen.getByText(/VITE_SUPABASE_URL/)).toBeTruthy();
  });

  it('explains a device that cannot store data', () => {
    useBootStore.setState({ kind: 'unavailable' }, true);
    render(<Root />);
    expect(screen.getByRole('heading', { name: '这台设备不能保存数据' })).toBeTruthy();
  });

  it('shows an empty frame while loading, without the sample data', () => {
    render(<Root />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText('收益')).toBeNull();
  });
});
```

- [ ] **Step 6：跑测试，确认失败**：`npx vitest run src/Root.test.tsx` → FAIL（找不到 `./app/boot`）

- [ ] **Step 7：实现**

`src/app/boot.ts`：

```ts
import { create } from 'zustand';
import { createSupabaseAuth } from './auth';
import type { AuthClient, AuthUser } from './auth';
import { emptyData, stateFromData } from './persistence';
import { createSupabaseRemote } from './remote';
import type { Remote } from './remote';
import { openSession } from './session';
import type { Session } from './session';
import { useAppStore } from './store';
import { createSupabase } from './supabase';
import type { SupabaseEnv } from './supabase';

// 启动：没配置云端 → 配置说明；没登录 → 登录页；已登录（离线也算）→ 打开这个账号的数据。

export type BootState =
  | { kind: 'loading' }
  | { kind: 'misconfigured' }
  | { kind: 'unavailable' }
  | { kind: 'signedOut'; auth: AuthClient }
  | { kind: 'ready'; auth: AuthClient; session: Session };

export const useBootStore = create<BootState>()(() => ({ kind: 'loading' }));

let cloud: { auth: AuthClient; remote: Remote } | null = null;

const localStorageSafe = () => {
  try {
    return window.localStorage;
  } catch {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
  }
};

/** 网络恢复、回到前台时同步 */
function listenForWake(onWake: () => void) {
  const onVisible = () => {
    if (document.visibilityState === 'visible') onWake();
  };
  window.addEventListener('online', onWake);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('online', onWake);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export async function boot(env: SupabaseEnv): Promise<void> {
  const client = createSupabase(env);
  if (!client) {
    useBootStore.setState({ kind: 'misconfigured' }, true);
    return;
  }
  cloud = { auth: createSupabaseAuth(client, localStorageSafe()), remote: createSupabaseRemote(client) };
  const user = await cloud.auth.currentUser();
  if (user) await enter(user);
  else useBootStore.setState({ kind: 'signedOut', auth: cloud.auth }, true);
}

export async function enter(user: AuthUser): Promise<void> {
  if (!cloud) return;
  const session = await openSession(user, {
    store: useAppStore,
    remote: cloud.remote,
    listen: listenForWake,
    onWriteError: () => useAppStore.getState().flash('保存到本机失败，建议先导出一份完整备份'),
  });
  if (session === 'unavailable') useBootStore.setState({ kind: 'unavailable' }, true);
  else useBootStore.setState({ kind: 'ready', auth: cloud.auth, session }, true);
}

/** 退出登录：停止同步、清掉内存里的数据；本机库留着，下次同一个邮箱登录时继续 */
export async function signOut(): Promise<void> {
  const s = useBootStore.getState();
  if (s.kind !== 'ready') return;
  await s.session.close();
  await s.auth.signOut();
  const app = useAppStore.getState();
  useAppStore.setState(stateFromData(emptyData({ displayCurrency: app.displayCurrency, hideAmounts: app.hideAmounts }), app.today));
  useBootStore.setState({ kind: 'signedOut', auth: s.auth }, true);
}
```

`src/Root.tsx`：

```tsx
import type { ReactNode } from 'react';
import App from './App';
import { enter, useBootStore } from './app/boot';
import { LoginPage } from './pages/login/LoginPage';
import './app/shell.css';
import './app/ui.css';
import './pages/login/login.css';

/** 按启动状态显示：加载中、配置说明、不能存数据、登录页或 App。 */
export function Root() {
  const state = useBootStore();
  switch (state.kind) {
    case 'loading':
      return <Frame />;
    case 'misconfigured':
      return (
        <Frame title="还没有配置云端">
          <span className="text-hint">在项目根目录的 .env.local 里填好 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY，再重新启动。</span>
        </Frame>
      );
    case 'unavailable':
      return (
        <Frame title="这台设备不能保存数据">
          <span className="text-hint">浏览器不让这个网页存数据，可能是开了无痕模式。换成普通模式打开，或者改用 Safari、Chrome。</span>
        </Frame>
      );
    case 'signedOut':
      return <LoginPage auth={state.auth} onSignedIn={(user) => void enter(user)} />;
    case 'ready':
      return <App />;
  }
}

function Frame({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="app-backdrop">
      <div className="app-frame">
        <main className="app-main login-main">
          {title && (
            <section className="page">
              <h1 className="page-title">{title}</h1>
              {children}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
```

`src/main.tsx`：删掉 `startLocalData` 相关导入和调用；先渲染，再启动：

```tsx
import { Root } from './Root';
import { boot } from './app/boot';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
void boot(import.meta.env);
```

  删掉 `src/app/localData.ts`、`src/app/localData.test.ts`（「不能存数据时不白屏」改由 session.test 的 unavailable 用例 + Root.test 的说明页用例覆盖）。

- [ ] **Step 8：跑测试**：`npx vitest run src/app/session.test.ts src/Root.test.tsx` → PASS；`npx vitest run` → 仅 `HoldingsPage.test.tsx` 里「恢复示例数据」那条失败（Task 8 改）；`npm run typecheck` 通过

---

### Task 8：界面：数据备份、待同步提示、空账号

**Files:**
- Create: `src/app/syncText.ts`、`src/app/syncText.test.ts`、`src/pages/emptyAccount.test.tsx`
- Modify:
  - `src/pages/holdings/AccountsSettings.tsx`、`src/pages/holdings/holdings.css`、`src/pages/holdings/HoldingsPage.test.tsx`
  - `src/pages/records/RecordsPage.tsx`、`src/pages/records/records.css`、`src/pages/records/RecordsPage.test.tsx`
  - `src/app/TabBar.tsx`、`src/app/AppShell.tsx`、`src/App.tsx`、`src/app/shell.css`、`src/app/icons.tsx`
  - 空账号下崩溃的页面（按测试结果改）

**Interfaces:**
- Consumes：Task 5 的 `useSyncStore`、`SyncStatus`；Task 7 的 `useBootStore`、`signOut`、`Session.importSample`；Task 4 的 `emptyData`。
- Produces：
  - `syncNoteText(s): string | null`
  - `syncStatusText(s, formatTime): string`
  - `TabBar` 的新属性 `badges?: Partial<Record<TabId, string>>`

- [ ] **Step 1：写失败的测试** `src/app/syncText.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { syncNoteText, syncStatusText } from './syncText';

const s = (state: 'idle' | 'syncing' | 'offline' | 'error' | 'signedOut', pending: number, lastSyncedAt: string | null = null) => ({ state, pending, lastSyncedAt });
const hm = () => '21:05';

describe('sync wording', () => {
  it('shows nothing on the records page when everything is uploaded', () => {
    expect(syncNoteText(s('idle', 0))).toBeNull();
    expect(syncNoteText(s('offline', 0))).toBeNull();
  });

  it('says how many records are waiting and why', () => {
    expect(syncNoteText(s('offline', 2))).toBe('2 笔待同步 · 联网后自动上传');
    expect(syncNoteText(s('syncing', 2))).toBe('2 笔待同步 · 正在上传…');
    expect(syncNoteText(s('error', 2))).toBe('2 笔待同步 · 上传没成功，稍后自动重试');
    expect(syncNoteText(s('signedOut', 2))).toBe('2 笔待同步 · 登录已过期，重新登录后继续上传');
    expect(syncNoteText(s('idle', 1))).toBe('1 笔待同步');
  });

  it('sums up the sync in the backup section', () => {
    expect(syncStatusText(s('idle', 0, '2026-09-30T13:05:00.000Z'), hm)).toBe('已同步 · 21:05');
    expect(syncStatusText(s('idle', 0), hm)).toBe('已同步');
    expect(syncStatusText(s('syncing', 0), hm)).toBe('正在同步…');
    expect(syncStatusText(s('offline', 0), hm)).toBe('离线，联网后自动同步');
    expect(syncStatusText(s('error', 0), hm)).toBe('同步没成功，稍后自动重试');
    expect(syncStatusText(s('offline', 3), hm)).toBe('3 笔待同步 · 联网后自动上传');
    expect(syncStatusText(s('signedOut', 0), hm)).toBe('登录已过期，重新登录后继续同步');
  });
});
```

- [ ] **Step 2：跑测试，确认失败**：`npx vitest run src/app/syncText.test.ts` → FAIL（找不到 `./syncText`）

- [ ] **Step 3：实现** `src/app/syncText.ts`

```ts
import type { SyncStatus } from './sync';

/** 记录页标题下的一行；没有待上传的流水时不显示 */
export function syncNoteText(s: SyncStatus): string | null {
  if (s.pending === 0) return null;
  const head = `${s.pending} 笔待同步`;
  switch (s.state) {
    case 'offline':
      return `${head} · 联网后自动上传`;
    case 'syncing':
      return `${head} · 正在上传…`;
    case 'error':
      return `${head} · 上传没成功，稍后自动重试`;
    case 'signedOut':
      return `${head} · 登录已过期，重新登录后继续上传`;
    default:
      return head;
  }
}

/** 「设置账户 → 数据备份」里的同步状态 */
export function syncStatusText(s: SyncStatus, formatTime: (iso: string) => string): string {
  if (s.state === 'signedOut') return s.pending > 0 ? syncNoteText(s)! : '登录已过期，重新登录后继续同步';
  if (s.pending > 0) return syncNoteText(s)!;
  if (s.state === 'syncing') return '正在同步…';
  if (s.state === 'error') return '同步没成功，稍后自动重试';
  if (s.state === 'offline') return '离线，联网后自动同步';
  return s.lastSyncedAt ? `已同步 · ${formatTime(s.lastSyncedAt)}` : '已同步';
}
```

- [ ] **Step 4：跑测试，确认通过**：`npx vitest run src/app/syncText.test.ts` → PASS 3/3

- [ ] **Step 5：写失败的测试**
  - `src/pages/records/RecordsPage.test.tsx` 加一组（`useSyncStore` 在 `afterEach` 里复位成 `INITIAL_SYNC`）：

```tsx
describe('records waiting to upload', () => {
  it('says how many records are waiting under the title', () => {
    useSyncStore.setState({ state: 'offline', pending: 2, lastSyncedAt: null });
    render(<RecordsPage />);
    expect(screen.getByText('2 笔待同步 · 联网后自动上传')).toBeTruthy();
  });

  it('says nothing when everything is uploaded', () => {
    render(<RecordsPage />);
    expect(screen.queryByText(/待同步/)).toBeNull();
  });
});
```

  - `src/App.test.tsx`（没有就新建，`// @vitest-environment happy-dom`）：

```tsx
it('marks the records tab while records are waiting to upload', () => {
  useSyncStore.setState({ state: 'offline', pending: 2, lastSyncedAt: null });
  render(<App />);
  expect(screen.getByRole('button', { name: '记录，2 笔待同步' })).toBeTruthy();
  act(() => useSyncStore.setState({ pending: 0 }));
  expect(screen.getByRole('button', { name: '记录' })).toBeTruthy();
});
```

  - `src/pages/holdings/HoldingsPage.test.tsx`：把「says the data stays on this device and can go back to the sample data」换成下面这组。`useBootStore` 设成 ready，`session` 用 `vi.fn()` 替身；`signOut` 用 `vi.mock('../../app/boot', async (orig) => ({ ...(await orig()), signOut: vi.fn() }))` 替掉。

```tsx
describe('data backup', () => {
  const openAccounts = async () => {
    render(<HoldingsPage />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '设置账户' })));
  };

  it('says the data syncs to the cloud and who is signed in', async () => {
    useSyncStore.setState({ state: 'idle', pending: 0, lastSyncedAt: null });
    await openAccounts();
    expect(screen.getByText('数据保存在这台设备上，联网时自动同步到云端。也可以导出一份到本地留存。')).toBeTruthy();
    expect(screen.getByText('已登录 me@example.com · 已同步')).toBeTruthy();
  });

  it('offers the sample data only while the account has no records', async () => {
    await openAccounts();
    expect(screen.queryByRole('button', { name: '导入示例数据' })).toBeNull();
    cleanup();
    useAppStore.setState({ transactions: [] });
    await openAccounts();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '导入示例数据' })));
    const sheet = dialog('导入示例数据');
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: '导入' })));
    expect(session.importSample).toHaveBeenCalledOnce();
  });

  it('signs out straight away when everything is uploaded', async () => {
    await openAccounts();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '退出登录' })));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('warns before signing out with records still waiting', async () => {
    useSyncStore.setState({ state: 'offline', pending: 2, lastSyncedAt: null });
    await openAccounts();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '退出登录' })));
    expect(signOut).not.toHaveBeenCalled();
    const sheet = dialog('退出登录');
    expect(within(sheet).getByText('还有 2 笔没同步。退出后记录留在这台设备上，下次用同一个邮箱登录时继续上传。')).toBeTruthy();
    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: '退出' })));
    expect(signOut).toHaveBeenCalledOnce();
  });
});
```

  - `src/pages/emptyAccount.test.tsx`：

```tsx
// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyData, stateFromData } from '../app/persistence';
import { useAppStore } from '../app/store';
import type { AppState } from '../app/store';
import { AiPage } from './ai/AiPage';
import { HoldingsPage } from './holdings/HoldingsPage';
import { PerfPage } from './perf/PerfPage';
import { PlanPage } from './plan/PlanPage';
import { RecordsPage } from './records/RecordsPage';

let initial: AppState;
beforeEach(() => {
  initial = useAppStore.getState();
  useAppStore.setState(stateFromData(emptyData({ displayCurrency: 'CNY', hideAmounts: false }), initial.today));
});
afterEach(() => {
  cleanup();
  useAppStore.setState(initial, true);
});

// 新账号（还没导入示例、还没首次录入）打开各页不能崩溃；空状态的设计在阶段 3
describe('a brand-new account', () => {
  it.each([
    ['收益', PerfPage],
    ['计划', PlanPage],
    ['持仓', HoldingsPage],
    ['记录', RecordsPage],
    ['AI 投顾', AiPage],
  ])('opens %s without crashing', (title, Page) => {
    render(<Page />);
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
  });

  it('counts no records', () => {
    render(<RecordsPage />);
    expect(screen.getByText('共 0 条记录')).toBeTruthy();
  });
});
```

- [ ] **Step 6：跑测试，确认失败**：`npx vitest run src/pages src/App.test.tsx` → 以上新用例 FAIL（没有提示、没有圆点、没有登录信息；空账号可能崩溃）

- [ ] **Step 7：实现**

  1. `src/app/icons.tsx` 加上传图标（同文件其他图标的写法：`stroke="currentColor"`）：

```tsx
export function CloudUploadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 18a4.6 4.6 0 0 1 0-9.2A5.5 5.5 0 0 1 17.6 8.8h.4a4.1 4.1 0 0 1 0 8.2" />
      <path d="M12 13v8" />
      <path d="m9 16 3-3 3 3" />
    </svg>
  );
}
```

  2. `RecordsPage.tsx`：在 `records-header` 后面加：

```tsx
  const note = syncNoteText(useSyncStore());
  // …
      {note && (
        <span className="records-sync">
          <CloudUploadIcon />
          {note}
        </span>
      )}
```

  `records.css`：

```css
/* 待同步提示：紧贴标题（页面 gap 16px，往回收 8px） */
.records-sync { display: flex; align-items: center; gap: 6px; margin-top: -8px; font-size: 13px; color: var(--color-accent-800); }
```

  3. `TabBar.tsx`：

```tsx
export function TabBar({ active, onSelect, badges = {} }: { active: TabId; onSelect: (id: TabId) => void; badges?: Partial<Record<TabId, string>> }) {
  return (
    <nav className="tabbar" aria-label="主导航">
      {TABS.map((t) => {
        const badge = badges[t.id];
        return (
          <button key={t.id} type="button" className="tabbar-item" aria-current={t.id === active ? 'page' : undefined} onClick={() => onSelect(t.id)}>
            <span className="tabbar-dot" aria-hidden="true" />
            <span className="tabbar-label">
              {t.label}
              {badge && (
                <>
                  <span className="tabbar-badge" aria-hidden="true" />
                  <span className="visually-hidden">，{badge}</span>
                </>
              )}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
```

  `shell.css`：

```css
.tabbar-label { position: relative; }
/* 待同步：标签文字右上角的小圆点（和上方表示当前页的圆点区分开） */
.tabbar-badge { position: absolute; top: 1px; right: -8px; width: 6px; height: 6px; border-radius: 50%; background: var(--color-accent); }
```

  4. `AppShell.tsx` 加 `badges` 属性传给 `TabBar`。`App.tsx`：

```tsx
  const pending = useSyncStore((s) => s.pending);
  // …
    <AppShell tab={tab} onSelectTab={setTab} badges={pending > 0 ? { rec: `${pending} 笔待同步` } : {}}>
```

  5. `AccountsSettings.tsx` 的数据备份部分：

```tsx
  const boot = useBootStore();
  const session = boot.kind === 'ready' ? boot.session : null;
  const sync = useSyncStore();
  const hasRecords = useAppStore((s) => s.transactions.length > 0);
  const [importing, setImporting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leave = () => (sync.pending > 0 ? setLeaving(true) : void signOut());
  // …
      <div className="backup">
        <span className="panel-title">数据备份</span>
        <span className="text-note">数据保存在这台设备上，联网时自动同步到云端。也可以导出一份到本地留存。</span>
        {session && (
          <span className="text-note">
            已登录 {session.user.email} · {syncStatusText(sync, (iso) => formatTimeHM(new Date(iso)))}
          </span>
        )}
        <div className="backup-actions">
          {/* 导出完整备份、导出流水两个按钮不变 */}
          {session && !hasRecords && (
            <button type="button" className="btn btn-secondary" onClick={() => setImporting(true)}>
              导入示例数据
            </button>
          )}
          {session && (
            <button type="button" className="btn btn-ghost" onClick={leave}>
              {sync.state === 'signedOut' ? '重新登录' : '退出登录'}
            </button>
          )}
        </div>
      </div>
      {importing && session && (
        <Sheet title="导入示例数据" subtitle="会把示例的 6 个账户、36 笔流水和目标组合写进你的账号。流水同步到云端后不能删除，只建议测试时用。" maxHeight="none" onClose={() => setImporting(false)}>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => { session.importSample(); setImporting(false); flash('已导入示例数据'); }}>
              导入
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setImporting(false)}>
              取消
            </button>
          </div>
        </Sheet>
      )}
      {leaving && (
        <Sheet title="退出登录" subtitle={`还有 ${sync.pending} 笔没同步。退出后记录留在这台设备上，下次用同一个邮箱登录时继续上传。`} maxHeight="none" onClose={() => setLeaving(false)}>
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => { setLeaving(false); void signOut(); }}>
              退出
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setLeaving(false)}>
              取消
            </button>
          </div>
        </Sheet>
      )}
```

  删掉「恢复示例数据」按钮、它的确认弹层和 `resetToSample` 导入。`formatTimeHM` 用 `src/app/format.ts` 里已有的。

  6. 空账号：跑 `emptyAccount.test.tsx` 看哪页崩溃，按崩溃位置加空列表保护。例如 `snapshots.at(-1)!` 改成没有快照时显示 0；只在计算入口判空，不改变有数据时的输出。每改一处在台账记一条 Ruling。

- [ ] **Step 8：跑测试，确认通过**：`npx vitest run` → 全部通过；`npm run typecheck` 通过

---

### Task 9：核对与控制台步骤

- [ ] 跑 `npx vitest run`、`npm run build`，都要通过。
- [ ] 变异检查：把下面每项逐个改坏，都要有测试失败：
  - RLS「只能读自己的行」改成 `true`；
  - transactions 多给 update 权限；
  - 触发器 `<=` 改成 `<`；
  - 入队（流水、设置）去掉；
  - applyRemote 不暂停写回；
  - 拉取不往回多看；
  - 重试间隔不递增；
  - auth 错误也重试；
  - 按账号分库去掉；
  - 导入示例不检查是否已有流水；
  - currentUser 离线时不用本机记住的用户；
  - 待同步提示文案。
- [ ] 内置浏览器（5199 端口）：
  - 没有 `.env.local` 时显示配置说明；
  - 用本机不存在的地址（`VITE_SUPABASE_URL=http://127.0.0.1:9`、任意 key）启动：显示登录页，样式同 App，发送验证码显示「连不上服务器，检查一下网络再试」；
  - 在 390 宽下核对登录页的间距和字体。
- [ ] 写 `docs/supabase-setup.md`，内容包括：
  - `.env.local`；
  - 执行迁移 SQL；
  - 邮件模板（Magic Link、Confirm signup 都用 `{{ .Token }}`）；
  - OTP 位数 6；
  - 自定义 SMTP（推荐 Resend，在 Cloudflare 加 DNS 记录验证 example.com）；
  - 在 Table Editor 核对 user_id；
  - 清空测试数据的 SQL（按邮箱删这个用户的所有行）。
- [ ] 更新台账，列出用户的手动验收步骤（BUILD_PLAN 阶段 2 的 7 条验收）。
