import { addDays, beijingDate } from '../../src/domain/dates';
import { currencyLookup, deriveLedger } from '../../src/domain/ledger';
import { QUOTE_CODE } from '../../src/domain/quoteCodes';
import { rowToExposure, rowToInstrument, rowToTx } from '../../src/domain/rows';
import type { ExposureRow, InstrumentRow, TxRow } from '../../src/domain/rows';
import { computeSnapshot } from '../../src/domain/snapshot';
import { MARKET, isCashCode } from '../../src/domain/types';
import type { Exposure, Instrument, Market, Prices, Snapshot, SnapshotItem, Transaction } from '../../src/domain/types';
import { getFx, getQuotes } from './cache';
import { newBudget } from './providers';
import { createAdmin } from './supabase';
import type { Fetch, Kv, MarketKind } from './types';

// Daily snapshots (BUILD_PLAN phase 4, item 5): at 06:00 Beijing time, records each user's total assets, net invested principal, usd_cny and per-asset values after the previous day's close.
// A rerun at 07:00 writes only users without a snapshot for that day yet. Computed with src/domain's computeSnapshot, the same as the app's live point.

export interface DailyEnv {
  QUOTES: Kv;
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
}

export interface DailyResult {
  date: string;
  written: number;
  /** Users with no transactions before this day */
  skipped: number;
  failed: number;
}

const MARKET_KIND: Partial<Record<Market, MarketKind>> = { [MARKET.us]: 'us', [MARKET.cn]: 'cn', [MARKET.fund]: 'fund' };
const KINDS: MarketKind[] = ['us', 'cn', 'fund'];
/** Outside requests reserved for quotes (the free plan allows 50 per request); the rest are left for reading and writing Supabase */
const QUOTE_BUDGET = 30;

/** Global presets + users' own, their own first (the same rule the app uses to find instruments by code) */
function catalogOf<R extends { user_id: string | null }, T>(rows: readonly R[], userId: string, toItem: (r: R) => T, key: (t: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  const add = (r: R) => {
    const item = toItem(r);
    out[key(item)] = item;
  };
  for (const r of rows) if (r.user_id === null) add(r);
  for (const r of rows) if (r.user_id === userId) add(r);
  return out;
}

export async function runDailySnapshots(env: DailyEnv, deps: { fetch: Fetch; now: () => Date }, mode: 'all' | 'missing'): Promise<DailyResult> {
  const date = addDays(beijingDate(deps.now()), -1);
  const admin = createAdmin(env, deps.fetch);
  let users = await admin.userIds();
  if (mode === 'missing' && users.length > 0) {
    const done = await admin.usersWithSnapshot(date);
    users = users.filter((u) => !done.has(u));
  }
  const result: DailyResult = { date, written: 0, skipped: 0, failed: 0 };
  const finish = () => {
    console.log(`Snapshots ${date} (${mode}): wrote ${result.written} users, skipped ${result.skipped}, failed ${result.failed}`);
    return result;
  };
  if (users.length === 0) return finish();

  // Each user's own transactions, instruments and assets; a user whose data can't be read is recorded as an error without affecting the others
  const data = await admin.loadAll();
  const byUser = new Map<string, TxRow[]>();
  for (const r of data.transactions) {
    const list = byUser.get(r.user_id);
    if (list) list.push(r);
    else byUser.set(r.user_id, [r]);
  }
  const books: { userId: string; transactions: Transaction[]; instruments: Record<string, Instrument>; exposures: Record<string, Exposure> }[] = [];
  for (const userId of users) {
    try {
      const transactions = (byUser.get(userId) ?? []).map(rowToTx).filter((t) => t.date <= date);
      if (transactions.length === 0) {
        result.skipped += 1;
        continue;
      }
      books.push({
        userId,
        transactions,
        instruments: catalogOf<InstrumentRow, Instrument>(data.instruments, userId, rowToInstrument, (i) => i.code),
        exposures: catalogOf<ExposureRow, Exposure>(data.exposures, userId, rowToExposure, (e) => e.id),
      });
    } catch {
      result.failed += 1;
    }
  }
  if (books.length === 0) return finish();

  // When no rate can be found (not even cached), don't write: USD assets must not be valued at a wrong rate
  const cache = { kv: env.QUOTES, fetch: deps.fetch, now: deps.now, budget: newBudget(QUOTE_BUDGET) };
  const fx = await getFx(null, cache).catch(() => null);
  if (!fx) {
    result.skipped += books.length;
    return finish();
  }

  // Every instrument held by any user that day, looked up once by market + code: the same 6-digit code may be an A-share for one user and a fund for another
  const wanted: Record<MarketKind, Set<string>> = { us: new Set(), cn: new Set(), fund: new Set() };
  for (const b of books) {
    for (const h of deriveLedger(b.transactions, currencyLookup(b.instruments)).holdings) {
      const kind = MARKET_KIND[b.instruments[h.code]?.market ?? MARKET.cash];
      if (kind && !isCashCode(h.code) && QUOTE_CODE[kind].test(h.code)) wanted[kind].add(h.code);
    }
  }
  const priceOf = new Map<string, number>();
  for (const kind of KINDS) {
    if (wanted[kind].size === 0) continue;
    for (const q of (await getQuotes(kind, [...wanted[kind]], cache)).quotes) priceOf.set(`${kind}:${q.code}`, q.price);
  }

  const rows: { userId: string; snapshot: Snapshot; items: SnapshotItem[] }[] = [];
  for (const b of books) {
    try {
      const prices: Prices = {};
      for (const inst of Object.values(b.instruments)) {
        const kind = MARKET_KIND[inst.market];
        const price = kind && priceOf.get(`${kind}:${inst.code}`);
        if (price) prices[inst.code] = price;
      }
      const r = computeSnapshot({ date, transactions: b.transactions, instruments: b.instruments, exposures: b.exposures, prices, fx: { CNY: 1, USD: fx.usd, HKD: fx.hkd } });
      if (![r.snapshot.totalValueCny, r.snapshot.netInvestedCny, ...r.items.map((i) => i.valueCny)].every(Number.isFinite)) throw new Error('Computed values are not finite');
      rows.push({ userId: b.userId, ...r });
    } catch {
      result.failed += 1;
    }
  }
  await admin.writeSnapshots(date, rows);
  result.written = rows.length;
  return finish();
}
