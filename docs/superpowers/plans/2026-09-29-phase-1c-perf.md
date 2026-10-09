# 阶段 1c-1 ·「收益」页 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按原型 v5 实现「收益」页：区间选择、人民币 / 美元、隐藏金额、刷新状态和下拉刷新、读数区、可横向滑动和触摸查看的图表、区间收益率与净投入、区间资金进出、各资产表现。数据用示例数据。

**Architecture:** 新增一个全局状态层（Zustand），先装示例数据，阶段 2 换成本地数据库。收益曲线的数据结构按 README 的 `snapshots` / `snapshot_items` 设计：示例数据用示例流水加模拟价格逐日推出来，保证和持仓、本金前后一致；阶段 4 换成真实快照时页面不用改。收益计算放在 `src/domain/performance.ts`，图表坐标放在 `src/pages/perf/chart.ts`，都有单元测试。

**Tech Stack:** React 19、Zustand、Vitest + Testing Library。

**Spec:** `design_handoff_investment_manager/README.md`「1. 收益」「美元视图」「流水类型」；原型 v5 第 20–97 行和 `perf` 相关逻辑；截图 `screenshots/02-returns.png`。

## Global Constraints

- 金额和比例的计算写在 `src/domain/`（纯函数、有测试），组件里不写计算。
- 颜色、字体、圆角只用 `tokens.css` 的变量。
- 区间收益率 = (期末 − 期初 − 区间净投入) ÷ (期初 + max(0, 区间净投入) / 2)。
- 美元视图：每天的总资产按当天 usd_cny 换算；本金按每笔入金 / 出金当天的汇率换算。
- 图表高 150px；总资产实线 `--color-accent` 2.5px、下方填充 `--color-accent-100`；本金为阶梯虚线 `--color-neutral-500`；入金点 `--color-accent-2`、出金点 `--color-accent`；区间 ≤ 1 年宽度等于容器（390 宽手机上是 350px），3 年 760、5 年 1120、全部 1360，可横向滑动，默认滚到最右端。
- 闭眼后所有金额显示为 `••••`，只保留百分比。

## Review Focus

1. 区间比已有历史还长（例如选「5年」但只有 1.7 年数据）：从第一天开始画，不报错。→ Task 2、4
2. 新用户只有今天一个点：显示「收益曲线从今天开始积累」的空状态。→ Task 5
3. 区间内没有资金进出：区间净投入显示 ¥0，不显示「区间资金进出」。→ Task 5
4. 所有值相同（曲线是平的）：纵轴不除以 0。→ Task 4
5. 美元视图下本金线仍是阶梯形，不随汇率每天抖动。→ Task 2

---

### Task 1：格式化与状态层

**Files:** `src/app/format.ts`(+test)、`src/app/store.ts`、`src/app/usePortfolio.ts`、`src/app/palette.ts`

- 金额：人民币 ≥ 1 万显示「¥310.5万」，否则整数；美元 ≥ 100 万「$4.37M」、≥ 1000「$43.7K」；港币同人民币的写法、符号 HK$；隐藏时「••••」
- 带符号：正数「+」，负数「−」（U+2212）；百分比两位小数
- 状态层：示例数据、显示币种、隐藏金额、行情刷新（示例：1.2 秒后价格 ±0.6%、美元汇率 ±0.2%）

### Task 2：收益计算（domain）

**Files:** `src/domain/performance.ts`(+test)、`src/domain/types.ts`（加 `Snapshot`、`SnapshotItem`）

```ts
export type RangeKey = '1周' | '1个月' | '3个月' | '1年' | '3年' | '5年' | '全部';
export function rangeStart(today: string, range: RangeKey, firstDate: string): string;
export interface SeriesPoint { date: string; value: number; principal: number }
export function buildSeries(i: { snapshots: readonly Snapshot[]; transactions: readonly Transaction[]; currency: 'CNY' | 'USD' }): SeriesPoint[];
export interface FlowEvent { date: string; kind: 'deposit' | 'withdraw'; amount: number }
export function flowEvents(i: { transactions: readonly Transaction[]; snapshots: readonly Snapshot[]; currency: 'CNY' | 'USD' }): FlowEvent[];
export function rangeSummary(i: { series: readonly SeriesPoint[]; events: readonly FlowEvent[]; start: string }): { startValue: number; endValue: number; netInflow: number; gain: number; pct: number | null; flows: FlowEvent[] };
export interface ExposurePerformance { exposureId: string; startValue: number; endValue: number; netFlow: number; gain: number; pct: number | null }
export function exposurePerformance(i: { items: readonly SnapshotItem[]; transactions: readonly Transaction[]; instruments: Record<string, Instrument>; start: string; end: string }): ExposurePerformance[];
```

### Task 3：示例历史

**Files:** `src/mock/history.ts`(+test)

- 按示例流水逐日推持仓，价格按每个底层资产的模拟指数（原型 SLOTPARAM）回推，汇率小幅波动；最后一天等于当前估值
- 测试：每天的本金等于流水推导的本金；最后一天总资产等于当前估值；各资产之和等于总资产

### Task 4：图表坐标

**Files:** `src/pages/perf/chart.ts`(+test)

- 抽样（最多 420 点）、纵轴范围留 8% 边距（平线时不除以 0）、总资产折线、阶梯本金线、面积、刻度（数量 = max(3, round(宽 / 110))，长区间显示「YYYY-MM」）、根据手指位置求对应的点

### Task 5：页面

**Files:** `src/pages/perf/PerfPage.tsx`、`src/pages/perf/perf.css`、`src/app/icons.tsx`、`src/app/usePullToRefresh.ts`、`src/pages/perf/PerfPage.test.tsx`、`src/App.tsx`

- 测试：显示当前总资产；闭眼后金额变成「••••」、百分比仍在；切换区间后「1年收益」变为「3个月收益」；只有一个快照时显示空状态
- 冷启动自动刷新；下拉超过 60px 松开刷新；刷新状态行文案同原型

### Task 6：核对

- `npm test`、`npm run build` 通过
- 内置浏览器 390 × 844 与 `screenshots/02-returns.png` 对照，列出差异
