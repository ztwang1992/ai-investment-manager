# 阶段 7：部署上线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- 前端上线到 `https://app.example.com`：Cloudflare Pages 关联 GitHub 仓库，推送到 main 自动部署。
- Worker（`api.example.com`）阶段 4 已部署，这次只核对。
- Supabase 的网址设置改成线上地址。
- `DEPLOY.md` 记下全部配置项和以后更新的步骤。

**Architecture:**
- 仓库：GitHub 私有仓库，main 分支。Cloudflare Pages 监听 main，每次推送自动构建（`npm run build`，输出 `dist`）。
- 前端构建只需要两个环境变量：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`（publishable key，本来就会出现在网页里）。行情接口默认就是 `https://api.example.com`。
- 静态资源响应头写在 `public/_headers`（Pages 原生支持）。
- Node 版本用 `.node-version` 固定，和本机一致。

**Tech Stack:** Cloudflare Pages（Git 集成）、GitHub、Wrangler、Supabase 控制台。不新增依赖。

**Spec:**
- BUILD_PLAN 阶段 7 第 1–5 条和验收；
- README「技术栈 · 部署」（都绑定自己的域名，不用默认域名）；
- CLAUDE.md：「以下密钥不能进入 git 仓库：.env.local、Supabase service role key、用户的 AI Key。」

## 现状（2026-10-03 核实）

- 还没有任何 git 提交，也没有远程仓库。GitHub 命令行已登录，可以建私有仓库。
- 不会被提交：`.env.local`、`.superpowers/`、`worker/.wrangler/`、`node_modules/`、`dist/`。
- 扫描过要提交的文件，没有真实密钥（只有文档里的前缀说明和测试用的假值）。
- 两个 `*.tsbuildinfo` 编译缓存会被带进去，要加进忽略规则。
- Worker：
  - `api.example.com` 正常（`/health` 返回 200）；
  - workers.dev 和预览地址已关；
  - 跨域已允许 `https://app.example.com`；
  - 上次部署后，Worker 用到的代码没有实质变化，不需要重新部署。
- PWA：名称「投资管理器」、图标、自动更新（`autoUpdate`）都已配置。

## 需要用户确认的决定

1. **第一次提交**：你之前定的是「先不提交」，但部署要靠 GitHub，所以需要提交。
   - 现在的全部内容（阶段 0–6）做成一次提交，阶段 7 的改动再提交一次。
   - 之后：每次改动做完、你验收以后，我再提交并推送。推送到 main 就会自动上线。
2. **在你的 GitHub 账号下建私有仓库 `invest-manager`**，推送 main 分支。名字可以改。
3. **加 `public/_headers`**：
   - 几项常用的安全响应头：禁止被别的网站嵌入、不猜文件类型、限制 referrer、关闭摄像头 / 麦克风 / 定位权限；
   - 文件名带哈希的静态资源长期缓存，手机上打开更快；`sw.js` 不缓存，保证能及时更新。
   - 这次不加内容安全策略（CSP），上线稳定后再考虑。
4. **固定 Node 版本**：加 `.node-version`（24，和本机一致），Cloudflare 构建时用同一个版本。
5. **上线验收通过后，关闭 Supabase 的新用户注册**（推荐）。这是你自己用的 App；开着注册的话，别人知道网址就能注册，还会占用你的发信额度。以后要加人时再打开。
6. **pages.dev 默认地址**：Cloudflare Pages 项目一定会有一个 `*.pages.dev` 地址，没法删除。我们不使用、不分享它。Worker 只允许 `app.example.com` 跨域，在那个地址上取不到行情。

## 分工

**我做（你确认后）：**
- `.gitignore` 加 `*.tsbuildinfo`；加 `.node-version`、`public/_headers`；写 `DEPLOY.md`。
- 本机跑全部测试和构建。
- 第一次提交、建私有仓库、推送。
- 你配好 Pages 以后，检查线上网站：首页、manifest 和图标、响应头、从 app 域名跨域请求 Worker。
- 推送一个小改动，确认几分钟内自动更新（验收第 3 条）。

**你做（要登录你的账号，在网页上操作）：**
1. Cloudflare 控制台 → Workers & Pages → Create → Pages → Connect to Git → 授权 GitHub，选 `invest-manager` 仓库：
   - Production branch：`main`
   - Framework preset：`None`
   - Build command：`npm run build`
   - Build output directory：`dist`
   - Environment variables（Production）：`VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`，值和本机 `.env.local` 里的一样。
2. Pages 项目 → Custom domains → Set up a custom domain → `app.example.com`（DNS 在 Cloudflare，会自动加记录）。
3. Supabase 控制台 → Authentication → URL Configuration：
   - Site URL 改成 `https://app.example.com`；
   - Redirect URLs 加上 `https://app.example.com/**`。
4. 手机验收：用 4G 打开并登录；添加到主屏幕，看图标和名称。
5. 验收通过后，关闭新用户注册（决定 5）。

## Review Focus

1. **构建环境和本机不同**（Linux、`npm ci`）：构建失败时，`DEPLOY.md` 写清在哪里看构建日志、怎么本机复现。
2. **手机上缓存着旧版本**：自动更新会在下次打开时换上新版本；`sw.js` 不能被长期缓存。
3. **线上请求被跨域拦截**：Supabase（允许任何来源）、Worker（允许 app 域名）、DeepSeek（允许）都要在线上实际请求一次。
4. **登录邮件里的地址还指向 localhost**：Supabase 的 Site URL 改成线上地址。
5. **密钥进仓库**：提交前再扫一次；`.env.local` 必须被忽略。

---

### Task 1：部署用的文件

**Files:**
- Modify: `.gitignore`（`*.tsbuildinfo`）
- Create: `.node-version`、`public/_headers`、`DEPLOY.md`

- [ ] `public/_headers`：
  - 所有路径：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy: camera=(), microphone=(), geolocation=()`；
  - `/assets/*`：`Cache-Control: public, max-age=31536000, immutable`；
  - `/sw.js`、`/registerSW.js`、`/manifest.webmanifest`：`Cache-Control: no-cache`。
- [ ] `DEPLOY.md`：
  - 线上地址和各服务的关系；
  - Pages 的构建设置、环境变量、自定义域名；
  - Worker 的部署命令、密钥名称（不写值）、定时任务；
  - Supabase：迁移列表和运行顺序、URL 设置、注册开关、SMTP；
  - 以后更新的步骤：前端（推送即上线）、Worker、新迁移；
  - 出问题时：看构建日志、回滚到上一次部署、手机上强制更新。
- [ ] 本机：全部测试、类型检查、构建通过；`dist/_headers` 存在。

### Task 2：第一次提交并推送

- [ ] 提交前再扫一次密钥；确认 `.env.local` 被忽略。
- [ ] 提交 1：阶段 0–6 的全部内容。提交 2：阶段 7 的部署文件。
- [ ] `gh repo create invest-manager --private`，推送 main。

### Task 3：线上核对（你配好 Pages 和域名以后）

- [ ] `https://app.example.com`：首页 200，manifest 名称和图标正确，`_headers` 生效，`sw.js` 不缓存。
- [ ] 带 `Origin: https://app.example.com` 请求 Worker 的 `/quote`、`/fx`：跨域头正确。
- [ ] 推送一个小改动（`DEPLOY.md` 里记下上线时间），几分钟内线上更新。
- [ ] 列出手机验收步骤。
