# 阶段 6：AI 投顾（DeepSeek）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- 用自己的 DeepSeek Key 和 AI 讨论自己的组合，回复逐字流式显示。
- Key 用 WebCrypto 加密后只存在这台设备上（这个账号的本机库），不上传、不进备份、不打日志；下次打开 App 直接进入对话。
- 每次提问，把回答要求和计划、持仓、收益的文字摘要（不含账户号）一起发给模型。
- 对话记录本地优先：先存本机，联网后同步到 Supabase 的 `ai_conversations` / `ai_messages`。左上角抽屉显示历史对话，关掉 App 再打开还在，换设备也在。
- 「联网分析」开关只改提示词里的一句。

**Architecture:**
- **浏览器直连 DeepSeek**（决定 1）：测试连接（阶段 1c 已经是直连）和对话，都由浏览器直接请求用户填的 https 接口地址，Key 只放在 `Authorization` 头里，不经过 Worker。
  - 2026-10-03 核实：DeepSeek 的 `/chat/completions` 对 `https://app.example.com` 放行跨域，预检允许 `POST`、`authorization`、`content-type`；错误 Key 返回的 401 也带跨域头。
- **Key 保管**（`src/app/aiVault.ts`）：
  - 每个账号的本机库加一张 `vault` 表。
  - 第一次保存时生成一把不可导出的 AES-GCM 密钥（`CryptoKey` 对象直接存进 IndexedDB），用它加密 Key，库里只有密文。
  - `Session` 提供这个保管箱；退出登录时清空（决定 3）。
- **对话数据**：
  - 类型和行格式放 `src/domain/types.ts`、`src/domain/rows.ts`；主状态 `AppState` 加 `aiConversations`、`aiMessages`。
  - 写回本机和待同步队列沿用 `persistence.ts`，新增两种队列项 `aiConversation`、`aiMessage`。
  - 同步时，流水和设置那一轮做完后，再单独同步 AI，有自己的拉取游标。AI 这一步失败，不影响流水和设置的同步。
- **流式请求**（`src/pages/ai/chatStream.ts`）：
  - `POST {接口地址}/chat/completions`，`stream: true`。
  - 按 SSE 逐行解析：跨网络块拼接，忽略注释行和 `reasoning_content`，读到 `[DONE]` 结束。
  - 出错分类沿用测试连接：HTTP 状态、超时、网络；另加「中途断开」和「已取消」。
- **提示词**（`src/pages/ai/aiContext.ts`）：纯函数生成回答要求和组合摘要（格式同原型 `this._ctx`）；对话取最近 8 条（同原型）。
- **AI store**：
  - 管表单、测试、连接、联网开关，以及流式回复的草稿和出错提示。
  - 会话列表从 `AppState` 读。
  - `ask()` 先存问题，再流式显示回复，完成后存回复。

**Tech Stack:** React 19、Zustand、Dexie、WebCrypto（浏览器自带）、Supabase（PostgREST、RLS）、Vitest + Testing Library、PGlite、fake-indexeddb。不新增依赖。

**Spec:**
- BUILD_PLAN 阶段 6 第 1–6 条和验收；
- README：
  - 「5. AI 投顾」（首次进入、对话页、历史对话抽屉、已读取标签、联网分析、推荐问题、回车发送）；
  - 「技术栈 · AI 投顾」；
  - 「数据模型」（`ai_conversations` / `ai_messages`，AI Key 不入库，只保存在本机）；
- 原型 v5：
  - `ask()`（第 840–850 行：提示词，最近 8 条对话）；
  - `this._ctx`（第 1008–1015 行：摘要格式）；
- CLAUDE.md：
  - 「用户的 AI Key 只加密保存在本机，永远不上传，也不打日志。」
  - 「本地优先：离线也能记账，先写本地 IndexedDB、立即显示，联网后自动同步」；
- 阶段 1c-AI 计划：DeepSeek 允许跨域，测试连接直连；Key 只发给用户填的 https 地址。

## Global Constraints

- 「用户的 AI Key 只加密保存在本机，永远不上传，也不打日志。」
  - Key 不进主状态、不进备份、不进 Supabase、不进 console 和错误提示；
  - 只作为 `Authorization` 头，发给用户填的 https 接口地址。
- 接口地址必须以 `https://` 开头，否则不发请求（沿用 `precheck`）。
- 「必须勾选数据授权：同意把汇总数据发给 DeepSeek，不发送账户号和登录信息」：没勾选不能开始对话，也不发对话请求。
- 「测试成功且已勾选授权后，「开始对话」按钮才可用」。
- 测试连接的提示：成功（延迟、可用模型）、401 鉴权失败、402 余额不足、其他错误和超时显示原因（阶段 1c 已有，对话出错时沿用同样的说法）。
- 消息只增不改：同一条重复上传只记一次（同流水）。
- 本地优先：离线能看历史对话；问新问题要联网。
- 颜色、字体、圆角只用 `tokens.css` 变量；文案简体中文，冷静简洁。
- 新迁移由用户在 Supabase SQL Editor 里运行；不提交 commit。
- 单元测试不走网络：`fetch` 由测试替换。

## 需要用户确认的决定

1. **浏览器直连 DeepSeek，不走 Worker 转发**。BUILD_PLAN 第 2 条、README 技术栈和 CLAUDE.md 都写的是「Worker 转发」，README 写明的原因是「避免浏览器跨域限制」。这个前提不成立：今天核实过，DeepSeek 允许我们的网址直接调用对话接口。直连的好处：
   - Key 不经过我们的服务器，正好符合「永远不上传」；
   - 国内直连 DeepSeek，比绕道 Cloudflare 快，流式回复也不会被中转缓冲；
   - 不占 Worker 免费额度（每次请求 10 毫秒 CPU、每天 10 万次请求）。

   验收「Worker 日志里看不到 Key」：Key 根本不会发给 Worker。测试会确认对话请求只发往你填的接口地址；你也可以在浏览器的网络面板里看到，AI 请求都去了 `api.deepseek.com`。
   - 以后如果 DeepSeek 不再允许跨域，或者要接入不允许跨域的服务商，再加 Worker 转发。
   - 同意的话，README 技术栈那一句、CLAUDE.md 技术栈里的「AI 转发」一起改掉，README 修订记录记一条。
2. **Key 怎么保存**：第一次「开始对话」时，在这台设备上生成一把不能导出的加密密钥，用它加密你的 Key，两者都存在这个账号的本机库里。
   - 防得住：别人拷走浏览器数据或备份文件后，直接看到 Key。
   - 防不住：在这台设备上、这个网站里运行的恶意脚本，它可以直接用这把密钥解密。不另设密码时，只能做到这一步。
   - 下次打开 App 直接进入对话，不用再填。「更换 Key」会删掉保存的 Key。
3. **退出登录时，删掉这台设备上保存的 Key**（推荐）。对话记录保留，云端和本机都有；重新登录后再填一次 Key。
4. **对话记录本地优先、同步到云端**：存本机，联网后同步，换设备也能看到。离线能看历史，问新问题要联网。
   - 需要一个新迁移：给两张表加「服务器收到的时间」，供其他设备增量拉取；对话标题以最后修改为准。
   - 没运行迁移之前：对话照常存在本机，同步状态会显示失败，流水和设置照常同步；运行迁移后自动补传。
5. **保存哪些内容**：
   - 保存你的问题和完整的回复。
   - 开场白（「已连接 DeepSeek…总资产约…」）不保存，每次按当前数据生成。
   - 回复失败或中途断开时，显示原因，这条回复不保存；问题留着，可以再问一次。
   - 点「+ 新对话」后，第一次提问时才出现在历史里，空对话不保存。
6. **每次提问发给 DeepSeek 的内容**：
   - **回答要求**（同原型）：「你是用户的私人投资顾问，风格冷静、专业、直接。用中文回答，分 2-4 个要点，总长不超过 200 字，不用 markdown 标题和加粗。」加上联网那一句，最后是「最后一句提醒这不构成投资建议（很短）。」
   - **组合摘要**（同原型 `this._ctx`）：一律按人民币，不受显示币种和闭眼影响。
     - 总资产、净投入、累计收益；
     - 各资产当前占比和目标（未设目标的注明）；
     - 偏离阈值、检查周期，本期是否已检查；
     - 各账户的名称、类型和占比（App 里本来就没有账户号）；
     - 近 1 年各资产表现（记录不满 1 年时写「自 某日 以来」）；
     - 退休目标：年支出、目标金额、预期年化、通胀、预计达成年份。
   - 这次对话最近 8 条消息（含新问题）。
7. **「联网分析」**：第一期只改提示词里的一句。
   - 开：「可以结合你了解的近期市场与宏观情况。」关：「只基于用户数据回答。」
   - 等待时的文字去掉「并查询最新市场信息」，因为并没有真的联网查询。
   - 开关状态存在这台设备上。
8. **看示例数据时**：AI 投顾照常可用，讨论的是示例组合；历史里是原型的两段示例对话；演示期间的对话不保存。

## Review Focus

1. **Key 泄露**：Key 不能出现在主状态、本机库明文、备份、Supabase、console、错误提示里，只发给 https 接口地址。→ Task 3、Task 6
2. **流式回复的边界**：
   - 一个 JSON 被拆在两个网络块里；
   - 注释行（`: keep-alive`）、只有 `reasoning_content` 的块；
   - 没有 `[DONE]` 就结束、中途断开。
   → Task 4
3. **回复进行中**：
   - 切换对话、开新对话：回复写回原来的对话；
   - 更换 Key、退出登录：停止请求，不保存半截回复。
   → Task 6
4. **两台设备**：
   - 一台设备的对话同步后出现在另一台：消息不重复，按时间排序；
   - 同一对话两台设备各问一句：两组问答都保留。
   → Task 2
5. **没运行迁移时**：对话照常存本机，流水和设置的同步不受影响；运行迁移后补传。→ Task 2

---

### Task 1：对话的数据类型、行格式和迁移

**Files:**
- Create: `supabase/migrations/20261003100000_ai_sync.sql`
- Modify:
  - `src/domain/types.ts`（`AiConversation`、`AiMessage`）
  - `src/domain/rows.ts`、`src/domain/rows.test.ts`
  - `src/app/remoteSchema.test.ts`（导入新迁移）
  - `docs/supabase-setup.md`（「阶段 6：AI 对话同步（只做一次）」）

**Interfaces:**
- `interface AiConversation { id: string; title: string; createdAt: string; updatedAt: string }`：`updatedAt` 是最后一条消息的时间。
- `interface AiMessage { id: string; conversationId: string; role: 'user' | 'assistant'; content: string; createdAt: string }`
- `AiConversationRow { user_id; id; title; created_at; updated_at; server_updated_at? }`
- `AiMessageRow { user_id; id; conversation_id; role; content; created_at; inserted_at? }`
- 四个映射函数：
  - `aiConversationToRow(c, userId)`、`rowToAiConversation(r)`；
  - `aiMessageToRow(m, userId)`、`rowToAiMessage(r)`；
  - 读回的时间用 `isoTime` 统一成 `…Z` 格式。
- 迁移内容（可重复运行）：
  - `ai_conversations` 加 `server_updated_at timestamptz not null default now()`，并装上 `keep_latest` 触发器（`drop trigger if exists` 后再建）；
  - `ai_messages` 加 `inserted_at timestamptz not null default now()`，建索引 `(user_id, inserted_at)`。

- [ ] **Step 1：写失败的测试**：
  - 两种行格式来回转换不丢字段，时间统一成 `Z` 格式；
  - PGlite，跑完迁移后：
    - 新建对话时写上 `server_updated_at`；
    - 用更早的 `updated_at` 更新会被跳过，更晚的生效；
    - 新增消息写上 `inserted_at`；
    - 同一条消息重复插入（`on conflict do nothing`）只有一条；
    - 别的用户读不到、写不进；
    - 迁移再跑一次不报错。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑测试 + domain 类型检查** → PASS

### Task 2：对话存本机、同步到云端

**Files:**
- Modify:
  - `src/app/localDb.ts`：第 4 版，加 `aiConversations: 'id'`、`aiMessages: 'id, conversationId'`、`vault: 'name'`；`OutboxKind` 加 `'aiConversation' | 'aiMessage'`
  - `src/app/store.ts`（新字段和 `recordAiMessage`）
  - `src/app/persistence.ts`（`LocalData`、读写、写回订阅、`applyAi`）
  - `src/app/remote.ts`、`src/app/fakeRemote.ts`
  - `src/app/sync.ts`
  - `src/mock/ai.ts`（两段示例对话改成记录格式）
- Test: `src/app/persistence.test.ts`、`src/app/sync.test.ts`、`src/app/session.test.ts`、`src/app/store.test.ts`

**Interfaces:**
- `AppState.aiConversations: AiConversation[]`、`AppState.aiMessages: AiMessage[]`
- `recordAiMessage(i: { conversation: AiConversation; message: AiMessage }): void`：在同一次更新里，新增或替换这个对话，再追加这条消息（同 id 已有就跳过）。
- 写回订阅：
  - 新增或改过的对话，原样写入（`updatedAt` 用对话自己的），并进队列；
  - 新增的消息 `bulkAdd`，并进队列。
  - 示例模式下暂停，同现有逻辑。
- `Remote`：
  - `upsertAiConversations(rows)`：云端只接受更晚的 `updated_at`；
  - `insertAiMessages(rows)`：重复的跳过；
  - `pullAi(since: string | null): Promise<{ conversations: AiConversationRow[]; messages: AiMessageRow[] }>`：按 `server_updated_at` / `inserted_at` 增量拉取。
- `LocalController.applyAi(conversations, messages)`：
  - 对话以 `updatedAt` 较晚的为准；本机没有的消息加进来；
  - 写进本机库，但不进队列、不触发写回。
- 同步引擎：
  - 现有的上传只处理、只删除流水和设置那几类队列项。现在它会删掉队列里所有项，必须改。
  - 流水和设置的上传、拉取做完后，再做 AI 这一步：上传 AI 队列项，再按本机记的 `aiPulledAt` 往回多看 2 分钟拉取。
  - AI 这一步出错时，这一轮显示失败、按间隔重试；流水和设置已经同步的部分不受影响。
  - 「待同步 N 笔」只数流水，不变。
- `sampleData`：带上两段示例对话；`emptyData`：没有对话。

- [ ] **Step 1：写失败的测试**：
  - 记一问一答后：
    - 本机库里有这个对话和两条消息，队列里有对应项；
    - 同步后，云端（fakeRemote）有它们，队列清空；
  - 另一台设备：同步后 store 里出现同样的对话和消息，消息按时间排序；
  - 同一对话两台设备各问一句：两边同步后都有两组问答；标题以最后修改为准；
  - 同一条消息重复上传，云端只一条；
  - 云端没有新列（fakeRemote 的 AI 拉取报错）时：
    - 流水照样上传和拉取；
    - 状态显示失败，AI 队列项留着；
    - 云端恢复后，下一轮补传；
  - 现有的上传不再删掉 AI 的队列项；
  - 示例模式：
    - 有两段示例对话；
    - 演示中提问不进本机库、不进队列；
    - 结束后换回账号自己的对话；
  - 退出登录换成空账号：对话清空；
  - 「待同步」数字不含 AI。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑全部测试** → PASS

### Task 3：Key 加密保存

**Files:**
- Create: `src/app/aiVault.ts`、`src/app/aiVault.test.ts`
- Modify:
  - `src/app/session.ts`（`Session.aiVault`）
  - `src/app/boot.ts`（退出登录时清空保管箱）
- Test: `src/app/session.test.ts`、`src/app/boot.test.ts`

**Interfaces:**
- `interface AiSaved { base: string; model: string; key: string; consent: boolean; web: boolean }`：`key` 为空字符串表示没有保存 Key。
- `interface AiVault { load(): Promise<AiSaved | null>; save(s: AiSaved): Promise<void>; clear(): Promise<void> }`
- `createAiVault(db: LocalDb, subtle: SubtleCrypto = crypto.subtle): AiVault`
- `vault` 表只有一行 `name: 'ai'`：
  - 内容：`base`、`model`、`consent`、`web`、`cryptoKey`（不可导出的 AES-GCM 256）、`iv`（每次保存重新生成）、`cipher`（Key 的密文）；
  - `key` 为空时，不存 `iv` 和 `cipher`。
- `load()` 解密失败（数据损坏、密钥丢失）时，返回不带 Key 的设置，不抛错，也不打日志。
- 退出登录：先 `aiVault.clear()`，再关闭本机库。

- [ ] **Step 1：写失败的测试**（真实 WebCrypto + fake-indexeddb）：
  - 保存后读回同样的 Key、地址、模型、授权、联网开关；
  - 把本机库所有表的所有行转成文字，搜不到 Key；
  - 存的密钥 `extractable` 为 `false`；
  - 两次保存的 `iv` 不同；
  - 保存空 Key 后，读回的 Key 为空，地址和模型还在；
  - 密文被改坏时，读回不带 Key，不抛错；
  - `clear()` 后读回 `null`；
  - 退出登录后，这个账号的保管箱是空的；
  - 两个账号的保管箱互不相通。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑测试** → PASS

### Task 4：流式对话请求

**Files:**
- Create: `src/pages/ai/chatStream.ts`、`src/pages/ai/chatStream.test.ts`
- Modify: `src/pages/ai/aiText.ts`、`src/pages/ai/aiText.test.ts`（对话出错的提示）

**Interfaces:**
- `type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }`
- `type ChatOutcome`：
  - `{ kind: 'ok'; text: string }`
  - `{ kind: 'http'; status: number }`
  - `{ kind: 'timeout' }`、`{ kind: 'network' }`
  - `{ kind: 'broken' }`：收到一部分后中断
  - `{ kind: 'aborted' }`：调用方取消
- `streamChat(i: { base: string; key: string; model: string; messages: readonly ChatMessage[]; signal?: AbortSignal; onDelta: (text: string) => void }, deps?: ChatDeps): Promise<ChatOutcome>`
- `ChatDeps { fetch; connectTimeoutMs: 30_000; idleTimeoutMs: 60_000 }`：30 秒没有响应头算超时；之后 60 秒没有任何数据（含 keep-alive 注释）也算超时。
- 请求：
  - `POST {base 去掉末尾斜杠}/chat/completions`；
  - 头只有 `Authorization: Bearer <key>`、`Content-Type: application/json`；
  - body 是 `{ model, messages, stream: true }`。
- `createSseDecoder(): { push(chunk: string): string[]; end(): string[] }`：返回 `data:` 后面的内容。
  - 处理 `\r\n`，以及被拆开的行；
  - 忽略注释行和空行。
- `chatErrorText(outcome): string | null`（`aiText.ts`）：
  - 401：「401 鉴权失败：API Key 无效或已过期，可以在历史对话里「更换 Key」」
  - 402：「402 余额不足：请到 DeepSeek 控制台充值」
  - 429：「请求太频繁：稍等一会儿再问」
  - 5xx：「DeepSeek 暂时不可用（503），稍后再试」（括号里是实际状态码）
  - 其他状态：「422 请求失败：请检查接口地址和模型」（数字是实际状态码）
  - 超时：「等待回复超时：请检查网络后再问一次」
  - 网络：「无法连接 DeepSeek：请检查网络」
  - 中断：「回复中断：网络不稳定，请再问一次」
  - 取消：`null`，不提示。

- [ ] **Step 1：写失败的测试**（`fetch` 用测试替身，返回 `ReadableStream`）：
  - 正常流：
    - 多个网络块，其中一个 JSON 被拆在两块里；
    - 夹着 `: keep-alive` 注释和只有 `reasoning_content` 的块；
    - `onDelta` 依次收到每段文字，`ok.text` 是全文；
  - 没有 `[DONE]` 但流正常结束：照样 `ok`；
  - 401 / 402 / 429 / 503：返回 `http`，不读正文；
  - 30 秒没有响应头 → `timeout`（假计时器）；
  - 收到一部分后 60 秒没有数据 → `timeout`；
  - 收到一部分后流报错 → `broken`；
  - 调用方取消 → `aborted`；
  - `fetch` 直接失败 → `network`；
  - 请求的地址、方法、头、body 和上面一致，`credentials` 不带 cookie；
  - 无法解析的 `data:` 行跳过，不中断；
  - 各种结果的提示文案，提示里不含 Key。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑测试** → PASS

### Task 5：提示词和组合摘要

**Files:**
- Create:
  - `src/pages/ai/aiContext.ts`、`src/pages/ai/aiContext.test.ts`
  - `src/pages/ai/useAiContext.ts`（从计划页、收益页的数据钩子取数）

**Interfaces:**
- `portfolioSummary(i: SummaryInput): string`，`SummaryInput` 包括：
  - `totalCny`、`netInvestedCny`；
  - `slots: { name: string; curPct: number; tgtPct: number; untargeted: boolean }[]`；
  - `threshold`、`periodLabel`（月 / 季度 / 年）、`checkedThisPeriod`；
  - `accounts: { name: string; kind: string; sharePct: number }[]`：`kind` 是人民币券商 / 美元券商 / 银行；
  - `performance: { since: string | null; items: { name: string; pct: number | null }[] }`：`since` 为 `null` 表示满 1 年；
  - `retirement: { annualSpend; targetAmount; expectedReturnPct; inflationPct; yearTarget: number | null }`。
- 摘要每一行（同原型 `this._ctx`，人民币）：
  - `总资产约 ¥123.4 万，净投入 ¥100.0 万，累计收益 ¥23.4 万（+23.4%）。`（不到 1 万时写整数元）
  - `目标组合 vs 当前：标普 500 38.2%/40%；…；全球除美 4.1%/0%（未设目标）`
  - `偏离阈值 ±3%，季度检查，本季度还没检查。`
  - `账户：招商证券（人民币券商）占 30.0%；…`
  - `近 1 年各资产表现：标普 500 +12.3%；…`（不满 1 年时为 `自 2026-10-01 以来各资产表现：…`）
  - `退休目标：年支出 ¥30 万，目标 ¥800 万，预期年化 6%，通胀 2.5%，预计 2049 年达成。`（达不到时写「按当前假设无法达成」）
- `systemPrompt(i: { web: boolean; summary: string }): string`：回答要求 + 联网一句 + 「用户组合数据：」+ 摘要。
- `chatMessages(i: { system: string; history: readonly AiMessage[]; question: string }): ChatMessage[]`：`system` 在最前；`history` 按时间取最近 7 条，加上新问题共 8 条（同原型）。
- `useAiContext(): string`：返回 `systemPrompt` 用的摘要，取数来自 `usePlanData`、`usePerfData('1年')`、账户列表。

- [ ] **Step 1：写失败的测试**：
  - 摘要和上面的格式逐行一致：未设目标的注明，退休达不到时的写法；
  - 测试数据里的账户 id 不出现在摘要里；
  - 不满 1 年时写「自 某日 以来」；
  - 闭眼、显示币种为美元时，摘要不变；
  - 联网开、关各一句；
  - `chatMessages`：
    - 超过 8 条时只留最近的；
    - 顺序不变，`role` 正确；
    - 新问题在最后。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑测试** → PASS

### Task 6：对话页接上真实回复和保存

**Files:**
- Modify:
  - `src/pages/ai/aiStore.ts`、`aiStore.test.ts`
  - `src/pages/ai/aiText.ts`（`busyText` 去掉「并查询最新市场信息」）
  - `src/pages/ai/types.ts`（去掉内存版的 `Conversation`，改用 `AppState` 里的记录）
  - `src/pages/ai/AiChat.tsx`、`ConversationDrawer.tsx`、`AiOnboarding.tsx`、`useWelcome.ts`、`ai.css`
  - `src/pages/ai/AiPage.test.tsx`
  - `src/app/boot.ts`（打开账号后 `attach`，退出登录时 `detach`）

**Interfaces:**
- `AiDeps` 增加：
  - `streamChat`（Task 4）；
  - `app: Pick<StoreApi<AppState>, 'getState'>`（读写对话，默认 `useAppStore`）。
- AI store 新增：
  - `attach(vault: AiVault): Promise<void>`：读出保存的设置；有 Key 就直接进入对话页。
  - `detach(): void`：停止进行中的请求，回到初始状态（退出登录时）。
  - `draft: { conversationId: string; text: string } | null`：正在流式显示的回复。
  - `error: { conversationId: string; text: string } | null`：回复失败的提示。
  - `welcome: { conversationId: string; text: string; time: string } | null`：这次打开 App 后新开的对话，显示开场白（不保存）。
- `connect(welcome, today)`：测试成功且已授权才执行；把地址、模型、Key、授权、联网开关存进保管箱，然后开一个新对话。保存失败时照常连接，提示「Key 没能保存在这台设备上，下次需要重新填写」。
- `ask(question, system)`：`system` 由页面传入 `systemPrompt({ web, summary: useAiContext() })`。
  1. 空问题或正在回复时忽略；
  2. 当前对话还没保存时，用问题的前 18 个字作标题新建；
  3. `recordAiMessage` 存问题；
  4. `streamChat`：边收边更新 `draft`；
  5. 成功后 `recordAiMessage` 存回复（对话的 `updatedAt` 同时更新）。失败时设 `error`，取消时什么都不提示；两种情况都不存回复。
- `newConversation()`：只换一个新的 `currentId`，不保存。
- `disconnect()`（更换 Key）：停止请求，保管箱里的 Key 清空，回到接入页；对话保留。
- `toggleWeb()`：同时存进保管箱。
- 页面：
  - 对话页的消息：当前对话的已存消息（按时间）。开场白在最前，只对 `welcome` 指定的对话显示；末尾是 `draft`，以及等待第一个字时的「AI 投顾正在分析…」，或 `error`。
  - 推荐问题：当前对话还没有消息时显示。
  - 抽屉：已保存的对话，按 `updatedAt` 从新到旧；每条显示「开始时间 · N 条消息」。

- [ ] **Step 1：写失败的测试**：
  - 开始对话后 Key 存进保管箱；换一个新的 AI store 接上同一个保管箱，直接是对话页；
  - 提问：
    - 请求发往 `{接口地址}/chat/completions`，`system` 含摘要，消息含最近几条和新问题；
    - 回复逐字出现（`draft` 一段段变长）；
    - 完成后对话和两条消息存进 `AppState`，标题是问题的前 18 个字；
  - 401 / 402 / 超时 / 中断：显示对应提示，不保存回复，问题还在；
  - 回复中：
    - 切换到别的对话：回复写回原来的对话；
    - 更换 Key：请求被取消，不保存半截回复；
    - `detach`（退出登录）：同上；
  - 没勾选授权时「开始对话」不可用（已有）；
  - 抽屉：
    - 按最后修改排序，显示条数；
    - 新对话第一次提问后才出现在列表里；
  - Key 只出现在发往接口地址的请求头里：
    - 不在 `AppState`、console、页面文字里；
    - 本机库里搜不到明文；
  - 「联网分析」开、关时，`system` 里的那一句跟着变；
  - 闭眼时，开场白里的总资产显示 `••••`（已有）。
- [ ] **Step 2：跑测试** → FAIL
- [ ] **Step 3：实现**
- [ ] **Step 4：跑全部测试** → PASS

### Task 7：核对和文档

**Files:**
- Modify（决定 1 同意后）：
  - `design_handoff_investment_manager/README.md`：技术栈「AI 投顾」那一句，加修订记录第 14 条；
  - `CLAUDE.md`：技术栈里的「AI 转发」。

- [ ] 全部测试、类型检查、构建通过。
- [ ] 变异检查，确认测试能抓到这些改坏：
  - Key 明文存进库；
  - 流式解析不拼接被拆开的行；
  - 超时不生效；
  - 没授权也能发请求；
  - 上传删掉了 AI 队列项；
  - 拉取游标不前进；
  - 退出登录不清空保管箱；
  - 回复失败时也保存。
- [ ] 整体自查（不派子代理）；列出验收步骤。浏览器里的检查需要你登录后自己走（我不能替你登录，也不能代填 Key）。
