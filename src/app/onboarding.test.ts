import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { currencyLookup, deriveLedger } from '../domain/ledger';
import type { Transaction } from '../domain/types';
import type { OnboardingResult } from '../pages/onboarding/OnboardingPage';
import { createFakeCloud } from './fakeRemote';
import { openLocalDb } from './localDb';
import type { LocalDb } from './localDb';
import { loadData } from './persistence';
import { openSession } from './session';
import type { Session } from './session';
import { createAppStore } from './store';

// Finishing onboarding writes the accounts, new instruments, single-stock assets, opening transactions and targets to the account; the day's first snapshot is stored locally and uploaded (README「数据模型」snapshots).

const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const opened: LocalDb[] = [];
const sessions: Session[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const db of opened.splice(0)) await db.delete();
});

let n = 0;
async function newAccount(online = true) {
  const cloud = createFakeCloud();
  const net = { online };
  const store = createAppStore({ now: () => new Date('2026-09-29T02:00:00Z'), schedule: () => () => {} });
  const db = openLocalDb(`onb-${++n}`);
  opened.push(db);
  const s = await openSession(
    { id: A, email: 'a@example.com' },
    { store, remote: cloud.remoteFor(A), openDb: () => db, isOnline: () => net.online, schedule: () => () => {} },
  );
  if (s === 'unavailable') throw new Error('unavailable');
  sessions.push(s);
  return { cloud, net, store, db, session: s };
}

const opening = (id: string, accountId: string, code: string, qty: number, price: number, fxToCny: number): Transaction => ({
  id,
  date: '2026-09-29',
  createdAt: '2026-09-29T02:00:00.000Z',
  type: 'opening',
  accountId,
  instrumentCode: code,
  qty,
  price,
  fee: 0,
  fxToCny,
});
const result: OnboardingResult = {
  accounts: [
    { id: 'acct-futu', name: '富途', type: 'broker', currency: 'USD', market: '美股', color: 'var(--color-accent-700)' },
    { id: 'acct-cms', name: '招商证券', type: 'broker', currency: 'CNY', market: 'A股', color: 'var(--color-accent-400)' },
  ],
  exposures: [{ id: 'stock-MSFT', name: 'MSFT', groupId: 'stk', isStock: true }],
  instruments: [{ code: 'MSFT', name: '', market: '美股', currency: 'USD', exposureId: 'stock-MSFT', paysDividend: false }],
  transactions: [
    opening('o1', 'acct-futu', 'VOO', 10, 500, 7.1),
    opening('o2', 'acct-futu', 'MSFT', 4, 400, 7.1),
    opening('o3', 'acct-futu', 'USD', 300, 1, 7.1),
    opening('o4', 'acct-cms', '513500', 1000, 2, 1),
  ],
  targets: { sp500: 80, stocks: 15, usd: 5 },
};
const invested = 10 * 500 * 7.1 + 4 * 400 * 7.1 + 300 * 7.1 + 1000 * 2;

describe('finishing the first entry', () => {
  it('writes everything entered into the account, with principal equal to the cost entered', async () => {
    const { store, db, session } = await newAccount();
    await session.completeOnboarding(result);
    const s = store.getState();
    expect(s.accounts.map((a) => a.id)).toEqual(['acct-futu', 'acct-cms']);
    expect(s.exposures.some((e) => e.id === 'stock-MSFT')).toBe(true);
    expect(s.instruments.find((i) => i.code === 'MSFT')).toMatchObject({ exposureId: 'stock-MSFT' });
    expect(s.transactions.map((t) => t.id)).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(s.targets).toEqual({ sp500: 80, stocks: 15, usd: 5 });
    const ledger = deriveLedger(s.transactions, currencyLookup(Object.fromEntries(s.instruments.map((i) => [i.code, i]))));
    expect(ledger.netInvestedCny).toBeCloseTo(invested, 6);
    const back = await loadData(db);
    expect(back!.transactions).toHaveLength(4);
    expect(back!.accounts).toHaveLength(2);
    expect(back!.targets).toEqual({ sp500: 80, stocks: 15, usd: 5 });
  });

  it('saves today\'s first snapshot and uploads it with the records', async () => {
    const { cloud, store, session } = await newAccount();
    await session.completeOnboarding(result);
    expect(store.getState().snapshots.map((x) => x.date)).toEqual(['2026-09-29']);
    await session.syncNow();
    expect(cloud.rows.transactions).toHaveLength(4);
    expect(cloud.rows.accounts).toHaveLength(2);
    // No quotes yet: valued at cost, so total assets equal the net invested principal
    expect(cloud.rows.snapshots).toHaveLength(1);
    const row = cloud.rows.snapshots[0]!;
    expect(row).toMatchObject({ user_id: A, date: '2026-09-29' });
    expect(Number(row.net_invested_cny)).toBeCloseTo(invested, 6);
    expect(Number(row.total_value_cny)).toBeCloseTo(invested, 6);
    expect(cloud.rows.snapshotItems.map((r) => r.exposure_id).sort()).toEqual(['sp500', 'stock-MSFT', 'usd']);
  });

  it('keeps everything on the device when offline and uploads it once back online', async () => {
    const { cloud, net, db, session } = await newAccount(false);
    await session.completeOnboarding(result);
    await session.syncNow();
    expect(cloud.rows.transactions).toEqual([]);
    expect(await db.outbox.where('kind').equals('snapshot').count()).toBe(1);
    net.online = true;
    await session.syncNow();
    expect(cloud.rows.transactions).toHaveLength(4);
    expect(cloud.rows.snapshots).toHaveLength(1);
    expect(await db.outbox.count()).toBe(0);
  });

  // No exchange rate fetched online today: the USD opening transactions get the day's rate before upload (phase 4a)
  it('marks the opening records for the day\'s rate when the rate was not fetched today', async () => {
    const { db, session } = await newAccount();
    await session.completeOnboarding(result);
    const queued = await db.outbox.where('kind').equals('tx').toArray();
    expect(queued.find((e) => e.key === 'o1')!.fxPending).toBe(true);
  });
});
