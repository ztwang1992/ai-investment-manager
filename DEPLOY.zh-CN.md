# 部署说明

[English](DEPLOY.md) | **简体中文**

AI 投资管理器线上由四部分组成。这份文档记下全部配置项和以后更新的步骤；第一次搭建的细节见 [docs/supabase-setup.zh-CN.md](docs/supabase-setup.zh-CN.md)、[docs/worker-setup.zh-CN.md](docs/worker-setup.zh-CN.md)。下面用 `app.example.com`、`api.example.com` 代表你自己的域名。

| 部分 | 地址 | 放在哪里 |
|---|---|---|
| 前端（PWA） | `https://app.example.com` | Cloudflare Worker `invest-manager`（只有静态资源），关联 GitHub 仓库，推送 main 自动构建、部署 |
| 行情、汇率、每日快照 | `https://api.example.com` | Cloudflare Worker `invest-api` |
| 数据和登录 | Supabase 项目 | Supabase（数据库 + 邮箱 6 位验证码登录） |
| AI 投顾 | `https://api.deepseek.com` | 浏览器直接请求，Key 只加密保存在手机上，不经过我们的服务器 |

域名的 DNS 要在 Cloudflare。`app`、`api` 两条记录分别由两个 Worker 的自定义域名自动维护，不要手动改。两个 Worker 都关闭了 `*.workers.dev` 默认地址和预览地址，只用自己的域名。

## 密钥放在哪里

| 密钥 | 放在哪里 | 不能出现在哪里 |
|---|---|---|
| Supabase URL、publishable key（`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`） | 本机 `.env.local`；前端 Worker 的构建变量 | git 仓库（`.env.local` 已被忽略）。它们本来就会出现在网页里，不算机密 |
| Supabase secret key（`sb_secret_` 开头） | 行情 Worker 的 secret `SUPABASE_SECRET_KEY` | git 仓库、前端、前端的构建变量、聊天记录 |
| DeepSeek API Key | 用户手机上，加密保存在本机库 | 任何服务器、git 仓库、日志 |
| 发信服务（SMTP）的密码 | Supabase 控制台的 SMTP 设置 | git 仓库 |

## 前端：Cloudflare Worker `invest-manager`（静态资源）

**配置**：仓库根目录的 `wrangler.jsonc`。

- 静态资源目录 `dist`，不跑代码；
- 关闭 workers.dev 和预览地址；
- 自定义域名不写在这里，在控制台添加（见下），部署时不会改动它。

**构建**（Workers & Pages → `invest-manager` → Settings → Builds）：

- Git 仓库：放这份代码的 GitHub 仓库，Branch control：`main`
- Build command：`npm run build`（先做类型检查，再 `vite build`）
- Deploy command：`npx wrangler deploy`
- Root directory：`/`
- Node 版本：仓库里的 `.node-version`（24）
- Build variables：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_API_BASE`（行情 Worker 的地址，比如 `https://api.example.com`），值同本机 `.env.local`。它们在构建时写进网页，改了要重新构建。没设 `VITE_API_BASE` 就不取行情。

**自定义域名**：`invest-manager` → Domains → `app.example.com`。

**响应头**：`public/_headers`，构建时复制到 `dist/_headers`，Worker 的静态资源照样生效。

- 所有页面带几项安全响应头：不许被嵌入、不猜文件类型、限制 referrer、关闭摄像头 / 麦克风 / 定位；
- `/assets/*`（文件名带哈希）长期缓存；`sw.js`、`registerSW.js`、`manifest.webmanifest` 每次都确认最新。

**更新前端**：

1. 本机改代码，跑 `npm test` 和 `npm run build`，都通过；
2. 提交并推送到 main：Cloudflare 自动构建、部署，一两分钟后上线；
3. 手机上的 App（PWA）下次打开时自动换上新版本。没换的话，把 App 完全关掉再打开一次。

**构建失败时**：`invest-manager` → Deployments → Build history → View build，看构建日志。本机复现：在一个干净的目录里 `git clone` 仓库，`npm ci && npm run build`。

**回滚**：`invest-manager` → Deployments → 版本列表里选上一个版本，部署它。几秒生效，代码仓库不受影响。

## 行情 Worker：`invest-api`

配置模板是 `worker/wrangler.example.jsonc`：复制成 `worker/wrangler.jsonc`（git 会忽略它），填好四处：`routes` 的域名、`kv_namespaces` 的 id、`APP_ORIGIN`、`SUPABASE_URL`。

- 自定义域名（比如 `api.example.com`）；workers.dev 和预览地址都关闭；
- KV `QUOTES`：缓存行情和汇率（交易时段 15 分钟）；
- 定时任务：UTC 22:00、23:00（北京时间 06:00、07:00）写前一天的每日快照，07:00 只补跑还没写上的用户；
- 变量 `APP_ORIGIN`、`SUPABASE_URL`；secret `SUPABASE_SECRET_KEY`；
- 跨域：允许 `APP_ORIGIN` 里的前端地址（几个用逗号隔开）；本机和局域网的开发页面总是允许（`worker/src/index.ts` 的 `DEV_ORIGINS`）。

常用命令（在项目根目录运行）：

```bash
npx wrangler deploy --config worker/wrangler.jsonc
```

```bash
npx wrangler secret put SUPABASE_SECRET_KEY --config worker/wrangler.jsonc
```

```bash
npx wrangler secret list --config worker/wrangler.jsonc
```

```bash
npx wrangler tail --config worker/wrangler.jsonc
```

行情 Worker 会打包 `src/domain/` 里共用的计算代码：改了快照、流水推导相关的函数后，要重新 `wrangler deploy`。它不跟着 GitHub 推送自动部署，要手动运行上面的命令。

## Supabase

**迁移**：在 SQL Editor 里按顺序运行，每个都可以重复运行：

1. `supabase/migrations/20260930000000_init.sql`：建表、RLS、全局预置（阶段 2，只在空项目上运行一次）
2. `supabase/migrations/20261002000000_presets.sql`：扩充品种预置（阶段 3）
3. `supabase/migrations/20261003000000_plan_rebalanced.sql`：记下最后一次再平衡（阶段 5）
4. `supabase/migrations/20261003100000_ai_sync.sql`：AI 对话同步（阶段 6）

以后加新迁移：先在 SQL Editor 运行，再推送用到它的前端代码。

**Authentication**：

- URL Configuration：Site URL 为 `https://app.example.com`；Redirect URLs 为 `https://app.example.com/**`。用验证码登录不经过跳转链接，本机开发不需要加 localhost。
- 登录方式：邮箱 6 位验证码（Magic Link 模板改成只发验证码），见 [docs/supabase-setup.zh-CN.md](docs/supabase-setup.zh-CN.md) 第三节。
- 发信：自定义 SMTP，见 [docs/supabase-setup.zh-CN.md](docs/supabase-setup.zh-CN.md) 第四节。
- 新用户注册：上线验收通过后关闭（Authentication → Sign In / Providers → Allow new users to sign up）。要加人时再打开。
