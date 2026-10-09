# 阶段 1c-4 ·「持仓」页 实施计划（含前几页的细节修正）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先修正前几页与原型的细节差异；再按原型 v5 实现「持仓」页：按底层资产三层展开（分组 → 底层资产 → 品种 → 平台）、按账户（占比条、账户卡片、账户详情面板）、点任意持仓校准、「设置账户」二级页（账户列表、添加账户、导出 JSON / CSV）。

**Architecture:** 汇总数据用 1a 的 `groupByExposure` / `groupByAccount`；导出文件的内容写成纯函数（`src/app/backup.ts`，有测试），触发下载放在单独的浏览器工具函数里；校准复用 1c-2 的 `CalibrationSheet`。

**Spec:** 原型 v5 第 143–206 行（页面）、368–380 行（设置账户）、472–503 行（账户详情、添加账户）；逻辑第 934–962、1138–1145、1204–1205 行；截图 `06-holdings-exposure.png`、`07-holdings-accounts.png`；README「3. 持仓」、修订记录第 2 条（账户币种只有 USD / CNY）。

## Global Constraints

- 尺寸、字号、颜色逐项对照原型的内联样式；原型截图里的文字折行（如「¥100.0万」断成两行）是原型的 bug，不照抄。
- 闭眼时金额和份额显示 `••••`；平均成本是单价，原型不隐藏，照原型。
- 颜色只用 `tokens.css` 变量。

## Review Focus

1. 账户里没有任何持仓：卡片显示 ¥0、0 个品种；详情面板显示「暂无持仓，去「记录」记一笔」，环形图为空色。→ Task 3、4
2. 账户名称为空、与已有账户重名：报错，不添加。→ Task 5
3. CSV 里的账户名或备注含逗号、引号、换行：按 CSV 规则加引号转义，Excel 打开不串列。→ Task 1
4. 从账户详情点进校准，保存或取消后回到账户详情；从资产视图点进校准，关闭后回到页面。→ Task 3、4
5. 场外基金显示净值日期；没有净值日期时不显示这一段。→ Task 3

---

### Task 0：前几页的细节修正

**Files:** `src/app/ui.css`、`src/app/Sheet.tsx`、`src/pages/perf/perf.css`、`src/pages/plan/*`

- 列表框最后一行保留下边框（原型如此）
- 投入面板「低配但买不了」提示改为 12px
- 调整步骤面板的副标题与标题分开（间距 14px）
- 待校准清单空状态 13px、上下 14px
- 设置组合：「+ 添加目标资产」只在编辑态出现；编辑列表和未定义列表左右内边距 14px；空状态、合计提示、「所有持仓都在目标组合里。」、「预设资产都已在目标组合里」改为 13px；添加目标资产面板最高 88%
- 验证：现有测试更新后全部通过；浏览器里量一遍

### Task 1：导出内容（纯函数）

**Files:** `src/app/backup.ts`、`src/app/backup.test.ts`、`src/app/download.ts`

```ts
export function backupJson(data: { exportedAt: string; accounts; exposures; instruments; transactions; targets; ownStock; plan }): string;
export function transactionsCsv(transactions: readonly Transaction[], accountName: (id: string) => string): string; // 首行表头，UTF-8 BOM 由下载时加
export function csvCell(value: string | number): string;
```
- 测试：表头「日期,类型,账户,代码,数量,价格,手续费,备注」；类型为中文；含逗号 / 引号 / 换行的字段加引号、引号加倍；JSON 可以原样读回

### Task 2：状态层

**Files:** `src/app/store.ts`、`src/app/store.test.ts`、`src/domain/types.ts`（`Account` 加可选 `color`）、`src/mock/market.ts`（场外基金净值日期）

- `addAccount(account)`；`navDates`（品种 → 净值日期，示例里 050025 为 2026-09-28）

### Task 3：按底层资产

**Files:** `src/pages/holdings/HoldingsPage.tsx`、`AssetView.tsx`、`holdings.css`、`HoldingsPage.test.tsx`

- 测试：默认展开「标普 500」，列出 VOO、513500、050025；050025 显示「净值 09-28」；点品种展开各平台（份额 @ 平均成本、市值）；点平台打开校准面板；闭眼后份额和金额变 `••••`；现金没有盈亏百分比

### Task 4：按账户与账户详情

**Files:** `AccountView.tsx`、`AccountSheet.tsx`（+ 测试）

- 测试：「资产分布在 6 个账户」；每张卡片名称、「券商 · USD · N 个品种」、市值、占比；点卡片打开详情（标题、占总资产、环形图、分组图例、品种列表「校准 ›」）；从详情校准后回到详情

### Task 5：设置账户

**Files:** `AccountsSettings.tsx`、`AddAccountSheet.tsx`（+ 测试）

- 测试：列出 6 个账户；添加账户（空名、重名报错；币种只有 USD / CNY）；新账户出现在列表和按账户视图；导出按钮调用下载，文件名带日期

### Task 6：核对

- `npm test`、`npm run build`；内置浏览器与截图 06、07 对照，并用计算样式逐项量尺寸和颜色
