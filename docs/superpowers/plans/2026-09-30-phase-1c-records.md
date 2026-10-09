# 阶段 1c-5 ·「记录」页 实施计划（含「记一笔」）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按原型 v5 实现「记录」页：可按时间、类型筛选和排序、按月分组的流水列表；「记一笔」面板支持买入 / 卖出 / 入金 / 出金，输入代码自动识别底层资产，识别不了时手动选择；现金扣款和自动补记入金 / 出金按 README 的规则。

**Architecture:** 筛选、排序、分组和代码识别写成纯函数，放在 `src/domain/`，并配测试。记账复用 1a 的 `recordBuy / recordSell / recordDeposit / recordWithdraw`，只补两种报错：手续费有误、用现金代码买卖。以下文案写成不依赖 React 的函数（`src/pages/records/*.ts`，有测试）：

- 列表每一行；
- 面板里的提示、报错；
- 保存后的提示。

组件只负责排版和状态。

1c 阶段在内存里的示例数据上完整可用：刷新后回到示例数据，持久化在阶段 2 做。预置品种表先用 `src/mock/catalog.ts`，阶段 3 换成 instruments 表。

**Tech Stack:** React 19 + TypeScript、Zustand、Vitest + Testing Library（happy-dom）

**Spec:**
- 原型 v5：第 207–231 行（记录页）、446–469 行（记一笔）；
- 原型逻辑：第 739、757–790、1034–1044、1149–1159、1188–1191 行；
- 截图 `08-records.png`；
- README 的「4. 记录」「流水类型」「本地优先与同步」。

## Global Constraints

- 金额和比例的计算只放在 `src/domain/`：纯 TypeScript，不引用 React 和浏览器 API，必须有单元测试。组件和文案函数里只做格式化和比较。
- 颜色、字体、圆角只用 `tokens.css` 里的变量；尺寸逐项对照原型的内联样式。
- 界面文案用简体中文，语气冷静、简洁。
- 闭眼时，金额、份额、现金余额一律显示 `••••`。
- 金额不换行。原型截图里的折行（「共 12 条记 / 录」「10,000 × / ¥2.05」）是原型的问题，不照抄。
- 流水只增不改。记一笔先写本地（1c 阶段是内存），立即显示。
- 不提交（你选了「先不提交」）。

## 取舍（请确认）

1. **期初流水**：也显示在列表里，类型写「期初录入」（README 如此），颜色用中性灰。只在「全部」里出现，类型筛选里没有这一项。示例数据有 18 条期初，所以「全部」是 36 条，原型是 12 条。
2. **「近 7 天」**：今天加之前 6 天，共 7 天；「近 30 天」同理。原型的写法是「相差 ≤ 7 天」，实际包含了 8 天。
3. **日期**：「记一笔」没有日期栏，一律记为今天（同原型）。补记过去的交易要用当天汇率，还会改动已经存下的每日快照，放到以后再做。
4. **识别不了的代码**：必须手动选一个底层资产才能保存。原型默认选中「标普 500」，容易误记。新代码保存后加入品种表，下次输入直接识别。
5. **买入提示**：按「账户里有没有这种币的现金」判断。原型只看账户币种和品种币种是否相同，和 README 的规则在少数情况下不一致。
   - 两种币相同，或账户里有这种币的现金：写「从富途的 USD 现金扣款（当前 $8,000），不足部分自动记为入金。」
   - 否则写「品种币种和账户不同，这笔买入会记为新入金。」
6. **卖出报错**：卖出超过持有份额时，报「该账户只有 120 份，不够卖出」，和出金的报错写法一致。原型是「该账户持仓不足」。
7. **小的写法调整**：
   - 价格加千分位（¥1,580，原型是 ¥1580）；
   - 未识别的新品种名称留空，列表只显示代码（原型会显示成「ABCD ABCD」）；
   - 面板最高 90%，内容超长时可以滚动（原型不限高，小屏上会被截掉）；
   - 筛选和排序离开页面后恢复默认，和其他页面的展开状态一样。

## Review Focus

1. **卖出超过持有份额**，或卖出这个账户没有的品种：报错并写出现有份额，不写入任何流水。→ Task 5
2. **识别不了的代码**：必须选了底层资产才能保存；保存后再输入同一个代码能直接识别，品种表里不出现重复。→ Task 2、Task 5
3. **现金代码**：在买入 / 卖出里输入 USD、CNY 时报错，提示改用入金 / 出金。→ Task 2、Task 5
4. **时间边界**：1 月份选「上个月」应得到去年 12 月；「近 7 天」不包括 7 天前那一天。→ Task 1
5. **闭眼**：列表里的金额、面板提示里的现金余额、报错和保存提示里的金额，都显示 `••••`。→ Task 3、Task 5

---

### Task 1：筛选、排序、按月分组（domain）

**Files:**
- Create: `src/domain/records.ts`
- Test: `src/domain/records.test.ts`

**Interfaces:**
- Consumes:
  - `sortTransactions(txns)`（`ledger.ts`）：按 日期 → 创建时间 → id 升序排列，返回新数组；
  - `daysBetween(from, to)`（`dates.ts`）。
- Produces:

```ts
export type RecordTime = '全部' | '近 7 天' | '近 30 天' | '上个月' | '今年' | '去年';
export const RECORD_TIMES: readonly RecordTime[];
export type RecordKind = 'all' | Exclude<TxType, 'opening'>;
export type RecordSort = 'desc' | 'asc';
export function inRecordTime(date: string, time: RecordTime, today: string): boolean;
export function filterRecords(
  txns: readonly Transaction[],
  f: { time: RecordTime; kind: RecordKind; sort: RecordSort; today: string },
): Transaction[];
export interface MonthGroup { month: string /* YYYY-MM */; items: Transaction[] }
export function groupByMonth(txns: readonly Transaction[]): MonthGroup[];
```

- [ ] **Step 1: 写测试**

```ts
import { describe, expect, it } from 'vitest';
import * as mock from '../mock';
import { filterRecords, groupByMonth, inRecordTime } from './records';
import type { RecordKind, RecordSort, RecordTime } from './records';
import type { Transaction, TxType } from './types';

const tx = (id: string, date: string, type: TxType = 'buy', createdAt = `${date}T01:00:00.000Z`): Transaction => ({
  id, date, createdAt, type, accountId: 'a', instrumentCode: 'VOO', qty: 1, price: 1, fee: 0, fxToCny: 1,
});

describe('inRecordTime', () => {
  it('近 7 天 / 近 30 天 count today and the days before it', () => {
    expect(inRecordTime('2026-09-29', '近 7 天', '2026-09-29')).toBe(true);
    expect(inRecordTime('2026-09-23', '近 7 天', '2026-09-29')).toBe(true);
    expect(inRecordTime('2026-09-22', '近 7 天', '2026-09-29')).toBe(false);
    expect(inRecordTime('2026-08-31', '近 30 天', '2026-09-29')).toBe(true);
    expect(inRecordTime('2026-08-30', '近 30 天', '2026-09-29')).toBe(false);
  });

  it('上个月 is the previous calendar month, also across a year end', () => {
    expect(inRecordTime('2026-08-01', '上个月', '2026-09-29')).toBe(true);
    expect(inRecordTime('2026-09-01', '上个月', '2026-09-29')).toBe(false);
    expect(inRecordTime('2026-12-31', '上个月', '2027-01-15')).toBe(true);
    expect(inRecordTime('2027-12-01', '上个月', '2027-01-15')).toBe(false);
  });

  it('今年 / 去年 go by calendar year', () => {
    expect(inRecordTime('2026-01-01', '今年', '2026-09-29')).toBe(true);
    expect(inRecordTime('2025-12-31', '今年', '2026-09-29')).toBe(false);
    expect(inRecordTime('2025-12-31', '去年', '2026-09-29')).toBe(true);
    expect(inRecordTime('2024-12-31', '去年', '2026-09-29')).toBe(false);
  });
});

describe('filterRecords', () => {
  const base: { time: RecordTime; kind: RecordKind; sort: RecordSort; today: string } = {
    time: '全部', kind: 'all', sort: 'desc', today: '2026-09-29',
  };

  it('counts the sample ledger by time and type', () => {
    const count = (f: Partial<typeof base>) => filterRecords(mock.transactions, { ...base, ...f }).length;
    expect(count({})).toBe(36);
    expect(count({ time: '近 7 天' })).toBe(0);
    expect(count({ time: '近 30 天' })).toBe(3);
    expect(count({ time: '上个月' })).toBe(3);
    expect(count({ time: '今年' })).toBe(12);
    expect(count({ time: '去年' })).toBe(24);
    expect(count({ kind: 'calibrate' })).toBe(1);
  });

  it('shows opening records only under 全部', () => {
    const txns = [tx('o', '2026-01-02', 'opening'), tx('b', '2026-02-01', 'buy')];
    expect(filterRecords(txns, base).map((t) => t.id)).toEqual(['b', 'o']);
    expect(filterRecords(txns, { ...base, kind: 'buy' }).map((t) => t.id)).toEqual(['b']);
  });

  it('sorts by date and creation time, newest or oldest first', () => {
    // 同一天：自动补记的入金先创建，买入后创建
    const txns = [
      tx('buy', '2026-09-18', 'buy', '2026-09-18T01:00:00.002Z'),
      tx('dep', '2026-09-18', 'deposit', '2026-09-18T01:00:00.001Z'),
      tx('old', '2026-09-02'),
    ];
    expect(filterRecords(txns, base).map((t) => t.id)).toEqual(['buy', 'dep', 'old']);
    expect(filterRecords(txns, { ...base, sort: 'asc' }).map((t) => t.id)).toEqual(['old', 'dep', 'buy']);
  });
});

describe('groupByMonth', () => {
  it('groups neighbouring records of the same month, keeping their order', () => {
    const groups = groupByMonth([tx('a', '2026-09-18'), tx('b', '2026-09-02'), tx('c', '2026-08-15')]);
    expect(groups.map((g) => [g.month, g.items.map((t) => t.id)])).toEqual([
      ['2026-09', ['a', 'b']],
      ['2026-08', ['c']],
    ]);
  });

  it('returns nothing for no records', () => {
    expect(groupByMonth([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

运行：`npx vitest run src/domain/records.test.ts`
预期：失败，提示找不到 `./records`。

- [ ] **Step 3: 实现**

```ts
import { daysBetween } from './dates';
import { sortTransactions } from './ledger';
import type { Transaction, TxType } from './types';

// 记录页：按时间、类型筛选流水，排序，再按月分组。日期都按记账日期（YYYY-MM-DD）比较。

export type RecordTime = '全部' | '近 7 天' | '近 30 天' | '上个月' | '今年' | '去年';
export const RECORD_TIMES: readonly RecordTime[] = ['全部', '近 7 天', '近 30 天', '上个月', '今年', '去年'];
/** 期初不单独筛选，只在「全部」里出现。 */
export type RecordKind = 'all' | Exclude<TxType, 'opening'>;
export type RecordSort = 'desc' | 'asc';

/** 「近 N 天」含今天共 N 天。 */
const withinDays = (date: string, today: string, days: number) => {
  const ago = daysBetween(date, today);
  return ago >= 0 && ago < days;
};

/** 「上个月」是今天所在月份的前一个自然月。 */
export function inRecordTime(date: string, time: RecordTime, today: string): boolean {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  switch (time) {
    case '全部':
      return true;
    case '近 7 天':
      return withinDays(date, today, 7);
    case '近 30 天':
      return withinDays(date, today, 30);
    case '上个月': {
      const prev = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
      return date.slice(0, 7) === prev;
    }
    case '今年':
      return date.slice(0, 4) === String(year);
    case '去年':
      return date.slice(0, 4) === String(year - 1);
  }
}

export function filterRecords(
  txns: readonly Transaction[],
  f: { time: RecordTime; kind: RecordKind; sort: RecordSort; today: string },
): Transaction[] {
  const kept = sortTransactions(txns).filter(
    (t) => inRecordTime(t.date, f.time, f.today) && (f.kind === 'all' || t.type === f.kind),
  );
  return f.sort === 'desc' ? kept.reverse() : kept;
}

export interface MonthGroup {
  /** YYYY-MM */
  month: string;
  items: Transaction[];
}

/** 相邻的同月流水归为一组，保持传入的顺序。 */
export function groupByMonth(txns: readonly Transaction[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  for (const t of txns) {
    const month = t.date.slice(0, 7);
    const last = groups.at(-1);
    if (last?.month === month) last.items.push(t);
    else groups.push({ month, items: [t] });
  }
  return groups;
}
```

- [ ] **Step 4: 运行，确认通过**

运行：`npx vitest run src/domain/records.test.ts`
预期：全部通过。

---

### Task 2：代码识别、记账报错、品种表（domain + store）

**Files:**
- Create: `src/domain/instruments.ts`
- Test: `src/domain/instruments.test.ts`
- Modify: `src/domain/record.ts`（`RecordError` 加两种；`recordBuy` / `recordSell` 的校验）
- Modify: `src/domain/record.test.ts`：第 76 行、第 108–112 行两条手续费断言改成 `invalid_fee`，并新增现金代码的用例
- Modify: `src/app/store.ts`（`addInstrument`）、`src/app/store.test.ts`

**Interfaces:**
- Produces:

```ts
// instruments.ts
export function normalizeCode(code: string): string; // 去掉首尾空格、转大写
export function findInstrument(code: string, instruments: readonly Instrument[]): Instrument | null;
export function guessCurrency(code: string): CashCurrency; // 纯数字 → CNY，其余 → USD（同原型）
export function newInstrument(code: string, exposureId: string): Instrument;
// 名称为空；纯数字 → A股 / CNY，其余 → 美股 / USD；paysDividend 为 false

// record.ts
export type RecordError =
  | { kind: 'invalid_amount' }
  | { kind: 'invalid_trade' } // 数量或价格不是正数
  | { kind: 'invalid_fee' } // 手续费为负、不是数字，或卖出时超过成交金额
  | { kind: 'cash_trade' } // 用 USD / CNY 这类现金代码买卖
  | { kind: 'insufficient_cash'; available: number; currency: CashCurrency }
  | { kind: 'insufficient_holding'; available: number };

// store.ts
addInstrument: (instrument: Instrument) => void; // 同代码已存在时不重复添加
```

- [ ] **Step 1: 写测试**

```ts
// instruments.test.ts
import { describe, expect, it } from 'vitest';
import * as mock from '../mock';
import { findInstrument, guessCurrency, newInstrument, normalizeCode } from './instruments';

describe('code lookup', () => {
  it('normalizes codes and finds them in the catalog', () => {
    expect(normalizeCode('  brk.b ')).toBe('BRK.B');
    expect(findInstrument('voo', mock.instruments)?.name).toBe('Vanguard 标普500');
    expect(findInstrument('513100', mock.instruments)?.exposureId).toBe('ndx');
    expect(findInstrument('ABCD', mock.instruments)).toBeNull();
    expect(findInstrument('   ', mock.instruments)).toBeNull();
  });

  it('guesses the currency and market of an unknown code from its digits', () => {
    expect(guessCurrency('600036')).toBe('CNY');
    expect(guessCurrency('tsla')).toBe('USD');
    expect(newInstrument(' abcd ', 'ndx')).toEqual({
      code: 'ABCD', name: '', market: '美股', currency: 'USD', exposureId: 'ndx', paysDividend: false,
    });
    expect(newInstrument('600036', 'csi300')).toMatchObject({ market: 'A股', currency: 'CNY' });
  });
});
```

`record.test.ts` 的改动：

```ts
// 第 76 行
expect(recordBuy({ ...args, qty: 1, price: 500, fee: -1 })).toEqual({ ok: false, error: { kind: 'invalid_fee' } });
expect(recordBuy({ ...args, qty: 1, price: 500, fee: Number.NaN })).toEqual({ ok: false, error: { kind: 'invalid_fee' } });
// 第 108–112 行：卖出手续费超过成交金额
expect(recordSell({ ...base, ledger, account: futu, instrument: VOO, qty: 1, price: 5, fee: 6, ctx: makeCtx() }))
  .toEqual({ ok: false, error: { kind: 'invalid_fee' } });
// 新增（放在 describe('recordBuy') 里）
it('refuses to buy or sell cash', () => {
  const USD: Instrument = { code: 'USD', name: '美元现金', market: '现金', currency: 'USD', exposureId: 'usd', paysDividend: false };
  expect(recordBuy({ ...base, ledger, account: futu, instrument: USD, qty: 1, price: 1, ctx: makeCtx() }))
    .toEqual({ ok: false, error: { kind: 'cash_trade' } });
  expect(recordSell({ ...base, ledger, account: futu, instrument: USD, qty: 1, price: 1, ctx: makeCtx() }))
    .toEqual({ ok: false, error: { kind: 'cash_trade' } });
});
```

`store.test.ts` 新增：

```ts
it('adds a new instrument once', () => {
  const store = createAppStore({ random: () => 0.5, delay: async () => {}, now: () => fixedNow });
  const abcd = { code: 'ABCD', name: '', market: '美股' as const, currency: 'USD' as const, exposureId: 'ndx', paysDividend: false };
  const before = store.getState().instruments.length;
  store.getState().addInstrument(abcd);
  store.getState().addInstrument(abcd);
  store.getState().addInstrument(store.getState().instruments[0]!);
  expect(store.getState().instruments).toHaveLength(before + 1);
});
```

- [ ] **Step 2: 运行，确认失败**

运行：`npx vitest run src/domain/instruments.test.ts src/domain/record.test.ts src/app/store.test.ts`
预期：
- `instruments` 找不到模块；
- 手续费断言得到 `invalid_trade`；
- 现金用例返回 `ok: true`；
- `addInstrument` 不是函数。

- [ ] **Step 3: 实现**

```ts
// instruments.ts
import type { CashCurrency, Instrument } from './types';

// 「记一笔」按代码识别品种。1c 查示例目录，阶段 3 换成 instruments 表（用户自建的优先）。
// 识别不了时由用户选底层资产，币种和市场按代码猜（同原型）。

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function findInstrument(code: string, instruments: readonly Instrument[]): Instrument | null {
  const c = normalizeCode(code);
  return c ? (instruments.find((i) => i.code === c) ?? null) : null;
}

const isDigits = (code: string) => /^\d+$/.test(code);

export function guessCurrency(code: string): CashCurrency {
  return isDigits(normalizeCode(code)) ? 'CNY' : 'USD';
}

export function newInstrument(code: string, exposureId: string): Instrument {
  const c = normalizeCode(code);
  return { code: c, name: '', market: isDigits(c) ? 'A股' : '美股', currency: guessCurrency(c), exposureId, paysDividend: false };
}
```

```ts
// record.ts：recordBuy / recordSell 开头原来的校验换成这个函数
function tradeError(i: TradeInput, fee: number, side: 'buy' | 'sell'): RecordError | null {
  if (i.instrument.market === '现金') return { kind: 'cash_trade' };
  if (!isPositive(i.qty) || !isPositive(i.price)) return { kind: 'invalid_trade' };
  if (!isNonNegative(fee) || (side === 'sell' && fee > i.qty * i.price)) return { kind: 'invalid_fee' };
  return null;
}

export function recordBuy(i: TradeInput): RecordResult {
  const fee = i.fee ?? 0;
  const error = tradeError(i, fee, 'buy');
  if (error) return fail(error);
  // 以下不变：算金额、现金不足时补记入金、写买入
}

export function recordSell(i: TradeInput): RecordResult {
  const fee = i.fee ?? 0;
  const error = tradeError(i, fee, 'sell');
  if (error) return fail(error);
  // 以下不变：检查持有份额、写卖出、跨币种时补记出金
}
```

```ts
// store.ts
addInstrument: (instrument) =>
  set((s) => (s.instruments.some((i) => i.code === instrument.code) ? s : { instruments: [...s.instruments, instrument] })),
```

- [ ] **Step 4: 运行，确认通过**

运行：`npx vitest run src/domain src/app`
预期：全部通过。

---

### Task 3：列表每一行的文案

**Files:**
- Create: `src/pages/records/recordLine.ts`
- Test: `src/pages/records/recordLine.test.ts`

**Interfaces:**
- Consumes:
  - `Ledger.calibrationDiffs`（`deriveLedger` 已算好每笔校准的差额，按流水 id）；
  - `MASK`、`CURRENCY_SYMBOL`、`formatQty`、`sign`（`app/format.ts`）；
  - `TX_TYPE_LABEL`（`app/backup.ts`）。
- Produces:

```ts
export type RecordTone = 'gain' | 'loss' | 'neutral';
export interface RecordLine { id: string; title: string; typeLabel: string; tone: RecordTone; meta: string; amount: string }
export function recordLine(
  t: Transaction,
  ctx: {
    instrumentByCode: Record<string, Instrument>;
    accountName: (id: string) => string;
    calibrationDiffs: Record<string, number>;
    hide: boolean;
  },
): RecordLine;
export function monthLabel(month: string): string; // '2026-09' → '2026 年 9 月'
export function formatPrice(price: number): string; // 千分位，最多 4 位小数
```

每种流水的显示规则（同原型第 1040–1043 行，另加期初）：

| type | 标题 | 类型 | 颜色 | 金额 |
|---|---|---|---|---|
| buy / sell | `513500 标普500ETF`（名称为空时只写代码） | 买入 / 卖出 | gain / loss | `10,000 × ¥2.05`，有手续费时加 ` · 费 1.5` |
| deposit / withdraw | 转入资金 / 转出资金 | 入金 / 出金 | gain / loss | `+¥50,000` / `−$4,500`，有 reason 时加 ` · 年终奖` |
| calibrate | 同买入 | 校准 | neutral | 差额为 0：`份额无变化 · 已核对`；否则 `+0.84 份 · 红利再投` |
| opening | 同买入 | 期初录入 | neutral | 现金：`$13,280`；其他：`109.16 × $450` |

- 说明行（meta）：`账户名 · MM-DD`。
- 闭眼时金额显示 `••••`。
- 颜色（原型第 1043 行）：gain 用 `--color-accent-2-800`，loss 用 `--color-accent-700`，neutral 用 `--color-neutral-700`。

- [ ] **Step 1: 写测试**

```ts
import { describe, expect, it } from 'vitest';
import { currencyLookup, deriveLedger } from '../../domain/ledger';
import type { Transaction } from '../../domain/types';
import * as mock from '../../mock';
import { formatPrice, monthLabel, recordLine } from './recordLine';

const ledger = deriveLedger(mock.transactions, currencyLookup(mock.instrumentByCode));
const ctx = {
  instrumentByCode: mock.instrumentByCode,
  accountName: (id: string) => mock.accountById[id]?.name ?? id,
  calibrationDiffs: ledger.calibrationDiffs,
  hide: false,
};
const find = (date: string, type: Transaction['type'], code?: string) =>
  mock.transactions.find((t) => t.date === date && t.type === type && (!code || t.instrumentCode === code))!;
const line = (t: Transaction, hide = false) => {
  const { id, ...rest } = recordLine(t, { ...ctx, hide });
  expect(id).toBe(t.id);
  return rest;
};

describe('recordLine', () => {
  it('shows trades as shares × price', () => {
    expect(line(find('2026-09-18', 'buy'))).toEqual({
      title: '513500 标普500ETF', typeLabel: '买入', tone: 'gain', meta: '招商证券 · 09-18', amount: '10,000 × ¥2.05',
    });
    expect(line(find('2026-08-15', 'sell'))).toMatchObject({ title: 'AAPL 苹果', typeLabel: '卖出', tone: 'loss', amount: '20 × $225' });
    expect(line(find('2025-06-16', 'buy'))).toMatchObject({ amount: '20 × ¥1,580' });
    expect(line({ ...find('2026-09-02', 'buy'), fee: 1.5 })).toMatchObject({ amount: '10 × $528 · 费 1.5' });
  });

  it('shows money in and out with its reason', () => {
    expect(line(find('2026-09-18', 'deposit'))).toEqual({
      title: '转入资金', typeLabel: '入金', tone: 'gain', meta: '招商证券 · 09-18', amount: '+¥20,500 · 买入时现金不足自动补记',
    });
    expect(line(find('2026-08-20', 'withdraw'))).toMatchObject({ title: '转出资金', typeLabel: '出金', tone: 'loss', amount: '−$4,500' });
  });

  it('shows the share difference a calibration made, worked out from the ledger', () => {
    const calib = find('2026-06-20', 'calibrate');
    expect(line(calib)).toMatchObject({ title: 'VOO Vanguard 标普500', typeLabel: '校准', tone: 'neutral', amount: '+0.84 份 · 红利再投' });
    expect(recordLine(calib, { ...ctx, calibrationDiffs: { [calib.id]: 0 } }).amount).toBe('份额无变化 · 已核对');
    expect(recordLine({ ...calib, reason: '拆股合股' }, { ...ctx, calibrationDiffs: { [calib.id]: -2 } }).amount).toBe('−2 份 · 拆股合股');
  });

  it('labels opening records 期初录入 and shows cash as a balance', () => {
    expect(line(find('2025-01-02', 'opening', 'VOO'))).toEqual({
      title: 'VOO Vanguard 标普500', typeLabel: '期初录入', tone: 'neutral', meta: '富途 · 01-02', amount: '109.16 × $450',
    });
    expect(line(find('2025-01-02', 'opening', 'USD'))).toMatchObject({ title: 'USD 美元现金', amount: '$13,280' });
  });

  it('shows only the code for an instrument without a name', () => {
    const t = { ...find('2026-09-02', 'buy'), instrumentCode: 'ABCD' };
    expect(recordLine(t, { ...ctx, instrumentByCode: { ...mock.instrumentByCode, ABCD: { ...mock.instrumentByCode.VOO!, code: 'ABCD', name: '' } } }).title).toBe('ABCD');
  });

  it('hides every amount when the eye is closed', () => {
    for (const t of mock.transactions) expect(recordLine(t, { ...ctx, hide: true }).amount).toBe('••••');
  });
});

describe('labels', () => {
  it('writes the month and the price', () => {
    expect(monthLabel('2026-09')).toBe('2026 年 9 月');
    expect(monthLabel('2025-01')).toBe('2025 年 1 月');
    expect(formatPrice(1580)).toBe('1,580');
    expect(formatPrice(2.05)).toBe('2.05');
    expect(formatPrice(4.61237)).toBe('4.6124');
  });
});
```

- [ ] **Step 2: 运行，确认失败**

运行：`npx vitest run src/pages/records/recordLine.test.ts`
预期：失败，提示找不到 `./recordLine`。

- [ ] **Step 3: 实现**

```ts
import { TX_TYPE_LABEL } from '../../app/backup';
import { CURRENCY_SYMBOL, MASK, formatQty, sign } from '../../app/format';
import type { Instrument, Transaction } from '../../domain/types';

// 记录页每一行的文案，写法同原型第 1040–1043 行；期初显示为「期初录入」（README）。

export type RecordTone = 'gain' | 'loss' | 'neutral';
export interface RecordLine { id: string; title: string; typeLabel: string; tone: RecordTone; meta: string; amount: string }

const TONE: Record<Transaction['type'], RecordTone> = {
  opening: 'neutral', buy: 'gain', sell: 'loss', deposit: 'gain', withdraw: 'loss', calibrate: 'neutral',
};

export function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function monthLabel(month: string): string {
  return `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`;
}

export function recordLine(t: Transaction, ctx: {
  instrumentByCode: Record<string, Instrument>;
  accountName: (id: string) => string;
  calibrationDiffs: Record<string, number>;
  hide: boolean;
}): RecordLine {
  const instrument = ctx.instrumentByCode[t.instrumentCode];
  const symbol = CURRENCY_SYMBOL[instrument?.currency ?? 'CNY'];
  const withReason = (text: string) => (t.reason ? `${text} · ${t.reason}` : text);
  const title =
    t.type === 'deposit' ? '转入资金' : t.type === 'withdraw' ? '转出资金' : `${t.instrumentCode} ${instrument?.name ?? ''}`.trim();

  let amount: string;
  if (ctx.hide) amount = MASK;
  else if (t.type === 'deposit' || t.type === 'withdraw') {
    amount = withReason(`${t.type === 'deposit' ? '+' : '−'}${symbol}${formatQty(t.qty)}`);
  } else if (t.type === 'calibrate') {
    const diff = ctx.calibrationDiffs[t.id] ?? 0;
    amount = Math.abs(diff) < 1e-9 ? '份额无变化 · 已核对' : withReason(`${sign(diff)}${formatQty(Math.abs(diff))} 份`);
  } else if (t.type === 'opening' && instrument?.market === '现金') {
    amount = `${symbol}${formatQty(t.qty)}`;
  } else {
    amount = `${formatQty(t.qty)} × ${symbol}${formatPrice(t.price)}${t.fee ? ` · 费 ${t.fee}` : ''}`;
  }

  return {
    id: t.id,
    title,
    typeLabel: t.type === 'opening' ? '期初录入' : TX_TYPE_LABEL[t.type],
    tone: TONE[t.type],
    meta: `${ctx.accountName(t.accountId)} · ${t.date.slice(5)}`,
    amount,
  };
}
```

- [ ] **Step 4: 运行，确认通过**

运行：`npx vitest run src/pages/records/recordLine.test.ts`
预期：全部通过。

---

### Task 4：记录页（列表、筛选、排序）

**Files:**
- Create: `src/pages/records/RecordsPage.tsx`、`src/pages/records/records.css`
- Test: `src/pages/records/RecordsPage.test.tsx`
- Modify: `src/App.tsx`（`tab === 'rec'` 时显示 `<RecordsPage />`）

**Interfaces:**
- Consumes：Task 1 的 `RECORD_TIMES / filterRecords / groupByMonth`；Task 3 的 `recordLine / monthLabel`；`usePortfolio().ledger.calibrationDiffs`、`instrumentByCode`；`Seg`。

**结构**（原型第 207–231 行）：

```
section.page.records（padding-top 28px）
  .records-header（flex，两端对齐，垂直居中）：h1.page-title「记录」+ button.btn.btn-primary「记一笔」
  .records-filters（column，gap 10）
    .rec-chips（flex，gap 6，横向滚动、不显示滚动条）：6 个 button.rec-chip[aria-pressed]
    .rec-types（横向滚动）：<Seg label="类型" options={全部 买入 卖出 入金 出金 校准} />
    .rec-count-row（两端对齐，垂直居中，gap 8）：span.rec-count「共 N 条记录」+ button.btn.btn-ghost.rec-sort「最新在前 ↓」/「最早在前 ↑」
  没有记录时：p.rec-empty「这个时间段没有符合条件的记录」
  每个月一组：.rec-group（column，gap 6）
    span.rec-month「2026 年 9 月」
    .list-box > .rec-row.list-row × N
      span.rec-title / span.rec-type.tone-{gain|loss|neutral} / span.rec-meta / span.rec-amount
```

**样式**（原型内联值）：

```css
.page.records { padding-top: 28px; }
.records-header { display: flex; justify-content: space-between; align-items: center; }
.records-filters { display: flex; flex-direction: column; gap: 10px; }
.rec-chips, .rec-types { overflow-x: auto; scrollbar-width: none; }
.rec-chips::-webkit-scrollbar, .rec-types::-webkit-scrollbar { display: none; }
.rec-chips { display: flex; gap: 6px; }
.rec-chip {
  flex: none; padding: 7px 14px; border: 0; border-radius: 999px;
  background: var(--color-neutral-100); color: var(--color-text);
  font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer;
}
.rec-chip[aria-pressed='true'] { background: var(--color-text); color: var(--color-bg); }
.rec-count-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.rec-count { font-size: 12px; color: var(--color-neutral-700); white-space: nowrap; }
.rec-sort { font-size: 13px; }
.rec-empty { margin: 0; padding: 24px 0; font-size: 14px; color: var(--color-neutral-700); text-align: center; }
.rec-group { display: flex; flex-direction: column; gap: 6px; }
.rec-month { padding: 0 4px; font-size: 13px; font-weight: 700; color: var(--color-neutral-700); }
.rec-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 12px 0; }
.rec-title { font-size: 15px; font-weight: 600; }
.rec-type { font-size: 12px; font-weight: 700; text-align: right; }
.rec-type.tone-gain { color: var(--color-accent-2-800); }
.rec-type.tone-loss { color: var(--color-accent-700); }
.rec-type.tone-neutral { color: var(--color-neutral-700); }
.rec-meta { font-size: 12px; color: var(--color-neutral-700); }
.rec-amount { font-size: 13px; text-align: right; white-space: nowrap; }
```

注意：
- 类型标签的颜色是 accent-700，不能用 `ui.css` 里的 `.is-loss`，那个是 accent-800。
- `.list-box` 已经是 `padding: 4px 16px`，和原型一致。

- [ ] **Step 1: 写测试**

```ts
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MASK } from '../../app/format';
import { useAppStore } from '../../app/store';
import type { AppState } from '../../app/store';
import { RecordsPage } from './RecordsPage';

let initial: AppState;
beforeEach(() => { initial = useAppStore.getState(); });
afterEach(() => { cleanup(); useAppStore.setState(initial, true); });

const rows = () => [...document.querySelectorAll('.rec-row')].map((r) => r.textContent);
const months = () => [...document.querySelectorAll('.rec-month')].map((m) => m.textContent);
const chip = (name: string) => screen.getByRole('button', { name });

describe('记录页', () => {
  it('lists every record newest first, grouped by month', () => {
    render(<RecordsPage />);
    expect(screen.getByText('共 36 条记录')).toBeTruthy();
    expect(months()[0]).toBe('2026 年 9 月');
    expect(rows().slice(0, 3)).toEqual([
      '513500 标普500ETF买入招商证券 · 09-1810,000 × ¥2.05',
      '转入资金入金招商证券 · 09-18+¥20,500 · 买入时现金不足自动补记',
      'VOO Vanguard 标普500买入富途 · 09-0210 × $528',
    ]);
    expect(chip('全部').getAttribute('aria-pressed')).toBe('true');
  });

  it('filters by time', () => {
    render(<RecordsPage />);
    fireEvent.click(chip('近 7 天'));
    expect(screen.getByText('共 0 条记录')).toBeTruthy();
    expect(screen.getByText('这个时间段没有符合条件的记录')).toBeTruthy();
    fireEvent.click(chip('上个月'));
    expect(months()).toEqual(['2026 年 8 月']);
    expect(rows()).toHaveLength(3);
  });

  it('filters by type', () => {
    render(<RecordsPage />);
    fireEvent.click(screen.getByRole('radio', { name: '校准' }));
    expect(rows()).toEqual(['VOO Vanguard 标普500校准富途 · 06-20+0.84 份 · 红利再投']);
  });

  it('flips to oldest first, where the opening records come first', () => {
    render(<RecordsPage />);
    fireEvent.click(screen.getByRole('button', { name: '最新在前 ↓' }));
    expect(screen.getByRole('button', { name: '最早在前 ↑' })).toBeTruthy();
    expect(months()[0]).toBe('2025 年 1 月');
    expect(rows()[0]).toBe('VOO Vanguard 标普500期初录入富途 · 01-02109.16 × $450');
  });

  it('hides every amount when the eye is closed', () => {
    useAppStore.setState({ hideAmounts: true });
    render(<RecordsPage />);
    const amounts = [...document.querySelectorAll('.rec-amount')].map((a) => a.textContent);
    expect(amounts).toHaveLength(36);
    expect(new Set(amounts)).toEqual(new Set([MASK]));
  });
});
```

- [ ] **Step 2: 运行，确认失败**

运行：`npx vitest run src/pages/records/RecordsPage.test.tsx`
预期：失败，提示找不到 `./RecordsPage`。

- [ ] **Step 3: 实现**

`records.css` 写入上面的样式。`RecordsPage.tsx`：

```tsx
import { useState } from 'react';
import { Seg } from '../../app/Seg';
import { useAppStore } from '../../app/store';
import { usePortfolio } from '../../app/usePortfolio';
import { RECORD_TIMES, filterRecords, groupByMonth } from '../../domain/records';
import type { RecordKind, RecordSort, RecordTime } from '../../domain/records';
import { monthLabel, recordLine } from './recordLine';
import './records.css';

const KINDS = [
  ['all', '全部'],
  ['buy', '买入'],
  ['sell', '卖出'],
  ['deposit', '入金'],
  ['withdraw', '出金'],
  ['calibrate', '校准'],
] as const satisfies readonly (readonly [RecordKind, string])[];

/** 「记录」页：按时间、类型筛选，排序，按月分组；右上角「记一笔」（原型 v5 第 207–231 行）。 */
export function RecordsPage() {
  const [time, setTime] = useState<RecordTime>('全部');
  const [kind, setKind] = useState<RecordKind>('all');
  const [sort, setSort] = useState<RecordSort>('desc');
  const portfolio = usePortfolio();
  const transactions = useAppStore((s) => s.transactions);
  const accounts = useAppStore((s) => s.accounts);
  const today = useAppStore((s) => s.today);
  const hide = useAppStore((s) => s.hideAmounts);

  const records = filterRecords(transactions, { time, kind, sort, today });
  const ctx = {
    instrumentByCode: portfolio.instrumentByCode,
    accountName: (id: string) => accounts.find((a) => a.id === id)?.name ?? id,
    calibrationDiffs: portfolio.ledger.calibrationDiffs,
    hide,
  };

  return (
    <section className="page records">
      <div className="records-header">
        <h1 className="page-title">记录</h1>
        <button type="button" className="btn btn-primary">
          记一笔
        </button>
      </div>
      <div className="records-filters">
        <div className="rec-chips" role="group" aria-label="时间">
          {RECORD_TIMES.map((t) => (
            <button key={t} type="button" className="rec-chip" aria-pressed={time === t} onClick={() => setTime(t)}>
              {t}
            </button>
          ))}
        </div>
        <div className="rec-types">
          <Seg label="类型" options={KINDS} value={kind} onChange={setKind} />
        </div>
        <div className="rec-count-row">
          <span className="rec-count">共 {records.length} 条记录</span>
          <button type="button" className="btn btn-ghost rec-sort" onClick={() => setSort(sort === 'desc' ? 'asc' : 'desc')}>
            {sort === 'desc' ? '最新在前 ↓' : '最早在前 ↑'}
          </button>
        </div>
      </div>
      {records.length === 0 && <p className="rec-empty">这个时间段没有符合条件的记录</p>}
      {groupByMonth(records).map((g) => (
        <div key={g.month} className="rec-group">
          <span className="rec-month">{monthLabel(g.month)}</span>
          <div className="list-box">
            {g.items.map((t) => {
              const line = recordLine(t, ctx);
              return (
                <div key={line.id} className="rec-row list-row">
                  <span className="rec-title">{line.title}</span>
                  <span className={`rec-type tone-${line.tone}`}>{line.typeLabel}</span>
                  <span className="rec-meta">{line.meta}</span>
                  <span className="rec-amount">{line.amount}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
```

在 `App.tsx` 里接上路由（加 `import { RecordsPage } from './pages/records/RecordsPage';`）：

```tsx
      ) : tab === 'hold' ? (
        <HoldingsPage />
      ) : tab === 'rec' ? (
        <RecordsPage />
      ) : (
```

- [ ] **Step 4: 运行，确认通过**

运行：`npx vitest run src/pages/records src/App.test.tsx`
预期：全部通过。

---

### Task 5：「记一笔」面板

**Files:**
- Create: `src/pages/records/recordForm.ts`、`src/pages/records/recordForm.test.ts`（提示、报错、保存提示的文案）
- Create: `src/pages/records/AddRecordSheet.tsx`、`src/pages/records/AddRecordSheet.test.tsx`
- Modify: `src/pages/records/RecordsPage.tsx`（点「记一笔」打开面板）、`src/pages/records/records.css`
- Modify: `src/pages/plan/plan.css` → `src/app/ui.css`：把 `.align-start` 挪过去。记录页也要用，和上次挪 `.dot` 的原因一样。

**Interfaces:**
- Consumes：
  - Task 2：`normalizeCode / findInstrument / newInstrument / guessCurrency`、store 的 `addInstrument`；
  - 1a：`recordBuy / recordSell / recordDeposit / recordWithdraw`（返回 `RecordResult`）、`cashBalance(ledger, accountId, currency)`；
  - 其他：`recordCtx`（`app/ids.ts`）、`appendTransactions`、`flash`。
- Produces（`recordForm.ts`）：

```ts
export type EntryType = 'buy' | 'sell' | 'deposit' | 'withdraw';
export type FormError = RecordError | { kind: 'missing_code' } | { kind: 'missing_exposure' };
export function entryCurrency(code: string, found: Instrument | null, account: Account): CashCurrency;
export function tradeHint(i: { type: 'buy' | 'sell'; account: Account; currency: CashCurrency; cash: number; hide: boolean }): string;
export function cashHint(i: { type: 'deposit' | 'withdraw'; account: Account; cash: number; hide: boolean }): string;
export function recognizedText(instrument: Instrument, exposure: Exposure, group: ExposureGroup): string;
export function formErrorText(error: FormError, hide: boolean): string;
export function savedMessage(i: {
  type: EntryType;
  code: string;
  account: Account;
  currency: CashCurrency; // 买卖为品种币种，入金出金为账户币种
  cashBefore: number; // 记账前账户里这种币的现金
  transactions: readonly Transaction[]; // 这次写入的流水
  hide: boolean;
}): string;
```

文案规则同原型第 757–790、1154–1157 行，按「取舍」第 5、6 条调整。闭眼时金额写成 `••••`。完整的写法见下面的测试。

- [ ] **Step 1: 写文案函数的测试**

```ts
// recordForm.test.ts
import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../domain/types';
import * as mock from '../../mock';
import { cashHint, entryCurrency, formErrorText, recognizedText, savedMessage, tradeHint } from './recordForm';

const futu = mock.accountById.futu!; // 美元券商
const cms = mock.accountById.cms!; // 人民币券商
const tx = (type: Transaction['type'], qty: number, code = 'USD'): Transaction => ({
  id: `${type}-${code}`, date: '2026-09-29', createdAt: '2026-09-29T01:00:00.000Z', type, accountId: 'futu',
  instrumentCode: code, qty, price: 1, fee: 0, fxToCny: 7.1,
});

describe('tradeHint', () => {
  it('buys from the cash of the instrument currency when the account has it', () => {
    expect(tradeHint({ type: 'buy', account: futu, currency: 'USD', cash: 8000, hide: false })).toBe(
      '从富途的 USD 现金扣款（当前 $8,000），不足部分自动记为入金。',
    );
    expect(tradeHint({ type: 'buy', account: futu, currency: 'CNY', cash: 500, hide: false })).toBe(
      '从富途的 CNY 现金扣款（当前 ¥500），不足部分自动记为入金。',
    );
    expect(tradeHint({ type: 'buy', account: futu, currency: 'CNY', cash: 0, hide: false })).toBe(
      '品种币种和账户不同，这笔买入会记为新入金。手续费计入成本。',
    );
    expect(tradeHint({ type: 'buy', account: futu, currency: 'USD', cash: 8000, hide: true })).toBe(
      '从富途的 USD 现金扣款（当前 ••••），不足部分自动记为入金。',
    );
  });

  it('sells into the account cash, or out of the portfolio in another currency', () => {
    expect(tradeHint({ type: 'sell', account: futu, currency: 'USD', cash: 0, hide: false })).toBe(
      '卖出所得（扣除手续费）计入账户现金，不影响本金线。',
    );
    expect(tradeHint({ type: 'sell', account: futu, currency: 'CNY', cash: 0, hide: false })).toBe('卖出所得记为出金。');
  });
});

describe('cashHint', () => {
  it('explains what money in and out does to the principal line', () => {
    expect(cashHint({ type: 'deposit', account: futu, cash: 8000, hide: false })).toBe(
      '从组合外转入的钱（工资、存款等），会让收益页的本金线上升。',
    );
    expect(cashHint({ type: 'withdraw', account: futu, cash: 8000, hide: false })).toBe(
      '转出组合的钱，会让本金线下降。当前账户现金 $8,000。',
    );
    expect(cashHint({ type: 'withdraw', account: cms, cash: 0, hide: false })).toBe('转出组合的钱，会让本金线下降。当前账户现金 ¥0。');
    expect(cashHint({ type: 'withdraw', account: futu, cash: 8000, hide: true })).toBe(
      '转出组合的钱，会让本金线下降。当前账户现金 ••••。',
    );
  });
});

describe('recognizedText / entryCurrency', () => {
  it('names the underlying asset, its group and the market', () => {
    const inst = mock.instrumentByCode['513100']!;
    expect(recognizedText(inst, mock.exposureById.ndx!, mock.groups.find((g) => g.id === 'us')!)).toBe(
      '识别为：纳斯达克 100 · 美股指数 · A股',
    );
  });

  it('prices in the instrument currency, a guess for unknown codes, or the account currency before a code is typed', () => {
    expect(entryCurrency('', null, cms)).toBe('CNY');
    expect(entryCurrency('513100', mock.instrumentByCode['513100']!, futu)).toBe('CNY');
    expect(entryCurrency('ABCD', null, cms)).toBe('USD');
  });
});

describe('formErrorText', () => {
  it('explains each problem', () => {
    expect(formErrorText({ kind: 'missing_code' }, false)).toBe('请填写代码');
    expect(formErrorText({ kind: 'invalid_trade' }, false)).toBe('请填写数量和成交价');
    expect(formErrorText({ kind: 'invalid_fee' }, false)).toBe('手续费填写有误');
    expect(formErrorText({ kind: 'missing_exposure' }, false)).toBe('请选择底层资产');
    expect(formErrorText({ kind: 'cash_trade' }, false)).toBe('现金请用「入金」或「出金」记录');
    expect(formErrorText({ kind: 'insufficient_holding', available: 120 }, false)).toBe('该账户只有 120 份，不够卖出');
    expect(formErrorText({ kind: 'invalid_amount' }, false)).toBe('请填写金额');
    expect(formErrorText({ kind: 'insufficient_cash', available: 8000, currency: 'USD' }, false)).toBe(
      '账户现金只有 $8,000，不够转出',
    );
  });

  it('hides balances when the eye is closed', () => {
    expect(formErrorText({ kind: 'insufficient_holding', available: 120 }, true)).toBe('该账户只有 •••• 份，不够卖出');
    expect(formErrorText({ kind: 'insufficient_cash', available: 8000, currency: 'USD' }, true)).toBe('账户现金只有 ••••，不够转出');
  });
});

describe('savedMessage', () => {
  const base = { code: 'VOO', account: futu, currency: 'USD' as const, cashBefore: 8000, hide: false };

  it('says where the money for a buy came from', () => {
    expect(savedMessage({ ...base, type: 'buy', transactions: [tx('buy', 5, 'VOO')] })).toBe('已记录 VOO，已从账户现金扣款');
    expect(savedMessage({ ...base, type: 'buy', transactions: [tx('deposit', 2000), tx('buy', 20, 'VOO')] })).toBe(
      '已记录 VOO，现金不足的 $2,000 已记为入金',
    );
    const cny = { ...base, code: '513500', currency: 'CNY' as const };
    expect(savedMessage({ ...cny, type: 'buy', cashBefore: 0, transactions: [tx('deposit', 200, 'CNY'), tx('buy', 100, '513500')] })).toBe(
      '已记录 513500，记为新入金',
    );
    expect(savedMessage({ ...cny, type: 'buy', cashBefore: 50, transactions: [tx('deposit', 150, 'CNY'), tx('buy', 100, '513500')] })).toBe(
      '已记录 513500，现金不足的 ¥150 已记为入金',
    );
  });

  it('says where the proceeds of a sale went', () => {
    expect(savedMessage({ ...base, type: 'sell', transactions: [tx('sell', 10, 'VOO')] })).toBe('已记录 VOO，所得已计入账户现金');
    expect(
      savedMessage({ ...base, type: 'sell', code: '513500', currency: 'CNY', transactions: [tx('sell', 10, '513500'), tx('withdraw', 20, 'CNY')] }),
    ).toBe('已记录 513500，所得记为出金');
  });

  it('confirms money in and out, hiding amounts when asked', () => {
    expect(savedMessage({ ...base, type: 'deposit', code: '', transactions: [tx('deposit', 10000)] })).toBe(
      '已记录入金 $10,000 · 本金线已更新',
    );
    expect(savedMessage({ ...base, type: 'withdraw', code: '', transactions: [tx('withdraw', 500)] })).toBe('已记录出金 $500 · 本金线已更新');
    expect(savedMessage({ ...base, type: 'deposit', code: '', hide: true, transactions: [tx('deposit', 10000)] })).toBe(
      '已记录入金 •••• · 本金线已更新',
    );
    expect(savedMessage({ ...base, type: 'buy', hide: true, transactions: [tx('deposit', 2000), tx('buy', 20, 'VOO')] })).toBe(
      '已记录 VOO，现金不足的 •••• 已记为入金',
    );
  });
});
```

- [ ] **Step 2: 运行，确认失败**

运行：`npx vitest run src/pages/records/recordForm.test.ts`
预期：失败，提示找不到 `./recordForm`。

- [ ] **Step 3: 实现 `recordForm.ts`**

```ts
import { CURRENCY_SYMBOL, MASK, formatQty } from '../../app/format';
import { guessCurrency } from '../../domain/instruments';
import type { RecordError } from '../../domain/record';
import type { Account, CashCurrency, Exposure, ExposureGroup, Instrument, Transaction } from '../../domain/types';

// 「记一笔」面板里的提示、报错和保存后的提示。写法同原型第 757–790、1154–1157 行；
// 买入提示按账户里这种币的现金判断（README「记一笔」），卖出超额时写出现有份额。

export type EntryType = 'buy' | 'sell' | 'deposit' | 'withdraw';
export type FormError = RecordError | { kind: 'missing_code' } | { kind: 'missing_exposure' };

const money = (amount: number, currency: CashCurrency, hide: boolean) =>
  hide ? MASK : `${CURRENCY_SYMBOL[currency]}${formatQty(amount)}`;

/** 识别到的品种用它的币种；没识别的按代码猜；还没填代码时用账户币种。 */
export function entryCurrency(code: string, found: Instrument | null, account: Account): CashCurrency {
  if (found) return found.currency;
  return code.trim() ? guessCurrency(code) : account.currency;
}

export function tradeHint(i: { type: 'buy' | 'sell'; account: Account; currency: CashCurrency; cash: number; hide: boolean }): string {
  const sameCurrency = i.currency === i.account.currency;
  if (i.type === 'sell') return sameCurrency ? '卖出所得（扣除手续费）计入账户现金，不影响本金线。' : '卖出所得记为出金。';
  return sameCurrency || i.cash > 0
    ? `从${i.account.name}的 ${i.currency} 现金扣款（当前 ${money(i.cash, i.currency, i.hide)}），不足部分自动记为入金。`
    : '品种币种和账户不同，这笔买入会记为新入金。手续费计入成本。';
}

export function cashHint(i: { type: 'deposit' | 'withdraw'; account: Account; cash: number; hide: boolean }): string {
  return i.type === 'deposit'
    ? '从组合外转入的钱（工资、存款等），会让收益页的本金线上升。'
    : `转出组合的钱，会让本金线下降。当前账户现金 ${money(i.cash, i.account.currency, i.hide)}。`;
}

export function recognizedText(instrument: Instrument, exposure: Exposure, group: ExposureGroup): string {
  return `识别为：${exposure.name} · ${group.name} · ${instrument.market}`;
}

export function formErrorText(error: FormError, hide: boolean): string {
  switch (error.kind) {
    case 'missing_code':
      return '请填写代码';
    case 'invalid_trade':
      return '请填写数量和成交价';
    case 'invalid_fee':
      return '手续费填写有误';
    case 'missing_exposure':
      return '请选择底层资产';
    case 'cash_trade':
      return '现金请用「入金」或「出金」记录';
    case 'insufficient_holding':
      return `该账户只有 ${hide ? MASK : formatQty(error.available)} 份，不够卖出`;
    case 'invalid_amount':
      return '请填写金额';
    case 'insufficient_cash':
      return `账户现金只有 ${money(error.available, error.currency, hide)}，不够转出`;
  }
}

export function savedMessage(i: {
  type: EntryType;
  code: string;
  account: Account;
  currency: CashCurrency;
  cashBefore: number;
  transactions: readonly Transaction[];
  hide: boolean;
}): string {
  const auto = (type: 'deposit' | 'withdraw') => i.transactions.find((t) => t.type === type);
  switch (i.type) {
    case 'deposit':
    case 'withdraw':
      return `已记录${i.type === 'deposit' ? '入金' : '出金'} ${money(i.transactions[0]!.qty, i.currency, i.hide)} · 本金线已更新`;
    case 'buy': {
      const deposit = auto('deposit');
      if (!deposit) return `已记录 ${i.code}，已从账户现金扣款`;
      if (i.currency !== i.account.currency && i.cashBefore <= 0) return `已记录 ${i.code}，记为新入金`;
      return `已记录 ${i.code}，现金不足的 ${money(deposit.qty, i.currency, i.hide)} 已记为入金`;
    }
    case 'sell':
      return auto('withdraw') ? `已记录 ${i.code}，所得记为出金` : `已记录 ${i.code}，所得已计入账户现金`;
  }
}
```

- [ ] **Step 4: 运行，确认通过**

运行：`npx vitest run src/pages/records/recordForm.test.ts`
预期：全部通过。

- [ ] **Step 5: 写面板的测试**

测试渲染 `RecordsPage`，点「记一笔」。示例数据里，富途有美元现金 $8,000、VOO 120 份；默认账户是第一个账户（富途）。

```ts
// AddRecordSheet.test.tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../app/store';
import type { AppState } from '../../app/store';
import { RecordsPage } from './RecordsPage';

let initial: AppState;
beforeEach(() => {
  initial = useAppStore.getState();
});
afterEach(() => {
  cleanup();
  useAppStore.setState(initial, true);
});

const state = () => useAppStore.getState();
const count = () => state().transactions.length;
const sheet = () => screen.getByRole('dialog', { name: '记一笔' });
const reopen = () => fireEvent.click(screen.getByRole('button', { name: '记一笔' }));
const open = () => {
  render(<RecordsPage />);
  reopen();
};
const pick = (type: '买入' | '卖出' | '入金' | '出金') => fireEvent.click(within(sheet()).getByRole('radio', { name: type }));
const fill = (label: string | RegExp, value: string) =>
  fireEvent.change(within(sheet()).getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(within(sheet()).getByRole('button', { name: '保存' }));
const trade = (code: string, qty: string, price: string, fee = '') => {
  fill('代码', code);
  fill('数量', qty);
  fill(/^成交价/, price);
  if (fee) fill('手续费', fee);
};
const firstRow = () => document.querySelector('.rec-row')!.textContent;

describe('记一笔 · 买入', () => {
  it('pays from the account cash', () => {
    open();
    const before = count();
    trade('VOO', '5', '500', '1');
    save();
    expect(count()).toBe(before + 1);
    expect(state().transactions.at(-1)).toMatchObject({
      type: 'buy', accountId: 'futu', instrumentCode: 'VOO', qty: 5, price: 500, fee: 1, date: '2026-09-29',
    });
    expect(state().toast).toBe('已记录 VOO，已从账户现金扣款');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(firstRow()).toBe('VOO Vanguard 标普500买入富途 · 09-295 × $500 · 费 1');
  });

  it('records the shortfall as a deposit', () => {
    open();
    const before = count();
    trade('VOO', '20', '500');
    save();
    expect(state().transactions.slice(before).map((t) => [t.type, t.qty])).toEqual([
      ['deposit', 2000],
      ['buy', 20],
    ]);
    expect(state().toast).toBe('已记录 VOO，现金不足的 $2,000 已记为入金');
  });

  it('records a buy in another currency as new money', () => {
    open();
    fill('代码', '513500');
    expect(within(sheet()).getByLabelText('成交价 CNY')).toBeTruthy();
    expect(within(sheet()).getByText('品种币种和账户不同，这笔买入会记为新入金。手续费计入成本。')).toBeTruthy();
    fill('数量', '100');
    fill('成交价 CNY', '2');
    save();
    expect(state().toast).toBe('已记录 513500，记为新入金');
  });

  it('recognises preset codes', () => {
    open();
    fill('代码', '513100');
    expect(within(sheet()).getByText('识别为：纳斯达克 100 · 美股指数 · A股')).toBeTruthy();
    expect(within(sheet()).queryByLabelText('未识别，选择底层资产')).toBeNull();
  });

  it('asks for the underlying asset of an unknown code and remembers it', () => {
    open();
    const before = count();
    trade('abcd', '1', '10');
    save();
    expect(within(sheet()).getByText('请选择底层资产')).toBeTruthy();
    expect(count()).toBe(before);
    fill('未识别，选择底层资产', 'ndx');
    save();
    expect(state().instruments.filter((i) => i.code === 'ABCD')).toEqual([
      { code: 'ABCD', name: '', market: '美股', currency: 'USD', exposureId: 'ndx', paysDividend: false },
    ]);
    reopen();
    fill('代码', 'ABCD');
    expect(within(sheet()).getByText('识别为：纳斯达克 100 · 美股指数 · 美股')).toBeTruthy();
  });

  it('refuses cash codes', () => {
    open();
    const before = count();
    trade('usd', '1', '1');
    save();
    expect(within(sheet()).getByText('现金请用「入金」或「出金」记录')).toBeTruthy();
    expect(count()).toBe(before);
  });

  it('asks for the missing fields', () => {
    open();
    save();
    expect(within(sheet()).getByText('请填写代码')).toBeTruthy();
    fill('代码', 'VOO');
    save();
    expect(within(sheet()).getByText('请填写数量和成交价')).toBeTruthy();
    trade('VOO', '1', '500', '-1');
    save();
    expect(within(sheet()).getByText('手续费填写有误')).toBeTruthy();
  });
});

describe('记一笔 · 卖出', () => {
  it('refuses to sell more than the account holds', () => {
    open();
    pick('卖出');
    const before = count();
    trade('VOO', '200', '600');
    save();
    expect(within(sheet()).getByText('该账户只有 120 份，不够卖出')).toBeTruthy();
    // 富途没有 QQQ
    trade('QQQ', '1', '400');
    save();
    expect(within(sheet()).getByText('该账户只有 0 份，不够卖出')).toBeTruthy();
    expect(count()).toBe(before);
  });

  it('adds the proceeds to the account cash', () => {
    open();
    pick('卖出');
    expect(within(sheet()).getByText('卖出所得（扣除手续费）计入账户现金，不影响本金线。')).toBeTruthy();
    trade('VOO', '10', '600');
    save();
    expect(state().toast).toBe('已记录 VOO，所得已计入账户现金');
  });
});

describe('记一笔 · 入金 / 出金', () => {
  it('records money in and never takes out more than the cash', () => {
    open();
    pick('入金');
    fill('金额（$）', '10000');
    save();
    expect(state().toast).toBe('已记录入金 $10,000 · 本金线已更新');
    expect(firstRow()).toBe('转入资金入金富途 · 09-29+$10,000');
    reopen();
    pick('出金');
    expect(within(sheet()).getByText('转出组合的钱，会让本金线下降。当前账户现金 $18,000。')).toBeTruthy();
    fill('金额（$）', '20000');
    save();
    expect(within(sheet()).getByText('账户现金只有 $18,000，不够转出')).toBeTruthy();
  });

  it('hides amounts in hints and errors when the eye is closed', () => {
    useAppStore.setState({ hideAmounts: true });
    open();
    pick('出金');
    expect(within(sheet()).getByText('转出组合的钱，会让本金线下降。当前账户现金 ••••。')).toBeTruthy();
    fill('金额（$）', '9000');
    save();
    expect(within(sheet()).getByText('账户现金只有 ••••，不够转出')).toBeTruthy();
  });

  it('cancels without writing anything', () => {
    open();
    const before = count();
    fireEvent.click(within(sheet()).getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(count()).toBe(before);
  });
});
```

- [ ] **Step 6: 运行，确认失败**

运行：`npx vitest run src/pages/records/AddRecordSheet.test.tsx`
预期：失败，点「记一笔」后找不到 `dialog`。

- [ ] **Step 7: 实现 `AddRecordSheet.tsx`，并接到 `RecordsPage`**

面板结构同原型第 446–469 行：用 `Sheet`，标题「记一笔」，gap 用默认的 14，最高 90%。

```tsx
import { useId, useState } from 'react';
import { CURRENCY_SYMBOL } from '../../app/format';
import { recordCtx } from '../../app/ids';
import { Seg } from '../../app/Seg';
import { Sheet } from '../../app/Sheet';
import { useAppStore } from '../../app/store';
import { usePortfolio } from '../../app/usePortfolio';
import { findInstrument, newInstrument, normalizeCode } from '../../domain/instruments';
import { cashBalance } from '../../domain/ledger';
import { recordBuy, recordDeposit, recordSell, recordWithdraw } from '../../domain/record';
import type { RecordResult } from '../../domain/record';
import { cashHint, entryCurrency, formErrorText, recognizedText, savedMessage, tradeHint } from './recordForm';
import type { EntryType, FormError } from './recordForm';

const TYPES = [
  ['buy', '买入'],
  ['sell', '卖出'],
  ['deposit', '入金'],
  ['withdraw', '出金'],
] as const satisfies readonly (readonly [EntryType, string])[];

/** 记一笔：买入 / 卖出 / 入金 / 出金（原型 v5 第 446–469 行；现金联动规则见 README「记一笔」）。 */
export function AddRecordSheet({ onClose }: { onClose: () => void }) {
  const portfolio = usePortfolio();
  const accounts = useAppStore((s) => s.accounts);
  const instruments = useAppStore((s) => s.instruments);
  const exposures = useAppStore((s) => s.exposures);
  const groups = useAppStore((s) => s.groups);
  const fx = useAppStore((s) => s.fx);
  const today = useAppStore((s) => s.today);
  const hide = useAppStore((s) => s.hideAmounts);
  const addInstrument = useAppStore((s) => s.addInstrument);
  const appendTransactions = useAppStore((s) => s.appendTransactions);
  const flash = useAppStore((s) => s.flash);

  const [type, setType] = useState<EntryType>('buy');
  const [accountId, setAccountId] = useState(accounts[0]!.id);
  const [code, setCode] = useState('');
  const [exposureId, setExposureId] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [fee, setFee] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const id = useId();

  const account = accounts.find((a) => a.id === accountId)!;
  const found = findInstrument(code, instruments);
  const exposure = found ? portfolio.exposureById[found.exposureId] : undefined;
  const group = exposure ? groups.find((g) => g.id === exposure.groupId) : undefined;
  const isTrade = type === 'buy' || type === 'sell';
  const currency = isTrade ? entryCurrency(code, found, account) : account.currency;
  const cash = cashBalance(portfolio.ledger, account.id, currency);
  const groupName = (groupId: string) => groups.find((g) => g.id === groupId)?.name ?? groupId;
  // 改任何输入都清掉报错（同原型 setForm）
  const edit = (set: (value: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setError(null);
  };

  const save = () => {
    let result: RecordResult;
    let instrument = found;
    if (type === 'buy' || type === 'sell') {
      const c = normalizeCode(code);
      if (!c) return setError({ kind: 'missing_code' });
      if (!found && !exposureId) return setError({ kind: 'missing_exposure' });
      instrument = found ?? newInstrument(c, exposureId);
      const trade = {
        ledger: portfolio.ledger,
        account,
        instrument,
        date: today,
        qty: Number.parseFloat(qty),
        price: Number.parseFloat(price),
        fee: fee.trim() ? Number.parseFloat(fee) : 0,
        fx,
        ctx: recordCtx,
      };
      result = type === 'buy' ? recordBuy(trade) : recordSell(trade);
    } else {
      const input = { ledger: portfolio.ledger, account, date: today, amount: Number.parseFloat(amount), fx, ctx: recordCtx };
      result = type === 'deposit' ? recordDeposit(input) : recordWithdraw(input);
    }
    if (!result.ok) return setError(result.error);
    if (instrument && !found) addInstrument(instrument);
    appendTransactions(result.transactions);
    flash(savedMessage({ type, code: instrument?.code ?? '', account, currency, cashBefore: cash, transactions: result.transactions, hide }));
    onClose();
  };

  return (
    <Sheet title="记一笔" onClose={onClose}>
      <Seg
        label="类型"
        className="align-start"
        options={TYPES}
        value={type}
        onChange={(t) => {
          setType(t);
          setError(null);
        }}
      />
      <div className="field">
        <label htmlFor={`${id}-account`}>账户</label>
        <select id={`${id}-account`} className="input" value={accountId} onChange={edit(setAccountId)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {type === 'buy' || type === 'sell' ? (
        <>
          <div className="field">
            <label htmlFor={`${id}-code`}>代码</label>
            <input id={`${id}-code`} className="input" placeholder="如 VOO、513500、050025" value={code} onChange={edit(setCode)} />
          </div>
          {found && exposure && group && (
            <span className="tag tag-accent-2 align-start">{recognizedText(found, exposure, group)}</span>
          )}
          {!found && code.trim() && (
            <div className="field">
              <label htmlFor={`${id}-exposure`}>未识别，选择底层资产</label>
              <select id={`${id}-exposure`} className="input" value={exposureId} onChange={edit(setExposureId)}>
                <option value="">请选择</option>
                {exposures.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}（{groupName(x.groupId)}）
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="rec-trade-grid">
            <div className="field">
              <label htmlFor={`${id}-qty`}>数量</label>
              <input id={`${id}-qty`} className="input" type="number" inputMode="decimal" value={qty} onChange={edit(setQty)} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-price`}>成交价 {currency}</label>
              <input id={`${id}-price`} className="input" type="number" inputMode="decimal" value={price} onChange={edit(setPrice)} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-fee`}>手续费</label>
              <input id={`${id}-fee`} className="input" type="number" inputMode="decimal" placeholder="可选" value={fee} onChange={edit(setFee)} />
            </div>
          </div>
          <span className="text-note">{tradeHint({ type, account, currency, cash, hide })}</span>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor={`${id}-amount`}>金额（{CURRENCY_SYMBOL[account.currency]}）</label>
            <input id={`${id}-amount`} className="input" type="number" inputMode="decimal" value={amount} onChange={edit(setAmount)} />
          </div>
          <span className="text-note">{cashHint({ type, account, cash, hide })}</span>
        </>
      )}
      {error && <span className="text-error">{formErrorText(error, hide)}</span>}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={save}>
          保存
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          取消
        </button>
      </div>
    </Sheet>
  );
}
```

在 `RecordsPage` 里：
- 加 `const [adding, setAdding] = useState(false);`；
- 「记一笔」按钮加 `onClick={() => setAdding(true)}`；
- 页面末尾加 `{adding && <AddRecordSheet onClose={() => setAdding(false)} />}`。

`records.css` 加上：

```css
.rec-trade-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
```

把 `plan.css` 里的 `.align-start { align-self: flex-start; }` 挪到 `ui.css` 的共用区。

- [ ] **Step 8: 运行，确认通过**

运行：`npx vitest run src/pages`，然后 `npm run typecheck`
预期：全部通过。

---

### Task 6：核对

- [ ] 跑 `npm test`、`npm run build`，都要通过。
- [ ] 变异检查：把下面每项逐个改坏，都要有测试失败：
  - 期初只在「全部」里出现；
  - 「近 7 天」的边界；
  - 「上个月」跨年；
  - 闭眼隐藏；
  - 未识别代码必须选底层资产；
  - 拒绝现金代码；
  - 卖出不能超过持有份额；
  - 新品种不重复加入；
  - 同一天的排序。
- [ ] 内置浏览器（5199 端口，`--strictPort`）：和截图 08 对照。再把原型的内联样式标记放在组件旁边，逐个量文字块，覆盖：
  - 页头；
  - 时间胶囊和类型分段；
  - 条数与排序那一行；
  - 月份分组和每一行；
  - 空状态；
  - 面板的买入形态（含识别标签、未识别下拉框）；
  - 面板的入金形态；
  - 报错状态。
- [ ] 更新台账 `.superpowers/sdd/2026-09-30-phase-1c-records/progress.md`（取舍、发现的问题、核对结果），列出手动验收步骤。
