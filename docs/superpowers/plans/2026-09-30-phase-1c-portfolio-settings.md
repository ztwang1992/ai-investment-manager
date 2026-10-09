# 阶段 1c-3 ·「设置组合」二级页 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按原型 v5 实现「设置组合」：显示币种、目标组合（查看态 / 编辑态、个股拆出与并回、添加预设或自定义资产、合计必须 100% 才能保存）、「未定义」资产、再平衡规则、长期目标。

**Architecture:** 目标组合草稿的校验和增删改写成 `src/domain/targets.ts` 的纯函数；状态层加上设置类的修改方法（阶段 2 按「最后修改为准」同步）；页面放在 1c-2 做好的二级页面外壳里。

**Spec:** 原型 v5 第 303–367 行（页面）、522–535 行（添加目标资产面板）、第 1049–1062、1232–1257 行（草稿逻辑）；BUILD_PLAN 阶段 3 第 6 条。README「设置组合」一节写的是更早的 ± 步进写法，以 v5 和 BUILD_PLAN 为准。

## Global Constraints

- 目标合计必须等于 100% 才能保存；每项必须是 0–100 的数字。
- 持有中的资产从目标里移除后变成「未定义」。
- 计算写在 `src/domain/`；颜色等只用 `tokens.css` 变量。

## Review Focus

1. 编辑时清空一个输入框或输入非数字：提示「每项需要填 0–100 之间的数字」，不能保存。→ Task 1、3
2. 小数误差：40.1 + 59.9 必须算作 100，不能因为浮点误差不让保存。→ Task 1
3. 所有目标都删光：提示「还差 100% 未分配」，不能保存。→ Task 1、3
4. 自定义资产重名或名字为空：报错，不添加。→ Task 3
5. 长期目标输入框清空：按 0 处理，退休推算显示「—」而不是报错。→ Task 3

---

### Task 1：目标草稿（domain）

**Files:** `src/domain/targets.ts`、`src/domain/targets.test.ts`

```ts
export interface TargetDraft { targets: Record<string, string>; ownStock: OwnStock }
export type DraftProblem = { kind: 'invalid' } | { kind: 'over'; by: number } | { kind: 'under'; by: number };
export function toDraft(targets: Targets, ownStock: OwnStock): TargetDraft;
export function checkDraft(draft: TargetDraft): { sum: number; badKeys: string[]; problem: DraftProblem | null };
export function parseDraft(draft: TargetDraft): Targets;              // 保留一位小数
export function addTarget(draft: TargetDraft, key: string, isStock: boolean): TargetDraft;   // 初始 0；个股视为单独设
export function removeTarget(draft: TargetDraft, key: string, isStock: boolean): TargetDraft;
export function mergeStock(draft: TargetDraft, key: string): TargetDraft;                     // 比例并回「个股合计」
export function addableTargets(keys: readonly string[], exposures: readonly Exposure[]): string[]; // 先「个股合计」，再按目录顺序
```

### Task 2：状态层的设置方法

**Files:** `src/app/store.ts`、`src/app/store.test.ts`

- `saveTargets(targets, ownStock)`、`updatePlan(patch)`、`addExposure(exposure)`

### Task 3：页面

**Files:** `src/pages/plan/PortfolioSettings.tsx`、`AddTargetSheet.tsx`、`settings.css`、`PortfolioSettings.test.tsx`；`PlanPage.tsx` 接上

- 测试：查看态列出目标和「合计 100%」；编辑超出 100% 报错且不能保存，改回后保存成功；移除一项提示还差多少；拆出个股、并回合计；添加预设资产和自定义资产（重名 / 空名报错）；未定义资产「加入目标」；「不参与再平衡」；阈值 ±、周期、长期目标、显示币种写回状态

### Task 4：核对

- `npm test`、`npm run build`；内置浏览器里走一遍编辑流程
