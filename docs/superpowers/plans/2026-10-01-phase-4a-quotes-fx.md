# 阶段 4a：行情、汇率接口 + App 用真实价格和汇率 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- Cloudflare Worker（api.example.com）提供 `/quote` 和 `/fx`：主用源失败自动换备用源，都失败时返回缓存里上次的结果并标明不是最新的。
- App 冷启动和下拉刷新时用它更新价格、汇率和净值日期，「今天」改用北京时间的真实日期。
- 离线记的美元流水，上传前换成记账当天的实际汇率。

**Architecture:**
- Worker 在 `worker/`，按市场分组取价：美股、A股、场外基金各有一条「主用 → 备用 → 第三」的源链（阶段 0 选定）。
- 结果按组缓存在 KV（`quotes:us` 等，一组一个键，避免免费版每天 1000 次写入的上限），新鲜度按交易时段判断：交易时段 15 分钟，其他时间 6 小时。
- 前端通过 `QuotesApi` 调用 Worker；store 的 `refreshQuotes` 从模拟改成真实请求。
- 同步引擎上传前，修正「记账时汇率不是当天联网取到的」流水。

**Tech Stack:** Cloudflare Workers（KV）、TypeScript；前端沿用 Vite + React + Zustand + Dexie；测试 Vitest（Worker 代码在 node 环境下用假的 fetch / KV 测）。不新增依赖。

**Spec:**
- BUILD_PLAN 阶段 4 第 1–4 条，以及验收里「下拉刷新后价格有变化」「场外基金显示净值日期」「数据源写错不崩溃、显示上次价格并提示行情暂不可用」三条；
- README「技术栈 · 行情/汇率」「本地优先与同步」（离线汇率）；
- `docs/phase0-feasibility.md` 的数据源推荐和接入细节；
- 用户在对话里定的「先做阶段 4 再做阶段 3」。
- 每日快照（BUILD_PLAN 阶段 4 第 5、6 条）在 4b。

## Global Constraints

- 「行情/汇率：由 Cloudflare Worker 中转，结果缓存 15 分钟，只用免费数据源」；BUILD_PLAN：「交易时段 15 分钟，非交易时段 6 小时」。
- 「场外基金用 T-1 净值」「要带上净值日期」。
- 「主用源失败时自动切到备用源，都失败时返回上次缓存的结果并注明时间。Worker 内部要做抽象，方便以后替换数据源。」
- 「离线记账先用最后一次查到的汇率，上传前换成记账当天的实际汇率；暂时查不到就留在队列里，下次同步再试」（README）。
- 前端和 Worker 都绑定自己的域名，不用 workers.dev（CLAUDE.md）。
- 「所有金额和比例的计算都写成纯函数，放在 `src/domain/`」；日期换算（北京时间的今天）放 `src/domain/dates.ts`。
- 「界面文案用简体中文，语气冷静、简洁。」
- 部署（建 KV、发布 Worker）先征得用户同意；不提交 commit。

## Review Focus

1. **某个源只返回了一部分代码**（比如腾讯不认识某只股票）：缺的那几只要继续向下一个源要，不能整组算失败。→ Task 2
2. **全部源都失败，但缓存里有旧价格**：返回旧价格并标 `stale`，App 显示「行情暂不可用」，不清空价格。→ Task 3、Task 6
3. **免费版的限制**：
   - 每次请求最多发 50 个外部请求。腾讯挂了以后，Yahoo 要一只一只地查，品种多了会超；超出的部分按「没取到」处理。
   - KV 每天最多写 1000 次。写失败时照常返回结果，只是这次没缓存上。
   → Task 2、Task 3
4. **离线记的美元流水，上传时汇率接口也失败**：这笔留在队列里，后面的流水也先不传（保持顺序），下次再试。→ Task 7
5. **美国夏令时切换**（三月、十一月）：美股交易时段的判断不能差一小时。→ Task 3

另外两点由设计保证，不单列：
- 6 位数字代码有歧义（000216 是场外基金，000001 是深交所股票）：接口按市场分参数，市场由 App 按品种告诉 Worker（Task 4）。
- 数据源都不认识的代码（比如用户自己加的）：只是这一只没有价格，按成本估值，不影响其他品种，也不提示「行情暂不可用」（Task 6）。

---

### Task 1：Worker 骨架、代码换算和解析器

**Files:**
- Create:
  - `worker/wrangler.jsonc`、`worker/tsconfig.json`
  - `worker/src/types.ts`、`worker/src/symbols.ts`、`worker/src/parse.ts`
  - `worker/src/symbols.test.ts`、`worker/src/parse.test.ts`
- Modify:
  - `vite.config.ts`（测试也收 `worker/**/*.test.ts`）
  - `package.json`（`typecheck` 加 `tsc -p worker/tsconfig.json`）

**Interfaces:**
- Produces：
  - `type MarketKind = 'us' | 'cn' | 'fund'`
  - `interface Quote { code: string; price: number; currency: 'USD' | 'CNY'; asOf: string; source: string }`
  - `interface Kv { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }`
  - `type Fetch = (url: string, init?: RequestInit) => Promise<Response>`
  - `cnExchange(code)`、`tencentSymbol(kind, code)`、`yahooSymbol(kind, code)`、`sinaSymbol(kind, code)`
  - `parseTencent(text): Map<string, { price: number; time: string }>`：键是腾讯代码，例如 `usVOO`、`sh513500`
  - `parseSina(text): Map<string, string[]>`：键是新浪代码，值是逗号分隔后的字段
  - `parseYahoo(json): { price: number; time: string; currency: string }`
  - `parseFundApp(json): Map<string, { nav: number; date: string }>`
  - `parseFundF10(json): { nav: number; date: string }`
  - `parseFrankfurter(json): { date: string; usd: number; hkd: number }`
  - 新浪的即期汇率 `fx_susdcny`、`fx_shkdcny` 也用 `parseSina` 解析：[1] 现价，最后一个非空字段是日期
  - `easternToUtc(local: string): string`：美东时间（含夏令时）转 ISO
  - `beijingToUtc(local: string): string`

- [ ] **Step 1：写失败的测试**
  - `symbols.test.ts`，各种代码的换算：
    - VOO → `usVOO` / `VOO` / `gb_voo`；
    - BRK.B → `usBRK.B` / `BRK-B` / `gb_brk$b`（新浪用 `$` 代替点，`gb_brk.b` 返回空，已实测）；
    - 513500、600519 → `sh…` / `….SS`（6、5、9 开头是上交所）；
    - 159915、000001、300750 → `sz…` / `….SZ`（0、1、2、3 开头是深交所）；
    - 050025（基金）→ `f_050025`。
  - `parse.test.ts`，用阶段 0 实测的响应做样例（`docs/phase0-feasibility.md` 第 5 节）：
    - 腾讯美股：价格 702.46，时间 `2026-09-29 16:00:01`（美东）转成 `2026-09-29T20:00:01.000Z`；
    - 腾讯 A 股：`20260930161435` 转成 `2026-09-30T08:14:35.000Z`；
    - 新浪基金 `f_050025`：净值 5.563，日期 2026-09-29；
    - 新浪美股 `gb_brk$b`：[1] 现价，[3] 是北京时间；
    - 新浪对不认识的代码返回空字符串（`hq_str_gb_brk.b=""`），当作没取到；
    - Yahoo：价格和时间；
    - 天天基金 App：`Datas[0].NAV` 和 `PDATE`；
    - 天天基金 F10：`Data.LSJZList[0].DWJZ` 和 `FSRQ`；
    - 新浪即期汇率：USD/CNY 6.7050，HKD/CNY 0.8545；
    - frankfurter：USD/CNY 6.7034、HKD/CNY 0.85437；
    - 夏令时边界：2026-03-06（EST，UTC-5）和 2026-03-09（EDT，UTC-4）的 16:00。
- [ ] **Step 2：跑测试** → FAIL（找不到模块）
- [ ] **Step 3：实现**
  - `worker/tsconfig.json` 用 `lib: ["ES2023", "WebWorker"]`。KV、Env 的类型自己写最小接口，不装 `@cloudflare/workers-types`；wrangler 用 `npx wrangler`（本机已有 4.144.0）。
  - 解析器只读 ASCII 字段，所以不用解码 GBK 也能取到价格和时间；名称不取，App 有自己的品种名。
  - 美东时间换算：用 `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })` 取当天的偏移。Workers 和 Node 都支持。
- [ ] **Step 4：跑测试** → PASS；`npm run typecheck` 通过

### Task 2：数据源和换源

**Files:**
- Create: `worker/src/providers.ts`、`worker/src/providers.test.ts`

**Interfaces:**
- Consumes：Task 1 的全部。
- Produces：
  - `interface Provider { name: string; get(codes: string[], fetch: Fetch): Promise<Quote[]> }`：只返回取到的；整体失败就抛错
  - `CHAINS: Record<MarketKind, Provider[]>`（阶段 0 的推荐表）：
    - 美股 `[tencent, yahoo, sina]`；
    - A 股 `[tencent, yahoo, sina]`；
    - 基金 `[sinaFund, fundApp, fundF10]`（F10 要带 `Referer: https://fundf10.eastmoney.com/`）
  - `Budget = { left: number }`：免费版每次请求最多 50 个外部请求，留 5 个余量，从 45 开始，每发一个减 1；用完后这次不再发，剩下的代码算没取到
  - `fetchKind(kind, codes, fetch, budget): Promise<{ quotes: Quote[]; missing: string[] }>`：按源链依次要，前一个源缺的代码交给下一个
  - `FxRates = { date: string; usd: number; hkd: number; source: string }`
  - `fetchFxLatest(fetch, budget): Promise<FxRates>`：frankfurter → Yahoo（`CNY=X`、`HKDCNY=X`）→ 新浪即期（`fx_susdcny`、`fx_shkdcny`）
  - `fetchFxOn(date, fetch, budget): Promise<FxRates>`：frankfurter 历史 → Yahoo 日线（日期对齐：Yahoo 汇率日线的时间戳是前一天 23:00 UTC）。新浪没有历史汇率

- [ ] **Step 1：写失败的测试**（用假的 fetch，按 URL 返回样例或报错）：
  - 主用源成功时，只调用主用源；
  - 腾讯只返回其中一只时，缺的那只交给 Yahoo，结果合并；
  - 腾讯超时或 5xx 时整组换 Yahoo；
  - 全部失败时，`missing` 包含所有代码；
  - 新浪请求带上 `Referer: https://finance.sina.com.cn`；
  - 基金结果的 `asOf` 是净值日期；
  - 基金：新浪缺的交给天天基金 App，再缺的交给 F10；
  - 腾讯整个挂掉、要查 60 只美股时，Yahoo 最多发到预算用完，剩下的交给新浪（新浪一次能查多只）；同时在途的请求不超过 4 个；
  - 汇率：frankfurter 失败时换 Yahoo，再失败换新浪即期；
  - 历史汇率遇到周末，返回前一个工作日，以返回的日期为准。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
  - 每个请求都用 `AbortSignal.timeout(5000)`，并带浏览器的 User-Agent。
  - 腾讯、新浪、天天基金 App 一次能查多个代码；Yahoo 和 F10 一次一个，最多同时 4 个（Worker 每次请求最多同时开 6 个连接）。
- [ ] **Step 4：跑测试** → PASS

### Task 3：缓存和交易时段

**Files:**
- Create: `worker/src/cache.ts`、`worker/src/sessions.ts`，以及对应的测试

**Interfaces:**
- Produces：
  - `freshMs(kind: MarketKind | 'fx', now: Date): number`：交易时段内 15 分钟，否则 6 小时
    - 美股：美东时间周一到周五 9:30–16:00；
    - A 股、基金：北京时间周一到周五 9:30–15:00；
    - 汇率：周一到周五全天。
  - `getQuotes(kind, codes, deps: { kv: Kv; fetch: Fetch; now: () => Date }): Promise<{ quotes: (Quote & { stale: boolean })[]; missing: string[] }>`
    - KV 里每个市场一个键 `quotes:<kind>`，值是 `{ [code]: Quote & { fetchedAt } }`；
    - 新鲜的直接返回，其余去要；要到了就合并后写回（只写一次；什么都没要到就不写）；
    - 写入失败（比如超出每天 1000 次的免费额度）时照常返回结果；
    - 没要到但有旧的，返回旧值并标 `stale: true`；
    - 什么都没有的，放进 `missing`。
  - `getFx(date: string | null, deps): Promise<FxRates & { stale: boolean }>`
    - 当天的汇率键是 `fx:latest`，新鲜度按交易时段；
    - 历史汇率键是 `fx:YYYY-MM-DD`，不会变，一直有效；
    - 都失败且没有缓存时抛错。

- [ ] **Step 1：写失败的测试**（假 KV 用 Map，时钟可调）：
  - 15 分钟内第二次请求不再访问外部；
  - 收盘后 6 小时内也不访问；
  - 过期后重新要；
  - 源全挂时返回旧值，并且 `stale: true`；
  - 一次请求只写一次 KV；全部没取到时不写；
  - KV 写入报错时，照常返回刚取到的价格；
  - 夏令时切换周（2026-03-09、2026-11-02）的开盘时间判断正确；
  - 历史汇率第二次请求直接读缓存。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑测试** → PASS

### Task 4：HTTP 接口

**Files:**
- Create: `worker/src/index.ts`、`worker/src/index.test.ts`

**Interfaces:**
- Produces（HTTP）：
  - `GET /quote?us=VOO,QQQ&cn=513500&fund=050025` →
    `{ quotes: [{ code, price, currency, asOf, source, stale }], missing: string[] }`
    - 6 位数字代码分不清是 A 股还是场外基金，所以按市场分参数，不用 BUILD_PLAN 举例里的 `codes=`；
    - 每组最多 100 个代码，格式不对的返回 400。
  - `GET /fx` 和 `GET /fx?date=YYYY-MM-DD` →
    `{ date, rates: { USD, HKD }, source, stale }`，表示 1 单位外币值多少人民币；日期不能晚于今天。
  - `GET /health` → `{ ok: true }`
  - 跨域白名单：
    - `https://app.example.com`；
    - `http://localhost:*`、`http://127.0.0.1:*`；
    - 局域网 `http://192.168.*`、`http://10.*`、`http://172.16–31.*`（开发时手机测试用）。
    - 白名单外不返回 `Access-Control-Allow-Origin`。
  - `handle(request, env, deps)` 可以注入 fetch 和时钟；默认导出用真实的 fetch 和时钟。

- [ ] **Step 1：写失败的测试**：
  - 三种市场混合请求，结果正确；
  - 格式错误返回 400；
  - 未知路径返回 404；
  - 预检（OPTIONS）对白名单 origin 返回 204 并带上允许的头；
  - 白名单外的 origin 不带 ACAO；
  - 内部出错返回 500，不泄露细节；
  - 历史汇率传了未来日期返回 400。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑测试** → PASS；`npm run typecheck` 通过

### Task 5：部署（先征得用户同意）

- [ ] 建 KV：`wrangler kv namespace create QUOTES`，把 id 写进 `worker/wrangler.jsonc`。
- [ ] 部署：`wrangler deploy --config worker/wrangler.jsonc`。`workers_dev` 和 `preview_urls` 都关掉，只绑定 `api.example.com`。
- [ ] 线上核对：
  - `/health` 正常；
  - `/quote?us=VOO,BRK.B&cn=513500,159915&fund=050025` 都取到；
  - 第二次请求很快，说明命中了缓存；
  - `/fx` 和 `/fx?date=` 正常；
  - 白名单外的 origin 拿不到跨域许可。

### Task 6：App 用真实行情、汇率和日期

**Files:**
- Create:
  - `src/app/quotesApi.ts`、`src/app/quotesApi.test.ts`
  - `src/pages/perf/quoteStatus.ts`、`src/pages/perf/quoteStatus.test.ts`
- Modify:
  - `src/domain/dates.ts`（加 `beijingDate`，带测试）
  - `src/app/store.ts`（`refreshQuotes` 走接口，加 `quotesError`、`fxLiveOn`，今天用 `beijingDate(deps.now())`）
  - `src/app/persistence.ts`（`emptyData` 的价格和净值日期为空，汇率先用默认值；本机的 `quotes` 加存 `fxLiveOn`，第二天离线打开时才知道今天还没取过汇率）
  - `src/pages/perf/PerfPage.tsx`（状态行）
  - `src/env.d.ts`（加 `VITE_API_BASE`）

**Interfaces:**
- Consumes：Task 4 的 HTTP 接口。
- Produces：
  - `interface QuotesApi { quotes(req: { us: string[]; cn: string[]; fund: string[] }): Promise<QuotesReply>; fx(date?: string): Promise<FxReply> }`
  - `createQuotesApi(base: string, fetchImpl?): QuotesApi`
  - `quoteRequest(instruments)`：品种目录里全部非现金品种（预置 + 自己加的），按 `market` 分到 us / cn / fund。
    - 不能只取持有的：「投入一笔钱」只推荐有价格的品种（`contribution.ts` 的 `canBuy`），没持有的品种也要有价格。
    - 预置品种 20 多个，Worker 按市场整组缓存，多取几个代价很小。
  - `beijingDate(now: Date): string`
  - `quoteStatusText({ refreshing, updatedAt, error, usdCny }): string`
  - 新的状态字段：`quotesError: boolean`、`fxLiveOn: string | null`（最后一次联网取到汇率的北京日期）

- [ ] **Step 1：写失败的测试**：
  - 接口客户端：拼出的 URL 正确，回应解析正确，非 200 时抛错；
  - `refreshQuotes`：
    - 成功时更新价格、汇率、场外基金的净值日期（来自 `asOf`，持仓页已经会显示）、更新时间，并设 `fxLiveOn` 为今天；
    - 同时把 `today` 更新成北京时间的今天（App 开着过了零点）；
    - 接口失败时价格不变，`quotesError` 为 true，更新时间不变；
    - 有 `stale` 时也算行情暂不可用，`stale` 的汇率不设 `fxLiveOn`；
    - 只有个别代码在 `missing` 里（数据源都不认识）时，其余照常更新，不算行情暂不可用；全部代码都在 `missing` 里才算；
    - 冷启动（`App.tsx` 已经会调用）和校准保存后（`CalibrationSheet` 已经会调用）都走这里，不用改调用方；
  - 状态行：
    - 成功：`已更新 21:05 · USD/CNY 6.7034 · 场外基金为 T-1 净值`；
    - 失败：`行情暂不可用 · 显示的是 21:05 的价格`；
    - 从来没成功过：`行情暂不可用`；
  - `beijingDate`：UTC 16:30 已经是北京的第二天；
  - 新账号的价格为空，估值按成本，不用示例价格。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**。演示用的示例数据仍然带示例价格。
- [ ] **Step 4：全量测试 + 类型检查** → PASS

### Task 7：离线流水上传前换成当天汇率

**Files:**
- Modify:
  - `src/app/localDb.ts`（`OutboxRow` 加 `fxPending?: boolean`）
  - `src/app/persistence.ts`（入队时标记；`LocalController` 加 `updateFx(changes)`）
  - `src/app/sync.ts`（上传前修正）
  - `src/app/session.ts`（把 `QuotesApi.fx` 接给同步引擎）
- Test: `src/app/persistence.test.ts`、`src/app/sync.test.ts`

**Interfaces:**
- Produces：
  - 入队规则：新流水入队时，如果 `s.fxLiveOn !== s.today`（今天还没联网取到汇率），标 `fxPending: true`。
  - `SyncDeps.fxOn?: (date: string, currency: 'USD') => Promise<number | null>`
  - 上传时按顺序处理：
    - 标了 `fxPending` 的非人民币流水，先查记账当天的汇率，改好本机库和界面后再上传；
    - 查不到时，这笔和之后的流水都留在队列里，前面的照常上传，下次再试；
    - 人民币流水不用查。
  - 只改还没上传的流水，云端的流水仍然只增不改（README 明确要求上传前更新 fx_to_cny）。

- [ ] **Step 1：写失败的测试**：
  - 今天没联网取过汇率时记的美元入金，入队标了 `fxPending`；联网取过以后记的不标；
  - 上传前按记账日期换成当天汇率，云端收到的是新汇率，本机和界面也改了；
  - 查不到汇率时，这笔和之后的都不上传、留在队列里，之前的照常上传；
  - 人民币流水不查汇率。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：全量测试 + 类型检查** → PASS

### Task 8：核对

- [ ] `npx vitest run`、`npm run build` 都通过。
- [ ] 变异检查，下面每项改坏后都要有测试失败：
  - 缺的代码不交给下一个源；
  - 全挂时不返回旧值；
  - 交易时段判断（含夏令时）；
  - KV 一次请求写多次；KV 写失败时整个请求报错；
  - 外部请求预算用完还继续发；
  - 跨域白名单放开；
  - 失败时清空价格；
  - 没取到汇率也不标 `fxPending`；
  - 查不到汇率也上传；
  - 「今天」不按北京时间。
- [ ] 浏览器（5199）：
  - 收益页显示真实价格，状态行是 `已更新 … · USD/CNY 6.7… · 场外基金为 T-1 净值`；
  - 下拉刷新后更新时间变了；
  - 临时把 `VITE_API_BASE` 指到一个不存在的地址：不崩溃，显示「行情暂不可用」，价格还在。
- [ ] 更新台账，列出手动验收步骤。
