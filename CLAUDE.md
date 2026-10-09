# CLAUDE.md — AI Investment Manager

## Project
A mobile-first PWA for managing a personal portfolio. The only authority for design and requirements is `design_handoff_investment_manager/README.md` (in Chinese); for interaction details, see the prototype 「投资管理器 原型 v5.dc.html」 in the same folder. Work proceeds in phases following `design_handoff_investment_manager/BUILD_PLAN.md`; don't implement anything ahead of its phase.

## Stack
- Vite + React + TypeScript; the PWA uses vite-plugin-pwa
- Supabase: database + sign-in with a 6-digit email code (no magic links); RLS on every table
- The front end is deployed as Cloudflare Worker static assets; a second Cloudflare Worker handles quotes, exchange rates and daily snapshots. Both are bound to their own domains, never workers.dev (see DEPLOY.md)
- AI advisor requests go from the browser straight to the provider (DeepSeek allows cross-origin requests), never through the Worker
- Tests: Vitest

## Conventions
- Every money and ratio calculation is a pure function in `src/domain/`, with unit tests. No calculations in UI components.
- `src/domain/` is plain TypeScript: no React and no browser APIs, because the Worker's daily snapshots reuse these functions.
- Amounts are computed in CNY internally and converted to the user's chosen currency for display. Cost in the original currency is stored separately.
- Colors, fonts and radii come only from the variables in `src/styles/tokens.css` (the Organic design system); never hard-code hex values.
- These never go into the git repository: `.env.local`, the Supabase secret (service role) key, users' AI keys.
- No deployment of mine appears in the repository: no domains, project URLs or resource IDs. The front end reads them from `.env.local` or build variables, the quotes Worker from `worker/wrangler.jsonc` (ignored by git); the repository holds only templates with example values.
- A user's AI key is only ever stored encrypted on their device; it is never uploaded and never logged.
- For a large change, explain the plan first and wait for my confirmation before writing code.
- After each phase, list the steps I need to check by hand.

## Languages
- English is the source language and Simplified Chinese is a translation. The interface follows the phone's language and can be switched in Holdings → Settings; the choice is a device setting and isn't synced.
- Interface copy lives only in `src/i18n/messages/`, with `en` and `zh` side by side (`zh: typeof en` keeps them in step). Components read it with `useT()`; code outside React uses `currentMessages()`. `src/i18n/guard.test.ts` fails when Chinese appears anywhere else in the code.
- Chinese appears in code only as stored data: the `MARKET` and `REASON` values, the preset names in the database (translated on display through `src/i18n/catalog.ts`), the sample data and test fixtures. Names of A-shares and Chinese mutual funds keep their Chinese names.
- Domain code returns error codes, never sentences; the interface turns them into text.
- Copy is calm and concise in both languages. Code comments, test names, logs and docs are in English.

## Key business rules (details in the spec)
- Holdings are merged by underlying asset, in three layers: asset → instrument → platform
- Targets are set on assets (slots) and must add up to 100%
- Assets not in the target (held, but missing from the target allocation): the user chooses between "suggest selling" and "leave out of rebalancing"
- The principal line changes only with opening / deposit / withdrawal records; buying, selling and calibrating inside the portfolio never move it. Anything that changes principal is recorded as a transaction, never by editing a number
- Cash is a holding whose code is CNY / USD; a buy spends cash in the same currency, and a shortfall records a deposit automatically
- Transactions are the single source of truth: holdings, cash and principal are all derived from them (the derivations live in `src/domain/`); there is no separate holdings table
- Local first: recording works offline, writing to IndexedDB first and showing at once, then syncing once online; transactions are append-only, and for settings the last change wins
- Invest new money: buy only, allocated by water-filling, suggesting only instruments in the same currency
- Withdraw: sell the most overweight first, only holdings in the same currency
- Calibration: store the actual share count the broker shows (not the difference); total cost stays the same; an unchanged count is recorded as checked; large holdings and dividend-reinvesting instruments get a quarterly reminder
