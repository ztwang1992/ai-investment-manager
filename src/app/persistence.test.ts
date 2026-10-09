import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { accountToRow, planToRow, txToRow } from '../domain/rows';
import { openLocalDb } from './localDb';
import type { LocalDb } from './localDb';
import { attachLocalDb, dataFromState, emptyData, hydrate, loadData, sampleData, saveAll, stateFromData } from './persistence';
import { createAppStore } from './store';

let n = 0;
const dbs: LocalDb[] = [];
const freshDb = () => {
  const db = openLocalDb(`test-${++n}`);
  dbs.push(db);
  return db;
};
afterEach(async () => {
  for (const db of dbs.splice(0)) await db.delete();
});
const deps = { random: () => 0.5, delay: async () => {}, now: () => new Date(2026, 8, 29, 9, 30), schedule: () => () => {} };
const NOW = '2026-09-30T08:00:00.000Z';

describe('local data', () => {
  it('has nothing before the first save', async () => {
    expect(await loadData(freshDb())).toBeNull();
  });

  it('reads back exactly what was saved', async () => {
    const db = freshDb();
    const data = dataFromState(createAppStore(deps).getState());
    await saveAll(db, data, NOW);
    const back = await loadData(db);
    expect(back!.transactions.map((t) => t.id).sort()).toEqual(data.transactions.map((t) => t.id).sort());
    // IndexedDB returns rows by primary key; the order field keeps the list order
    expect(back!.accounts).toEqual(data.accounts.map((a, i) => ({ ...a, updatedAt: NOW, order: i })));
    expect(back!.exposures.map((e) => e.id)).toEqual(data.exposures.map((e) => e.id));
    expect(back!.instruments.map((i) => i.code)).toEqual(data.instruments.map((i) => i.code));
    expect(back!.targets).toEqual(data.targets);
    expect(back!.plan).toEqual(data.plan);
    expect(back!.quotes).toEqual(data.quotes);
    expect(back!.prefs).toEqual(data.prefs);
  });

  // Phase 4b: an account's history is the Worker's daily snapshots, no longer simulated from transactions
  it('keeps the stored history instead of rebuilding it from records', () => {
    const s = createAppStore(deps).getState();
    const snapshots = [
      { date: '2026-09-27', totalValueCny: 100, netInvestedCny: 90, usdCny: 6.7 },
      { date: '2026-09-28', totalValueCny: 110, netInvestedCny: 90, usdCny: 6.71 },
    ];
    const snapshotItems = [{ date: '2026-09-28', exposureId: 'sp500', valueCny: 110 }];
    const state = stateFromData({ ...dataFromState(s), snapshots, snapshotItems });
    expect(state.snapshots).toEqual(snapshots);
    expect(state.snapshotItems).toEqual(snapshotItems);
  });

  it('saves the history on the device and reads it back', async () => {
    const db = freshDb();
    const snapshots = [{ date: '2026-09-28', totalValueCny: 110, netInvestedCny: 90, usdCny: 6.71 }];
    const snapshotItems = [
      { date: '2026-09-28', exposureId: 'cny', valueCny: 10 },
      { date: '2026-09-28', exposureId: 'sp500', valueCny: 100 },
    ];
    await saveAll(db, { ...emptyData({ displayCurrency: 'CNY', hideAmounts: false }), snapshots, snapshotItems }, NOW);
    const back = await loadData(db);
    expect(back!.snapshots).toEqual(snapshots);
    expect(back!.snapshotItems).toEqual(snapshotItems);
  });

  it('gives a new account no history and the sample its simulated years', () => {
    const empty = emptyData({ displayCurrency: 'CNY', hideAmounts: false });
    expect(empty.snapshots).toEqual([]);
    expect(empty.snapshotItems).toEqual([]);
    expect(sampleData({ displayCurrency: 'CNY', hideAmounts: false }, 'zh').snapshots.length).toBeGreaterThan(600);
  });

  // A new account hasn't fetched quotes yet: holdings are valued at cost, never filled in with the sample prices
  it('starts a new account without sample prices', () => {
    const data = emptyData({ displayCurrency: 'CNY', hideAmounts: false });
    expect(data.quotes).toMatchObject({ prices: {}, navDates: {}, updatedAt: null, fxLiveOn: null });
    expect(data.quotes.fx.USD).toBeGreaterThan(0);
  });

  it('remembers on which day the exchange rate was last fetched', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    store.setState({ fxLiveOn: '2026-10-01' });
    await saveAll(db, dataFromState(store.getState()), NOW);
    const back = await loadData(db);
    expect(stateFromData(back!).fxLiveOn).toBe('2026-10-01');
    // Local data saved before this version doesn't have this field
    const { fxLiveOn: _, ...older } = back!.quotes;
    expect(stateFromData({ ...back!, quotes: older }).fxLiveOn).toBeNull();
  });

  it('builds the sample data with the given preferences', () => {
    const data = sampleData({ displayCurrency: 'USD', hideAmounts: true }, 'zh');
    expect(data.prefs).toEqual({ displayCurrency: 'USD', hideAmounts: true });
    expect(data.transactions).toHaveLength(36);
    expect(data.accounts).toHaveLength(6);
  });
});

describe('writing changes back', () => {
  const reload = async (db: LocalDb) => {
    const store = createAppStore(deps);
    store.setState(stateFromData((await loadData(db))!));
    return store.getState();
  };

  it('keeps everything the user changed across a reload', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    const s = store.getState();
    const deposit = {
      ...s.transactions[0]!,
      id: 'new-1',
      type: 'deposit' as const,
      instrumentCode: 'USD',
      qty: 1000,
      price: 1,
      date: '2026-09-29',
      createdAt: '2026-09-30T08:00:00.000Z',
    };
    s.appendTransactions([deposit]);
    s.addAccount({ id: 'tiger', name: '老虎', type: 'broker', currency: 'USD', market: '美股' });
    s.addExposure({ id: 'custom-btc', name: '比特币', groupId: 'other', isStock: false });
    s.addInstrument({ code: 'ABCD', name: '', market: '美股', currency: 'USD', exposureId: 'ndx', paysDividend: false });
    s.saveTargets({ sp500: 100 }, {});
    s.updatePlan({ threshold: 5 });
    s.setDisplayCurrency('USD');
    s.toggleHideAmounts();
    await local.flush();

    const back = await reload(db);
    expect(back.transactions.find((t) => t.id === 'new-1')).toMatchObject({ type: 'deposit', qty: 1000 });
    expect(back.transactions).toHaveLength(37);
    expect(back.accounts.at(-1)!.id).toBe('tiger');
    expect(back.accounts.map((a) => a.id).slice(0, 3)).toEqual(['futu', 'ibkr', 'schwab']);
    expect(back.exposures.at(-1)!.id).toBe('custom-btc');
    expect(back.instruments.at(-1)!.code).toBe('ABCD');
    expect(back.targets).toEqual({ sp500: 100 });
    expect(back.plan.threshold).toBe(5);
    expect(back.displayCurrency).toBe('USD');
    expect(back.hideAmounts).toBe(true);
    expect(back.snapshots).toEqual(s.snapshots);
  });

  const usd = (id: string) => ({
    id,
    date: '2026-09-29',
    createdAt: '2026-09-30T08:00:00.000Z',
    type: 'deposit' as const,
    accountId: 'futu',
    instrumentCode: 'USD',
    qty: 1000,
    price: 1,
    fee: 0,
    fxToCny: 7.1,
  });

  it('flags records made without today\'s exchange rate for a check before upload', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    store.getState().appendTransactions([usd('a')]);
    store.setState({ fxLiveOn: store.getState().today });
    store.getState().appendTransactions([usd('b')]);
    await local.flush();
    const queued = await db.outbox.where('kind').equals('tx').toArray();
    expect(queued.map((e) => [e.key, e.fxPending ?? false])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });

  it('changes the rate of a record that is still waiting to upload', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    store.getState().appendTransactions([usd('a')]);
    await local.flush();
    // Recording a transaction doesn't recompute the return history; compute it once at the old rate for comparison
    const history = store.getState().snapshots;
    const queued = await db.outbox.count();
    await local.updateFx([{ id: 'a', fxToCny: 6.7045 }]);
    await local.flush();
    expect(store.getState().transactions.find((t) => t.id === 'a')!.fxToCny).toBe(6.7045);
    expect((await db.transactions.get('a'))!.fxToCny).toBe(6.7045);
    // The history is the cloud's snapshots, and the next day's snapshot uses the new rate; nothing is queued again
    expect(store.getState().snapshots).toBe(history);
    expect(await db.outbox.count()).toBe(queued);
  });

  it('stamps only the settings that changed', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => '2026-10-01T00:00:00.000Z', () => {});
    store.getState().addAccount({ id: 'tiger', name: '老虎', type: 'broker', currency: 'USD', market: '美股' });
    await local.flush();
    expect(await db.accounts.get('tiger')).toMatchObject({ updatedAt: '2026-10-01T00:00:00.000Z', order: 6 });
    expect((await db.accounts.get('futu'))!.updatedAt).toBe(NOW);
  });

  it('never rewrites a stored transaction', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    const first = store.getState().transactions[0]!;
    store.setState({ transactions: [{ ...first, qty: 999 }, ...store.getState().transactions.slice(1)] });
    await local.flush();
    expect((await db.transactions.get(first.id))!.qty).toBe(first.qty);
  });

  it('reports a failed write', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const errors: unknown[] = [];
    const local = attachLocalDb(store, db, () => NOW, (e) => errors.push(e));
    db.close();
    store.getState().updatePlan({ threshold: 4 });
    await local.flush();
    expect(errors).toHaveLength(1);
  });

  it('queues each new record for upload in the order it was made', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    const base = store.getState().transactions[0]!;
    store.getState().appendTransactions([{ ...base, id: 'n-1' }]);
    store.getState().appendTransactions([{ ...base, id: 'n-2' }]);
    await local.flush();
    expect((await db.outbox.orderBy('seq').toArray()).map((e) => `${e.kind}:${e.key}`)).toEqual(['tx:n-1', 'tx:n-2']);
  });

  it('queues changed settings but not display preferences or quotes', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    const s = store.getState();
    s.addAccount({ id: 'tiger', name: '老虎', type: 'broker', currency: 'USD', market: '美股' });
    s.addExposure({ id: 'custom-btc', name: '比特币', groupId: 'other', isStock: false });
    s.saveTargets({ sp500: 100 }, {});
    s.updatePlan({ threshold: 5 });
    s.toggleHideAmounts();
    store.setState({ prices: { ...s.prices, VOO: 1 } });
    await local.flush();
    expect((await db.outbox.toArray()).map((e) => `${e.kind}:${e.key}`).sort()).toEqual([
      'account:tiger',
      'exposure:custom-btc',
      'plan:plan',
      'targets:targets',
    ]);
    expect((await db.exposures.get('custom-btc'))!.own).toBe(true);
  });

  it('tells the sync that something new is waiting', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    let queued = 0;
    const local = attachLocalDb(store, db, () => NOW, () => {}, () => (queued += 1));
    store.getState().updatePlan({ threshold: 5 });
    await local.flush();
    expect(queued).toBe(1);
  });
});

describe('history from the cloud', () => {
  const snap = (date: string, total: number) => ({ date, totalValueCny: total, netInvestedCny: 90, usdCny: 6.7 });
  const item = (date: string, exposureId: string) => ({ date, exposureId, valueCny: 1 });

  async function deviceWithHistory() {
    const db = freshDb();
    const store = createAppStore(deps);
    const data = {
      ...emptyData({ displayCurrency: 'CNY' as const, hideAmounts: false }),
      snapshots: [snap('2026-09-20', 100), snap('2026-09-25', 100), snap('2026-09-28', 100)],
      snapshotItems: [item('2026-09-20', 'sp500'), item('2026-09-28', 'moutai'), item('2026-09-28', 'sp500')],
    };
    await saveAll(db, data, NOW);
    store.setState(stateFromData(data));
    return { db, store, local: attachLocalDb(store, db, () => NOW, () => {}) };
  }

  // A rerun rewrites the last few days: the pulled days replace those days whole, earlier days stay; assets no longer held after the rewrite are deleted too
  it('replaces the recent days with what the cloud has and keeps the older ones', async () => {
    const { db, store, local } = await deviceWithHistory();
    await local.applySnapshots('2026-09-25', [snap('2026-09-25', 105), snap('2026-09-28', 108), snap('2026-09-29', 109)], [item('2026-09-28', 'sp500'), item('2026-09-29', 'sp500')]);
    const expected = [snap('2026-09-20', 100), snap('2026-09-25', 105), snap('2026-09-28', 108), snap('2026-09-29', 109)];
    const expectedItems = [item('2026-09-20', 'sp500'), item('2026-09-28', 'sp500'), item('2026-09-29', 'sp500')];
    expect(store.getState().snapshots).toEqual(expected);
    expect(store.getState().snapshotItems).toEqual(expectedItems);
    const back = await loadData(db);
    expect(back!.snapshots).toEqual(expected);
    expect(back!.snapshotItems).toEqual(expectedItems);
    expect(await db.outbox.count()).toBe(0);
  });

  it('replaces everything on the first pull', async () => {
    const { store, local } = await deviceWithHistory();
    await local.applySnapshots(null, [snap('2026-09-29', 109)], []);
    expect(store.getState().snapshots).toEqual([snap('2026-09-29', 109)]);
    expect(store.getState().snapshotItems).toEqual([]);
  });

  // Until the onboarding day's first snapshot is uploaded, the cloud doesn't have that day: the pulled result must not wipe it out
  it('keeps a first snapshot that is still waiting to upload', async () => {
    const { db, store, local } = await deviceWithHistory();
    await local.saveFirstSnapshot(snap('2026-09-29', 120), [item('2026-09-29', 'sp500')]);
    await local.applySnapshots(null, [snap('2026-09-28', 100)], []);
    expect(store.getState().snapshots).toEqual([snap('2026-09-28', 100), snap('2026-09-29', 120)]);
    expect((await loadData(db))!.snapshots).toEqual([snap('2026-09-28', 100), snap('2026-09-29', 120)]);
    expect(await db.outbox.where('kind').equals('snapshot').count()).toBe(1);
  });

  // Every sync re-pulls the last few days; when nothing changed, the interface isn't disturbed
  it('leaves the screen alone when nothing changed', async () => {
    const { store, local } = await deviceWithHistory();
    const before = store.getState().snapshots;
    await local.applySnapshots('2026-09-25', [snap('2026-09-25', 100), snap('2026-09-28', 100)], [item('2026-09-28', 'moutai'), item('2026-09-28', 'sp500')]);
    expect(store.getState().snapshots).toBe(before);
  });
});

describe('starting up', () => {
  it('writes the sample data on the first start and reads it back afterwards', async () => {
    const db = freshDb();
    const first = createAppStore(deps);
    expect(await hydrate(first, db, () => NOW)).toBe('seeded');
    const local = attachLocalDb(first, db, () => NOW, () => {});
    first.getState().updatePlan({ threshold: 6 });
    await local.flush();

    const second = createAppStore(deps);
    expect(await hydrate(second, db, () => NOW)).toBe('loaded');
    expect(second.getState().plan.threshold).toBe(6);
  });

  it('keeps the amounts hidden after a reload', async () => {
    const db = freshDb();
    const first = createAppStore(deps);
    await hydrate(first, db, () => NOW);
    const local = attachLocalDb(first, db, () => NOW, () => {});
    first.getState().toggleHideAmounts();
    await local.flush();
    const second = createAppStore(deps);
    await hydrate(second, db, () => NOW);
    expect(second.getState().hideAmounts).toBe(true);
  });

  it('gives up cleanly when the device storage cannot be opened', async () => {
    const broken = { kv: { get: () => Promise.reject(new Error('blocked')) } } as unknown as LocalDb;
    const store = createAppStore(deps);
    await expect(hydrate(store, broken, () => NOW)).rejects.toThrow('blocked');
    expect(store.getState().transactions).toHaveLength(36);
  });
});

describe('upgrading the device database', () => {
  const V1 = { transactions: 'id, date, createdAt', accounts: 'id', exposures: 'id', instruments: 'code', kv: 'key' };
  /** Writes the sample data into the tables of the old version */
  async function oldDevice(name: string, versions: number) {
    const old = new Dexie(name);
    old.version(1).stores(V1);
    if (versions >= 2) old.version(2).stores({ outbox: '++seq, kind' });
    if (versions >= 3) old.version(3).stores({ snapshots: 'date', snapshotItems: '[date+exposureId], date' });
    await old.open();
    const d = dataFromState(createAppStore(deps).getState());
    const kvRow = (key: string, value: unknown) => ({ key, value, updatedAt: NOW });
    await old.table('transactions').bulkPut(d.transactions);
    await old.table('accounts').bulkPut(d.accounts.map((a, order) => ({ ...a, updatedAt: NOW, order })));
    await old.table('exposures').bulkPut(d.exposures.map((e, order) => ({ ...e, updatedAt: NOW, order })));
    await old.table('instruments').bulkPut(d.instruments.map((i, order) => ({ ...i, updatedAt: NOW, order })));
    await old.table('kv').bulkPut([
      kvRow('targets', { targets: d.targets, ownStock: d.ownStock }),
      kvRow('plan', d.plan),
      kvRow('quotes', d.quotes),
      kvRow('prefs', d.prefs),
      kvRow('seededAt', NOW),
    ]);
    old.close();
  }

  it('keeps the data saved before the upload queue existed', async () => {
    const name = `test-v1-${++n}`;
    await oldDevice(name, 1);
    const db = openLocalDb(name);
    dbs.push(db);
    const back = await loadData(db);
    expect(back!.transactions).toHaveLength(36);
    expect(await db.outbox.count()).toBe(0);
  });

  it('keeps the data saved before conversations were stored, with no conversations yet', async () => {
    const name = `test-v3-${++n}`;
    await oldDevice(name, 3);
    const db = openLocalDb(name);
    dbs.push(db);
    const back = await loadData(db);
    expect(back!.transactions).toHaveLength(36);
    expect(back!.aiConversations).toEqual([]);
    expect(back!.aiMessages).toEqual([]);
  });

  it('keeps the data saved before the history was stored, with no history yet', async () => {
    const name = `test-v2-${++n}`;
    await oldDevice(name, 2);
    const db = openLocalDb(name);
    dbs.push(db);
    const back = await loadData(db);
    expect(back!.transactions).toHaveLength(36);
    expect(back!.snapshots).toEqual([]);
    expect(back!.snapshotItems).toEqual([]);
  });
});

describe('applying changes from the cloud', () => {
  const U = '11111111-1111-1111-1111-111111111111';
  const none = { transactions: [], accounts: [], exposures: [], instruments: [], targets: [], plans: [] };
  const setup = async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    const local = attachLocalDb(store, db, () => NOW, () => {});
    return { db, store, local };
  };
  const cloudTx = (id: string) => ({
    ...txToRow({ ...createAppStore(deps).getState().transactions[0]!, id }, U),
    inserted_at: '2026-09-30T09:00:00+00:00',
  });

  it('adds records from another device without sending them back', async () => {
    const { db, store, local } = await setup();
    await local.applyRemote({ ...none, transactions: [cloudTx('other-1')] });
    await local.flush();
    expect(store.getState().transactions.map((t) => t.id)).toContain('other-1');
    expect(await db.transactions.get('other-1')).toBeDefined();
    expect(await db.outbox.count()).toBe(0);
    // When this device records another transaction later, the pulled one isn't written again as new
    store.getState().appendTransactions([{ ...store.getState().transactions[0]!, id: 'mine-1' }]);
    await local.flush();
    expect((await db.outbox.toArray()).map((e) => e.key)).toEqual(['mine-1']);
  });

  it('takes a newer setting from the cloud and keeps its time', async () => {
    const { db, store, local } = await setup();
    const account = { ...accountToRow(store.getState().accounts[0]!, { updatedAt: '2026-09-30T09:00:00.000Z', order: 0 }, U), name: '富途牛牛' };
    await local.applyRemote({ ...none, accounts: [account] });
    expect(store.getState().accounts[0]!.name).toBe('富途牛牛');
    expect((await db.accounts.get('futu'))!.updatedAt).toBe('2026-09-30T09:00:00.000Z');
    expect(await db.outbox.count()).toBe(0);
  });

  it('keeps a newer change made on this device', async () => {
    const { store, local } = await setup();
    // Changed locally at 08:00 (NOW); the cloud copy is from 07:00
    store.getState().updatePlan({ threshold: 6 });
    await local.flush();
    await local.applyRemote({ ...none, plans: [{ ...planToRow(store.getState().plan, '2026-09-30T07:00:00.000Z', U), threshold: 9 }] });
    expect(store.getState().plan.threshold).toBe(6);
  });

  it('does not ask for another upload after applying cloud changes', async () => {
    const db = freshDb();
    const store = createAppStore(deps);
    await saveAll(db, dataFromState(store.getState()), NOW);
    let queued = 0;
    const local = attachLocalDb(store, db, () => NOW, () => {}, () => (queued += 1));
    await local.applyRemote({ ...none, plans: [{ ...planToRow(store.getState().plan, '2026-09-30T09:00:00.000Z', U), threshold: 9 }] });
    await local.flush();
    expect(store.getState().plan.threshold).toBe(9);
    expect(queued).toBe(0);
  });

  it('drops a queued change that a newer one from the cloud replaced', async () => {
    const { db, store, local } = await setup();
    store.getState().updatePlan({ threshold: 6 });
    await local.flush();
    expect(await db.outbox.count()).toBe(1);
    await local.applyRemote({ ...none, plans: [{ ...planToRow(store.getState().plan, '2026-09-30T09:00:00.000Z', U), threshold: 9 }] });
    expect(store.getState().plan.threshold).toBe(9);
    expect(await db.outbox.count()).toBe(0);
  });
});

// Phase 6: AI conversations are stored locally like transactions and synced once online
describe('AI conversations on this device', () => {
  const prefs = { displayCurrency: 'CNY' as const, hideAmounts: false };
  const conversation = { id: 'c1', title: '美债超配要不要现在调？', createdAt: '2026-10-03T08:00:00.000Z', updatedAt: '2026-10-03T08:00:00.000Z' };
  const question = { id: 'q1', conversationId: 'c1', role: 'user' as const, content: '美债超配要不要现在调？', createdAt: '2026-10-03T08:00:00.000Z' };
  const reply = { id: 'a1', conversationId: 'c1', role: 'assistant' as const, content: '1. 超配约 11%。', createdAt: '2026-10-03T08:00:05.000Z' };
  const later = { ...conversation, updatedAt: reply.createdAt };

  async function account() {
    const db = freshDb();
    const store = createAppStore(deps);
    store.setState(stateFromData(emptyData(prefs)));
    await hydrate(store, db, () => NOW);
    const local = attachLocalDb(store, db, () => NOW, (e) => {
      throw e;
    });
    return { db, store, local };
  }

  it('starts a new account without conversations, and the sample with its two', () => {
    expect(emptyData(prefs).aiConversations).toEqual([]);
    expect(emptyData(prefs).aiMessages).toEqual([]);
    expect(sampleData(prefs, 'zh').aiConversations.map((c) => c.title)).toEqual(['美债超配要不要现在调？', '年底前的加仓计划']);
    expect(sampleData(prefs, 'zh').aiMessages).toHaveLength(4);
  });

  it('keeps questions and replies across a reload, in time order', async () => {
    const { db, store, local } = await account();
    store.getState().recordAiMessage({ conversation, message: question });
    store.getState().recordAiMessage({ conversation: later, message: reply });
    await local.flush();
    const again = createAppStore(deps);
    await hydrate(again, db, () => NOW);
    expect(again.getState().aiConversations).toEqual([later]);
    expect(again.getState().aiMessages).toEqual([question, reply]);
  });

  it('queues the conversation before each of its messages', async () => {
    const { db, store, local } = await account();
    store.getState().recordAiMessage({ conversation, message: question });
    store.getState().recordAiMessage({ conversation: later, message: reply });
    await local.flush();
    expect((await db.outbox.orderBy('seq').toArray()).map((e) => `${e.kind}:${e.key}`)).toEqual([
      'aiConversation:c1',
      'aiMessage:q1',
      'aiConversation:c1',
      'aiMessage:a1',
    ]);
  });

  it('takes conversations from the cloud without queueing them, and keeps a newer one from this device', async () => {
    const { db, store, local } = await account();
    store.getState().recordAiMessage({ conversation: later, message: reply });
    await local.flush();
    await db.outbox.clear();
    const other = { id: 'c2', title: '年底前的加仓计划', createdAt: '2026-10-03T07:00:00.000Z', updatedAt: '2026-10-03T07:00:01.000Z' };
    const otherQuestion = { id: 'q2', conversationId: 'c2', role: 'user' as const, content: '年底前怎么安排？', createdAt: '2026-10-03T07:00:00.000Z' };
    await local.applyAi([conversation, other], [question, otherQuestion, reply]);
    expect(store.getState().aiConversations).toEqual([later, other]);
    expect(store.getState().aiMessages).toEqual([otherQuestion, question, reply]);
    expect(await db.outbox.count()).toBe(0);
    expect((await db.aiMessages.toArray()).map((m) => m.id).sort()).toEqual(['a1', 'q1', 'q2']);
    expect((await db.aiConversations.get('c1'))!.updatedAt).toBe(later.updatedAt);
  });

  it('takes a newer version of a conversation from the cloud', async () => {
    const { db, store, local } = await account();
    store.getState().recordAiMessage({ conversation, message: question });
    await local.flush();
    await local.applyAi([later], [reply]);
    expect(store.getState().aiConversations).toEqual([later]);
    expect((await db.aiConversations.get('c1'))!.updatedAt).toBe(later.updatedAt);
  });
});
