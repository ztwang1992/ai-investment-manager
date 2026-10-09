import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveLedger } from '../domain/ledger';
import { createFakeCloud } from './fakeRemote';
import { RemoteError } from './remote';
import type { FakeCloud } from './fakeRemote';
import { openLocalDb } from './localDb';
import type { LocalDb } from './localDb';
import { attachLocalDb, emptyData, hydrate, stateFromData } from './persistence';
import { createAppStore } from './store';
import { DEBOUNCE_MS, INITIAL_SYNC, PULL_OVERLAP_MS, RETRY_MS, SNAPSHOT_OVERLAP_DAYS, startSync } from './sync';
import type { SyncDeps, SyncStatus } from './sync';

const U = '11111111-1111-1111-1111-111111111111';
const storeDeps = { random: () => 0.5, delay: async () => {}, now: () => new Date(2026, 8, 29, 9, 30), schedule: () => () => {} };
let n = 0;
const dbs: LocalDb[] = [];
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete();
});
// All devices share one clock: a later change always has a later time
let clock = Date.parse('2026-09-30T08:00:00.000Z');
const now = () => new Date((clock += 1000)).toISOString();
const isRetry = (ms: number) => (RETRY_MS as readonly number[]).includes(ms);

/** A device signed in to the same account: local database, interface state, sync engine; timers fired by hand */
async function device(cloud: FakeCloud, userId = U, fxOn?: SyncDeps['fxOn']) {
  const db = openLocalDb(`sync-${++n}`);
  dbs.push(db);
  const store = createAppStore(storeDeps);
  store.setState(stateFromData(emptyData({ displayCurrency: 'CNY', hideAmounts: false })));
  await hydrate(store, db, now);
  let online = true;
  let status: SyncStatus = { ...INITIAL_SYNC };
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const remote = cloud.remoteFor(userId);
  let requestSync = () => {};
  const local = attachLocalDb(
    store,
    db,
    now,
    (e) => {
      throw e;
    },
    () => requestSync(),
  );
  const sync = startSync({
    remote,
    db,
    local,
    userId,
    isOnline: () => online,
    now: () => new Date(clock),
    schedule: (fn, ms) => {
      const t = { fn, ms, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    setStatus: (patch) => {
      status = { ...status, ...patch };
    },
    ...(fxOn ? { fxOn } : {}),
  });
  requestSync = sync.requestSync;
  const record = (id: string, qty = 100) =>
    store.getState().appendTransactions([
      { id, date: '2026-09-29', createdAt: now(), type: 'deposit', accountId: 'futu', instrumentCode: 'USD', qty, price: 1, fee: 0, fxToCny: 7.1 },
    ]);
  return {
    db,
    store,
    local,
    sync,
    remote,
    timers,
    record,
    status: () => status,
    setOnline: (v: boolean) => {
      online = v;
    },
    settle: async () => {
      await local.flush();
      await sync.syncNow();
      await local.flush();
    },
  };
}

describe('syncing with the cloud', () => {
  it('uploads new records in the order they were made and empties the queue', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.record('r-1');
    d.record('r-2');
    await d.settle();
    expect(cloud.rows.transactions.map((r) => r.id)).toEqual(['r-1', 'r-2']);
    expect(await d.db.outbox.count()).toBe(0);
    expect(d.status()).toMatchObject({ state: 'idle', pending: 0 });
  });

  it('keeps records while offline and uploads them once back online', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.setOnline(false);
    d.record('r-1');
    d.record('r-2');
    await d.settle();
    expect(cloud.rows.transactions).toEqual([]);
    expect(d.status()).toMatchObject({ state: 'offline', pending: 2 });
    d.setOnline(true);
    await d.settle();
    expect(cloud.rows.transactions).toHaveLength(2);
    expect(d.status().pending).toBe(0);
  });

  it('retries after a lost reply without recording anything twice', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.record('r-1');
    cloud.failNext('network', { afterStoring: true });
    await d.settle();
    expect(d.status()).toMatchObject({ state: 'error', pending: 1 });
    expect(d.timers.at(-1)!.ms).toBe(RETRY_MS[0]);
    d.timers.at(-1)!.fn();
    await d.settle();
    expect(cloud.rows.transactions.filter((r) => r.id === 'r-1')).toHaveLength(1);
    expect(d.status()).toMatchObject({ state: 'idle', pending: 0 });
  });

  it('waits longer after each failed try', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.record('r-1');
    cloud.failNext('server');
    await d.settle();
    cloud.failNext('server');
    d.timers.at(-1)!.fn();
    await d.settle();
    expect(d.timers.filter((t) => isRetry(t.ms)).map((t) => t.ms)).toEqual([RETRY_MS[0], RETRY_MS[1]]);
  });

  it('syncs a moment after a change instead of right away', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.record('r-1');
    await d.local.flush();
    expect(d.timers.at(-1)!.ms).toBe(DEBOUNCE_MS);
  });

  it('brings in records made on another device without sending them back', async () => {
    const cloud = createFakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    a.record('from-a');
    await a.settle();
    await b.settle();
    expect(b.store.getState().transactions.map((t) => t.id)).toContain('from-a');
    expect(await b.db.outbox.count()).toBe(0);
  });

  it('keeps the most recent setting whichever device changed it', async () => {
    const cloud = createFakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    a.store.getState().updatePlan({ threshold: 4 });
    await a.settle();
    await b.settle();
    expect(b.store.getState().plan.threshold).toBe(4);
    b.store.getState().updatePlan({ threshold: 7 });
    await b.settle();
    await a.settle();
    expect(a.store.getState().plan.threshold).toBe(7);
  });

  it('ends with the same holdings on two devices that both recorded offline', async () => {
    const cloud = createFakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    a.setOnline(false);
    b.setOnline(false);
    a.record('a-offline', 300);
    b.record('b-offline', 500);
    await a.settle();
    await b.settle();
    a.setOnline(true);
    b.setOnline(true);
    await a.settle();
    await b.settle();
    await a.settle();
    const ids = (d: typeof a) =>
      d.store
        .getState()
        .transactions.map((t) => t.id)
        .sort();
    expect(ids(a)).toEqual(['a-offline', 'b-offline']);
    expect(ids(b)).toEqual(ids(a));
    const ledger = (d: typeof a) => {
      const s = d.store.getState();
      return deriveLedger(s.transactions, (code) => s.instruments.find((i) => i.code === code)!.currency);
    };
    expect(ledger(b).holdings).toEqual(ledger(a).holdings);
    expect(ledger(a).netInvestedCny).toBeGreaterThan(0);
  });

  it('stops and asks to sign in again when the login has expired, keeping the queue', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.record('r-1');
    cloud.failNext('auth');
    await d.settle();
    expect(d.status()).toMatchObject({ state: 'signedOut', pending: 1 });
    expect(d.timers.some((t) => isRetry(t.ms))).toBe(false);
    expect(await d.db.outbox.count()).toBe(1);
  });

  it('counts only records as waiting', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.setOnline(false);
    d.store.getState().updatePlan({ threshold: 4 });
    await d.settle();
    expect(d.status().pending).toBe(0);
  });

  it('looks back a little when pulling so late arrivals are not missed', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    await d.settle();
    d.record('r-1');
    await d.settle();
    await d.settle();
    const [first, , third] = d.remote.sinceSeen;
    expect(first).toBeNull();
    const cursor = (await d.db.kv.get('pulledAt'))!.value as string;
    expect(third).toBe(new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString());
  });

  // Until a new device has read the cloud once, it can't tell whether the account is empty (onboarding waits for it)
  it('remembers that this device has read the cloud once', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    expect(d.status().pulledOnce).toBe(false);
    d.setOnline(false);
    await d.settle();
    expect(d.status().pulledOnce).toBe(false);
    d.setOnline(true);
    await d.settle();
    expect(d.status().pulledOnce).toBe(true);
  });

  // One device marks rebalancing done; after syncing, the other knows this period has been checked too
  it('brings the last rebalance to the other devices', async () => {
    const cloud = createFakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    a.store.getState().updatePlan({ lastRebalancedOn: '2026-10-03' });
    await a.settle();
    await b.settle();
    expect(b.store.getState().plan.lastRebalancedOn).toBe('2026-10-03');
  });

  it('does nothing after it has been stopped', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.sync.stop();
    d.record('r-1');
    await d.settle();
    expect(cloud.rows.transactions).toEqual([]);
  });
});

describe('exchange rates of offline records', () => {
  const cny = (id: string) => ({ id, date: '2026-09-29', createdAt: now(), type: 'deposit' as const, accountId: 'cmb', instrumentCode: 'CNY', qty: 500, price: 1, fee: 0, fxToCny: 1 });

  it('uploads an offline dollar record with the rate of the day it was made', async () => {
    const cloud = createFakeCloud();
    const asked: string[] = [];
    const d = await device(cloud, U, async (date) => {
      asked.push(date);
      return 6.7045;
    });
    d.record('r-1');
    await d.settle();
    expect(asked).toEqual(['2026-09-29']);
    expect(cloud.rows.transactions.map((r) => [r.id, Number(r.fx_to_cny)])).toEqual([['r-1', 6.7045]]);
    expect(d.store.getState().transactions.find((t) => t.id === 'r-1')!.fxToCny).toBe(6.7045);
    expect((await d.db.transactions.get('r-1'))!.fxToCny).toBe(6.7045);
  });

  it('keeps a record and everything after it queued until its rate can be found', async () => {
    const cloud = createFakeCloud();
    let rate: number | null = null;
    const d = await device(cloud, U, async () => rate);
    d.store.getState().appendTransactions([cny('c-1')]);
    d.record('r-1');
    d.store.getState().appendTransactions([cny('c-2')]);
    await d.settle();
    expect(cloud.rows.transactions.map((r) => r.id)).toEqual(['c-1']);
    expect(d.status()).toMatchObject({ state: 'idle', pending: 2 });
    rate = 6.7045;
    await d.settle();
    expect(cloud.rows.transactions.map((r) => r.id)).toEqual(['c-1', 'r-1', 'c-2']);
    expect(d.status().pending).toBe(0);
  });

  it('does not look up a rate for yuan records or records made with today\'s rate', async () => {
    const cloud = createFakeCloud();
    const asked: string[] = [];
    const d = await device(cloud, U, async (date) => {
      asked.push(date);
      return 6.7;
    });
    d.store.getState().appendTransactions([cny('c-1')]);
    d.store.setState({ fxLiveOn: d.store.getState().today });
    d.record('r-1');
    await d.settle();
    expect(asked).toEqual([]);
    expect(cloud.rows.transactions.map((r) => [r.id, Number(r.fx_to_cny)])).toEqual([
      ['c-1', 1],
      ['r-1', 7.1],
    ]);
  });

  // A recording date in the future: that day's rate isn't available yet, so today's is used
  it('uses today\'s rate for a record dated in the future', async () => {
    const cloud = createFakeCloud();
    const asked: string[] = [];
    const d = await device(cloud, U, async (date) => {
      asked.push(date);
      return 6.7;
    });
    d.store.getState().appendTransactions([{ ...cny('x'), id: 'r-9', date: '2027-01-01', accountId: 'futu', instrumentCode: 'USD', fxToCny: 7.1 }]);
    await d.settle();
    expect(asked).toEqual(['2026-09-30']);
    expect(cloud.rows.transactions).toHaveLength(1);
  });
});

describe('daily history from the cloud', () => {
  const snap = (date: string, total: number) => ({ user_id: U, date, total_value_cny: total, net_invested_cny: 90, usd_cny: 6.7 });
  const item = (date: string, exposure: string) => ({ user_id: U, date, exposure_id: exposure, value_cny: 1 });
  const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-09-${String(from + i).padStart(2, '0')}`);

  it('brings the daily history to a new device and keeps it there', async () => {
    const cloud = createFakeCloud();
    for (const date of days(27, 29)) cloud.writeSnapshot(snap(date, 100), [item(date, 'sp500')]);
    const d = await device(cloud);
    await d.settle();
    expect(d.store.getState().snapshots.map((s) => s.date)).toEqual(days(27, 29));
    expect(d.store.getState().snapshotItems).toHaveLength(3);
    // Reopened offline: the chart comes from the snapshots stored locally
    const again = createAppStore(storeDeps);
    await hydrate(again, d.db, now);
    expect(again.getState().snapshots.map((s) => s.date)).toEqual(days(27, 29));
  });

  // A 07:00 rerun, or a later recomputation, rewrites the last few days: every pull re-fetches 7 days back from the latest local day and replaces that stretch whole
  it('pulls the last week again and follows a rewritten day', async () => {
    const cloud = createFakeCloud();
    for (const date of days(10, 20)) cloud.writeSnapshot(snap(date, 100), [item(date, 'sp500'), item(date, 'moutai')]);
    const d = await device(cloud);
    const asked: (string | null)[] = [];
    const pull = d.remote.pullSnapshots.bind(d.remote);
    d.remote.pullSnapshots = (since) => {
      asked.push(since);
      return pull(since);
    };
    await d.settle();
    cloud.writeSnapshot(snap('2026-09-20', 150), [item('2026-09-20', 'sp500')]);
    cloud.writeSnapshot(snap('2026-09-21', 160), [item('2026-09-21', 'sp500')]);
    await d.sync.syncNow();
    expect(SNAPSHOT_OVERLAP_DAYS).toBe(7);
    expect(asked).toEqual([null, '2026-09-13']);
    const s = d.store.getState();
    expect(s.snapshots.map((x) => [x.date, x.totalValueCny]).slice(-3)).toEqual([
      ['2026-09-19', 100],
      ['2026-09-20', 150],
      ['2026-09-21', 160],
    ]);
    expect(s.snapshotItems.filter((x) => x.date === '2026-09-20').map((x) => x.exposureId)).toEqual(['sp500']);
    expect(s.snapshotItems.filter((x) => x.date === '2026-09-10')).toHaveLength(2);
  });

  it('retries like any other pull when the history cannot be fetched', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    const pull = d.remote.pullSnapshots.bind(d.remote);
    let fail = true;
    d.remote.pullSnapshots = async (since) => {
      if (fail) throw new RemoteError('network', 'down');
      return pull(since);
    };
    await d.settle();
    expect(d.status().state).toBe('error');
    expect(d.timers.at(-1)!.ms).toBe(RETRY_MS[0]);
    fail = false;
    cloud.writeSnapshot(snap('2026-09-29', 100), []);
    d.timers.at(-1)!.fn();
    await d.settle();
    expect(d.status().state).toBe('idle');
    expect(d.store.getState().snapshots).toHaveLength(1);
  });
});

// Phase 6: AI conversations, like transactions, are stored locally first and then synced, in a separate step after transactions and settings
describe('AI conversations', () => {
  /** Asks a question in a conversation and gets an answer: stores the question first (creating or updating the conversation), then the answer */
  function ask(d: Awaited<ReturnType<typeof device>>, conversationId: string, k: number) {
    const existing = d.store.getState().aiConversations.find((c) => c.id === conversationId);
    const askedAt = now();
    const conversation = { id: conversationId, title: existing?.title ?? `问题 ${k}`, createdAt: existing?.createdAt ?? askedAt, updatedAt: askedAt };
    d.store.getState().recordAiMessage({ conversation, message: { id: `q${k}`, conversationId, role: 'user', content: `问题 ${k}`, createdAt: askedAt } });
    const answeredAt = now();
    d.store.getState().recordAiMessage({
      conversation: { ...conversation, updatedAt: answeredAt },
      message: { id: `a${k}`, conversationId, role: 'assistant', content: `回答 ${k}`, createdAt: answeredAt },
    });
  }
  const ids = (d: Awaited<ReturnType<typeof device>>) => d.store.getState().aiMessages.map((m) => m.id);

  it('uploads a question and its reply, and empties the queue', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.store.setState({ aiConversations: [], aiMessages: [] });
    ask(d, 'c1', 1);
    await d.settle();
    expect(cloud.rows.aiConversations.map((r) => r.id)).toEqual(['c1']);
    expect(cloud.rows.aiMessages.map((r) => r.id)).toEqual(['q1', 'a1']);
    expect(await d.db.outbox.count()).toBe(0);
    expect(d.status().state).toBe('idle');
  });

  it('brings conversations from another device, in time order, without sending them back', async () => {
    const cloud = createFakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    ask(a, 'c1', 1);
    ask(a, 'c1', 2);
    await a.settle();
    await b.settle();
    expect(b.store.getState().aiConversations.map((c) => c.id)).toEqual(['c1']);
    expect(ids(b)).toEqual(['q1', 'a1', 'q2', 'a2']);
    expect(await b.db.aiMessages.count()).toBe(4);
    expect(await b.db.outbox.count()).toBe(0);
  });

  it('keeps both questions when two devices add to the same conversation', async () => {
    const cloud = createFakeCloud();
    const a = await device(cloud);
    const b = await device(cloud);
    ask(a, 'c1', 1);
    await a.settle();
    await b.settle();
    ask(b, 'c1', 2);
    ask(a, 'c1', 3);
    await b.settle();
    await a.settle();
    await b.settle();
    for (const d of [a, b]) {
      expect(ids(d)).toEqual(['q1', 'a1', 'q2', 'a2', 'q3', 'a3']);
      expect(d.store.getState().aiConversations).toHaveLength(1);
    }
    expect(a.store.getState().aiConversations[0]!.updatedAt).toBe(b.store.getState().aiConversations[0]!.updatedAt);
    expect(cloud.rows.aiConversations).toHaveLength(1);
  });

  it('stores a re-sent message once', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    ask(d, 'c1', 1);
    await d.settle();
    // The response was lost: the cloud has stored it, and it's still in the local queue
    await d.db.outbox.bulkAdd([
      { kind: 'aiConversation', key: 'c1' },
      { kind: 'aiMessage', key: 'q1' },
      { kind: 'aiMessage', key: 'a1' },
    ]);
    await d.settle();
    expect(cloud.rows.aiMessages.map((r) => r.id)).toEqual(['q1', 'a1']);
    expect(cloud.rows.aiConversations).toHaveLength(1);
    expect(await d.db.outbox.count()).toBe(0);
  });

  it('keeps records and settings syncing while the cloud lacks the AI columns, and catches up afterwards', async () => {
    const cloud = createFakeCloud();
    cloud.setAiReady(false);
    const a = await device(cloud);
    const b = await device(cloud);
    a.record('t1');
    ask(a, 'c1', 1);
    await a.settle();
    expect(cloud.rows.transactions.map((r) => r.id)).toEqual(['t1']);
    expect(a.status().state).toBe('error');
    await b.settle();
    expect(b.store.getState().transactions.map((t) => t.id)).toEqual(['t1']);
    cloud.setAiReady(true);
    await a.settle();
    await b.settle();
    expect(a.status().state).toBe('idle');
    expect(ids(b)).toEqual(['q1', 'a1']);
  });

  // A new device waits until it has "read the cloud once" before deciding whether to show onboarding; that depends only on transactions and settings, so a failed AI conversation sync mustn't block it
  it('counts the cloud as read once records and settings are in, even when the AI step fails', async () => {
    const cloud = createFakeCloud();
    cloud.setAiReady(false);
    const d = await device(cloud);
    await d.settle();
    expect(d.status()).toMatchObject({ state: 'error', pulledOnce: true });
  });

  it('keeps conversations queued while the upload fails, with records unaffected', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.record('t1');
    ask(d, 'c1', 1);
    await d.local.flush();
    cloud.failAiUploads(true);
    await d.sync.syncNow();
    expect(cloud.rows.transactions.map((r) => r.id)).toEqual(['t1']);
    expect(d.status().state).toBe('error');
    expect((await d.db.outbox.toArray()).map((e) => e.kind).sort()).toEqual(['aiConversation', 'aiConversation', 'aiMessage', 'aiMessage']);
    cloud.failAiUploads(false);
    await d.settle();
    expect(cloud.rows.aiMessages.map((r) => r.id)).toEqual(['q1', 'a1']);
  });

  it('does not count conversations as waiting records', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    d.setOnline(false);
    ask(d, 'c1', 1);
    await d.settle();
    expect(d.status().pending).toBe(0);
  });

  it('looks back a little when pulling conversations', async () => {
    const cloud = createFakeCloud();
    const d = await device(cloud);
    ask(d, 'c1', 1);
    await d.settle();
    await d.settle();
    const seen = d.remote.aiSinceSeen;
    expect(seen[0]).toBeNull();
    const cursor = (await d.db.kv.get('aiPulledAt'))!.value as string;
    expect(seen.at(-1)).toBe(new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString());
  });
});
