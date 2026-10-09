# 行情 Worker 设置步骤

[English](worker-setup.md) | **简体中文**

行情、汇率由 Cloudflare Worker `invest-api` 中转，地址是你自己的域名（下面用 `https://api.example.com` 代表）。代码在 `worker/`。行情接口不需要密钥；每日快照要一个 Supabase 的 secret key（见「每日快照」）。

## 接口

| 请求 | 返回 |
|---|---|
| `GET /quote?us=VOO,BRK.B&cn=513500&fund=050025` | `{ quotes: [{ market, code, price, currency, asOf, source, stale }], missing: [{ market, code }] }` |
| `GET /fx`、`GET /fx?date=2026-09-27` | `{ date, rates: { USD, HKD }, source, stale }`，1 单位外币值多少人民币 |
| `GET /health` | `{ ok: true }` |

- 按市场分参数：6 位数字代码分不清是 A 股还是场外基金。
- `stale: true` 表示数据源都没取到，这是缓存里的旧值。
- 场外基金的 `asOf` 是净值日期。

## 部署

第一次部署做 1–4 步；以后改了 Worker 的代码，只做第 3 步。

1. 复制配置模板。你的这份写着自己的域名和 id，git 会忽略它：

   ```bash
   cp worker/wrangler.example.jsonc worker/wrangler.jsonc
   ```

2. 建 KV 存储（缓存行情用），在项目根目录运行：

   ```bash
   npx wrangler kv namespace create QUOTES --config worker/wrangler.jsonc
   ```

   输出里有一个 `id`。如果 wrangler 问是否把它加进配置，选是；否则把它填进 `worker/wrangler.jsonc` 的 `kv_namespaces`。

3. 发布。第一次发布前，把 `worker/wrangler.jsonc` 里其余几项填成你自己的：`routes` 的域名（比如 `api.example.com`）、`APP_ORIGIN`（前端的地址，比如 `https://app.example.com`，允许它跨域读取）、`SUPABASE_URL`。

   ```bash
   npx wrangler deploy --config worker/wrangler.jsonc
   ```

   只绑定 `routes` 里的域名，不开 workers.dev 地址。第一次绑定域名时，证书要等一两分钟。

4. 核对：

   ```bash
   curl "https://api.example.com/quote?us=VOO&cn=513500&fund=050025"
   ```

   能看到三只的价格，场外基金带净值日期，就好了。

## 每日快照（阶段 4b）

Worker 每天北京时间 06:00 给每个建过账户的用户记一条前一天收盘后的快照（总资产、净投入本金、美元汇率、各底层资产市值），07:00 补跑一次，只补还没写上的。写快照要用 Supabase 的 secret key（旧项目叫 service role key），它能绕过所有权限，**只存在 Cloudflare 里**：

1. Supabase 控制台 → **Project Settings → API Keys → Secret keys**，复制 secret key（`sb_secret_` 开头）。旧项目在 **Legacy API Keys** 里，叫 `service_role`。
2. 在项目根目录运行，按提示粘贴：

   ```bash
   npx wrangler secret put SUPABASE_SECRET_KEY --config worker/wrangler.jsonc
   ```

3. 发布（见上面「部署」第 3 步）。输出里应该有 `schedule: 0 22 * * *` 和 `schedule: 0 23 * * *`。
4. 第二天 06:00 以后，在 Supabase 的 **Table Editor → snapshots** 里能看到前一天的一行，`snapshot_items` 里每个持有的资产一行。

想马上试一次，不等到早上：

1. 在 `worker/.dev.vars`（不进 git）里写一行 `SUPABASE_SECRET_KEY=刚才的 key`。
2. 运行 `npx wrangler dev --config worker/wrangler.jsonc --test-scheduled`。
3. 浏览器打开 `http://localhost:8787/__scheduled?cron=0+22+*+*+*`。这会往真实的数据库写一条昨天的快照，和早上 06:00 写的一样。
4. 试完删掉 `worker/.dev.vars`。

## 本机调试

- `npx wrangler dev --config worker/wrangler.jsonc --port 8787` 在本机运行 Worker，用的是真实数据源，没有 KV 时不缓存。
- 让 App 连本机的 Worker：把 `.env.local` 的 `VITE_API_BASE` 改成 `http://127.0.0.1:8787`，重启 `npm run dev`。调完改回正式地址。
- `.claude/launch.json`（Claude Code 的预览配置）里有现成的两项：`worker-local`（本机 Worker）和 `app-local-worker`（连本机 Worker 的 App，端口 5196）。

## 换数据源

各市场的数据源顺序在 `worker/src/providers.ts` 的 `CHAINS`：前一个源缺的代码交给下一个。新数据源写一个 `Provider` 放进去即可，解析放在 `worker/src/parse.ts`，样例响应放在 `worker/src/testdata.ts`。
