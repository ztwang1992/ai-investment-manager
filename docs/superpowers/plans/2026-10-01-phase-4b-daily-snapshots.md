# 阶段 4b：每日快照 + 收益页用真实快照 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Worker 每天北京时间 06:00，给每个用户算一次前一天收盘后的总资产、净投入本金、usd_cny 和各底层资产市值，写进 `snapshots`、`snapshot_items`；07:00 再跑一次，补上没写成的。
- App 从云端拉快照、存进本机（离线也能看），收益页的曲线、美元视图、「各资产表现」都用真实快照；入金出金的圆点仍来自流水。
- 「某一天的持仓估值」写成 `src/domain/` 的纯函数，Worker 和 App 共用。

**Architecture:**
- `src/domain/snapshot.ts`：`computeSnapshot`，用流水、品种、价格、汇率算出某一天的快照和各资产市值；收益页「今天」的实时点也改用它。
- `worker/src/supabase.ts`：用 service role key 通过 PostgREST（只用 fetch）读全部用户的流水、品种、底层资产，写快照。
- `worker/src/daily.ts`：每日任务。价格、汇率走 4a 的缓存和换源（`getQuotes`、`getFx`），所有用户共用一次查询。
- `worker/src/index.ts`：加 `scheduled` 入口；`wrangler.jsonc` 加两个定时触发和 `SUPABASE_URL`。
- App：`Remote.pullSnapshots`；本机库第 3 版加快照两张表；同步时按日期增量拉取；`stateFromData` 直接用存下的快照，不再按流水模拟历史（模拟只留给示例数据）。

**Tech Stack:** Cloudflare Workers（Cron Triggers、KV、secret）、Supabase PostgREST（service role）、Dexie、Vitest。不新增依赖。

**Spec:**
- BUILD_PLAN 阶段 4 第 5、6 条，验收「连续运行 3 天后，收益页出现 3 个点」；
- README「数据模型」的 `snapshots`、`snapshot_items`，「美元视图」，「1. 收益」的图表、各资产表现和新用户空状态；
- CLAUDE.md：计算复用 `src/domain/`；service role key 不进 git；
- 阶段 4a 计划和台账（缓存、换源、免费版限制）。

## Global Constraints

- 「每日快照：用 Worker 的 Cron Trigger，每天北京时间 06:00 为每个用户计算一次总资产、净投入本金、当天的 usd_cny 和各底层资产的市值，写入 snapshots 和 snapshot_items 表，计算复用 src/domain/ 的函数。」
- 「Worker 访问 Supabase 时使用 service role key，这个 key 只放在 Worker 的 secret 里。」key 不进 git、不打日志，由用户自己用 `wrangler secret put` 填。
- 「收益页改为读取 snapshots 表来画图；入金 / 出金的圆点来自 transactions 表；『各资产表现』读取 snapshot_items；美元视图按 README『美元视图』一节换算。」
- `snapshots` 每天一条；`snapshot_items` 每天每个持有的底层资产一条。
- 「新用户：刚完成首次录入时还没有历史，显示『收益曲线从今天开始积累』的空状态。」
- Worker 免费版：每次调用最多 50 个外部请求、约 10 毫秒 CPU；KV 每天最多写 1000 次。
- 部署（填 secret、发布）由用户在终端运行；不提交 commit。

## 需要用户确认的决定

1. **快照记在哪一天**：06:00 那次记为**前一天**（北京日期减一天），数值是前一天收盘后的。今天的点由 App 的实时估值补上，和现在一样。这样图上每一天都是那天收盘后的值，不会错开一天。
2. **07:00 补跑**：只给还没有前一天快照的用户写。06:00 那次失败（比如 Supabase 临时连不上）时，07:00 补上。
3. **「首次录入完成时写当天第一条快照」放到阶段 3**：首次录入的界面阶段 3 才做。这一阶段先把共用的计算函数写好，阶段 3 直接调用。
4. **已经导入示例数据的账号**：收益页里模拟出来的几年曲线会消失，变成「收益曲线从今天开始积累」，然后每天多一个真实的点。示例数据本身（流水、持仓）不动。
5. **快照怎么同步到 App**：不改表结构。每次同步时，从本机最新的那一天往前 7 天开始重新拉，并替换这几天的数据，因为补跑可能会重写这几天。第一次拉全部。
6. **汇率完全取不到时，这次不写快照**：Worker 缓存里也没有汇率时，不能用错的汇率算美元资产，等 07:00 或第二天。价格取不到时，用缓存里的旧价，再没有就按成本算，和 App 一样。

## Review Focus

1. **同一个 6 位代码，在两个用户那里市场不同**（一个当 A 股，一个当场外基金）：价格按「市场 + 代码」分开取、分开用，不能串。→ Task 3
2. **某个用户的数据有问题**（比如流水里有不认识的品种，或计算出错）：跳过这个用户，其他用户照写；日志只记人数，不记金额、不记密钥。→ Task 3
3. **同一天重跑**：快照覆盖；各资产市值先删后写，不能留下已经卖掉的资产的旧行。→ Task 2、Task 3
4. **离线打开 App**：快照从本机读，曲线照常显示；拉快照失败和其他拉取失败一样，按原来的规则重试。→ Task 5、Task 6
5. **Worker 的 CPU 时间**：收盘后判断缓存是否过期时，按 5 分钟一步往后找开盘时间，一只美股约 0.17 毫秒（本机实测），20 只就接近 10 毫秒上限。改成直接算出下一次开盘时间。→ Task 1

---

### Task 1：Worker 直接算下一次开盘时间（CPU）

**Files:**
- Modify: `worker/src/sessions.ts`、`worker/src/time.ts`
- Test: `worker/src/sessions.test.ts`（现有用例不变，再加几条边界）

**Interfaces:**
- Produces（签名不变）：
  - `inSession(kind, at)`
  - `freshUntil(kind, fetchedAt)`：交易时段内 15 分钟；其他时间取「6 小时后」和「下一次开盘」中较早的那个。
- 新增 `newYorkToUtc(wall: number): number`：美东钟表时间转 UTC，夏令时切换前后都对；`easternToUtc` 改用它。

- [ ] **Step 1：补失败的测试**
  - 周五收盘后：下一次开盘是周一 09:30，6 小时先到，结果是 6 小时后；
  - 周日晚上：下一次开盘是周一 09:30（美东）；
  - 夏令时开始的周一（2026-03-09）早上：结果是 13:30 UTC；
  - 11 月 2 日（冬令时）早上：结果是 14:30 UTC；
  - 北京周五 16:00：6 小时后。

  这些用例按现在的写法也能通过，它们是给重写兜底的，所以 RED 靠 Step 3 之前先改坏一处来证明。
- [ ] **Step 2：测量**：本机 `freshUntil('us', 收盘后)` 每次约 0.17 毫秒，记进台账。
- [ ] **Step 3：实现**：
  - 读出当地钟表时间。
  - 当天还没到 09:30 且是工作日，下一次开盘就是今天 09:30；否则往后找第一个工作日的 09:30。
  - 美股的结果用 `newYorkToUtc` 转成 UTC；A股、基金减 8 小时；汇率是下周一 00:00 UTC。
- [ ] **Step 4：测试全过；再测量一次**，目标每次不到 0.02 毫秒，记进台账。

### Task 2：共用的快照计算 + 快照的行格式

**Files:**
- Create: `src/domain/snapshot.ts`、`src/domain/snapshot.test.ts`
- Modify:
  - `src/domain/rows.ts`（加快照的行格式和转换）、`src/domain/rows.test.ts`
  - `src/pages/perf/usePerfData.ts`（今天的实时点改用 `computeSnapshot`）

**Interfaces:**
- Produces：
  - `computeSnapshot(i: { date: string; transactions: readonly Transaction[]; instruments: Record<string, Instrument>; exposures: Record<string, Exposure>; prices: Prices; fx: FxRates }): { snapshot: Snapshot; items: SnapshotItem[] }`
    - 只算记账日期不晚于 `date` 的流水；
    - 每个持有的底层资产一条，按人民币市值加总，现金也算；
    - 没有价格的按成本算（和 `valueHoldings` 一样）；
    - 市值为 0 的资产不写；
    - `usdCny` 取 `fx.USD`。
  - `SnapshotRow { user_id; date; total_value_cny: Num; net_invested_cny: Num; usd_cny: Num }`
  - `SnapshotItemRow { user_id; date; exposure_id; value_cny: Num }`
  - `snapshotToRow`、`rowToSnapshot`、`snapshotItemToRow`、`rowToSnapshotItem`（数据库返回的 numeric 可能是字符串，要转成数字）。

- [ ] **Step 1：写失败的测试**：
  - 一个账户有人民币现金、美元现金、美股、A股、场外基金：总资产等于各资产人民币市值之和，美元资产按 `fx.USD` 换算；
  - `date` 之后的流水不算；
  - 有份额但没价格的按成本算；
  - 卖光的资产不出现在各资产市值里；
  - 净投入本金只看期初、入金、出金，买卖、校准不影响；
  - 没有流水时，总资产、本金都是 0，各资产市值为空；
  - 行格式来回转换不丢精度，字符串形式的数字能读。
- [ ] **Step 2：跑测试** → FAIL（找不到模块）
- [ ] **Step 3：实现**；`usePerfData` 的实时点改用 `computeSnapshot`，收益页的现有测试应该都还能过。
- [ ] **Step 4：跑全部测试和类型检查** → PASS

### Task 3：Worker 读写 Supabase + 每日任务

**Files:**
- Create:
  - `worker/src/supabase.ts`、`worker/src/supabase.test.ts`
  - `worker/src/daily.ts`、`worker/src/daily.test.ts`
- Modify:
  - `worker/src/index.ts`（`scheduled` 入口；`Env` 加 `SUPABASE_URL`、`SUPABASE_SECRET_KEY`）、`worker/src/index.test.ts`
  - `worker/src/providers.ts`（`newBudget(n)`：每日任务给行情留 30 个外部请求，其余留给 Supabase）
  - `worker/wrangler.jsonc`（`triggers.crons: ["0 22 * * *", "0 23 * * *"]`，`vars.SUPABASE_URL`）
  - `docs/worker-setup.md`

**Interfaces:**
- `createAdmin(env: { SUPABASE_URL: string; SUPABASE_SECRET_KEY: string }, fetch: Fetch): Admin`
  - 请求头带 `apikey`；key 像 JWT（旧版 service_role）时，再加 `Authorization: Bearer`。新版 `sb_secret_` 开头的 key 不是 JWT，不放进 `Authorization`。
  - `userIds(): Promise<string[]>`：`accounts` 里出现过的 `user_id`，去重。还没录入的新用户不算。
  - `loadAll(): Promise<{ transactions: TxRow[]; instruments: InstrumentRow[]; exposures: ExposureRow[] }>`：全部用户的行，加上全局预置；每页 1000 行。
  - `usersWithSnapshot(date: string): Promise<Set<string>>`
  - `writeSnapshots(date: string, rows: { userId: string; snapshot: Snapshot; items: SnapshotItem[] }[]): Promise<void>`：
    - 快照按（user_id, date）覆盖写（`Prefer: resolution=merge-duplicates`）；
    - 先删这些用户这一天的各资产市值，再插入新的。
  - 失败时报错只写表名和状态码，不带 key。
- `runDailySnapshots(env: Env, deps: { fetch: Fetch; now: () => Date }, mode: 'all' | 'missing'): Promise<{ date: string; written: number; skipped: number; failed: number }>`
  - `date` = 北京日期减一天。
  - 用户的品种、底层资产 = 全局预置 + 自己建的，自己建的优先（和 App 一样）。
  - 汇总所有用户在 `date` 当天持有的非现金品种，按「市场 + 代码」分组，每个市场调一次 `getQuotes`；汇率调 `getFx(null)`，取不到就整次不写。
  - 每个用户用 `computeSnapshot` 计算；`date` 之前没有流水的用户跳过。单个用户出错只算 `failed`，不影响别人。
  - 只用一次 `console.log` 记日期和人数。
- `scheduled(controller, env, ctx)`：`0 22 * * *` 跑 `all`，`0 23 * * *` 跑 `missing`；没配 `SUPABASE_URL` 或 key 时记一行日志，直接返回。

- [ ] **Step 1：写失败的测试**（假的 fetch 模拟 PostgREST 和行情源）：
  - `supabase.test`：
    - 请求头：`sb_secret_` 开头的 key 只放 `apikey`，JWT 形式的 key 两个头都放；
    - 分页读满 1000 行时接着读下一页；
    - 写快照时，覆盖写的请求头正确，并且先删后插；
    - 出错信息里不含 key。
  - `daily.test`：
    - 两个用户：各自的快照按自己的流水算，日期是北京时间的前一天（任务在 2026-10-01T22:00Z 跑，记为 2026-10-01）；
    - 两个用户都持有 VOO 时，行情只查一次；
    - 同一个代码 000001，一个用户当 A 股、一个当基金，各自用对的价格；
    - 某个用户的计算出错时，另一个用户照写，结果里 `failed` 是 1；
    - `missing` 模式跳过已经有这一天快照的用户；
    - 汇率取不到、缓存里也没有时，一行都不写；
    - 行情源都挂了：用 KV 里的旧价写；没有旧价的按成本写；
    - 日志里没有金额和 key。
  - `index.test`：两个定时任务分别跑 `all` 和 `missing`；没配置时不调用任何外部请求。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：Worker 测试 + 类型检查 + `wrangler deploy --dry-run`**（输出里有两个 schedule 和 `SUPABASE_URL`）→ PASS

### Task 4：App 拉快照（云端接口）

**Files:**
- Modify:
  - `src/app/remote.ts`（`pullSnapshots`）、`src/app/fakeRemote.ts`（快照两张表 + 测试用的写入方法）
  - `src/app/remoteSchema.test.ts`（PGlite：真实表结构下的权限）
- Test: `src/app/remote.test.ts`

**Interfaces:**
- `Remote.pullSnapshots(sinceDate: string | null): Promise<{ snapshots: SnapshotRow[]; items: SnapshotItemRow[] }>`：`date >= sinceDate`，按日期排序，每页 1000 行；`null` 时拉全部。RLS 保证只拿到自己的行。

- [ ] **Step 1：写失败的测试**：
  - remote：只拉 `sinceDate` 及以后的；分页；登录过期时报 `auth` 错误（和别的拉取一样）。
  - remoteSchema（PGlite）：
    - service role 能覆盖写快照、删除再写各资产市值；
    - 登录用户只能读到自己的快照；
    - 登录用户不能改、不能删快照。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑测试** → PASS

### Task 5：本机存快照；账号不再模拟历史

**Files:**
- Modify:
  - `src/app/localDb.ts`（第 3 版：`snapshots: 'date'`，`snapshotItems: '[date+exposureId], date'`）
  - `src/app/persistence.ts`：
    - `LocalData` 加 `snapshots`、`snapshotItems`，`loadData` / `saveAll` / `dataFromState` 跟着改；
    - `stateFromData` 直接用存下的快照；
    - 去掉 `historyState`；`applyRemote`、`updateFx` 不再重算历史；
    - 新增 `LocalController.applySnapshots`
  - `src/app/session.ts`（导入示例数据时不再重算历史）
- Test: `src/app/persistence.test.ts`、`src/app/session.test.ts`

**Interfaces:**
- `LocalController.applySnapshots(since: string | null, snapshots: Snapshot[], items: SnapshotItem[]): Promise<void>`：
  - 用拉下来的替换本机 `date >= since` 的快照和各资产市值（`since` 为 `null` 时全部替换）；
  - 更新界面（暂停写回）；
  - 不进同步队列。
- 示例数据（`sampleData`、启动前的占位数据）仍带模拟的历史；新账号（`emptyData`）的快照为空。

- [ ] **Step 1：写失败的测试**：
  - 快照存进本机，重新打开能读出；
  - 账号的历史就是存下的快照，记一笔、从云端合并流水、换汇率，都不会改动历史；
  - `applySnapshots` 替换最近几天、保留更早的，并且删掉被重写那几天里已经不存在的资产行；
  - 旧版（第 2 版）本机库升级到第 3 版后，原有数据都在，快照为空；
  - 示例数据仍然有几年的模拟曲线。
- [ ] **Step 2：改掉依赖模拟历史的旧测试**：
  - 「重算历史」改为「保持存下的历史」；
  - 「换汇率后本金重算」改为「换汇率不动历史」。

  每条改动都记进台账。
- [ ] **Step 3：跑测试** → FAIL
- [ ] **Step 4：实现**
- [ ] **Step 5：全部测试 + 类型检查** → PASS

### Task 6：同步时拉快照；收益页用真实快照

**Files:**
- Modify: `src/app/sync.ts`
- Test:
  - `src/app/sync.test.ts`
  - `src/pages/perf/PerfPage.test.tsx` 或 `src/emptyAccount.test.tsx`

**Interfaces:**
- 每次拉取在流水和设置之后接着拉快照：
  - 本机有快照时，`since` = 本机最新一天往前 7 天；没有时为 `null`。
  - 拉完调 `local.applySnapshots`。
  - 出错和其他拉取一样，进入重试。

- [ ] **Step 1：写失败的测试**：
  - 新设备第一次同步拉到全部快照；
  - 之后只拉最近 7 天，并替换这几天（云端重跑后少了一个资产，本机也跟着少）；
  - 离线打开时，曲线来自本机存的快照；
  - 账号没有任何快照：收益页显示「收益曲线从今天开始积累」；
  - 有 3 天快照：曲线有这 3 天再加今天；切到美元时，每天按那天快照的 usd_cny 换算；「各资产表现」按快照计算。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：全部测试 + 构建** → PASS

### Task 7：部署（用户在终端运行）

- [ ] 我先把 `.env.local` 里的项目地址写进 `wrangler.jsonc` 的 `vars.SUPABASE_URL`。这个地址前端本来就公开，不是密钥。
- [ ] 用户：Supabase → **Project Settings → API Keys → Secret keys**，复制 secret key（旧项目叫 service_role key），然后运行：

  ```bash
  npx wrangler secret put SUPABASE_SECRET_KEY --config worker/wrangler.jsonc
  ```

  按提示粘贴。key 只进 Cloudflare，不会出现在项目文件和聊天里。
- [ ] 用户：

  ```bash
  npx wrangler deploy --config worker/wrangler.jsonc
  ```

  输出里应该有 `schedule: 0 22 * * *` 和 `0 23 * * *`。
- [ ] 可选，马上试一次：
  - 用户在 `worker/.dev.vars`（不进 git）写一行 `SUPABASE_SECRET_KEY=...`；
  - 运行 `npx wrangler dev --config worker/wrangler.jsonc --test-scheduled`；
  - 再打开 `http://localhost:8787/__scheduled?cron=0+22+*+*+*`。

  这会给真实数据库写一条昨天的快照。不试的话，就等第二天早上 06:00。
- [ ] 第一次定时任务跑完后核对：Supabase 的 `snapshots` 里有一行昨天的，`snapshot_items` 里每个持有的资产各一行。

### Task 8：核对

- [ ] `npx vitest run`、`npm run build`、`wrangler deploy --dry-run` 都通过。
- [ ] 变异检查（每条改坏后都要有测试失败）：
  - 快照日期不减一天；
  - 晚于快照日期的流水也算进去；
  - 两个用户的行情不合并查询；
  - 「市场 + 代码」只按代码；
  - 一个用户出错导致整次失败；
  - `missing` 模式不跳过；
  - 汇率取不到也写；
  - 重写同一天时不删旧的资产行；
  - `apikey` 以外也把 `sb_secret_` 放进 `Authorization`；
  - 同步拉快照不往前留 7 天；
  - `applySnapshots` 不删被重写那几天的旧行；
  - 账号仍按流水模拟历史；
  - 下一次开盘时间算错（夏令时）。
- [ ] 整体审查，对照上面五个重点风险。
- [ ] 更新台账，列出手动验收步骤：
  1. 第二天 06:00 以后，Supabase 的 `snapshots` 里有前一天的一行。
  2. 收益页：第一天是空状态；连续 3 天后出现 3 个点，再加上今天的点。
  3. 切到美元时曲线按每天的汇率换算。
  4. 「各资产表现」有数。
  5. 离线打开 App 时曲线仍在。
