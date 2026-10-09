import type { Table } from 'dexie';
import type { StoreApi } from 'zustand';
import { sortTransactions } from '../domain/ledger';
import { isoTime, rowStamp, rowToAccount, rowToExposure, rowToInstrument, rowToPlan, rowToTx } from '../domain/rows';
import type {
  Account,
  AiConversation,
  AiMessage,
  Currency,
  Exposure,
  FxRates,
  Instrument,
  OwnStock,
  Plan,
  Prices,
  Snapshot,
  SnapshotItem,
  Targets,
  Transaction,
} from '../domain/types';
import { mockAppData } from '../mock/initial';
import type { KvRow, LocalDb, OutboxKind } from './localDb';
import { mergeLatest } from './merge';
import type { LocalVersion, Versioned } from './merge';
import type { RemoteChanges } from './remote';
import type { AppState } from './store';
import type { Locale } from '../i18n/locale';

// Local first: all data lives in the local database; the interface reads the state in memory, and changes are written back locally at once and queued for sync.
// The return history is the Worker's daily snapshots, pulled and kept locally when syncing (read only); groups and today's date aren't stored.

export interface LocalData {
  transactions: Transaction[];
  accounts: Account[];
  exposures: Exposure[];
  instruments: Instrument[];
  targets: Targets;
  ownStock: OwnStock;
  plan: Plan;
  /** fxLiveOn: the Beijing date the current exchange rate was last fetched online (missing in data saved before this version) */
  quotes: { prices: Prices; fx: FxRates; navDates: Record<string, string>; updatedAt: string | null; fxLiveOn?: string | null };
  prefs: { displayCurrency: Currency; hideAmounts: boolean };
  /** Daily snapshots: an account's come from the cloud; the sample data's are simulated */
  snapshots: Snapshot[];
  snapshotItems: SnapshotItem[];
  /** AI conversations and messages (messages in time order) */
  aiConversations: AiConversation[];
  aiMessages: AiMessage[];
  /** The version time of the targets and plan when written locally; defaults to the time of writing */
  settingsStamp?: string;
}

export function dataFromState(s: AppState): LocalData {
  return {
    transactions: s.transactions,
    accounts: s.accounts,
    exposures: s.exposures,
    instruments: s.instruments,
    targets: s.targets,
    ownStock: s.ownStock,
    plan: s.plan,
    quotes: { prices: s.prices, fx: s.fx, navDates: s.navDates, updatedAt: s.quotesUpdatedAt?.toISOString() ?? null, fxLiveOn: s.fxLiveOn },
    prefs: { displayCurrency: s.displayCurrency, hideAmounts: s.hideAmounts },
    snapshots: s.snapshots,
    snapshotItems: s.snapshotItems,
    aiConversations: s.aiConversations,
    aiMessages: s.aiMessages,
  };
}

export function stateFromData(d: LocalData): Partial<AppState> {
  return {
    transactions: d.transactions,
    accounts: d.accounts,
    exposures: d.exposures,
    instruments: d.instruments,
    targets: d.targets,
    ownStock: d.ownStock,
    plan: d.plan,
    prices: d.quotes.prices,
    fx: d.quotes.fx,
    navDates: d.quotes.navDates,
    quotesUpdatedAt: d.quotes.updatedAt ? new Date(d.quotes.updatedAt) : null,
    fxLiveOn: d.quotes.fxLiveOn ?? null,
    displayCurrency: d.prefs.displayCurrency,
    hideAmounts: d.prefs.hideAmounts,
    snapshots: d.snapshots,
    snapshotItems: d.snapshotItems,
    aiConversations: d.aiConversations,
    aiMessages: d.aiMessages,
  };
}

export function sampleData(prefs: LocalData['prefs'], locale: Locale): LocalData {
  const m = mockAppData(locale);
  return {
    transactions: m.transactions,
    accounts: m.accounts,
    exposures: m.exposures,
    instruments: m.instruments,
    targets: m.targets,
    ownStock: m.ownStock,
    plan: m.plan,
    quotes: { prices: m.prices, fx: m.fx, navDates: m.navDates, updatedAt: null, fxLiveOn: null },
    prefs,
    snapshots: m.snapshots,
    snapshotItems: m.snapshotItems,
    aiConversations: m.aiConversations,
    aiMessages: m.aiMessages,
  };
}

/** The version time of the global presets, the same as updated_at in the migrations: a later migration that updates the presets uses a later time, so local copies follow */
export const PRESET_STAMP = '2026-09-30T00:00:00.000Z';

/** A new account's default targets and plan use the earliest time: any real setting in the cloud is newer, so a new device takes the cloud's */
export const DEFAULT_SETTINGS_STAMP = '1970-01-01T00:00:00.000Z';

/**
 * A new account: no accounts or transactions; assets and instruments are the global presets; the plan uses the sample parameters until onboarding (phase 3) sets them.
 * No quotes fetched yet: prices are empty (valued at cost), exchange rates use the defaults, and foreign-currency transactions get the day's rate before upload.
 */
export function emptyData(prefs: LocalData['prefs']): LocalData {
  // The presets as stored (Chinese); the accounts and records of the sample are dropped below
  const sample = sampleData(prefs, 'zh');
  const preset = <T extends object>(rows: readonly T[]) => rows.map((r, order) => ({ ...r, updatedAt: PRESET_STAMP, order, own: false }));
  return {
    ...sample,
    quotes: { prices: {}, fx: sample.quotes.fx, navDates: {}, updatedAt: null, fxLiveOn: null },
    transactions: [],
    accounts: [],
    exposures: preset(sample.exposures),
    instruments: preset(sample.instruments),
    targets: {},
    ownStock: {},
    snapshots: [],
    snapshotItems: [],
    aiConversations: [],
    aiMessages: [],
    settingsStamp: DEFAULT_SETTINGS_STAMP,
  };
}

/** Messages in time order; at the same moment by id (so every device sorts them the same way) */
export function sortAiMessages(list: readonly AiMessage[]): AiMessage[] {
  return [...list].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const kv = (key: string, value: unknown, updatedAt: string): KvRow => ({ key, value, updatedAt });

/** Reads the local data; null when nothing has been written yet (first open). */
export async function loadData(db: LocalDb): Promise<LocalData | null> {
  if (!(await db.kv.get('seededAt'))) return null;
  const [transactions, accounts, exposures, instruments, targets, plan, quotes, prefs, snapshots, snapshotItems, aiConversations, aiMessages] = await Promise.all([
    db.transactions.toArray(),
    db.accounts.toArray(),
    db.exposures.toArray(),
    db.instruments.toArray(),
    db.kv.get('targets'),
    db.kv.get('plan'),
    db.kv.get('quotes'),
    db.kv.get('prefs'),
    db.snapshots.orderBy('date').toArray(),
    db.snapshotItems.orderBy('[date+exposureId]').toArray(),
    db.aiConversations.toArray(),
    db.aiMessages.toArray(),
  ]);
  const t = targets!.value as { targets: Targets; ownStock: OwnStock };
  const inOrder = <T extends { order: number }>(rows: T[]) => rows.sort((a, b) => a.order - b.order);
  return {
    transactions: sortTransactions(transactions),
    accounts: inOrder(accounts),
    exposures: inOrder(exposures),
    instruments: inOrder(instruments),
    targets: t.targets,
    ownStock: t.ownStock,
    plan: plan!.value as Plan,
    quotes: quotes!.value as LocalData['quotes'],
    prefs: prefs!.value as LocalData['prefs'],
    snapshots,
    snapshotItems,
    aiConversations,
    aiMessages: sortAiMessages(aiMessages),
  };
}

/** Clears the local data and writes it all (on first open). Rows that already carry a version time (the global presets) keep it. */
export async function saveAll(db: LocalDb, d: LocalData, now: string): Promise<void> {
  const stamp = <T extends object>(rows: readonly T[]) =>
    rows.map((r, order) => ({ ...r, updatedAt: (r as { updatedAt?: string }).updatedAt ?? now, order }));
  const tables = [db.transactions, db.accounts, db.exposures, db.instruments, db.kv, db.snapshots, db.snapshotItems, db.aiConversations, db.aiMessages];
  await db.transaction('rw', tables, async () => {
    await Promise.all([
      db.transactions.clear(),
      db.accounts.clear(),
      db.exposures.clear(),
      db.instruments.clear(),
      db.kv.clear(),
      db.snapshots.clear(),
      db.snapshotItems.clear(),
      db.aiConversations.clear(),
      db.aiMessages.clear(),
    ]);
    await Promise.all([
      db.transactions.bulkPut(d.transactions),
      db.snapshots.bulkPut(d.snapshots),
      db.snapshotItems.bulkPut(d.snapshotItems),
      db.aiConversations.bulkPut(d.aiConversations),
      db.aiMessages.bulkPut(d.aiMessages),
      db.accounts.bulkPut(stamp(d.accounts)),
      db.exposures.bulkPut(stamp(d.exposures)),
      db.instruments.bulkPut(stamp(d.instruments)),
      db.kv.bulkPut([
        kv('targets', { targets: d.targets, ownStock: d.ownStock }, d.settingsStamp ?? now),
        kv('plan', d.plan, d.settingsStamp ?? now),
        kv('quotes', d.quotes, now),
        kv('prefs', d.prefs, now),
        kv('seededAt', now, now),
      ]),
    ]);
  });
}

type Store = Pick<StoreApi<AppState>, 'getState' | 'setState' | 'subscribe'>;

export interface LocalController {
  /** Waits until every write in progress has finished (for tests; also called before closing an account) */
  flush: () => Promise<void>;
  /** Merges changes pulled from the cloud into the local database and the interface: not written back or queued; local changes overwritten by newer cloud ones leave the queue */
  applyRemote: (changes: RemoteChanges) => Promise<void>;
  /** Before upload, gives transactions the exchange rate of their recording day: only ones not yet uploaded (cloud transactions never change), not queued again */
  updateFx: (changes: readonly { id: string; fxToCny: number }[]) => Promise<void>;
  /**
   * Puts in the daily snapshots pulled from the cloud: replaces the local ones from since onwards (all of them when since is null); earlier ones stay.
   * Read-only data, never queued; when nothing differs from the local copy, the interface isn't disturbed.
   */
  applySnapshots: (since: string | null, snapshots: readonly Snapshot[], items: readonly SnapshotItem[]) => Promise<void>;
  /**
   * Puts in the AI conversations and messages pulled from the cloud: for a conversation the later updatedAt wins; messages missing locally are added.
   * Written to the local database, not queued.
   */
  applyAi: (conversations: readonly AiConversation[], messages: readonly AiMessage[]) => Promise<void>;
  /** The first snapshot on the day of onboarding: stored locally and in the interface, and queued for sync (the next day the Worker overwrites it with closing values) */
  saveFirstSnapshot: (snapshot: Snapshot, items: readonly SnapshotItem[]) => Promise<void>;
  /** Pauses writing back (while viewing the sample data): changes in the interface are neither saved nor queued */
  suspend: () => void;
  resume: () => void;
  detach: () => void;
}

/**
 * Writes the state back locally whenever it changes, queuing it for sync in the same transaction:
 * transactions write only new ones (bulkAdd, so the same id is never overwritten); accounts, assets and instruments write only the new or changed item;
 * targets and plan are written whole; quotes and display preferences stay local, never synced.
 */
export function attachLocalDb(
  store: Store,
  db: LocalDb,
  now: () => string,
  onError: (error: unknown) => void,
  onQueued: () => void = () => {},
): LocalController {
  // Pause writing back while putting cloud changes into the interface, so they aren't written and uploaded again as local changes
  let paused = false;
  // Paused for as long as the sample data is shown
  let suspended = false;
  const saved = new Set(store.getState().transactions.map((t) => t.id));
  const savedMessages = new Set(store.getState().aiMessages.map((m) => m.id));
  const pending = new Set<Promise<unknown>>();
  const track = (write: Promise<unknown>) => {
    const p: Promise<unknown> = write.catch(onError).finally(() => pending.delete(p));
    pending.add(p);
  };
  const queue = (tables: Table[], write: () => Promise<unknown>) =>
    track(db.transaction('rw', [...tables, db.outbox], write).then(onQueued));
  const entries = (kind: OutboxKind, keys: readonly string[]) => keys.map((key) => ({ kind, key }));
  // Elements whose reference changed are new or changed; order records the position in the list
  const changed = <T extends object>(list: readonly T[], before: readonly T[], time: string) => {
    const old = new Set(before);
    return list.flatMap((x, order) => (old.has(x) ? [] : [{ ...x, updatedAt: time, order }]));
  };

  const unsubscribe = store.subscribe((s, prev) => {
    if (paused || suspended) return;
    const time = now();
    if (s.transactions !== prev.transactions) {
      const added = s.transactions.filter((t) => !saved.has(t.id));
      for (const t of added) saved.add(t.id);
      if (added.length > 0) {
        const unconfirmed = new Set(s.unconfirmedFx);
        queue([db.transactions], async () => {
          await db.transactions.bulkAdd(added);
          await db.outbox.bulkAdd(entries('tx', added.map((t) => t.id)).map((e) => (unconfirmed.has(e.key) ? { ...e, fxPending: true } : e)));
        });
      }
    }
    if (s.accounts !== prev.accounts) {
      const rows = changed(s.accounts, prev.accounts, time);
      if (rows.length > 0) {
        queue([db.accounts], async () => {
          await db.accounts.bulkPut(rows);
          await db.outbox.bulkAdd(entries('account', rows.map((r) => r.id)));
        });
      }
    }
    if (s.exposures !== prev.exposures) {
      const rows = changed(s.exposures, prev.exposures, time).map((r) => ({ ...r, own: true }));
      if (rows.length > 0) {
        queue([db.exposures], async () => {
          await db.exposures.bulkPut(rows);
          await db.outbox.bulkAdd(entries('exposure', rows.map((r) => r.id)));
        });
      }
    }
    if (s.instruments !== prev.instruments) {
      const rows = changed(s.instruments, prev.instruments, time).map((r) => ({ ...r, own: true }));
      if (rows.length > 0) {
        queue([db.instruments], async () => {
          await db.instruments.bulkPut(rows);
          await db.outbox.bulkAdd(entries('instrument', rows.map((r) => r.code)));
        });
      }
    }
    if (s.targets !== prev.targets || s.ownStock !== prev.ownStock) {
      queue([db.kv], async () => {
        await db.kv.put(kv('targets', { targets: s.targets, ownStock: s.ownStock }, time));
        await db.outbox.add({ kind: 'targets', key: 'targets' });
      });
    }
    if (s.plan !== prev.plan) {
      queue([db.kv], async () => {
        await db.kv.put(kv('plan', s.plan, time));
        await db.outbox.add({ kind: 'plan', key: 'plan' });
      });
    }
    if (
      s.prices !== prev.prices ||
      s.fx !== prev.fx ||
      s.navDates !== prev.navDates ||
      s.quotesUpdatedAt !== prev.quotesUpdatedAt ||
      s.fxLiveOn !== prev.fxLiveOn
    ) {
      track(db.kv.put(kv('quotes', dataFromState(s).quotes, time)));
    }
    if (s.displayCurrency !== prev.displayCurrency || s.hideAmounts !== prev.hideAmounts) {
      track(db.kv.put(kv('prefs', dataFromState(s).prefs, time)));
    }
    // AI conversations: new or changed ones are written as is (with the conversation's own updatedAt); messages only when new
    if (s.aiConversations !== prev.aiConversations) {
      const old = new Set(prev.aiConversations);
      const rows = s.aiConversations.filter((c) => !old.has(c));
      if (rows.length > 0) {
        queue([db.aiConversations], async () => {
          await db.aiConversations.bulkPut(rows);
          await db.outbox.bulkAdd(entries('aiConversation', rows.map((c) => c.id)));
        });
      }
    }
    if (s.aiMessages !== prev.aiMessages) {
      const added = s.aiMessages.filter((m) => !savedMessages.has(m.id));
      for (const m of added) savedMessages.add(m.id);
      if (added.length > 0) {
        queue([db.aiMessages], async () => {
          await db.aiMessages.bulkAdd(added);
          await db.outbox.bulkAdd(entries('aiMessage', added.map((m) => m.id)));
        });
      }
    }
  });

  const versions = <T extends { updatedAt: string; order: number; own?: boolean }>(rows: readonly T[], key: (r: T) => string) =>
    new Map<string, LocalVersion>(
      rows.map((r) => [key(r), { updatedAt: r.updatedAt, order: r.order, ...(r.own !== undefined ? { own: r.own } : {}) }]),
    );

  const applyRemote = async (remote: RemoteChanges) => {
    // 1) The version of each local item
    const [accountRows, exposureRows, instrumentRows, targetsRow, planRow] = await Promise.all([
      db.accounts.toArray(),
      db.exposures.toArray(),
      db.instruments.toArray(),
      db.kv.get('targets'),
      db.kv.get('plan'),
    ]);
    // 2) Merge against the interface's current state (it includes the user's changes in the meantime), with writing back paused
    const s = store.getState();
    const newTx = remote.transactions.map(rowToTx).filter((t) => !saved.has(t.id));
    const accounts = mergeLatest(
      s.accounts,
      versions(accountRows, (r) => r.id),
      remote.accounts.map((r): Versioned<Account> => ({ value: rowToAccount(r), ...rowStamp(r) })),
      (a) => a.id,
    );
    const exposures = mergeLatest(
      s.exposures,
      versions(exposureRows, (r) => r.id),
      remote.exposures.map((r): Versioned<Exposure> => ({ value: rowToExposure(r), ...rowStamp(r), own: r.user_id !== null })),
      (e) => e.id,
    );
    const instruments = mergeLatest(
      s.instruments,
      versions(instrumentRows, (r) => r.code),
      remote.instruments.map((r): Versioned<Instrument> => ({ value: rowToInstrument(r), ...rowStamp(r), own: r.user_id !== null })),
      (i) => i.code,
    );
    const t = remote.targets[0];
    const takeTargets = t !== undefined && isoTime(t.updated_at) > (targetsRow?.updatedAt ?? '');
    const p = remote.plans[0];
    const takePlan = p !== undefined && isoTime(p.updated_at) > (planRow?.updatedAt ?? '');
    if (!newTx.length && !accounts.won.length && !exposures.won.length && !instruments.won.length && !takeTargets && !takePlan) return;

    const patch: Partial<AppState> = {};
    if (newTx.length) patch.transactions = sortTransactions([...s.transactions, ...newTx]);
    if (accounts.won.length) patch.accounts = accounts.list;
    if (exposures.won.length) patch.exposures = exposures.list;
    if (instruments.won.length) patch.instruments = instruments.list;
    if (takeTargets) {
      patch.targets = t.slots;
      patch.ownStock = t.own_stock;
    }
    if (takePlan) patch.plan = rowToPlan(p);
    paused = true;
    try {
      for (const tx of newTx) saved.add(tx.id);
      store.setState(patch);
    } finally {
      paused = false;
    }

    // 3) Write to the local database; local changes overwritten by newer cloud ones are no longer uploaded
    const stamp = <T>(w: Versioned<T>) => ({ ...w.value, updatedAt: w.updatedAt, order: w.order });
    const stale = new Set([
      ...accounts.won.map((w) => `account:${w.value.id}`),
      ...exposures.won.map((w) => `exposure:${w.value.id}`),
      ...instruments.won.map((w) => `instrument:${w.value.code}`),
      ...(takeTargets ? ['targets:targets'] : []),
      ...(takePlan ? ['plan:plan'] : []),
    ]);
    track(
      db.transaction('rw', [db.transactions, db.accounts, db.exposures, db.instruments, db.kv, db.outbox], async () => {
        await db.transactions.bulkPut(newTx);
        await db.accounts.bulkPut(accounts.won.map(stamp));
        await db.exposures.bulkPut(exposures.won.map((w) => ({ ...stamp(w), own: w.own ?? false })));
        await db.instruments.bulkPut(instruments.won.map((w) => ({ ...stamp(w), own: w.own ?? false })));
        if (takeTargets) await db.kv.put(kv('targets', { targets: t.slots, ownStock: t.own_stock }, isoTime(t.updated_at)));
        if (takePlan) await db.kv.put(kv('plan', rowToPlan(p), isoTime(p.updated_at)));
        const queued = await db.outbox.toArray();
        await db.outbox.bulkDelete(queued.filter((e) => stale.has(`${e.kind}:${e.key}`)).map((e) => e.seq!));
      }),
    );
    await Promise.all([...pending]);
  };

  const updateFx = async (changes: readonly { id: string; fxToCny: number }[]) => {
    if (changes.length === 0) return;
    const rate = new Map(changes.map((c) => [c.id, c.fxToCny]));
    const s = store.getState();
    const transactions = s.transactions.map((t) => (rate.has(t.id) ? { ...t, fxToCny: rate.get(t.id)! } : t));
    paused = true;
    try {
      // The return history is the cloud's snapshots; the next day the Worker uses the new rate
      store.setState({ transactions });
    } finally {
      paused = false;
    }
    await db.transaction('rw', db.transactions, async () => {
      for (const c of changes) await db.transactions.update(c.id, { fxToCny: c.fxToCny });
    });
  };

  const byDate = <T extends { date: string }>(a: T, b: T) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const sortItems = (list: readonly SnapshotItem[]) =>
    [...list].sort((a, b) => byDate(a, b) || (a.exposureId < b.exposureId ? -1 : a.exposureId > b.exposureId ? 1 : 0));
  const applySnapshots = async (since: string | null, snapshots: readonly Snapshot[], items: readonly SnapshotItem[]) => {
    // A snapshot still in the upload queue (the onboarding day's) isn't in the cloud yet: when the pulled result lacks that day, keep the local one
    const pending = new Set((await db.outbox.where('kind').equals('snapshot').toArray()).map((e) => e.key));
    const pulled = new Set(snapshots.map((x) => x.date));
    const keep = (date: string) => (since !== null && date < since) || (pending.has(date) && !pulled.has(date));
    const s = store.getState();
    const nextSnapshots = [...s.snapshots.filter((x) => keep(x.date)), ...snapshots].sort(byDate);
    const nextItems = sortItems([...s.snapshotItems.filter((x) => keep(x.date)), ...items]);
    if (JSON.stringify(nextSnapshots) === JSON.stringify(s.snapshots) && JSON.stringify(nextItems) === JSON.stringify(s.snapshotItems)) return;
    paused = true;
    try {
      store.setState({ snapshots: nextSnapshots, snapshotItems: nextItems });
    } finally {
      paused = false;
    }
    await db.transaction('rw', [db.snapshots, db.snapshotItems], async () => {
      await db.snapshots.filter((x) => !keep(x.date)).delete();
      await db.snapshotItems.filter((x) => !keep(x.date)).delete();
      await db.snapshots.bulkPut([...snapshots]);
      await db.snapshotItems.bulkPut([...items]);
    });
  };

  const applyAi = async (conversations: readonly AiConversation[], messages: readonly AiMessage[]) => {
    const s = store.getState();
    const current = new Map(s.aiConversations.map((c) => [c.id, c]));
    const won = conversations.filter((c) => {
      const mine = current.get(c.id);
      return !mine || c.updatedAt > mine.updatedAt;
    });
    const fresh = messages.filter((m) => !savedMessages.has(m.id));
    if (won.length === 0 && fresh.length === 0) return;
    const winner = new Map(won.map((c) => [c.id, c]));
    paused = true;
    try {
      for (const m of fresh) savedMessages.add(m.id);
      store.setState({
        aiConversations: [...s.aiConversations.map((c) => winner.get(c.id) ?? c), ...won.filter((c) => !current.has(c.id))],
        aiMessages: sortAiMessages([...s.aiMessages, ...fresh]),
      });
    } finally {
      paused = false;
    }
    track(
      db.transaction('rw', [db.aiConversations, db.aiMessages], async () => {
        await db.aiConversations.bulkPut(won);
        await db.aiMessages.bulkPut(fresh);
      }),
    );
    await Promise.all([...pending]);
  };

  const saveFirstSnapshot = async (snapshot: Snapshot, items: readonly SnapshotItem[]) => {
    const s = store.getState();
    const others = <T extends { date: string }>(list: readonly T[]) => list.filter((x) => x.date !== snapshot.date);
    paused = true;
    try {
      store.setState({
        snapshots: [...others(s.snapshots), snapshot].sort(byDate),
        snapshotItems: sortItems([...others(s.snapshotItems), ...items]),
      });
    } finally {
      paused = false;
    }
    queue([db.snapshots, db.snapshotItems], async () => {
      await db.snapshots.put(snapshot);
      await db.snapshotItems.where('date').equals(snapshot.date).delete();
      await db.snapshotItems.bulkPut([...items]);
      await db.outbox.add({ kind: 'snapshot', key: snapshot.date });
    });
    await Promise.all([...pending]);
  };

  return {
    flush: async () => {
      await Promise.all([...pending]);
    },
    applyRemote,
    updateFx,
    applySnapshots,
    applyAi,
    saveFirstSnapshot,
    suspend: () => {
      suspended = true;
    },
    resume: () => {
      suspended = false;
    },
    detach: unsubscribe,
  };
}

/** Called at start-up: reads the local data; on first open, writes seed (by default the data now in the interface). */
export async function hydrate(
  store: Store,
  db: LocalDb,
  now: () => string,
  seed: LocalData = dataFromState(store.getState()),
): Promise<'loaded' | 'seeded'> {
  const data = await loadData(db);
  if (data) {
    store.setState(stateFromData(data));
    return 'loaded';
  }
  await saveAll(db, seed, now());
  return 'seeded';
}
