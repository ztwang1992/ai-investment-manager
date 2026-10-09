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
