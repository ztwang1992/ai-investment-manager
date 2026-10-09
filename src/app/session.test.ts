import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeCloud } from './fakeRemote';
import { openLocalDb, userDbName } from './localDb';
import type { LocalDb } from './localDb';
import { openSession } from './session';
import type { Session, SessionDeps } from './session';
import { sortTransactions } from '../domain/ledger';
import { dataFromState, sampleData, stateFromData } from './persistence';
import { createAppStore } from './store';
import { useSyncStore } from './sync';

const A = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'a@example.com' };
const B = { id: 'bbbbbbbb-0000-0000-0000-000000000002', email: 'b@example.com' };
const storeDeps = { random: () => 0.5, delay: async () => {}, now: () => new Date(2026, 8, 29, 9, 30), schedule: () => () => {} };
const opened: LocalDb[] = [];
const sessions: Session[] = [];
afterEach(async () => {
  for (const s of sessions.splice(0)) await s.close();
  for (const db of opened.splice(0)) await db.delete();
});

function deps(cloud = createFakeCloud(), userId = A.id, online = true): SessionDeps & { store: ReturnType<typeof createAppStore> } {
  return {
    store: createAppStore(storeDeps),
    remote: cloud.remoteFor(userId),
    openDb: (name) => {
      const db = openLocalDb(name);
      opened.push(db);
      return db;
    },
    isOnline: () => online,
    schedule: () => () => {},
  };
}
/** For tests: like the old "import sample data", writes the sample accounts, transactions, targets and plan to the account (written back locally and queued) */
function fillWithSample(store: ReturnType<typeof createAppStore>) {
  const s = store.getState();
  const sample = sampleData({ displayCurrency: s.displayCurrency, hideAmounts: s.hideAmounts }, s.locale);
  store.setState(
    stateFromData({
      ...dataFromState(s),
      accounts: sample.accounts,
      transactions: sortTransactions(sample.transactions),
      targets: sample.targets,
      ownStock: sample.ownStock,
      plan: sample.plan,
    }),
  );
}
const open = async (user: typeof A, d: SessionDeps) => {
  const s = await openSession(user, d);
  if (s === 'unavailable') throw new Error('unavailable');
  sessions.push(s);
  return s;
};
const closeEarly = async (s: Session) => {
  await s.close();
  sessions.splice(sessions.indexOf(s), 1);
};

describe('opening an account on this device', () => {
  it('starts a new account empty instead of with the sample data', async () => {
    const d = deps();
    const s = await open(A, d);
    await s.syncNow();
    expect(d.store.getState().transactions).toEqual([]);
    expect(d.store.getState().accounts).toEqual([]);
    expect(d.store.getState().exposures.length).toBeGreaterThan(0);
  });

  it('fills the device from the cloud', async () => {
    const cloud = createFakeCloud();
    const first = deps(cloud);
    const s1 = await open(A, first);
    fillWithSample(first.store);
    await s1.syncNow();
    await closeEarly(s1);
    const other = deps(cloud);
    other.openDb = (name) => {
      const db = openLocalDb(`${name}-second-device`);
      opened.push(db);
      return db;
    };
    const s2 = await open(A, other);
    await s2.syncNow();
    expect(other.store.getState().transactions).toHaveLength(36);
    expect(other.store.getState().accounts).toHaveLength(6);
  });

  it('brings the targets and plan to a new device', async () => {
    const cloud = createFakeCloud();
    const first = deps(cloud);
    const s1 = await open(A, first);
    first.store.getState().saveTargets({ sp500: 60, ndx: 40 }, {});
    first.store.getState().updatePlan({ threshold: 7 });
    await s1.syncNow();
    await closeEarly(s1);
    // A new device opened for the first time later: its defaults must not override settings in the cloud that are older but real
    const other = deps(cloud);
    other.now = () => new Date('2030-01-01T00:00:00.000Z');
    other.openDb = (name) => {
      const db = openLocalDb(`${name}-new-device`);
      opened.push(db);
      return db;
    };
    const s2 = await open(A, other);
    await s2.syncNow();
    expect(other.store.getState().targets).toEqual({ sp500: 60, ndx: 40 });
    expect(other.store.getState().plan.threshold).toBe(7);
  });

  // An account's history comes only from the Worker's snapshots; transactions recorded to the account bring no simulated curve
  it('does not make up a history for records added to the account', async () => {
    const d = deps();
    await open(A, d);
    fillWithSample(d.store);
    expect(d.store.getState().transactions).toHaveLength(36);
    expect(d.store.getState().snapshots).toEqual([]);
    expect(d.store.getState().snapshotItems).toEqual([]);
  });

  it('keeps each account on this device separate', async () => {
    const cloud = createFakeCloud();
    const a = deps(cloud, A.id);
    const sa = await open(A, a);
    fillWithSample(a.store);
    await sa.syncNow();
    await closeEarly(sa);
    const b = deps(cloud, B.id);
    b.store = a.store; // same device, same interface state
    const sb = await open(B, b);
    await sb.syncNow();
    expect(b.store.getState().transactions).toEqual([]);
    expect(opened.map((db) => db.name)).toEqual([userDbName(A.id), userDbName(B.id)]);
  });

  it('keeps unsent records when signing out and sends them after signing in again', async () => {
    const cloud = createFakeCloud();
    const offline = deps(cloud, A.id, false);
    const s = await open(A, offline);
    offline.store.getState().appendTransactions([
      {
        id: 'late-1',
        date: '2026-09-29',
        createdAt: '2026-09-30T08:00:00.000Z',
        type: 'deposit',
        accountId: 'futu',
        instrumentCode: 'USD',
        qty: 10,
        price: 1,
        fee: 0,
        fxToCny: 7.1,
      },
    ]);
    await closeEarly(s);
    const again = deps(cloud, A.id, true);
    const s2 = await open(A, again);
    await s2.syncNow();
    expect(cloud.rows.transactions.map((r) => r.id)).toEqual(['late-1']);
  });

  // A USD transaction recorded offline: uploaded after reopening, still given the rate of its recording day first
  it('sends an offline dollar record with the rate of its own day, even after a restart', async () => {
    const cloud = createFakeCloud();
    const offline = { ...deps(cloud, A.id, false), fxOn: async () => 6.7 };
    const s = await open(A, offline);
    offline.store.getState().appendTransactions([
      { id: 'usd-1', date: '2026-09-29', createdAt: '2026-09-30T08:00:00.000Z', type: 'deposit', accountId: 'futu', instrumentCode: 'USD', qty: 10, price: 1, fee: 0, fxToCny: 7.1 },
    ]);
    await closeEarly(s);
    const asked: string[] = [];
    const again = {
      ...deps(cloud, A.id, true),
      fxOn: async (date: string) => {
        asked.push(date);
        return 6.7045;
      },
    };
    const s2 = await open(A, again);
    await s2.syncNow();
    expect(asked).toEqual(['2026-09-29']);
    expect(cloud.rows.transactions.map((r) => [r.id, Number(r.fx_to_cny)])).toEqual([['usd-1', 6.7045]]);
  });

  it('knows at once that this device already read the cloud before', async () => {
    const cloud = createFakeCloud();
    const first = deps(cloud);
    const s1 = await open(A, first);
    await s1.syncNow();
    expect(useSyncStore.getState().pulledOnce).toBe(true);
    await closeEarly(s1);
    expect(useSyncStore.getState().pulledOnce).toBe(false);
    const offline = deps(cloud, A.id, false);
    offline.openDb = first.openDb;
    await open(A, offline);
    expect(useSyncStore.getState().pulledOnce).toBe(true);
  });

  // Phase 6: the AI key and settings live in each account's own local database; accounts don't share them
  it("keeps each account's AI key on this device, separately", async () => {
    const cloud = createFakeCloud();
    const a = await open(A, deps(cloud));
    await a.aiVault.save({ base: 'https://api.deepseek.com', model: 'deepseek-chat', key: 'sk-test-a', consent: true, web: true });
    await closeEarly(a);
    const again = deps(cloud);
    again.openDb = (name) => openLocalDb(name);
    const a2 = await open(A, again);
    expect((await a2.aiVault.load())!.key).toBe('sk-test-a');
    await closeEarly(a2);
    const b = await open(B, deps(cloud, B.id));
    expect(await b.aiVault.load()).toBeNull();
    await openLocalDb(userDbName(A.id)).delete();
  });

  it('reports a device that cannot store data', async () => {
    const d = deps();
    d.openDb = () => {
      throw new Error('blocked');
    };
    expect(await openSession(A, d)).toBe('unavailable');
  });
});

describe('looking at the sample data first', () => {
  const usd = { id: 'demo-1', date: '2026-09-29', createdAt: '2026-09-29T08:00:00.000Z', type: 'deposit' as const, accountId: 'futu', instrumentCode: 'USD', qty: 10, price: 1, fee: 0, fxToCny: 7.1 };

  it('shows the sample on this device without saving or uploading anything', async () => {
    const cloud = createFakeCloud();
    const d = deps(cloud);
    const s = await open(A, d);
    await s.syncNow();
    const db = opened.at(-1)!;
    await s.startDemo();
    const shown = d.store.getState();
    expect(shown.demo).toBe(true);
    expect(shown.accounts).toHaveLength(6);
    expect(shown.snapshots.length).toBeGreaterThan(600);
    shown.updatePlan({ threshold: 9 });
    shown.appendTransactions([usd]);
    await s.syncNow();
    expect(await db.outbox.count()).toBe(0);
    expect(await db.transactions.count()).toBe(0);
    expect(cloud.rows.transactions).toEqual([]);
    expect(cloud.rows.plans).toEqual([]);
  });

  it('shows the two sample conversations and keeps questions asked during the demo off the device', async () => {
    const cloud = createFakeCloud();
    const d = deps(cloud);
    const s = await open(A, d);
    await s.syncNow();
    const db = opened.at(-1)!;
    await s.startDemo();
    expect(d.store.getState().aiConversations.map((c) => c.title)).toEqual(['My Treasuries are overweight. Should I rebalance now?', 'Adding before year end']);
    d.store.getState().recordAiMessage({
      conversation: { id: 'demo-c', title: '演示里的问题', createdAt: '2026-10-03T08:00:00.000Z', updatedAt: '2026-10-03T08:00:00.000Z' },
      message: { id: 'demo-q', conversationId: 'demo-c', role: 'user', content: '演示里的问题', createdAt: '2026-10-03T08:00:00.000Z' },
    });
    await s.syncNow();
    expect(await db.aiMessages.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(cloud.rows.aiMessages).toEqual([]);
    await s.endDemo();
    expect(d.store.getState().aiConversations).toEqual([]);
    expect(d.store.getState().aiMessages).toEqual([]);
  });

  // No sync during the demo: other devices' changes must not mix into the sample data; they're pulled after the demo ends
  it('keeps changes from other devices out of the sample until the demo ends', async () => {
    const cloud = createFakeCloud();
    const d = deps(cloud);
    const s = await open(A, d);
    await s.syncNow();
    await s.startDemo();
    await cloud.remoteFor(A.id).upsert('account', [
      { user_id: A.id, id: 'acct-other', name: '另一台设备加的', type: 'broker', currency: 'USD', market: '美股', color: null, position: 0, updated_at: '2026-10-02T00:00:00.000Z' },
    ]);
    await s.syncNow();
    expect(d.store.getState().accounts.some((a) => a.id === 'acct-other')).toBe(false);
    await s.endDemo();
    expect(d.store.getState().accounts.map((a) => a.id)).toEqual(['acct-other']);
  });

  it('goes back to the empty account, ready for the first entry, and syncs again', async () => {
    const cloud = createFakeCloud();
    const d = deps(cloud);
    const s = await open(A, d);
    await s.startDemo();
    d.store.getState().appendTransactions([usd]);
    await s.endDemo({ startOnboarding: true });
    const back = d.store.getState();
    expect(back).toMatchObject({ demo: false, onboardingStep: 1 });
    expect(back.accounts).toEqual([]);
    expect(back.transactions).toEqual([]);
    back.addAccount({ id: 'acct-1', name: '富途', type: 'broker', currency: 'USD', market: '美股' });
    await s.syncNow();
    expect(cloud.rows.accounts.map((r) => r.id)).toEqual(['acct-1']);
  });
});
