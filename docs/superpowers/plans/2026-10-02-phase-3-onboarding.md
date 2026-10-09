# 阶段 3：首次录入、示例演示、品种预置 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- 新账号可以从零录入自己的账户、持仓、现金和目标组合，完成后写入「期初」流水和当天第一条快照。
- 「先看示例数据」只在这台设备上演示，不写进账号。
- 常见的美股 ETF、A股 ETF、QDII 基金都能按代码自动识别底层资产。
- 用真实数据前的几项保护：
  - 份额或现金为负时，在界面上标出来；
  - 请求浏览器不要清理本机数据；
  - 去掉会把示例数据写进账号的「导入示例数据」。

**Architecture:**
- 纯计算放在 `src/domain/onboarding.ts`：
  - 校验录入行；
  - 生成期初流水；
  - 按持仓成本算目标比例。
- 界面：`src/pages/onboarding/`，按原型 v5 的四屏：欢迎、选账户、录入持仓、目标组合。
  - `Root` 在账号没有任何账户时显示它。
  - 但必须先在这台设备上从云端读过一次，免得新设备在同步完成前误显示引导、重复录入。
- 示例演示：`Session.startDemo` / `endDemo`。演示期间暂停写回本机库和同步，界面换成示例数据；结束时换回账号数据。
- 第一条快照：完成时用 4b 的 `computeSnapshot` 算出今天的快照，存进本机，并通过待同步队列上传（新的队列类型 `snapshot`，只插入、重复跳过）。第二天早上 Worker 会用收盘后的值覆盖它。
- 预置：新迁移文件 `supabase/migrations/20261002000000_presets.sql`，增加全局底层资产和品种。每个代码写进去之前，先用行情源实测名称和价格。

- BUILD_PLAN 第 2、4、5、6、7 条（记一笔、校准面板、季度校准提醒、设置组合的 100% 规则、记录筛选）在阶段 1c 已经按原型实现，并且有测试。这次不重做，只在 Task 8 用真实数据走一遍。

**Tech Stack:** React、Zustand、Dexie、Supabase（PostgREST、RLS）、Vitest + Testing Library、PGlite。不新增依赖。

**Spec:**
- BUILD_PLAN 阶段 3 第 1–7 条和验收；
- README「首次录入引导」「记一笔」「代码识别」「数据模型」（`opening` 流水、`snapshots` 首次录入先写当天一条、全局预置）「本地优先与同步」（份额或现金为负时标出来）；
- 原型 v5 的首次录入（`onb*`、`obAdd`、`obPreview`、`obFinish`、`PRESETS`）；
- 用户在对话里定的「先看示例数据：只在这台设备上演示，不写进账号」；
- 4b 决定 2「首次录入写当天第一条快照放到阶段 3」。

## Global Constraints

- 「所有涉及金额的计算都放在 src/domain/ 里，并补充单元测试。」
- 「填好但没点添加的那一行，在切换账户或点下一步时要自动加进去」。
- 「完成后：净投入本金 = 录入的成本合计（每条持仓和现金各写一条「期初」流水）」。
- 期初流水：qty 为份额，price 为平均成本；现金的 qty 为余额、price 为 1。
- 「识别不了时让用户手动选，存为用户自己的品种」。
- 「凡是改变本金的情况都要落一条流水」：期初流水走 `appendTransactions`，和记一笔同一个入口（4a 的离线汇率标记也就生效）。
- 颜色、字体、圆角只用 `tokens.css` 的变量；文案简体中文、冷静简洁。
- 新迁移由用户在 Supabase SQL Editor 里运行；不提交 commit。

## 需要用户确认的决定

1. **什么时候出现引导**：账号里没有任何账户，并且这台设备已经从云端读过一次。
   - 新设备第一次登录时，先显示「正在读取云端数据…」，读完才判断要不要出现引导。这样不会在已有数据的账号上误弹引导、重复录入。
   - 新设备离线时，显示「第一次在这台设备上使用，需要联网读取一次」。
2. **「先看示例数据」**：
   - 在这台设备上展示示例数据，顶部有一条提示「正在看示例数据，不会保存」和「开始录入」按钮。
   - 演示期间记的任何东西都不保存、不同步。
   - 刷新页面后回到欢迎页。
3. **去掉「设置账户」里的「导入示例数据」**：它会把示例流水真的写进账号，有了演示就不需要了。你账号里已经导入的示例数据不受影响。
4. **识别不了的代码**：可以从现有底层资产里选，也可以选「作为个股单独列出」。后者会新建一个你自己的个股资产，名称默认用代码，以后在「设置组合」里能改。这样持有个股（比如微软）的人也能如实录入。
5. **预置表扩充到约 60 个品种、约 25 个底层资产**：
   - 新增的底层资产：全美股、罗素 2000、美股红利、全球股、新兴市场、中证 500、创业板、科创 50、中证红利、恒生指数、恒生科技、美国综合债、美国长期国债、美国短期国债、中国国债、美国房地产。
   - 每个代码写进去之前，都先用行情源核对名称和价格，对不上的不放。
   - 迁移文件要你在 Supabase 的 SQL Editor 里运行一次，和阶段 2 建表时一样。
6. **份额或现金为负时的提示**：持仓页顶部出现一张提醒卡片，列出是哪个账户的哪个品种，并说明可以用「校准」或补记一笔来修正。多台设备同时离线记账时才可能出现。
7. **按当前持仓生成目标时，比例按录入的成本算**（和原型一样）。四舍五入后差的那一点加到最大的一项上，保证合计正好是 100%。

## Review Focus

1. **新设备在第一次同步完成之前**：已有数据的账号绝不能出现引导；离线时给出明确提示。→ Task 4
2. **填好但没点「添加」的那一行**：切换账户、点下一步、点完成时都要自动加进去；填了一半的要报错，不能悄悄丢掉。→ Task 1、Task 3
3. **演示期间**：本机库、待同步队列、云端都不能多出任何东西；结束演示后账号数据原样回来。→ Task 5
4. **完成录入时离线**：账户、品种、期初流水、第一条快照都先存本机；联网后按顺序上传，美元期初流水按 4a 的规则换成当天汇率。→ Task 3、Task 6
5. **预置迁移重复运行、或和已有预置撞代码**：不能报错，也不能出现两条同代码的全局品种。→ Task 7

---

### Task 1：录入引导的纯计算

**Files:**
- Create: `src/domain/onboarding.ts`、`src/domain/onboarding.test.ts`

**Interfaces:**
- `interface OnbAccount { id: string; name: string; type: AccountType; currency: CashCurrency }`
- `interface OnbPosition { accountId: string; code: string; qty: number; cost: number; instrument: Instrument }`
- `interface OnbForm { code: string; qty: string; cost: string; exposureId: string }`
- `addPendingRow(form, accountId, positions, findInstrument: (code) => Instrument | null, newStockId?: string)`：
  - 返回 `{ kind: 'empty' }`（三格都空）、`{ kind: 'error', message }`（没填完整，原型文案「这一行还没填完整：需要代码、份额和成本价」），或 `{ kind: 'added', positions, form }`；
  - 同账户同代码覆盖旧的一行（原型 `obAdd`）；
  - 识别不了的代码用表单里选的底层资产生成新品种：纯数字是人民币 A 股，其余是美元美股（`newInstrument`）。
- `openingTransactions(i: { date; createdAt; accounts; positions; cash: Record<accountId, number>; fx: FxRates; newId }): Transaction[]`：
  - 每条持仓一条 `opening`，`price` = 成本价，`fxToCny` = 品种币种的汇率；
  - 每个账户现金大于 0 的写一条（代码是账户币种，`price` 为 1）。
- `targetsFromCost(i: { positions; cash; accounts; exposures; ownStock; fx }): Targets`：
  - 按成本（折成人民币）算各槽位占比，个股默认并入 `stocks`；
  - 四舍五入成整数，差的加到最大的一项，合计 100；
  - 没有任何持仓和现金时为空。

- [ ] **Step 1：写失败的测试**：
  - 三格都空 → `empty`；
  - 只填了代码 → `error`；
  - 份额或成本价不是正数 → `error`；
  - 同账户同代码再加一次 → 覆盖，不重复；
  - 不认识的代码用选中的底层资产，纯数字是人民币；
  - 期初流水：本金 = 成本合计（人民币），美元持仓用 `fx.USD`；
  - 现金为 0 或空的账户不写现金流水；
  - 目标比例：33.3/33.3/33.4 这类情况合计正好 100；
  - 个股并入 `stocks`；
  - 只有现金时是现金 100%。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑测试 + domain 类型检查** → PASS

### Task 2：首次录入的页面（四屏）

**Files:**
- Create:
  - `src/pages/onboarding/OnboardingPage.tsx`、`onboarding.css`；
  - `src/pages/onboarding/presets.ts`（常用平台：原型 `PRESETS` 的 10 个）；
  - `src/pages/onboarding/OnboardingPage.test.tsx`
- Modify: `src/pages/records/AddRecordSheet.tsx`（记一笔遇到不认识的代码，同样可以选「作为个股单独列出」）

**Interfaces:**
- `OnboardingPage({ onFinish, onDemo }: { onFinish: (result: OnboardingResult) => void; onDemo: () => void })`
- `OnboardingResult { accounts: Account[]; instruments: Instrument[]（新建的）; exposures: Exposure[]（新建的个股）; transactions: Transaction[]; targets: Targets }`
- 文案和布局按原型 v5（欢迎页标题「开始管理你的组合」，各步标题、提示、按钮）。

- [ ] **Step 1：写失败的测试**（Testing Library）：
  - 欢迎页两个按钮；「先看示例数据」调用 `onDemo`；
  - 第 1 步：
    - 点选常用平台加入或取消；
    - 自定义账户：名称为空时报错，重复时报错；
    - 一个都没选时点下一步报错「至少选择一个账户」；
  - 第 2 步：
    - 输入 VOO 显示「识别为：标普 500 · 美股 · USD」；
    - 不认识的代码出现底层资产选择，里面有「作为个股单独列出」；
    - 「+ 添加到列表」后出现在列表里，可以删除；
    - 填好没点添加时切换账户，那一行自动加进去；
    - 填了一半时切换，报错且不切换；
    - 点下一步时没有任何持仓和现金，报错「至少录入一条持仓或一笔现金」；
    - 每个账户可以填现金；
  - 第 3 步：
    - 默认「按当前持仓比例生成」，显示预览，合计 100%；
    - 选「暂不设目标」时没有预览；
    - 只有现金时显示提示；
  - 完成：`onFinish` 收到的账户、期初流水、目标与输入一致；
  - 每一步都能「上一步」回去，已填的内容还在。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑测试** → PASS

### Task 3：完成录入 → 写进账号

**Files:**
- Create: `src/app/onboarding.ts`、`src/app/onboarding.test.ts`
- Modify:
  - `src/app/localDb.ts`（`OutboxKind` 加 `'snapshot'`）
  - `src/app/persistence.ts`（`LocalController.saveFirstSnapshot`）
  - `src/app/sync.ts`（上传 `snapshot`）
  - `src/app/remote.ts`、`src/app/fakeRemote.ts`（`insertSnapshot`：只插入，重复的跳过）
  - `src/app/remoteSchema.test.ts`

**Interfaces:**
- `finishOnboarding(result, deps: { store; local; now })`：
  - 依次 `addExposure`（新建的个股）、`addInstrument`（新品种）、`addAccount`、`appendTransactions`（期初）、`saveTargets`；
  - 再用 `computeSnapshot`（日期 = 北京今天）算第一条快照，交给 `local.saveFirstSnapshot`；
  - 最后切到收益页并 `refreshQuotes`，提示「录入完成，正在拉取最新行情」。
- `Remote.insertSnapshot(row, items)`：用户只能插入、不能改。PostgREST 的 `ignore-duplicates` 对应 `on conflict do nothing`，不需要 update 权限。
- 队列里的 `snapshot` 项（key = 日期）上传时读本机的快照和各资产市值。

- [ ] **Step 1：写失败的测试**：
  - 完成后，store 和本机库里有账户、新品种、期初流水、目标；
  - 净投入本金 = 成本合计；
  - 待同步队列里有期初流水和一条快照；
  - 离线完成：联网后按顺序上传，云端有当天的快照；
  - 美元期初流水在今天还没取过汇率时标了 `fxPending`；
  - PGlite：用户能插入自己的快照；同一天再插入一次不报错、不改动；不能插入别人的。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：全部测试 + 类型检查** → PASS

### Task 4：什么时候显示引导

**Files:**
- Modify:
  - `src/app/sync.ts`（`SyncStatus.pulledOnce`）
  - `src/app/session.ts`（打开时按本机库里有没有拉取记录设初值）
  - `src/Root.tsx`（`ready` 时：没有账户 → 还没读过云端就显示读取中或离线提示，读过了就显示引导）
- Test: `src/Root.test.tsx`、`src/app/sync.test.ts`

- [ ] **Step 1：写失败的测试**：
  - 新账号第一次同步完成、账户为空 → 显示欢迎页；
  - 新设备、云端已有账户：同步完成前显示「正在读取云端数据…」，完成后直接进 App，不出现引导；
  - 新设备离线 → 显示需要联网的提示，联网后自动继续；
  - 已经读过云端、账户为空、离线 → 显示引导（本机记录说明这个账号确实是空的）；
  - 完成录入后进入 App 的收益页，显示「收益曲线从今天开始积累」。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑测试** → PASS

### Task 5：只在本机的示例演示

**Files:**
- Modify:
  - `src/app/session.ts`（`startDemo` / `endDemo`）
  - `src/app/persistence.ts`（`LocalController.suspend` / `resume`：暂停时不写回本机、不进队列）
  - `src/app/sync.ts`（`SyncController.suspend` / `resume`）
  - `src/app/AppShell.tsx`（演示时顶部的提示条）
  - `src/pages/holdings/AccountsSettings.tsx`（去掉「导入示例数据」）
- Test: `src/app/session.test.ts`、`src/App.test.tsx`、`src/pages/holdings/HoldingsPage.test.tsx`

**Interfaces:**
- `Session.startDemo()`：
  - 记下账号当前数据；
  - 暂停写回和同步；
  - 界面换成 `sampleData`（模拟的几年曲线、示例价格）。
- `Session.endDemo()`：换回账号数据，恢复写回和同步，并马上同步一次。
- 删除 `Session.importSample`。它只有「导入示例数据」用，测试跟着删改。

- [ ] **Step 1：写失败的测试**：
  - 演示期间记一笔、改设置：本机库和待同步队列没有变化，云端什么都没收到；
  - 结束演示后，账号数据原样回来，引导重新出现；
  - 演示时顶部有提示条，点「开始录入」进入引导第 1 步；
  - 设置账户里不再有「导入示例数据」。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：全部测试** → PASS

### Task 6：份额为负的提示 + 请求保留本机数据

**Files:**
- Create: `src/pages/holdings/AnomalyCard.tsx`
- Modify:
  - `src/pages/holdings/HoldingsPage.tsx`
  - `src/app/boot.ts`（`navigator.storage.persist()`，不支持就跳过）
- Test: `src/pages/holdings/HoldingsPage.test.tsx`、`src/app/boot.test.ts`

- [ ] **Step 1：写失败的测试**：
  - 流水推导出负份额或负现金（`ledger.anomalies` 的 `negative_qty`）时，持仓页顶部出现提醒，列出账户和品种；
  - 没有时不出现；
  - 启动时请求持久存储；浏览器不支持时不报错。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑测试** → PASS

### Task 7：扩充品种预置表

**Files:**
- Create:
  - `supabase/migrations/20261002000000_presets.sql`
  - `scripts/check-presets.mjs`（核对脚本：逐个查行情源，打印名称和价格，不进 App）
- Modify:
  - `src/app/palette.ts`（新底层资产的顺序和颜色，只用 tokens 变量）
  - `src/app/remoteSchema.test.ts`
  - `docs/supabase-setup.md`（运行新迁移的步骤）

**Interfaces:**
- 迁移只插入全局行（`user_id` 为空）：`insert … on conflict (user_id, id) do nothing` 和 `on conflict (user_id, code) do nothing`。`updated_at` 用 `2026-10-02T00:00:00Z`，各设备按服务器时间拉到。
- 每个品种的代码都要符合 `QUOTE_CODE`（`src/domain/quoteCodes.ts`）。

- [ ] **Step 1：核对**：
  - 候选代码逐个用腾讯、新浪查名称和价格，结果记进台账；
  - 名称和预期不符、或查不到的代码，不放进预置表。
- [ ] **Step 2：写失败的测试**（PGlite）：
  - 运行两次迁移不报错；
  - 全局品种代码不重复；
  - 每个品种的底层资产都存在，市场和币种搭配正确（美股 = USD，A股和场外基金 = CNY）；
  - 代码都符合 `QUOTE_CODE`；
  - 原有 24 个品种不变。
- [ ] **Step 3：跑测试** → FAIL
- [ ] **Step 4：写迁移 + palette** → PASS
- [ ] **Step 5：更新 `docs/supabase-setup.md`**：在 SQL Editor 运行新迁移；运行后各设备下次同步就能识别。

### Task 8：核对

- [ ] `npx vitest run`、`npm run build` 通过。
- [ ] 变异检查（每条改坏后都要有测试失败）：
  - 切换账户时不自动加入未添加的行；
  - 期初流水漏掉现金；
  - 目标比例合计不是 100；
  - 引导在第一次同步前就出现；
  - 演示时写进本机库；
  - 结束演示不恢复同步；
  - 第一条快照不进队列；
  - 负份额不提示；
  - 迁移重复运行出现重复代码。
- [ ] 浏览器（需要你在浏览器面板里登录一次，或者用手机）：从欢迎页走完四屏，收益页出现空状态，持仓页按底层资产合并正确。
- [ ] 整体审查，对照五个重点风险；更新台账；列出验收步骤（BUILD_PLAN 阶段 3 的五条）。
