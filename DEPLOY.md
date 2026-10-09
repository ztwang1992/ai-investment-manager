# Deploying

**English** | [简体中文](DEPLOY.zh-CN.md)

The live app has four parts. This document lists every setting and the steps for later updates; for first-time setup in detail, see [docs/supabase-setup.md](docs/supabase-setup.md) and [docs/worker-setup.md](docs/worker-setup.md). Below, `app.example.com` and `api.example.com` stand for your own domains.

| Part | Address | Where it runs |
|---|---|---|
| Front end (PWA) | `https://app.example.com` | Cloudflare Worker `invest-manager` (static assets only), connected to the GitHub repository; a push to main builds and deploys it |
| Quotes, exchange rates, daily snapshots | `https://api.example.com` | Cloudflare Worker `invest-api` |
| Data and sign-in | A Supabase project | Supabase (database + 6-digit email code sign-in) |
| AI advisor | `https://api.deepseek.com` | Requested by the browser directly; the key is stored encrypted on the phone only and never passes through our servers |

The domain's DNS must be on Cloudflare. The two Workers' custom domains maintain the `app` and `api` records; don't edit them by hand. Both Workers have the default `*.workers.dev` address and preview URLs turned off, and use only your own domains.

## Where secrets live

| Secret | Where it lives | Where it must never appear |
|---|---|---|
| Supabase URL and publishable key (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) | `.env.local` on your machine; the front-end Worker's build variables | The git repository (`.env.local` is ignored). They end up in the web page anyway, so they aren't secrets |
| Supabase secret key (starts with `sb_secret_`) | The quotes Worker's secret `SUPABASE_SECRET_KEY` | The git repository, the front end, the front end's build variables, chat logs |
| DeepSeek API key | On the user's phone, encrypted in the local database | Any server, the git repository, logs |
| The email service's (SMTP) password | The SMTP settings in the Supabase dashboard | The git repository |

## Front end: Cloudflare Worker `invest-manager` (static assets)

**Config**: `wrangler.jsonc` at the repository root.

- Static assets from `dist`; no code runs;
- workers.dev and preview URLs off;
- the custom domain isn't set here but in the dashboard (see below), so deploys leave it alone.

**Build** (Workers & Pages → `invest-manager` → Settings → Builds):

- Git repository: the GitHub repository holding this code; Branch control: `main`
- Build command: `npm run build` (type check first, then `vite build`)
- Deploy command: `npx wrangler deploy`
- Root directory: `/`
- Node version: `.node-version` in the repository (24)
- Build variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_API_BASE` (the quotes Worker's address, e.g. `https://api.example.com`), with the same values as your `.env.local`. They're written into the web page at build time, so changing one needs a rebuild. Without `VITE_API_BASE`, no quotes are fetched.

**Custom domain**: `invest-manager` → Domains → `app.example.com`.

**Response headers**: `public/_headers`, copied to `dist/_headers` at build time; Workers static assets honor it.

- Every page gets a few security headers: no embedding, no content-type sniffing, a limited referrer, camera / microphone / location off;
- `/assets/*` (hashed file names) is cached for good; `sw.js`, `registerSW.js` and `manifest.webmanifest` are revalidated every time.

**Updating the front end**:

1. Change the code locally and run `npm test` and `npm run build`; both must pass;
2. Commit and push to main: Cloudflare builds and deploys it, and it's live in a minute or two;
3. The app on phones (PWA) switches to the new version the next time it opens. If it doesn't, close the app completely and open it again.

**When a build fails**: `invest-manager` → Deployments → Build history → View build shows the build log. To reproduce it locally, `git clone` the repository into a clean directory and run `npm ci && npm run build`.

**Rolling back**: `invest-manager` → Deployments, pick the previous version in the list and deploy it. It takes effect in seconds; the repository isn't touched.

## Quotes Worker: `invest-api`

The config template is `worker/wrangler.example.jsonc`: copy it to `worker/wrangler.jsonc`, which git ignores, and fill in four things: the `routes` domain, the `kv_namespaces` id, `APP_ORIGIN` and `SUPABASE_URL`.

- A custom domain (e.g. `api.example.com`); workers.dev and preview URLs off;
- KV `QUOTES`: caches quotes and exchange rates (15 minutes during trading hours);
- Cron: at 22:00 and 23:00 UTC (06:00 and 07:00 Beijing time) it writes the previous day's daily snapshots; the 07:00 run only fills in users still without one;
- Variables `APP_ORIGIN` and `SUPABASE_URL`; secret `SUPABASE_SECRET_KEY`;
- CORS: allows the front-end addresses in `APP_ORIGIN` (separate several with commas); development pages on your machine and LAN are always allowed (`DEV_ORIGINS` in `worker/src/index.ts`).

Common commands (run them at the project root):

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

The quotes Worker bundles the shared calculations in `src/domain/`: after changing functions that snapshots or the transaction derivations use, run `wrangler deploy` again. A push to GitHub doesn't deploy it; run the command above by hand.

## Supabase

**Migrations**: run them in order in the SQL Editor; each one is safe to run again:

1. `supabase/migrations/20260930000000_init.sql`: tables, RLS and global presets (phase 2; run once, on an empty project)
2. `supabase/migrations/20261002000000_presets.sql`: more preset instruments (phase 3)
3. `supabase/migrations/20261003000000_plan_rebalanced.sql`: records the last rebalance (phase 5)
4. `supabase/migrations/20261003100000_ai_sync.sql`: AI conversation sync (phase 6)

To add a migration later: run it in the SQL Editor first, then push the front-end code that uses it.

**Authentication**:

- URL Configuration: Site URL `https://app.example.com`; Redirect URLs `https://app.example.com/**`. Code sign-in uses no redirect links, so local development needs no localhost entry.
- Sign-in method: a 6-digit email code (the Magic Link template changed to send only the code); see section 3 of [docs/supabase-setup.md](docs/supabase-setup.md).
- Email: custom SMTP; see section 4 of [docs/supabase-setup.md](docs/supabase-setup.md).
- New sign-ups: turn them off once the launch checks pass (Authentication → Sign In / Providers → Allow new users to sign up), and back on when adding someone.
