# Supabase 设置步骤

[English](supabase-setup.md) | **简体中文**

照着一步一步做。任何 Key 都不用发给 Claude，也不要写进 `.env.local` 以外的项目文件。

## 一、让前端连上云端：`.env.local`

1. 打开 Supabase 控制台，进入你的项目 → **Project Settings → API Keys**。有的版本叫 **Data API**。
2. 复制两样东西：
   - **Project URL**，形如 `https://xxxx.supabase.co`
   - **Publishable key**，旧项目里叫 **anon key**
3. 在项目根目录（和 `package.json` 同一层）新建文件 `.env.local`，写两行：

   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=刚复制的 publishable / anon key
   ```

   - **不要**用 service_role 或 secret key。它们能绕过所有权限，只能留在服务器上。
   - `.env.local` 已经在 `.gitignore` 里，不会进 git。
4. 重新启动 `npm run dev`（手机测试用 `npm run dev:phone`）。页面不再直接显示示例数据，而是出现登录页，就说明配置好了。

## 二、建表（只做一次）

1. 控制台左侧 **SQL Editor → New query**。
2. 打开项目里的 `supabase/migrations/20260930000000_init.sql`，全选、复制，粘贴进去，点 **Run**。
3. 到 **Table Editor** 核对：
   - 一共 10 张表；
   - `exposures` 有 11 行、`instruments` 有 24 行，都是全局预置，`user_id` 为空。

### 阶段 3：扩充品种预置（只做一次）

1. 同样在 **SQL Editor → New query**，打开 `supabase/migrations/20261002000000_presets.sql`，全选、复制、粘贴，点 **Run**。
2. 到 **Table Editor** 核对：`exposures` 里全局预置（`user_id` 为空）有 27 行，`instruments` 有 72 行。
3. 重复运行也没关系：已有的行会跳过，不会重复，也不会改动原来的预置。
4. 各设备下次同步时自动拿到新的预置，之后录入或记一笔时就能识别这些代码。

想再核对一遍预置代码的名称和价格，在项目根目录运行 `node scripts/check-presets.mjs`。

### 阶段 5：记下最后一次再平衡（只做一次）

在 **SQL Editor** 运行 `supabase/migrations/20261003000000_plan_rebalanced.sql`（只有一行，给 `plans` 表加一列 `last_rebalanced_on`）。重复运行也没关系。

没运行之前，App 其他功能照常；只有点「再平衡 → 标记已完成」时同步会报错，运行以后自动补传。

### 阶段 6：AI 对话同步（只做一次）

在 **SQL Editor** 运行 `supabase/migrations/20261003100000_ai_sync.sql`。它给 `ai_conversations`、`ai_messages` 两张表加上服务器时间，让各设备增量拉取对话。重复运行也没关系。

没运行之前，AI 对话照常存在本机，同步状态会显示失败，流水和设置照常同步；运行以后自动补传。你的 AI Key 不会存进这两张表，也不会存进 Supabase 的任何地方。

## 三、登录邮件改成发 6 位验证码

1. 进入 **Authentication → Emails**（Email Templates）。
2. 改 **Magic Link** 模板：
   - Subject：`AI 投资管理器登录验证码`
   - Body：

     ```html
     <p>你的验证码是：<strong>{{ .Token }}</strong></p>
     <p>如果不是你本人操作，忽略这封邮件即可。</p>
     ```

3. **Confirm signup** 模板也照这样改。一个邮箱第一次登录时，收到的是这一封。
4. 进入 **Authentication → Sign In / Providers → Email**，把 **Email OTP Length** 设成 `6`。新项目的默认值可能是 8 位；App 能接受 6–10 位，设成 6 位输入更快，也和设计一致。

Supabase 给所有人发的是同一个模板，不管对方手机用什么语言。如果用户里也有看英文的，可以把两种语言写在同一封邮件里：

```html
<p>你的验证码是：<strong>{{ .Token }}</strong></p>
<p>Your code is: <strong>{{ .Token }}</strong></p>
<p>如果不是你本人操作，忽略这封邮件即可。If you didn't ask for it, you can ignore this email.</p>
```

## 四、发信服务（自定义 SMTP）

Supabase 自带的发信服务每小时只能发几封，而且只发给项目成员的邮箱。如果你登录用的邮箱就是注册 Supabase 的那个，测试可以先不配。正式用之前再配，推荐 Resend（免费额度每月 3000 封）：

1. 注册 resend.com → **Domains → Add Domain**，填你的域名（下面用 `example.com` 代表）。
2. Resend 会给出几条 DNS 记录（SPF、DKIM 等）。把它们逐条加到 Cloudflare：**你的域名 → DNS → Records → Add record**，代理状态选「仅 DNS」（灰色云朵）。
3. Resend 显示 **Verified** 后，创建一个 API Key，权限选只能发送。
4. 回到 Supabase：进入 **Authentication → Emails → SMTP Settings**，打开 **Enable custom SMTP**，填写：

   | 项目 | 填什么 |
   |---|---|
   | Sender email | `noreply@example.com` |
   | Sender name | `AI 投资管理器` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | Resend 的 API Key（只填在这里） |

5. 保存后，可以在 **Authentication → Rate Limits** 里把每小时发信上限调高一点，比如 30。
6. **注意**：Sender email 的域名必须和 Resend 里显示 **Verified** 的域名一字不差（比如 `example.com`）。域名不对时 Resend 会拒绝发信，App 会显示「验证码邮件没有发出去」。具体原因在 Supabase 的 **Logs → Auth** 里能看到，例如 `domain is not verified`。

## 五、测试完想清空自己的数据

在 SQL Editor 里执行，把邮箱换成你的：

```sql
delete from public.transactions where user_id = (select id from auth.users where email = '你的邮箱');
delete from public.accounts where user_id = (select id from auth.users where email = '你的邮箱');
delete from public.exposures where user_id = (select id from auth.users where email = '你的邮箱');
delete from public.instruments where user_id = (select id from auth.users where email = '你的邮箱');
delete from public.targets where user_id = (select id from auth.users where email = '你的邮箱');
delete from public.plans where user_id = (select id from auth.users where email = '你的邮箱');
delete from public.snapshot_items where user_id = (select id from auth.users where email = '你的邮箱');
delete from public.snapshots where user_id = (select id from auth.users where email = '你的邮箱');
delete from public.ai_messages where user_id = (select id from auth.users where email = '你的邮箱');
delete from public.ai_conversations where user_id = (select id from auth.users where email = '你的邮箱');
```

也可以直接在 **Authentication → Users** 里删掉这个用户，他的所有行会一起删掉。

这只清空云端。手机和电脑上的本机数据还在，要一起清掉的话，在浏览器设置里删除这个网站的数据：
- iPhone：设置 → Safari → 高级 → 网站数据
- Chrome：网站设置 → 清除数据

## 六、验收步骤

1. 用邮箱登录，能收到 6 位验证码邮件，输入后进入 App。
2. 新账号先进入首次录入：录入一个账户和一条持仓，或者点「先看示例数据」随便看看（示例数据不会写进账号）。
3. 完成首次录入后，在 Supabase 的 **Table Editor → transactions** 里能看到你的期初流水，`user_id` 都是你的（和 **Authentication → Users** 里你的 id 一样）。
4. 记一笔，刷新页面，这笔还在。
5. 在另一个浏览器用同一个邮箱登录，看到同样的数据。
6. 离线记账，以手机为例：
   - 先把 App 打开；
   - 开飞行模式，**不要刷新页面**，记一笔：界面立即更新，记录页标题下显示「1 笔待同步 · 联网后自动上传」，「记录」标签上出现小圆点；
   - 关掉飞行模式，几秒内自动上传，提示消失；
   - 另一台设备刷新后能看到这笔。

   局域网测试地址是 http，没有离线缓存，所以「飞行模式下重新打开 App」要等部署到 https 之后才能测。
7. 两台设备都离线、各记一笔，联网后两边的持仓一致。
