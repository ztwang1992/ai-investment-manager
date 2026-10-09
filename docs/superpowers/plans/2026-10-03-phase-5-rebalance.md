# 阶段 5：再平衡提醒 + 用真实数据核对调整功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- 计划页的再平衡提醒：到了检查周期、并且有资产偏离超过阈值时，在 App 里提示。
- 「标记已完成」真正记下这一次，本周期内不再提醒；这个记录在各设备间同步。
- 投入一笔钱、取钱、再平衡步骤都接在真实数据上。这部分阶段 1c 已经实现并写入账号，这次补上验收要求的性质测试，再用你的真实数据跑一遍「投入 ¥10 万」，给你核对。

**Architecture:**
- `src/domain/rebalance.ts`：`rebalanceStatus({ slots, plan, today })`。纯函数，判断这一期是否已检查、有几项偏离、要不要提醒。
- `Plan` 加 `lastRebalancedOn`（最后一次标记完成的日期），随计划一起同步。云端 `plans` 表要加一列，需要一个新迁移。
- 界面：
  - 要提醒时，「计划」标签上出现小圆点；
  - 再平衡卡片说明这一期的状态；
  - 「标记已完成」记下今天。

**Spec:** BUILD_PLAN 阶段 5（第 1–4 条和三条验收）；README「2. 计划」「增量投入算法」「取钱算法」。

## Global Constraints

- 「计划页的再平衡提醒：按阈值和检查周期判断，在 App 内提示。」
- 「『未定义』资产的处理要按用户在设置里的选择（建议卖出 / 不参与）」。
- 验收：
  - 投入 ¥10 万后，每个槽位买入后的占比都没有下降；
  - 取钱时只卖同币种的持仓；
  - 执行之后，持仓、现金、收益页的本金线都一致。
- 计算放 `src/domain/`；不提交 commit；新迁移由用户在 SQL Editor 运行。

## 需要用户确认的决定

1. **提醒规则**：这一期（月、季度或年，按设置）还没有标记过「已完成」，并且至少有一项偏离超过阈值时提醒。
   - 「未定义」资产在「建议卖出」模式下也算偏离，「不参与」模式下不算。
   - 标记完成后，到下一期开始前都不再提醒，即使偏离变大也不提醒。这符合「定期检查」的意思。
2. **提醒出现在哪**：「计划」标签上的小圆点，加上再平衡卡片顶部的一行，例如「本季度还没检查：2 项偏离超过 ±3%」。不弹窗、不发通知。
3. **新迁移**：`plans` 表加一列 `last_rebalanced_on`。没运行迁移之前，其他功能照常用；只有点「标记已完成」时同步会报错，运行迁移后自动补传。
4. **真实数据核对**：请你在「持仓 → 设置账户 → 数据备份 → 导出完整备份（JSON）」导出一份，把文件路径告诉我。我用现在的行情算出「投入 ¥10 万」的建议，列给你看。这个文件含有你的持仓，在本机读，不会上传到别处。也可以你自己在 App 里打开「投入一笔钱」看。

## Review Focus

1. **周期边界**：季度第一天提醒；上一季度最后一天标记的，到新季度要重新提醒。→ Task 1
2. **「未定义」资产的两种模式**：「不参与」时，只有未定义资产偏离不提醒。→ Task 1
3. **迁移没运行时**：只要不点「标记已完成」，计划的其他改动照常同步。→ Task 1、Task 2
4. **投入后被稀释的槽位**：没买到的槽位占比下降是稀释，不是错误。验收说的是被买入的槽位不能下降。→ Task 3
5. **多台设备**：一台设备标记完成，另一台同步后也不再提醒。→ Task 2

---

### Task 1：提醒规则 + 计划里记下最后一次再平衡

**Files:**
- Create:
  - `src/domain/rebalance.ts`、`src/domain/rebalance.test.ts`
  - `supabase/migrations/20261003000000_plan_rebalanced.sql`（`alter table public.plans add column if not exists last_rebalanced_on date;`）
- Modify:
  - `src/domain/types.ts`（`Plan.lastRebalancedOn?: string | null`）
  - `src/domain/rows.ts`（`PlanRow.last_rebalanced_on`；写的时候没有值就不带这一列）
  - `src/app/remoteSchema.test.ts`、`docs/supabase-setup.md`

**Interfaces:**
- `rebalanceStatus(i: { slots: Slot[]; plan: Plan; today: string }): { due: boolean; offCount: number; checkedThisPeriod: boolean; periodStart: string }`

- [ ] 测试：
  - 季度第一天、有偏离、从没标记过 → 提醒；
  - 本季度标记过 → 不提醒；
  - 上季度标记过，到了新季度 → 提醒；
  - 没有偏离 → 不提醒；
  - 「不参与」模式下，只有未定义资产偏离 → 不提醒；「建议卖出」模式 → 提醒；
  - 月、年周期同理；
  - 行格式来回转换；没有值时不带这一列；
  - PGlite：迁移后能写能读，重复运行不报错。
- [ ] 实现，测试通过。

### Task 2：界面

**Files:**
- Modify:
  - `src/App.tsx`（要提醒时，「计划」标签加小圆点：「需要再平衡」）
  - `src/pages/plan/PlanPage.tsx`（再平衡卡片的状态行）
  - `src/pages/plan/RebalanceSheet.tsx`（「标记已完成」记下今天）
- Test: `src/pages/plan/PlanPage.test.tsx`、`src/App.test.tsx`、`src/app/sync.test.ts`

- [ ] 测试：
  - 到期且有偏离时，标签上有小圆点，卡片写「本季度还没检查：N 项偏离超过 ±3%」；
  - 点「标记已完成」后，小圆点消失，卡片写「本季度已检查（10-03）」，计划里记下了日期；
  - 另一台设备同步后也不再提醒。
- [ ] 实现，测试通过。

### Task 3：验收要求的性质测试

**Files:** `src/domain/contribution.test.ts`、`src/domain/withdrawal.test.ts`、`src/pages/plan/PlanPage.test.tsx`

- [ ] 测试：
  - 多组持仓、多个金额（含人民币 ¥10 万）：每一个被买入的槽位，投入后的占比都不低于投入前；
  - 取钱：卖出的都是同币种持仓（美元取钱不碰人民币持仓，反过来也一样）；
  - 在计划页「按此记录」以后：持仓、各账户现金、净投入本金（收益页本金线的来源）三者一致。投入时本金增加投入金额，账户现金不变；取钱时本金减少取出金额。
- [ ] 这些性质已经实现，所以测试应该直接通过，用改坏代码的方式证明它们有效。

### Task 4：用真实数据核对（需要你的备份文件）

- [ ] 读你导出的备份，取当前行情，按「可跨账户」和「只在一个账户买」两种模式算「投入 ¥10 万」的建议，列出每一笔：账户、品种、金额、占比从多少到多少；再列出投入前后最大偏离，以及买不到的低配资产。脚本放在临时目录，不进项目。
- [ ] 核对验收第一条：每个被买入的槽位，占比都没有下降。

### Task 5：核对

- [ ] 全部测试、构建通过；变异检查（周期边界、未定义模式、标记完成不记日期、标签小圆点）；整体审查；列出验收步骤。
