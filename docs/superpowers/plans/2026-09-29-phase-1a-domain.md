# 阶段 1a · 计算逻辑 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建好 Vite + React + TypeScript 项目骨架，把原型 v5 的计算逻辑整理成 `src/domain/` 里的纯函数，每个都有 Vitest 单元测试。

**Architecture:** 流水是唯一的事实来源：`deriveLedger` 把流水排序后推导出持仓、现金和本金；估值、槽位、投入、取钱、校准提醒、退休推算都建立在推导结果之上。`src/domain/` 只依赖 ES2022 标准库（用单独的 tsconfig 强制），以后 Worker 直接复用。示例数据放在 `src/mock/`，原型里的持仓转成「期初」流水。

**Tech Stack:** Node 24、Vite 8、React 19、TypeScript 7、Vitest 5。

**Spec:** `design_handoff_investment_manager/README.md`（数据模型、流水类型、增量投入算法、取钱算法、校准提醒规则）；阶段范围见 `design_handoff_investment_manager/BUILD_PLAN.md` 的 1a。

## Global Constraints

- 所有金额和比例的计算都写成纯函数，放在 `src/domain/`，必须有单元测试。UI 组件里不写计算逻辑。
- `src/domain/` 只写纯 TypeScript，不能引用 React 或浏览器 API。
- 金额内部统一换算成人民币计算；原币成本单独保存。
- 流水是唯一的事实来源；现金是代码为 CNY / USD 的持仓。
- 本阶段不接后端、不写页面。
- domain 不生成界面文案：出错时返回结构化错误，由 UI 层翻译成中文。流水的 reason 属于数据，可以是中文。
- 百分比一律用 0–100 的数值（例如 40 表示 40%）。

## Review Focus

1. 空组合（没有流水、总资产为 0）：各函数返回 0% 或 null，不能出现 NaN / Infinity。→ Task 5、7、9
2. 浮点残差：按人民币金额反算份额后全部卖出，持仓应当消失，而不是留下 −0.000001 或触发异常提示。→ Task 2、8
3. 同一天、来自两台设备的流水：排序固定为 日期 → 创建时间 → id，合并顺序打乱结果不变。→ Task 2
4. 校准到相同份额记为「已核对」且不改份额；校准到 0 时持仓消失，不出现除以 0。→ Task 2、3
5. 选定币种 / 账户里没有可买品种：返回空建议和「低配但无品种可买」清单，而不是报错。→ Task 7

## 文件结构

| 文件 | 职责 |
|---|---|
| `package.json`、`vite.config.ts`、`tsconfig.json`、`tsconfig.app.json`、`tsconfig.node.json`、`index.html`、`src/main.tsx`、`src/App.tsx` | 项目骨架，App 只放占位 |
| `tsconfig.domain.json` | 只含 ES2022 标准库，保证 `src/domain/` 不用浏览器 API |
| `src/domain/types.ts` | 共享类型、`isCashCode` |
| `src/domain/dates.ts` | 周期起点、下一个周期起点、天数差 |
| `src/domain/ledger.ts` | 流水排序；推导持仓、现金、本金；异常；本金事件 |
| `src/domain/record.ts` | 记一笔：买入、卖出、入金、出金、校准（含自动补记） |
| `src/domain/valuation.ts` | 按价格和汇率估值 |
| `src/domain/slots.ts` | 槽位归属、占比与偏离、再平衡步骤 |
| `src/domain/holdingsView.ts` | 持仓页「按底层资产」「按账户」的汇总 |
| `src/domain/contribution.ts` | 投入一笔钱（注水）及生成流水 |
| `src/domain/withdrawal.ts` | 取钱及生成流水 |
| `src/domain/retirement.ts` | 退休推算 |
| `src/domain/returns.ts` | 区间收益率 |
| `src/domain/calibration.ts` | 待校准清单 |
| `src/mock/*.ts` | 原型示例数据 |

每个 `src/domain/x.ts` 旁边放 `x.test.ts`。提交等用户确认后按阶段进行。

---

### Task 1：项目骨架 + 类型 + 日期工具

**Files:** 骨架文件（见上表）、`tsconfig.domain.json`、`src/domain/types.ts`、`src/domain/dates.ts`、`src/domain/dates.test.ts`

**Produces:**
```ts
// types.ts
export type CashCurrency = 'CNY' | 'USD';
export type Currency = CashCurrency | 'HKD';
export type Market = '美股' | 'A股' | '场外基金' | '现金';
export type AccountType = 'broker' | 'bank';
export type Period = 'month' | 'quarter' | 'year';
export type UndefinedMode = 'sell' | 'ignore';
export type TxType = 'opening' | 'buy' | 'sell' | 'deposit' | 'withdraw' | 'calibrate';
export interface Account { id: string; name: string; type: AccountType; currency: CashCurrency; market: Market }
export interface ExposureGroup { id: string; name: string }
export interface Exposure { id: string; name: string; groupId: string; isStock: boolean }
export interface Instrument { code: string; name: string; market: Market; currency: CashCurrency; exposureId: string; paysDividend: boolean }
export interface Transaction { id: string; date: string; createdAt: string; type: TxType; accountId: string; instrumentCode: string; qty: number; price: number; fee: number; reason?: string; fxToCny: number }
export type FxRates = Record<Currency, number>;      // 1 单位外币值多少人民币
export type Prices = Record<string, number>;          // 品种原币价格
export type Targets = Record<string, number>;         // 槽位 → 目标 %
export type OwnStock = Record<string, boolean>;       // 个股是否单独设目标
export interface Plan { threshold: number; rebalancePeriod: Period; calibPeriod: Period; undefinedMode: UndefinedMode; annualSpend: number; targetAmount: number; expectedReturnPct: number; inflationPct: number }
export interface AllocationLine { slotKey: string; code: string; accountId: string; amountCny: number; amount: number; isCash: boolean; isNewInstrument: boolean; beforePct: number; afterPct: number }
export function isCashCode(code: string): code is CashCurrency;
// dates.ts（日期都是 'YYYY-MM-DD'）
export function periodStart(date: string, period: Period): string;
export function nextPeriodStart(date: string, period: Period): string;
export function daysBetween(from: string, to: string): number;
```

- [ ] 写测试：`periodStart('2026-09-29','quarter') === '2026-07-01'`，`'month'` → `'2026-09-01'`，`'year'` → `'2026-01-01'`；`nextPeriodStart('2026-09-29','quarter') === '2026-10-01'`，`('2026-12-15','quarter')` → `'2027-01-01'`，`('2026-12-15','month')` → `'2027-01-01'`；`daysBetween('2026-09-29','2026-10-01') === 2`，跨年 `('2026-12-31','2027-01-01') === 1`
- [ ] 运行，确认失败；实现；运行，确认通过
- [ ] `npm run typecheck` 通过（含 `tsconfig.domain.json`）

### Task 2：由流水推导持仓、现金、本金

**Files:** `src/domain/ledger.ts`、`src/domain/ledger.test.ts`

**Produces:**
```ts
export interface Holding { accountId: string; code: string; qty: number; cost: number } // cost 为原币总成本
export type Anomaly =
  | { kind: 'negative_qty'; accountId: string; code: string; qty: number }
  | { kind: 'unknown_instrument'; txId: string; code: string };
export interface Ledger { holdings: Holding[]; netInvestedCny: number; calibrationDiffs: Record<string, number>; anomalies: Anomaly[] }
export type CurrencyOf = (code: string) => CashCurrency | undefined;
export function currencyLookup(instruments: Record<string, Instrument>): CurrencyOf;
export function sortTransactions(txns: readonly Transaction[]): Transaction[];      // 日期 → createdAt → id
export function deriveLedger(txns: readonly Transaction[], currencyOf: CurrencyOf): Ledger;
export function holdingQty(ledger: Ledger, accountId: string, code: string): number;
export function cashBalance(ledger: Ledger, accountId: string, currency: CashCurrency): number;
export interface PrincipalEvent { txId: string; date: string; accountId: string; kind: 'deposit' | 'withdraw'; amountCny: number }
export function principalEvents(txns: readonly Transaction[]): PrincipalEvent[];  // 出金为负数
export function netInvestedOn(txns: readonly Transaction[], date: string): number; // 截至该日（含）的本金
```

规则按 README「流水类型」表。份额绝对值 ≤ 1e-9 的持仓不输出；证券份额 < −1e-6、现金 < −0.005 记为 `negative_qty`。

- [ ] 写测试：
  - 期初 VOO 10 股 @100（fx 7）+ 期初 USD 现金 2000 → 本金 = (1000 + 2000) × 7 = 21000
  - 买入 5 @110 手续费 1 → 份额 15、成本 1551、USD 现金 1449、本金不变
  - 卖出 5 @120 手续费 2 → 份额 10、成本 1034（按平均成本同比例减少）、现金 2047
  - 入金 500（fx 7.1）→ 本金 + 3550；出金 300（fx 7.1）→ 本金 − 2130
  - 校准到 10.5（原 10）→ 份额 10.5、成本不变，`calibrationDiffs[id] === 0.5`；校准到 0 → 持仓消失
  - 同一天两笔流水按 createdAt 排序，createdAt 相同按 id 排序
  - 两台设备的流水打乱顺序后合并，推导结果与按时间顺序一致（校准存实际份额，所以合并后仍等于券商的数）
  - 卖出超过持有 → `negative_qty` 异常；引用未知品种的买入 → `unknown_instrument` 异常，不抛错
  - `principalEvents` 只含入金 / 出金；`netInvestedOn` 含期初
- [ ] 运行失败 → 实现 → 运行通过

### Task 3：记一笔（含自动补记）

**Files:** `src/domain/record.ts`、`src/domain/record.test.ts`

**Consumes:** `Ledger`、`holdingQty`、`cashBalance`

**Produces:**
```ts
export interface RecordCtx { newId: () => string; now: () => string } // now 返回 ISO 时间
export type RecordError =
  | { kind: 'invalid_amount' }
  | { kind: 'invalid_trade' }
  | { kind: 'insufficient_cash'; available: number; currency: CashCurrency }
  | { kind: 'insufficient_holding'; available: number };
export type RecordResult = { ok: true; transactions: Transaction[] } | { ok: false; error: RecordError };
export const AUTO_DEPOSIT_REASON = '买入时现金不足自动补记';
export const AUTO_WITHDRAW_REASON = '跨币种卖出自动补记';
export type CalibrationReason = '红利再投' | '拆股合股' | '手动修正';
export type TxDraft = Omit<Transaction, 'id' | 'createdAt'>;
export function stamp(drafts: readonly TxDraft[], ctx: RecordCtx): Transaction[]; // 同一批 createdAt 依次 +1ms
export function recordBuy(i: { ledger: Ledger; account: Account; instrument: Instrument; date: string; qty: number; price: number; fee?: number; fx: FxRates; ctx: RecordCtx }): RecordResult;
export function recordSell(i: 同上): RecordResult;
export function recordDeposit(i: { account: Account; date: string; amount: number; fx: FxRates; ctx: RecordCtx; reason?: string }): RecordResult;
export function recordWithdraw(i: { ledger: Ledger; account: Account; date: string; amount: number; fx: FxRates; ctx: RecordCtx; reason?: string }): RecordResult;
export function recordCalibration(i: { ledger: Ledger; accountId: string; instrument: Instrument; date: string; actualQty: number; reason: CalibrationReason; fx: FxRates; ctx: RecordCtx }): RecordResult;
```

- [ ] 写测试：
  - 现金够：只生成一笔 buy
  - 现金不够：先补一笔入金（金额 = 差额，reason 为自动补记），再 buy；推导后现金为 0，本金增加差额 × 汇率
  - 人民币账户买美元品种：整笔补记美元入金
  - 同币种卖出：只有 sell；跨币种卖出：sell + 同额出金，推导后该币种现金为 0
  - 卖出超过持有 → `insufficient_holding`（带可卖份额）；出金超过现金 → `insufficient_cash`（带余额）
  - 金额、数量、价格不是正数 → `invalid_amount` / `invalid_trade`；手续费大于成交额的卖出 → `invalid_trade`
  - 校准份额没变 → reason 为「已核对」；变了 → 用传入的 reason，qty 是实际份额
- [ ] 运行失败 → 实现 → 运行通过

### Task 4：示例数据 + 估值

**Files:** `src/mock/catalog.ts`、`src/mock/ledger.ts`、`src/mock/market.ts`、`src/mock/settings.ts`、`src/mock/index.ts`、`src/mock/mock.test.ts`、`src/domain/valuation.ts`、`src/domain/valuation.test.ts`

**Produces:**
```ts
export interface ValuedHolding extends Holding { instrument: Instrument; exposure: Exposure; price: number; priceMissing: boolean; valueCny: number; costCny: number }
export function valueHoldings(i: { holdings: readonly Holding[]; instruments: Record<string, Instrument>; exposures: Record<string, Exposure>; prices: Prices; fx: FxRates }): ValuedHolding[];
export function totalValue(rows: readonly ValuedHolding[]): number;
```
示例数据：原型的 6 个账户、11 个底层资产、24 个品种、价格和汇率（USD 7.1、HKD 0.91）、目标组合和计划参数。原型的持仓倒推为 2025-01-02 的期初流水，再加上原型的 12 笔流水和必要的入金 / 出金，使推导结果等于原型的持仓（例如富途 VOO 120 股、招商银行人民币现金 150,000）。

- [ ] 写测试：示例流水推导后，各持仓份额等于原型、没有异常；估值 = 份额 × 价格 × 汇率；成本按当前汇率折算；现金价格为 1；缺价格时用平均成本并标 `priceMissing`
- [ ] 运行失败 → 实现 → 运行通过

### Task 5：槽位、偏离、再平衡

**Files:** `src/domain/slots.ts`、`src/domain/slots.test.ts`

**Produces:**
```ts
export const STOCK_BUCKET = 'stocks';
export function slotKeyOf(exposure: Exposure, ownStock: OwnStock): string;
export interface Slot { key: string; valueCny: number; costCny: number; curPct: number; tgtPct: number; diffPct: number; off: boolean; untargeted: boolean }
export function computeSlots(i: { rows: readonly ValuedHolding[]; targets: Targets; ownStock: OwnStock; threshold: number; undefinedMode: UndefinedMode; order?: readonly string[] }): { totalCny: number; slots: Slot[] };
export interface RebalanceStep { slotKey: string; action: 'buy' | 'sell'; amountCny: number; untargeted: boolean }
export function rebalanceSteps(slots: readonly Slot[], totalCny: number): RebalanceStep[]; // 先卖后买，忽略小于总资产 0.3% 的调整
```
- [ ] 写测试：个股归入 `stocks`，单独设目标后成为自己的槽位；未设目标的持仓在 `sell` 模式下目标 0% 且标偏离，在 `ignore` 模式下目标 = 当前、不标偏离；超过阈值才标偏离；空组合各占比为 0；示例数据各槽位占比合计 100%；再平衡步骤先卖后买
- [ ] 运行失败 → 实现 → 运行通过

### Task 6：持仓页汇总

**Files:** `src/domain/holdingsView.ts`、`src/domain/holdingsView.test.ts`

**Produces:**
```ts
export interface PlatformLine { accountId: string; qty: number; avgCost: number; valueCny: number }
export interface InstrumentLine { code: string; valueCny: number; accountCount: number; platforms: PlatformLine[] }
export interface ExposureLine { exposureId: string; valueCny: number; costCny: number; pnlPct: number | null; pct: number; instrumentCount: number; accountCount: number; instruments: InstrumentLine[] }
export interface GroupLine { groupId: string; valueCny: number; pct: number; exposures: ExposureLine[] }
export function groupByExposure(i: { rows: readonly ValuedHolding[]; groups: readonly ExposureGroup[]; exposures: readonly Exposure[] }): GroupLine[];
export interface AccountLine { accountId: string; valueCny: number; sharePct: number; itemCount: number; composition: { groupId: string; valueCny: number }[]; items: ValuedHolding[] }
export function groupByAccount(i: { rows: readonly ValuedHolding[]; accounts: readonly Account[]; groups: readonly ExposureGroup[] }): AccountLine[];
```
- [ ] 写测试：示例数据里「标普 500」下有 VOO、513500、050025 三个品种、5 个账户；现金的浮动盈亏为 null；空分组不输出；按账户汇总的占比合计 100%
- [ ] 运行失败 → 实现 → 运行通过

### Task 7：投入一笔钱（注水）

**Files:** `src/domain/contribution.ts`、`src/domain/contribution.test.ts`

**Produces:**
```ts
export interface ContributionPlan { lines: AllocationLine[]; maxDeviationBefore: number; maxDeviationAfter: number; missingSlots: string[] }
export function planContribution(i: { amount: number; currency: CashCurrency; mode: 'account' | 'any'; account?: Account; slots: readonly Slot[]; totalCny: number; rows: readonly ValuedHolding[]; candidates: readonly Instrument[]; exposures: Record<string, Exposure>; ownStock: OwnStock; accounts: readonly Account[]; fx: FxRates }): ContributionPlan;
export function contributionTransactions(i: { lines: readonly AllocationLine[]; currency: CashCurrency; date: string; prices: Prices; fx: FxRates; ctx: RecordCtx }): Transaction[];
```
水位用精确解：按 当前市值 ÷ 目标比例 从低到高逐个加入，直到解出的水位不超过下一个槽位的起点。小于投入额 0.2% 的建议并入最大的一笔，保证合计等于投入额。

- [ ] 写测试：
  - README 修订记录第 11 条的例子：三个槽位 39 / 1 / 60（目标 40 / 10 / 50），投入 10 → 分别得到 1、9、0；合计 10；没有槽位超过目标
  - 钱够补齐所有槽位时，每个槽位都达到目标，多出的按目标比例分配
  - 只推荐同币种品种：人民币投入时只有美元品种的低配槽位进入 `missingSlots`
  - 「只在一个账户买」只推荐这个账户市场里的品种（或留作现金）；没有可买品种时返回空建议，不报错
  - 每个槽位推荐已持有最多的品种；没持有过时用候选列表里的第一个，并标 `isNewInstrument`
  - 所有金额 ≥ 0，合计等于投入额
  - 生成流水：每个账户一笔入金，再逐笔买入；推导后本金增加 = 投入额 × 汇率，现金不变
- [ ] 运行失败 → 实现 → 运行通过

### Task 8：取钱

**Files:** `src/domain/withdrawal.ts`、`src/domain/withdrawal.test.ts`

**Produces:**
```ts
export type WithdrawalPlan = { ok: true; lines: AllocationLine[] } | { ok: false; error: { kind: 'insufficient_holdings'; availableCny: number } };
export function planWithdrawal(i: { amount: number; currency: CashCurrency; slots: readonly Slot[]; totalCny: number; rows: readonly ValuedHolding[]; ownStock: OwnStock; fx: FxRates }): WithdrawalPlan;
export function withdrawalTransactions(i: { lines: readonly AllocationLine[]; currency: CashCurrency; date: string; prices: Prices; fx: FxRates; ctx: RecordCtx }): Transaction[];
```
- [ ] 写测试：超配部分够时只卖超配的槽位；不够时先卖完超配部分，余下按剩余持仓比例分摊；只卖同币种持仓；同一槽位先卖市值大的持仓；合计等于取出额；超过同币种持仓合计时返回错误；生成流水：逐笔卖出 + 每个账户一笔出金，推导后本金减少 = 取出额 × 汇率，卖光的持仓消失、没有异常
- [ ] 运行失败 → 实现 → 运行通过

### Task 9：退休推算、区间收益率

**Files:** `src/domain/retirement.ts`、`src/domain/retirement.test.ts`、`src/domain/returns.ts`、`src/domain/returns.test.ts`

**Produces:**
```ts
export interface RetirementProjection { realReturn: number; need4: number; yearsToTarget: number | null; yearsTo4: number | null; yearTarget: number | null; year4: number | null; pctOfTarget: number; pctOf4: number }
export function projectRetirement(i: { totalCny: number; annualSpend: number; targetAmount: number; expectedReturnPct: number; inflationPct: number; currentYear: number }): RetirementProjection;
export function rangeReturn(i: { startValue: number; endValue: number; netInflow: number }): { gain: number; pct: number | null };
```
- [ ] 写测试：原型截图的数字：总资产 3,105,000、年支出 300,000、目标 8,000,000、回报 7%、通胀 2.5%、2026 年 → 设定目标 2049 年、4% 法则 750 万 2047 年；已达标 → 0 年；实际回报 ≤ 0 或总资产为 0 → null；区间收益率公式（含净投入为正时分母加一半、为负时不加）；分母 ≤ 0 → pct 为 null
- [ ] 运行失败 → 实现 → 运行通过

### Task 10：待校准清单

**Files:** `src/domain/calibration.ts`、`src/domain/calibration.test.ts`

**Produces:**
```ts
export interface CalibrationDueItem { accountId: string; code: string; qty: number; valueCny: number; lastCalibratedOn: string | null; big: boolean; paysDividend: boolean }
export function calibrationDue(i: { rows: readonly ValuedHolding[]; totalCny: number; transactions: readonly Transaction[]; today: string; period: Period; bigPct?: number }): CalibrationDueItem[];
```
「本周期」按自然月 / 季度 / 年计算，和计划页「还有 N 天」的倒计时一致。

- [ ] 写测试：占比 ≥ 3% 或会分红再投的持仓，本周期内没有校准记录就进清单；本周期内校准过（包括「已核对」）就不进；现金不进；按市值从大到小排序
- [ ] 运行失败 → 实现 → 运行通过

### Task 11：收尾验证

- [ ] `npm test`、`npm run typecheck` 全部通过
- [ ] 检查 `src/domain/` 没有引用 React、DOM 或 Node API
- [ ] 按 BUILD_PLAN 1a 的验收清单逐条核对，列出需要用户手动验收的步骤
