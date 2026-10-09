# 阶段 1c-2 ·「计划」页 实施计划（主页面 + 底部面板）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按原型 v5 实现「计划」页：退休目标卡片、组合配置、资金进出（投入一笔钱 / 取钱面板）、再平衡（调整步骤面板）、持仓校准（待校准清单 + 校准面板）。「设置组合」二级页面下一轮做，这一轮只放能返回的空壳。

**Architecture:** 新增通用的底部面板（`Sheet`，挂在手机框里的浮层上）、提示条（toast）、二级页面外壳。面板里的计算全部调用 1a 写好的 domain 函数；「按此记录」生成流水后追加到状态层，页面随之更新。校准面板放在 `src/app/`，持仓页以后复用。

**Tech Stack:** React 19、Zustand、Vitest + Testing Library。

**Spec:** README「2. 计划」「增量投入算法」「取钱算法」「校准面板」「校准提醒规则」；原型 v5 第 99–142 行（主页面）、381–444 行（投入 / 取钱 / 再平衡面板）、504–520 行（校准面板）、536–548 行（待校准清单）。

## Global Constraints

- 计算写在 `src/domain/`；组件只负责展示和收集输入。
- 颜色、字体、圆角只用 `tokens.css` 的变量（面板遮罩用 `color-mix` 取正文色 28%）。
- 面板样式：顶部圆角 28px、内边距 22px 20px 28px、最高 90%、标题 Caprasimo 22px。
- 闭眼时金额显示 `••••`。
- 退休推算、偏离阈值、周期倒计时都以 `today`（示例数据是 2026-09-29）为准。

## Review Focus

1. 投入金额为空、0 或负数：不出建议，「按此记录买入」不写任何流水。→ Task 3
2. 取钱超过同币种持仓：显示「…持仓合计只有 …，不够取出」，不写流水。→ Task 3
3. 「只在一个账户买」但这个账户里没有可买的品种：列出低配但买不了的资产，并提示切到「可跨账户」。→ Task 3
4. 校准份额输入不是数字或为负：报错，不写流水；份额没变保存为「已核对」。→ Task 4
5. 连续记录后页面要跟着变（持仓、配置占比、待校准数量）。→ Task 3、4

---

### Task 1：通用组件与状态

**Files:** `src/app/Sheet.tsx`、`src/app/SubPage.tsx`、`src/app/Toast.tsx`、`src/app/ui.css`、`src/app/ids.ts`、`src/app/store.ts`（加 `appendTransactions`、`toast`、`flash`）、`src/app/AppShell.tsx`（浮层容器）

- 测试：`appendTransactions` 追加后推导结果随之变化；`flash` 显示提示，2.4 秒后消失

### Task 2：主页面

**Files:** `src/pages/plan/PlanPage.tsx`、`src/pages/plan/plan.css`、`src/pages/plan/PlanPage.test.tsx`、`src/App.tsx`

- 测试：显示「2049 年」、4% 法则「2047」；「N 项偏离」标签；「全球除美」带「未定义」标签；再平衡卡片「季度检查 · 还有 2 天」；持仓校准卡片列出待核对数量

### Task 3：投入一笔钱 / 取钱 / 再平衡

**Files:** `src/pages/plan/ContributionSheet.tsx`、`WithdrawalSheet.tsx`、`RebalanceSheet.tsx`（+ 测试加在 `PlanPage.test.tsx`）

- 测试：默认 ¥100,000、只在招商证券买 → 出建议和「投入后最大偏离 x% → y%」；按此记录后流水增加、提示「已记录 N 笔买入」；金额为 0 时不写流水；取 $20,000 出建议，取超过持仓时报错；调整步骤先卖后买

### Task 4：持仓校准

**Files:** `src/pages/plan/CalibrationListSheet.tsx`、`src/app/CalibrationSheet.tsx`（+ 测试）

- 测试：清单列出待核对项；点进去输入新份额保存 → 流水增加、清单少一项；份额不变保存 → 记为「已核对」；输入负数报错；「全部标记已核对」后清单为空

### Task 5：核对

- `npm test`、`npm run build` 通过；内置浏览器与 `screenshots/03-plan.png`、`04-deploy-cash.png`、`05-calibration-list.png` 对照
