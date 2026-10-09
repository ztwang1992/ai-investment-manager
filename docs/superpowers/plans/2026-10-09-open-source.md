# 开源准备 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:**
- 仓库可以公开：代码不再默认使用作者的服务；
- 没配云端也能看示例数据，别人 clone 下来就能跑；
- 中英双语 README、MIT 许可证、GitHub Actions；
- 提交作者改成 GitHub 隐私邮箱。

**Architecture:**
- 行情地址只认 `VITE_API_BASE`，不填就不取行情。`refreshQuotes` 和 `usdCnyOn` 本来就处理「没有行情接口」。
- Worker 允许跨域的正式域名来自 wrangler 变量 `APP_ORIGIN`。本机和局域网地址照旧允许。
- 没配置 Supabase 时，启动状态是 `noCloud`：直接进 App 看示例数据（`demo: true`），不开本机库、不同步。
- 文档：`README.md`（英文）和 `README.zh-CN.md`（中文）。部署文档里的域名换成占位符。

**Tech Stack:** 不新增依赖。GitHub Actions 用 `actions/checkout@v5`、`actions/setup-node@v5`。

**Spec:** 用户 2026-10-09 在对话里确认的决定：
- MIT 许可证；
- 根目录 README 中英双语；
- 示例数据是虚构的，不用改；
- 提交邮箱改成 GitHub 的 noreply 地址；
- 做「不配云端也能看示例数据」和 GitHub Actions。

## 决定

1. 许可证 MIT，署名 Z.T.Wang（和 GitHub 主页一致）。
2. README 两份，顶部互相链接：
   - `README.md` 英文，GitHub 默认显示这一份；
   - `README.zh-CN.md` 中文；
   - `DEPLOY.md` 和 `docs/` 保持中文。
3. 提交作者 `Z.T.Wang <260400512+ztwang1992@users.noreply.github.com>`：
   - 只改这个仓库的 git 设置；
   - 已有提交改写作者，保留原来的时间；
   - 验收后强制推送 main。
4. GitHub 用户名改过：远程地址和部署文档里的旧名字一起改。推送后核对 Cloudflare 还会自动构建。
5. 没配云端时直接看示例数据，不再显示「还没有配置云端」页。连接云端的说明放在两处：「账户」设置的数据备份区、README。

## Review Focus

1. 线上前端：推送前 Cloudflare 的构建变量里要有 `VITE_API_BASE`，否则线上取不到行情。
2. Worker 改了跨域代码，要重新部署。没配 `APP_ORIGIN` 时，只允许本机和局域网。
3. `noCloud` 模式下，任何操作都不能写本机库，也不能请求 Supabase。
4. 干净目录、没有 `.env.local` 时，测试和构建都要能过。CI 就是这个环境。
5. 公开前要确认三件事：注册已关、历史里没有 Gmail 地址、没有密钥。

## 分工

- **我做：** Task 1–6。
- **你做：**
  - Cloudflare 前端加构建变量 `VITE_API_BASE`；
  - 关闭 Supabase 新用户注册；
  - 验收后确认强制推送和部署 Worker；
  - GitHub 仓库改成公开。

---

### Task 1：行情地址必须配置

- [ ] `quotesApi.test`：`apiBase({})` 和空白返回 null；有值时去掉末尾斜杠。（RED）
- [ ] `boot.test`：没有 `VITE_API_BASE` 时，`getQuotesApi()` 是 null。（RED）
- [ ] 实现：
  - 删掉 `DEFAULT_API_BASE`；
  - `apiBase` 返回 `string | null`；
  - boot 只在有地址时才建行情接口；
  - 改掉 `src/env.d.ts` 的注释。
- [ ] 加 `.env.example`：三个变量和说明。

### Task 2：Worker 允许的来源可配置

- [ ] `index.test`（RED）：
  - `APP_ORIGIN` 里的地址允许跨域；
  - 多个地址用逗号分隔；
  - 没配 `APP_ORIGIN` 时，只允许本机和局域网。
- [ ] 实现：
  - `Env.APP_ORIGIN?: string`；
  - `corsHeaders(request, env)`；
  - `worker/wrangler.jsonc` 的 vars 加 `APP_ORIGIN`。

### Task 3：没配云端直接看示例数据

- [ ] `boot.test`：没配 Supabase 时，`kind: 'noCloud'`，界面是示例数据，`demo: true`。（RED）
- [ ] `Root.test`：`noCloud` 时显示 App 和「正在看示例数据，不会保存」，没有「开始录入」。（RED）
- [ ] `AccountsSettings` 的测试：`noCloud` 时显示连接云端的说明，没有「退出登录」。（RED）
- [ ] 实现。交接包 README 加一条修订说明。

### Task 4：文档、许可证、CI

- [ ] `LICENSE`（MIT）。`package.json`、`package-lock.json` 的名字改成 `invest-manager`，license 写 MIT。
- [ ] `README.md`、`README.zh-CN.md`。截图用 `noCloud` 模式，在手机尺寸下截真实 App。
- [ ] `DEPLOY.md`、`docs/supabase-setup.md`、`docs/worker-setup.md`：
  - 域名换成占位符；
  - GitHub 用户名改成新的；
  - 阶段计划等历史文档不动。
- [ ] `.github/workflows/ci.yml`：push 和 PR 时跑 `npm ci`、`npm test`、`npm run build`。
- [ ] `.claude/launch.json` 加一个不连云端的 dev 配置（截图用）。

### Task 5：git 身份和远程地址

- [ ] 设置这个仓库的 `user.name`、`user.email`。
- [ ] 远程地址改成 `ztwang1992/invest-manager`。

### Task 6：验证

- [ ] 从本机仓库 clone 到干净目录，不带 `.env.local`，跑 `npm ci`、`npm test`、`npm run build`。
- [ ] 跑全量测试和类型检查。

### 验收后（每一步先问你）

- [ ] 提交。改写全部提交的作者，保留时间。确认历史里没有 Gmail 地址。
- [ ] 你确认 Cloudflare 已有 `VITE_API_BASE` 后，强制推送 main。核对自动构建和线上行情。
- [ ] 部署 Worker，核对跨域。
- [ ] 你关闭注册、把仓库改成公开以后，我在未登录状态下检查一遍。
