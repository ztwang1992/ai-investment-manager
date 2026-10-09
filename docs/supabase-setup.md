# Supabase setup

**English** | [简体中文](supabase-setup.zh-CN.md)

Follow these steps in order. Never paste a key into a chat (an AI assistant included), and never write one into any project file other than `.env.local`.

## 1. Connect the front end to the cloud: `.env.local`

1. Open the Supabase dashboard and go to your project → **Project Settings → API Keys** (called **Data API** in some versions).
2. Copy two things:
   - the **Project URL**, like `https://xxxx.supabase.co`
   - the **Publishable key**, called the **anon key** in older projects
3. In the project root (next to `package.json`), create a file named `.env.local` with two lines:

   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=the publishable / anon key you copied
   ```

   - **Don't** use the service_role or secret key. They bypass every permission and must stay on a server.
   - `.env.local` is already in `.gitignore`, so it never goes into git.
4. Restart `npm run dev` (`npm run dev:phone` to test on a phone). When the sign-in page appears instead of the sample data, it's configured.

## 2. Create the tables (once)

1. In the dashboard, open **SQL Editor → New query**.
2. Open `supabase/migrations/20260930000000_init.sql` in the project, select all, copy, paste it in and click **Run**.
3. Check in the **Table Editor**:
   - there are 10 tables;
   - `exposures` has 11 rows and `instruments` 24, all global presets with an empty `user_id`.

### Phase 3: more preset instruments (once)

1. Again in **SQL Editor → New query**, open `supabase/migrations/20261002000000_presets.sql`, select all, copy, paste and click **Run**.
2. Check in the **Table Editor**: `exposures` has 27 global presets (empty `user_id`) and `instruments` 72.
3. Running it again is fine: existing rows are skipped, nothing is duplicated, and the original presets stay as they were.
4. Each device picks up the new presets at its next sync; onboarding and "Add record" then recognize these codes.

To check the names and prices of the preset codes again, run `node scripts/check-presets.mjs` in the project root.

### Phase 5: record the last rebalance (once)

In the **SQL Editor**, run `supabase/migrations/20261003000000_plan_rebalanced.sql` (a single line that adds a `last_rebalanced_on` column to the `plans` table). Running it again is fine.

Until it has run, the rest of the app works as usual; only "Rebalance → Mark as done" makes sync fail, and it uploads by itself once the migration has run.

### Phase 6: AI conversation sync (once)

In the **SQL Editor**, run `supabase/migrations/20261003100000_ai_sync.sql`. It adds server times to the `ai_conversations` and `ai_messages` tables so devices can pull conversations incrementally. Running it again is fine.

Until it has run, AI conversations are still stored on the device, the sync status shows a failure, and transactions and settings sync as usual; everything uploads by itself once it has run. Your AI key is never stored in these tables, or anywhere in Supabase.

## 3. Make the sign-in email send a 6-digit code

1. Go to **Authentication → Emails** (Email Templates).
2. Change the **Magic Link** template:
   - Subject: `Your AI Investment Manager sign-in code`
   - Body:

     ```html
     <p>Your code is: <strong>{{ .Token }}</strong></p>
     <p>If you didn't ask for it, you can ignore this email.</p>
     ```

3. Change the **Confirm signup** template the same way. It's the email an address gets the first time it signs in.
4. Go to **Authentication → Sign In / Providers → Email** and set **Email OTP Length** to `6`. New projects may default to 8 digits; the app accepts 6–10, but 6 is quicker to type and matches the design.

Supabase sends the same template to everyone, whatever language their phone uses. If some of your users read Chinese, you can put both languages in one email:

```html
<p>Your code is: <strong>{{ .Token }}</strong></p>
<p>你的验证码是：<strong>{{ .Token }}</strong></p>
<p>If you didn't ask for it, you can ignore this email. 如果不是你本人操作，忽略这封邮件即可。</p>
```

## 4. Email service (custom SMTP)

Supabase's built-in email sends only a few messages an hour, and only to the project members' addresses. If you sign in with the address you registered Supabase with, you can skip this while testing. Set it up before real use; Resend works well (3,000 emails a month free):

1. Sign up at resend.com → **Domains → Add Domain** and enter your domain (`example.com` below).
2. Resend lists a few DNS records (SPF, DKIM and so on). Add each one in Cloudflare: **your domain → DNS → Records → Add record**, with the proxy status set to "DNS only" (grey cloud).
3. Once Resend shows **Verified**, create an API key with sending access only.
4. Back in Supabase, go to **Authentication → Emails → SMTP Settings**, turn on **Enable custom SMTP** and fill in:

   | Field | Value |
   |---|---|
   | Sender email | `noreply@example.com` |
   | Sender name | `AI Investment Manager` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | The Resend API key (entered here only) |

5. After saving, you can raise the hourly email limit a little under **Authentication → Rate Limits**, to 30 for example.
6. **Note**: the Sender email's domain must match the domain Resend shows as **Verified** exactly (e.g. `example.com`). With the wrong domain, Resend refuses to send and the app says "The code email wasn't sent. Try again later." The reason shows in Supabase under **Logs → Auth**, for example `domain is not verified`.

## 5. Clearing your own data after testing

Run this in the SQL Editor, with your email address:

```sql
delete from public.transactions where user_id = (select id from auth.users where email = 'you@example.com');
delete from public.accounts where user_id = (select id from auth.users where email = 'you@example.com');
delete from public.exposures where user_id = (select id from auth.users where email = 'you@example.com');
delete from public.instruments where user_id = (select id from auth.users where email = 'you@example.com');
delete from public.targets where user_id = (select id from auth.users where email = 'you@example.com');
delete from public.plans where user_id = (select id from auth.users where email = 'you@example.com');
delete from public.snapshot_items where user_id = (select id from auth.users where email = 'you@example.com');
delete from public.snapshots where user_id = (select id from auth.users where email = 'you@example.com');
delete from public.ai_messages where user_id = (select id from auth.users where email = 'you@example.com');
delete from public.ai_conversations where user_id = (select id from auth.users where email = 'you@example.com');
```

Deleting the user under **Authentication → Users** removes all of their rows as well.

This clears the cloud only. The local data on your phone and computer is still there; to clear it too, delete this site's data in the browser settings:
- iPhone: Settings → Safari → Advanced → Website Data
- Chrome: Site settings → Clear data

## 6. Check that it works

1. Sign in with your email: a 6-digit code arrives, and entering it opens the app.
2. A new account starts with onboarding. Enter an account and a holding, or tap "Look at sample data first" to look around (the sample data is never written to your account).
3. After you finish onboarding, the Supabase **Table Editor → transactions** shows your opening records, with `user_id` matching your id under **Authentication → Users**.
4. Add a record and reload the page: it's still there.
5. Sign in with the same email in another browser: the same data appears.
6. Offline recording, on a phone:
   - open the app first;
   - turn on airplane mode and, **without reloading**, add a record: the interface updates at once, the line under the Records title says "1 record waiting to sync · uploads when online", and the Records tab gets a small dot;
   - turn airplane mode off: it uploads within seconds and the note goes away;
   - another device shows the record after a reload.

   A LAN test address is plain http with no offline cache, so reopening the app in airplane mode can only be tested once it's deployed over https.
7. Two devices offline each add a record; once online, both show the same holdings.
