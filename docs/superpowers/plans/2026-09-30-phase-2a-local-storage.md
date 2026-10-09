# 阶段 2a · 本地存储 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 数据存进本机 IndexedDB，刷新或关掉再打开，数据都还在；断网也能打开查看和记账。第一次打开时写入示例数据，并提供「恢复示例数据」。

**Architecture:**
- `src/app/localDb.ts`：用 Dexie 定义本机数据库。表有 transactions、accounts、exposures、instruments，外加一张键值表 kv，存目标组合、计划、最后一次行情、显示偏好。
- `src/app/persistence.ts`：负责读、写、重置，不依赖 React，用 fake-indexeddb 测试。
- `src/app/localData.ts`：把它接到正式应用上。`main.tsx` 先从本机读出数据再渲染；之后状态一变就写回本机，流水只追加。
- 现有的状态层和测试不用改，本地存储只在 `main.tsx` 里接上。

**Tech Stack:** Dexie 4（新增）、fake-indexeddb 6（新增，只用于测试）、Zustand、Vitest

**Spec:**
- README「本地优先与同步」（手机本地 IndexedDB 存一份完整数据，先写本地、立即显示；设置类数据按 updated_at，以最后修改为准）；
- BUILD_PLAN 阶段 2 第 3 条（「可以用 Dexie」）和它的验收：「记一笔后刷新页面，数据还在」「断网后打开 App，能看到上次的数据，也能记一笔」；
- 你 2026-09-30 确认的范围：
  - 存哪些：流水、账户、底层资产、品种、目标组合、计划、最后一次行情和汇率、显示偏好；
  - 第一次打开写入示例数据，加「恢复示例数据」；
  - 「数据已通过云端同步」改成属实的说法；
  - AI Key 不写进本机存储；
  - 记账日期仍是示例日期；
  - 同步队列和同步提示放到接 Supabase 时再做。

## Global Constraints

- 用户的 AI Key 不写进本机存储（`aiStore` 不接数据库）。
- 流水只增不改：本机数据库里只追加流水，不改写已有的。
- 设置类数据（账户、底层资产、品种、目标组合、计划）写入时带 `updatedAt`，为以后「以最后修改为准」的同步做准备。
- 本机数据库打不开时（比如某些浏览器的无痕模式）不能白屏：退回示例数据，并提示「这台设备不能保存数据」。
- 颜色、字体只用 `tokens.css` 变量；文案用简体中文，语气冷静、简洁。
- 不提交（你选了「先不提交」）。

## Review Focus

1. **写入还没完成就刷新**：写入要快，并在测试里等写入完成再重读；写入失败要提示，不能静默丢数据。→ Task 2
2. **恢复示例数据时还有写入在进行**：重置期间暂停自动写回，免得旧状态把重置后的数据覆盖掉。→ Task 4
3. **本机数据库打不开**：界面照常显示示例数据，不白屏。→ Task 3
4. **老数据和新代码**：数据库带版本号（version 1）。以后加字段要写升级步骤，不能直接改表结构。→ Task 1
5. **闭眼后刷新**：金额仍然隐藏，不能刷新一下就露出来。→ Task 2

---

### Task 1：本机数据库和整体读写

**Files:**
- 安装：`npm install dexie@^4`、`npm install -D fake-indexeddb@^6`
- Create: `src/app/localDb.ts`、`src/app/persistence.ts`
- Test: `src/app/persistence.test.ts`

**Interfaces:**
- Produces:

```ts
// localDb.ts
export interface KvRow { key: string; value: unknown; updatedAt: string }
export type Stamped<T> = T & { updatedAt: string };
export type LocalDb = Dexie & {
  transactions: EntityTable<Transaction, 'id'>;
  accounts: EntityTable<Stamped<Account>, 'id'>;
  exposures: EntityTable<Stamped<Exposure>, 'id'>;
  instruments: EntityTable<Stamped<Instrument>, 'code'>;
  kv: EntityTable<KvRow, 'key'>;
};
export function openLocalDb(name?: string): LocalDb; // 默认名 'invest-manager'

// persistence.ts
export interface LocalData {
  transactions: Transaction[]; accounts: Account[]; exposures: Exposure[]; instruments: Instrument[];
  targets: Targets; ownStock: OwnStock; plan: Plan;
  quotes: { prices: Prices; fx: FxRates; navDates: Record<string, string>; updatedAt: string | null };
  prefs: { displayCurrency: Currency; hideAmounts: boolean };
}
export function dataFromState(s: AppState): LocalData;
export function stateFromData(d: LocalData, today: string): Partial<AppState>; // 收益历史按流水重算
export function sampleData(prefs: LocalData['prefs']): LocalData;
export function loadData(db: LocalDb): Promise<LocalData | null>; // 还没写过时返回 null
export function saveAll(db: LocalDb, d: LocalData, now: string): Promise<void>; // 清空后整体写入
```

- [ ] **Step 1: 装依赖**

```bash
npm install dexie@^4
npm install -D fake-indexeddb@^6
```

- [ ] **Step 2: 写测试**

```ts
// persistence.test.ts
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { openLocalDb } from './localDb';
import type { LocalDb } from './localDb';
import { dataFromState, loadData, sampleData, saveAll, stateFromData } from './persistence';
import { createAppStore } from './store';

let n = 0;
const dbs: LocalDb[] = [];
const freshDb = () => {
  const db = openLocalDb(`test-${++n}`);
  dbs.push(db);
  return db;
};
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete();
});
const deps = { random: () => 0.5, delay: async () => {}, now: () => new Date(2026, 8, 29, 9, 30), schedule: () => () => {} };
const NOW = '2026-09-30T08:00:00.000Z';

describe('local data', () => {
  it('has nothing before the first save', async () => {
    expect(await loadData(freshDb())).toBeNull();
  });

  it('reads back exactly what was saved', async () => {
    const db = freshDb();
    const data = dataFromState(createAppStore(deps).getState());
    await saveAll(db, data, NOW);
    const back = await loadData(db);
    expect(back!.transactions.map((t) => t.id).sort()).toEqual(data.transactions.map((t) => t.id).sort());
    expect(back!.accounts).toEqual(data.accounts.map((a) => ({ ...a, updatedAt: NOW })));
    expect(back!.targets).toEqual(data.targets);
    expect(back!.plan).toEqual(data.plan);
    expect(back!.quotes).toEqual(data.quotes);
    expect(back!.prefs).toEqual(data.prefs);
  });

  it('rebuilds the performance history from the stored transactions', () => {
    const s = createAppStore(deps).getState();
    const state = stateFromData(dataFromState(s), s.today);
    expect(state.snapshots).toEqual(s.snapshots);
    expect(state.snapshotItems).toEqual(s.snapshotItems);
  });

  it('builds the sample data with the given preferences', () => {
    const data = sampleData({ displayCurrency: 'USD', hideAmounts: true });
    expect(data.prefs).toEqual({ displayCurrency: 'USD', hideAmounts: true });
    expect(data.transactions).toHaveLength(36);
    expect(data.accounts).toHaveLength(6);
  });
});
```

- [ ] **Step 3: 运行，确认失败**

运行：`npx vitest run src/app/persistence.test.ts`
预期：失败，提示找不到 `./localDb`。

- [ ] **Step 4: 实现**

```ts
// localDb.ts
import Dexie from 'dexie';
import type { EntityTable } from 'dexie';
import type { Account, Exposure, Instrument, Transaction } from '../domain/types';

// 本机数据库（IndexedDB，经 Dexie）。表结构改动时加 version(2) 并写升级步骤，不要改 version(1)。

export interface KvRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

/** 设置类数据带上最后修改时间，接入云端同步后按它「以最后修改为准」。 */
export type Stamped<T> = T & { updatedAt: string };

export type LocalDb = Dexie & {
  transactions: EntityTable<Transaction, 'id'>;
  accounts: EntityTable<Stamped<Account>, 'id'>;
  exposures: EntityTable<Stamped<Exposure>, 'id'>;
  instruments: EntityTable<Stamped<Instrument>, 'code'>;
  kv: EntityTable<KvRow, 'key'>;
};

export function openLocalDb(name = 'invest-manager'): LocalDb {
  const db = new Dexie(name) as LocalDb;
  db.version(1).stores({
    transactions: 'id, date, createdAt',
    accounts: 'id',
    exposures: 'id',
    instruments: 'code',
    kv: 'key',
  });
  return db;
}
```

```ts
// persistence.ts
import type { Account, Currency, Exposure, FxRates, Instrument, OwnStock, Plan, Prices, Targets, Transaction } from '../domain/types';
import { sortTransactions } from '../domain/ledger';
import { simulateHistory } from '../mock/history';
import { mockAppData } from '../mock/initial';
import type { KvRow, LocalDb } from './localDb';
import type { AppState } from './store';

// 本地优先：全部数据存在本机数据库，界面读内存里的状态，改动随时写回本机。
// 收益历史、分组、今天的日期不存：历史每次按流水重算（第 4 阶段换成 Worker 写的真实快照）。

export interface LocalData {
  transactions: Transaction[];
  accounts: Account[];
  exposures: Exposure[];
  instruments: Instrument[];
  targets: Targets;
  ownStock: OwnStock;
  plan: Plan;
  quotes: { prices: Prices; fx: FxRates; navDates: Record<string, string>; updatedAt: string | null };
  prefs: { displayCurrency: Currency; hideAmounts: boolean };
}

export function dataFromState(s: AppState): LocalData {
  return {
    transactions: s.transactions,
    accounts: s.accounts,
    exposures: s.exposures,
    instruments: s.instruments,
    targets: s.targets,
    ownStock: s.ownStock,
    plan: s.plan,
    quotes: { prices: s.prices, fx: s.fx, navDates: s.navDates, updatedAt: s.quotesUpdatedAt?.toISOString() ?? null },
    prefs: { displayCurrency: s.displayCurrency, hideAmounts: s.hideAmounts },
  };
}

export function stateFromData(d: LocalData, today: string): Partial<AppState> {
  const instrumentByCode = Object.fromEntries(d.instruments.map((i) => [i.code, i]));
  const history = simulateHistory({ transactions: d.transactions, instruments: instrumentByCode, prices: d.quotes.prices, fx: d.quotes.fx, end: today });
  return {
    transactions: d.transactions,
    accounts: d.accounts,
    exposures: d.exposures,
    instruments: d.instruments,
    targets: d.targets,
    ownStock: d.ownStock,
    plan: d.plan,
    prices: d.quotes.prices,
    fx: d.quotes.fx,
    navDates: d.quotes.navDates,
    quotesUpdatedAt: d.quotes.updatedAt ? new Date(d.quotes.updatedAt) : null,
    displayCurrency: d.prefs.displayCurrency,
    hideAmounts: d.prefs.hideAmounts,
    snapshots: history.snapshots,
    snapshotItems: history.items,
  };
}

export function sampleData(prefs: LocalData['prefs']): LocalData {
  const m = mockAppData();
  return {
    transactions: m.transactions,
    accounts: m.accounts,
    exposures: m.exposures,
    instruments: m.instruments,
    targets: m.targets,
    ownStock: m.ownStock,
    plan: m.plan,
    quotes: { prices: m.prices, fx: m.fx, navDates: m.navDates, updatedAt: null },
    prefs,
  };
}

const kv = (key: string, value: unknown, updatedAt: string): KvRow => ({ key, value, updatedAt });

export async function loadData(db: LocalDb): Promise<LocalData | null> {
  if (!(await db.kv.get('seededAt'))) return null;
  const [transactions, accounts, exposures, instruments, targets, plan, quotes, prefs] = await Promise.all([
    db.transactions.toArray(),
    db.accounts.toArray(),
    db.exposures.toArray(),
    db.instruments.toArray(),
    db.kv.get('targets'),
    db.kv.get('plan'),
    db.kv.get('quotes'),
    db.kv.get('prefs'),
  ]);
  const t = targets!.value as { targets: Targets; ownStock: OwnStock };
  return {
    transactions: sortTransactions(transactions),
    accounts,
    exposures,
    instruments,
    targets: t.targets,
    ownStock: t.ownStock,
    plan: plan!.value as Plan,
    quotes: quotes!.value as LocalData['quotes'],
    prefs: prefs!.value as LocalData['prefs'],
  };
}

export async function saveAll(db: LocalDb, d: LocalData, now: string): Promise<void> {
  const stamp = <T extends object>(rows: readonly T[]) => rows.map((r) => ({ ...r, updatedAt: now }));
  await db.transaction('rw', [db.transactions, db.accounts, db.exposures, db.instruments, db.kv], async () => {
    await Promise.all([db.transactions.clear(), db.accounts.clear(), db.exposures.clear(), db.instruments.clear(), db.kv.clear()]);
    await Promise.all([
      db.transactions.bulkPut(d.transactions),
      db.accounts.bulkPut(stamp(d.accounts)),
      db.exposures.bulkPut(stamp(d.exposures)),
      db.instruments.bulkPut(stamp(d.instruments)),
      db.kv.bulkPut([
        kv('targets', { targets: d.targets, ownStock: d.ownStock }, now),
        kv('plan', d.plan, now),
        kv('quotes', d.quotes, now),
        kv('prefs', d.prefs, now),
        kv('seededAt', now, now),
      ]),
    ]);
  });
}
```

读回来的账户、底层资产、品种会多带一个 `updatedAt` 字段。它不影响界面，以后同步时正好要用，所以不去掉。

- [ ] **Step 5: 运行，确认通过**

运行：`npx vitest run src/app/persistence.test.ts`，然后 `npm run typecheck`
预期：全部通过。

---

### Task 2：改动自动写回

**Files:**
- Modify: `src/app/persistence.ts`（加 `attachLocalDb`）
- Test: `src/app/persistence.test.ts`

**Interfaces:**
- Produces:

```ts
export interface LocalController {
  /** 等所有进行中的写入完成（测试用，也可在页面关闭前调用） */
  flush: () => Promise<void>;
  /** 本机数据和界面都换回示例数据，保留显示偏好 */
  resetToSample: () => Promise<void>; // Task 4 实现
  detach: () => void;
}
export function attachLocalDb(
  store: Pick<StoreApi<AppState>, 'getState' | 'setState' | 'subscribe'>,
  db: LocalDb,
  now: () => string,
  onError: (error: unknown) => void,
): LocalController;
```

规则：
- 流水：新增的（按 id 没写过的）才写，不改写已有的；
- 账户、底层资产、品种：只写新增或改过的那一条，带上当前时间作为 `updatedAt`；
- 目标组合和个股设置、计划、行情、显示偏好：有变化就整条写。

- [ ] **Step 1: 写测试**（加在 `persistence.test.ts`）

```ts
describe('writing changes back', () => {
  const reload = async (db: LocalDb) => {
    const store = createAppStore(deps);
    store.setState(stateFromData((await loadData(db))!, store.getState().today));
    return store.getState();
  };

  it('keeps everything the user changed across a reload', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    const s = store.getState();
    const deposit = { ...s.transactions[0]!, id: 'new-1', type: 'deposit' as const, instrumentCode: 'USD', qty: 1000, price: 1, date: '2026-09-29', createdAt: '2026-09-30T08:00:00.000Z' };
    s.appendTransactions([deposit]);
    s.addAccount({ id: 'tiger', name: '老虎', type: 'broker', currency: 'USD', market: '美股' });
    s.addExposure({ id: 'custom-btc', name: '比特币', groupId: 'other', isStock: false });
    s.addInstrument({ code: 'ABCD', name: '', market: '美股', currency: 'USD', exposureId: 'ndx', paysDividend: false });
    s.saveTargets({ sp500: 100 }, {});
    s.updatePlan({ threshold: 5 });
    s.setDisplayCurrency('USD');
    s.toggleHideAmounts();
    await local.flush();

    const back = await reload(db);
    expect(back.transactions.find((t) => t.id === 'new-1')).toMatchObject({ type: 'deposit', qty: 1000 });
    expect(back.transactions).toHaveLength(37);
    expect(back.accounts.map((a) => a.id)).toContain('tiger');
    expect(back.exposures.map((e) => e.id)).toContain('custom-btc');
    expect(back.instruments.map((i) => i.code)).toContain('ABCD');
    expect(back.targets).toEqual({ sp500: 100 });
    expect(back.plan.threshold).toBe(5);
    expect(back.displayCurrency).toBe('USD');
    expect(back.hideAmounts).toBe(true);
    expect(back.snapshots.at(-1)!.netInvestedCny).toBeGreaterThan(s.snapshots.at(-1)!.netInvestedCny);
  });

  it('stamps only the settings that changed', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => '2026-10-01T00:00:00.000Z', () => {});
    store.getState().addAccount({ id: 'tiger', name: '老虎', type: 'broker', currency: 'USD', market: '美股' });
    await local.flush();
    expect((await db.accounts.get('tiger'))!.updatedAt).toBe('2026-10-01T00:00:00.000Z');
    expect((await db.accounts.get('futu'))!.updatedAt).toBe(NOW);
  });

  it('never rewrites a stored transaction', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    const first = store.getState().transactions[0]!;
    store.setState({ transactions: [{ ...first, qty: 999 }, ...store.getState().transactions.slice(1)] });
    await local.flush();
    expect((await db.transactions.get(first.id))!.qty).toBe(first.qty);
  });

  it('reports a failed write', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const errors: unknown[] = [];
    const local = attachLocalDb(store, db, () => NOW, (e) => errors.push(e));
    db.close();
    store.getState().updatePlan({ threshold: 4 });
    await local.flush();
    expect(errors).toHaveLength(1);
  });
});
```

`attachLocalDb` 要加进本文件顶部的 import。

- [ ] **Step 2: 运行，确认失败**

运行：`npx vitest run src/app/persistence.test.ts`
预期：「writing changes back」一组失败（`attachLocalDb` 不存在）。

- [ ] **Step 3: 实现**

```ts
// persistence.ts 追加
import type { StoreApi } from 'zustand';

type Store = Pick<StoreApi<AppState>, 'getState' | 'setState' | 'subscribe'>;

export interface LocalController {
  flush: () => Promise<void>;
  resetToSample: () => Promise<void>;
  detach: () => void;
}

export function attachLocalDb(store: Store, db: LocalDb, now: () => string, onError: (error: unknown) => void): LocalController {
  let paused = false;
  let saved = new Set(store.getState().transactions.map((t) => t.id));
  const pending = new Set<Promise<unknown>>();
  const track = (write: Promise<unknown>) => {
    const p = write.catch(onError).finally(() => pending.delete(p));
    pending.add(p);
  };
  // 数组里引用变了的元素就是新增或改过的
  const changed = <T extends object>(list: readonly T[], before: readonly T[], time: string) => {
    const old = new Set(before);
    return list.filter((x) => !old.has(x)).map((x) => ({ ...x, updatedAt: time }));
  };

  const unsubscribe = store.subscribe((s, prev) => {
    if (paused) return;
    const time = now();
    if (s.transactions !== prev.transactions) {
      const added = s.transactions.filter((t) => !saved.has(t.id));
      for (const t of added) saved.add(t.id);
      if (added.length > 0) track(db.transactions.bulkAdd(added));
    }
    if (s.accounts !== prev.accounts) track(db.accounts.bulkPut(changed(s.accounts, prev.accounts, time)));
    if (s.exposures !== prev.exposures) track(db.exposures.bulkPut(changed(s.exposures, prev.exposures, time)));
    if (s.instruments !== prev.instruments) track(db.instruments.bulkPut(changed(s.instruments, prev.instruments, time)));
    if (s.targets !== prev.targets || s.ownStock !== prev.ownStock) {
      track(db.kv.put(kv('targets', { targets: s.targets, ownStock: s.ownStock }, time)));
    }
    if (s.plan !== prev.plan) track(db.kv.put(kv('plan', s.plan, time)));
    if (s.prices !== prev.prices || s.fx !== prev.fx || s.navDates !== prev.navDates || s.quotesUpdatedAt !== prev.quotesUpdatedAt) {
      track(db.kv.put(kv('quotes', dataFromState(s).quotes, time)));
    }
    if (s.displayCurrency !== prev.displayCurrency || s.hideAmounts !== prev.hideAmounts) {
      track(db.kv.put(kv('prefs', dataFromState(s).prefs, time)));
    }
  });

  return {
    flush: async () => {
      await Promise.all([...pending]);
    },
    resetToSample: async () => {
      throw new Error('Task 4');
    },
    detach: unsubscribe,
  };
}
```

说明：
- 流水用 `bulkAdd`：同 id 已存在时报错而不是覆盖，符合「只增不改」，写入失败会走 `onError`。
- 「never rewrites a stored transaction」那条测试改的是已有 id 的流水，不会被当成新增。

- [ ] **Step 4: 运行，确认通过**

运行：`npx vitest run src/app`，然后 `npm run typecheck`
预期：全部通过。

---

### Task 3：启动时读出数据

**Files:**
- Modify: `src/app/persistence.ts`（加 `hydrate`）
- Create: `src/app/localData.ts`
- Modify: `src/main.tsx`
- Test: `src/app/persistence.test.ts`

**Interfaces:**
- Produces:

```ts
// persistence.ts
export function hydrate(store: Store, db: LocalDb, now: () => string): Promise<'loaded' | 'seeded'>;
// localData.ts
export function startLocalData(): Promise<'loaded' | 'seeded' | 'unavailable'>;
export function resetToSample(): Promise<void>; // Task 4
```

- [ ] **Step 1: 写测试**

```ts
describe('starting up', () => {
  it('writes the sample data on the first start and reads it back afterwards', async () => {
    const db = freshDb();
    const first = createAppStore(deps);
    expect(await hydrate(first, db, () => NOW)).toBe('seeded');
    const local = attachLocalDb(first, db, () => NOW, () => {});
    first.getState().updatePlan({ threshold: 6 });
    await local.flush();

    const second = createAppStore(deps);
    expect(await hydrate(second, db, () => NOW)).toBe('loaded');
    expect(second.getState().plan.threshold).toBe(6);
  });

  it('keeps the amounts hidden after a reload', async () => {
    const db = freshDb();
    const first = createAppStore(deps);
    await hydrate(first, db, () => NOW);
    const local = attachLocalDb(first, db, () => NOW, () => {});
    first.getState().toggleHideAmounts();
    await local.flush();
    const second = createAppStore(deps);
    await hydrate(second, db, () => NOW);
    expect(second.getState().hideAmounts).toBe(true);
  });

  it('gives up cleanly when the device storage cannot be opened', async () => {
    const broken = { kv: { get: () => Promise.reject(new Error('blocked')) } } as unknown as LocalDb;
    const store = createAppStore(deps);
    await expect(hydrate(store, broken, () => NOW)).rejects.toThrow('blocked');
    expect(store.getState().transactions).toHaveLength(36);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

运行：`npx vitest run src/app/persistence.test.ts`
预期：「starting up」一组失败（`hydrate` 不存在）。

- [ ] **Step 3: 实现**

```ts
// persistence.ts 追加
/** 读出本机数据；第一次打开时把当前的（示例）数据写进去。 */
export async function hydrate(store: Store, db: LocalDb, now: () => string): Promise<'loaded' | 'seeded'> {
  const data = await loadData(db);
  if (data) {
    store.setState(stateFromData(data, store.getState().today));
    return 'loaded';
  }
  await saveAll(db, dataFromState(store.getState()), now());
  return 'seeded';
}
```

```ts
// localData.ts
import { openLocalDb } from './localDb';
import { attachLocalDb, hydrate, sampleData, stateFromData } from './persistence';
import type { LocalController } from './persistence';
import { useAppStore } from './store';

// 把本机数据库接到应用上。只在 main.tsx 调用；测试里的状态层不接数据库。

let controller: LocalController | null = null;
const nowIso = () => new Date().toISOString();

/** 读出上次的数据（第一次打开时写入示例数据），之后的改动自动写回本机。 */
export async function startLocalData(): Promise<'loaded' | 'seeded' | 'unavailable'> {
  try {
    const db = openLocalDb();
    const status = await hydrate(useAppStore, db, nowIso);
    controller = attachLocalDb(useAppStore, db, nowIso, () => useAppStore.getState().flash('保存到本机失败，建议先导出一份完整备份'));
    return status;
  } catch {
    return 'unavailable';
  }
}

/** 恢复示例数据；没接本机数据库时（测试、无痕模式）只换界面上的数据。 */
export async function resetToSample(): Promise<void> {
  if (controller) return controller.resetToSample();
  const s = useAppStore.getState();
  useAppStore.setState(stateFromData(sampleData({ displayCurrency: s.displayCurrency, hideAmounts: s.hideAmounts }), s.today));
}
```

```tsx
// main.tsx：先读出本机数据再渲染
import { startLocalData } from './app/localData';
import { useAppStore } from './app/store';

void startLocalData().then((status) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  if (status === 'unavailable') useAppStore.getState().flash('这台设备不能保存数据，刷新后会回到示例数据');
});
```

- [ ] **Step 4: 运行，确认通过**

运行：`npx vitest run src/app`，然后 `npm run typecheck`
预期：全部通过。

---

### Task 4：恢复示例数据、改掉不实的文案

**Files:**
- Modify: `src/app/persistence.ts`（实现 `resetToSample`）
- Modify: `src/pages/holdings/AccountsSettings.tsx`、`src/pages/holdings/holdings.css`
- Test: `src/app/persistence.test.ts`、`src/pages/holdings/HoldingsPage.test.tsx`

**界面**（「设置账户 → 数据备份」）：
- 说明文字改成「数据保存在这台设备上，还没有开启云端同步。也可以导出一份到本地留存。」
- 两个导出按钮后面加一个「恢复示例数据」（`btn btn-ghost`）。
- 点了打开确认面板：
  - 标题「恢复示例数据」；
  - 副标题「这台设备上的记录、账户和设置都会换回示例数据，不能撤销。建议先导出一份完整备份。」；
  - 按钮「恢复」（btn-primary）/「取消」。
- 恢复后提示「已恢复示例数据」。

- [ ] **Step 1: 写测试**

```ts
// persistence.test.ts
describe('resetting to the sample data', () => {
  it('puts the sample data back on the device and on screen, keeping the display preferences', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await hydrate(store, db, () => NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    store.getState().addAccount({ id: 'tiger', name: '老虎', type: 'broker', currency: 'USD', market: '美股' });
    store.getState().setDisplayCurrency('USD');
    await local.flush();

    await local.resetToSample();
    expect(store.getState().accounts.map((a) => a.id)).not.toContain('tiger');
    expect(store.getState().displayCurrency).toBe('USD');
    const back = await loadData(db);
    expect(back!.accounts.map((a) => a.id)).not.toContain('tiger');
    expect(back!.prefs.displayCurrency).toBe('USD');

    // 恢复之后的改动照常写回
    store.getState().updatePlan({ threshold: 7 });
    await local.flush();
    expect((await loadData(db))!.plan.threshold).toBe(7);
  });
});
```

```ts
// HoldingsPage.test.tsx 的「设置账户」一组里加（RTL 那行的导入加上 act）
it('says the data stays on this device and can go back to the sample data', async () => {
  useAppStore.getState().addAccount({ id: 'tiger', name: '老虎', type: 'broker', currency: 'USD', market: '美股' });
  render(<HoldingsPage />);
  openSettings();
  expect(screen.getByText('数据保存在这台设备上，还没有开启云端同步。也可以导出一份到本地留存。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '恢复示例数据' }));
  const sheet = dialog('恢复示例数据');
  await act(async () => {
    fireEvent.click(within(sheet).getByRole('button', { name: '恢复' }));
  });
  expect(state().toast).toBe('已恢复示例数据');
  expect(state().accounts.map((a) => a.id)).not.toContain('tiger');
  expect(screen.queryByRole('dialog')).toBeNull();
});
```

页面测试没有接本机数据库，`resetToSample()` 走的是只换界面数据的分支；写回本机的那条路径由 `persistence.test.ts` 覆盖。

- [ ] **Step 2: 运行，确认失败**

运行：`npx vitest run src/app/persistence.test.ts src/pages/holdings`
预期：两条新测试失败（`resetToSample` 抛出「Task 4」；找不到「恢复示例数据」按钮和新文案）。

- [ ] **Step 3: 实现**

```ts
// persistence.ts：attachLocalDb 里的 resetToSample
resetToSample: async () => {
  paused = true;
  try {
    await Promise.all([...pending]);
    const s = store.getState();
    const data = sampleData({ displayCurrency: s.displayCurrency, hideAmounts: s.hideAmounts });
    await saveAll(db, data, now());
    saved = new Set(data.transactions.map((t) => t.id));
    store.setState(stateFromData(data, s.today));
  } finally {
    paused = false;
  }
},
```

`AccountsSettings.tsx`：
- 加 `const [confirming, setConfirming] = useState(false);`；
- 在「数据备份」里改文案、加按钮；
- 加确认面板：

```tsx
{confirming && (
  <Sheet
    title="恢复示例数据"
    subtitle="这台设备上的记录、账户和设置都会换回示例数据，不能撤销。建议先导出一份完整备份。"
    maxHeight="none"
    onClose={() => setConfirming(false)}
  >
    <div className="actions">
      <button
        type="button"
        className="btn btn-primary"
        onClick={async () => {
          await resetToSample();
          setConfirming(false);
          flash('已恢复示例数据');
        }}
      >
        恢复
      </button>
      <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>
        取消
      </button>
    </div>
  </Sheet>
)}
```

- [ ] **Step 4: 运行，确认通过**

运行：`npx vitest run`，然后 `npm run typecheck`
预期：全部通过。

---

### Task 5：核对

- [ ] 跑 `npx vitest run`、`npm run build`，都要通过。
- [ ] 变异检查：把下面每项逐个改坏，都要有测试失败：
  - 流水只写新增的；
  - 流水不改写；
  - 只给改过的设置盖新时间；
  - 闭眼偏好写回；
  - 重置期间暂停写回；
  - 重置保留显示偏好；
  - 写入失败要报告；
  - 第一次打开写入示例数据。
- [ ] 内置浏览器（5199 端口）：
  - 首次打开写入示例数据；
  - 记一笔入金 → 刷新 → 还在；
  - 闭眼 → 刷新 → 仍然闭眼；
  - 恢复示例数据 → 回到 36 条；
  - 用 JS 读 IndexedDB 核对条数。
- [ ] 更新台账 `.superpowers/sdd/2026-09-30-phase-2a-local-storage/progress.md`，列出手动验收步骤。
