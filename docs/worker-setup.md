# Quotes Worker setup

**English** | [简体中文](worker-setup.zh-CN.md)

Quotes and exchange rates are relayed by the Cloudflare Worker `invest-api`, on your own domain (`https://api.example.com` below). The code is in `worker/`. The quotes API needs no key; the daily snapshots need a Supabase secret key (see "Daily snapshots").

## API

| Request | Response |
|---|---|
| `GET /quote?us=VOO,BRK.B&cn=513500&fund=050025` | `{ quotes: [{ market, code, price, currency, asOf, source, stale }], missing: [{ market, code }] }` |
| `GET /fx`, `GET /fx?date=2026-09-27` | `{ date, rates: { USD, HKD }, source, stale }`, in CNY per unit of foreign currency |
| `GET /health` | `{ ok: true }` |

- Parameters are split by market: a 6-digit code can't tell an A-share from a mutual fund.
- `stale: true` means no data source had it, and this is an old value from the cache.
- For mutual funds, `asOf` is the NAV date.

## Deploying

The first deployment takes steps 1–4; after changing the Worker's code later, only step 3.

1. Copy the config template. Your copy holds your domain and IDs, and git ignores it:

   ```bash
   cp worker/wrangler.example.jsonc worker/wrangler.jsonc
   ```

2. Create the KV store (the quote cache). In the project root, run:

   ```bash
   npx wrangler kv namespace create QUOTES --config worker/wrangler.jsonc
   ```

   The output includes an `id`. If wrangler offers to add it to the config, say yes; otherwise put it in `kv_namespaces` in `worker/wrangler.jsonc`.

3. Deploy. Before the first deployment, fill in the rest of `worker/wrangler.jsonc`: the `routes` domain (e.g. `api.example.com`), `APP_ORIGIN` (the front end's address, e.g. `https://app.example.com`, allowed to read cross-origin) and `SUPABASE_URL`.

   ```bash
   npx wrangler deploy --config worker/wrangler.jsonc
   ```

   It binds only the domain in `routes`, with no workers.dev address. The first time a domain is bound, the certificate takes a minute or two.

4. Check:

   ```bash
   curl "https://api.example.com/quote?us=VOO&cn=513500&fund=050025"
   ```

   If all three prices come back, with the NAV date on the mutual fund, it works.

## Daily snapshots (phase 4b)

Every day at 06:00 Beijing time, the Worker records a snapshot for each user who has created an account, as of the previous day's close (total assets, net invested principal, the USD rate, the value of each asset), and at 07:00 it runs again to fill in any that are missing. Writing snapshots takes the Supabase secret key (the service role key in older projects). It bypasses every permission, so it's **stored only in Cloudflare**:

1. In the Supabase dashboard → **Project Settings → API Keys → Secret keys**, copy the secret key (starting with `sb_secret_`). Older projects have it under **Legacy API Keys**, as `service_role`.
2. In the project root, run this and paste the key when asked:

   ```bash
   npx wrangler secret put SUPABASE_SECRET_KEY --config worker/wrangler.jsonc
   ```

3. Deploy (step 3 of "Deploying" above). The output should include `schedule: 0 22 * * *` and `schedule: 0 23 * * *`.
4. After 06:00 the next day, the Supabase **Table Editor → snapshots** shows a row for the previous day, and `snapshot_items` a row per held asset.

To try it right away instead of waiting for the morning:

1. Put one line, `SUPABASE_SECRET_KEY=the key from above`, in `worker/.dev.vars` (ignored by git).
2. Run `npx wrangler dev --config worker/wrangler.jsonc --test-scheduled`.
3. Open `http://localhost:8787/__scheduled?cron=0+22+*+*+*` in a browser. This writes a snapshot for yesterday into the real database, the same as the 06:00 run.
4. Delete `worker/.dev.vars` when you're done.

## Debugging locally

- `npx wrangler dev --config worker/wrangler.jsonc --port 8787` runs the Worker on your machine against the real data sources; with no KV, nothing is cached.
- To point the app at the local Worker, set `VITE_API_BASE` in `.env.local` to `http://127.0.0.1:8787` and restart `npm run dev`. Change it back to the real address afterwards.
- The Claude Code preview configs in `.claude/launch.json` include two ready-made entries: `worker-local` (the Worker on your machine) and `app-local-worker` (the app connected to it, on port 5196).

## Changing data sources

Each market's data sources are listed in order in `CHAINS` in `worker/src/providers.ts`: codes one source lacks go to the next. For a new data source, write a `Provider` and add it there, with its parsing in `worker/src/parse.ts` and sample responses in `worker/src/testdata.ts`.
