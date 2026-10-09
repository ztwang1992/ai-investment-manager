import { create } from 'zustand';
import { addDays, beijingDate } from '../domain/dates';
import {
  accountToRow,
  aiConversationToRow,
  aiMessageToRow,
  exposureToRow,
  instrumentToRow,
  isoTime,
  planToRow,
  rowToAiConversation,
  rowToAiMessage,
  rowToSnapshot,
  rowToSnapshotItem,
  snapshotItemToRow,
  snapshotToRow,
  targetsToRow,
  txToRow,
} from '../domain/rows';
import { isCashCode } from '../domain/types';
import type { OwnStock, Plan, Targets } from '../domain/types';
import type { LocalDb, OutboxKind, OutboxRow } from './localDb';
import type { LocalController } from './persistence';
import { RemoteError } from './remote';
import type { Remote, RemoteChanges } from './remote';

// The sync engine: uploads in queue order, then pulls incrementally by server time and merges into the local database.
// AI conversations sync on their own after transactions and settings (with their own pull cursor): an error there fails the round, but transactions and settings are already synced.
// Triggers: start-up, local changes (after a short wait, merged into one), the network coming back, returning to the foreground, and retries at intervals after a failure.

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'signedOut';

export interface SyncStatus {
  state: SyncState;
  /** Transactions not yet uploaded (changes to settings don't count) */
  pending: number;
  lastSyncedAt: string | null;
  /** This device has read the cloud at least once: until a new device has, an empty account and data not yet downloaded look the same (onboarding waits for it) */
  pulledOnce: boolean;
}

export const INITIAL_SYNC: SyncStatus = { state: 'idle', pending: 0, lastSyncedAt: null, pulledOnce: false };

/** Sync status for the interface (not stored in the local database) */
export const useSyncStore = create<SyncStatus>()(() => INITIAL_SYNC);

/** How long to wait before retrying after a failure: 5 seconds, 30 seconds, 2 minutes, then every 10 minutes */
export const RETRY_MS = [5_000, 30_000, 120_000, 600_000] as const;
/** Wait a moment after a local change before syncing, so several records in a row go up together */
export const DEBOUNCE_MS = 1_500;
/** Pulls look 2 minutes further back, so rows committed late are caught too (duplicates are removed by id) */
export const PULL_OVERLAP_MS = 120_000;
/** Daily snapshots have no server time, so they're pulled by date: each time from this many days before the latest local day, so the days a rerun rewrote come too */
export const SNAPSHOT_OVERLAP_DAYS = 7;

export interface SyncDeps {
  remote: Remote;
  db: LocalDb;
  local: LocalController;
  userId: string;
  isOnline: () => boolean;
  now: () => Date;
  /** Runs later; returns a cancel function */
  schedule: (fn: () => void, ms: number) => () => void;
  setStatus: (patch: Partial<SyncStatus>) => void;
  /** How many CNY 1 USD was worth on a given day; null when it can't be found. Without it, offline transactions are uploaded with their original rate */
  fxOn?: (date: string) => Promise<number | null>;
}

export interface SyncController {
  syncNow: () => Promise<void>;
  /** There are new local changes: sync after a short wait */
  requestSync: () => void;
  /** Pauses sync (while viewing the sample data): waits for the round in progress to finish, then sends nothing */
  suspend: () => Promise<void>;
  resume: () => void;
  stop: () => void;
}

const isDefined = <T>(x: T | undefined): x is T => x !== undefined;

const AI_KINDS: ReadonlySet<OutboxKind> = new Set(['aiConversation', 'aiMessage']);
const latest = (times: readonly (string | undefined)[]) =>
  times
    .filter(isDefined)
    .map(isoTime)
    .reduce<string | null>((a, b) => (a === null || b > a ? b : a), null);

function latestServerTime(c: RemoteChanges): string | null {
  const times = [
    ...c.transactions.map((r) => r.inserted_at),
    ...[...c.accounts, ...c.exposures, ...c.instruments, ...c.targets, ...c.plans].map((r) => r.server_updated_at),
  ]
    .filter(isDefined)
    .map(isoTime);
  return times.length ? times.reduce((a, b) => (a > b ? a : b)) : null;
}

export function startSync(deps: SyncDeps): SyncController {
  const { remote, db, local, userId } = deps;
  let stopped = false;
  let suspended = false;
  let running: Promise<void> | null = null;
  let again = false;
  let failures = 0;
  let cancelTimer: (() => void) | null = null;

  const later = (ms: number) => {
    cancelTimer?.();
    cancelTimer = deps.schedule(() => {
      cancelTimer = null;
      void syncNow();
    }, ms);
  };
  // Only a number for the interface: if the database is already closed (signed out), never mind
  const countPending = async () => {
    try {
      const pending = await db.outbox.where('kind').equals('tx').count();
      if (!stopped) deps.setStatus({ pending });
    } catch {
      // ignore
    }
  };

  /**
   * Gives USD transactions recorded offline the rate of their recording day before upload (a future date uses today's).
   * A transaction whose rate can't be found, and those queued after it, wait in the queue for the next try; returns those queue items' seq.
   */
  async function confirmFx(txEntries: readonly OutboxRow[]): Promise<Set<number>> {
    const held = new Set<number>();
    if (!deps.fxOn) return held;
    const today = beijingDate(deps.now());
    const fixes: { id: string; fxToCny: number }[] = [];
    for (const [i, entry] of txEntries.entries()) {
      if (!entry.fxPending) continue;
      const tx = await db.transactions.get(entry.key);
      if (!tx) continue;
      const currency = isCashCode(tx.instrumentCode) ? tx.instrumentCode : (await db.instruments.get(tx.instrumentCode))?.currency;
      if (currency !== 'USD') continue;
      const rate = await deps.fxOn(tx.date > today ? today : tx.date);
      if (rate === null) {
        for (const later of txEntries.slice(i)) held.add(later.seq!);
        break;
      }
      if (rate !== tx.fxToCny) fixes.push({ id: tx.id, fxToCny: rate });
    }
    await local.updateFx(fixes);
    return held;
  }

  async function push() {
    // The AI queue items are left for pushAi
    const queued = (await db.outbox.orderBy('seq').toArray()).filter((e) => !AI_KINDS.has(e.kind));
    if (queued.length === 0) return;
    const held = await confirmFx(queued.filter((e) => e.kind === 'tx'));
    const entries = queued.filter((e) => !held.has(e.seq!));
    const keys = (kind: OutboxKind) => [...new Set(entries.filter((e) => e.kind === kind).map((e) => e.key))];
    const accounts = (await db.accounts.bulkGet(keys('account'))).filter(isDefined);
    const exposures = (await db.exposures.bulkGet(keys('exposure'))).filter(isDefined).filter((r) => r.own === true);
    const instruments = (await db.instruments.bulkGet(keys('instrument'))).filter(isDefined).filter((r) => r.own === true);
    await remote.upsert(
      'account',
      accounts.map((a) => accountToRow(a, a, userId)),
    );
    await remote.upsert(
      'exposure',
      exposures.map((e) => exposureToRow(e, e, userId)),
    );
    await remote.upsert(
      'instrument',
      instruments.map((i) => instrumentToRow(i, i, userId)),
    );
    if (keys('targets').length) {
      const row = await db.kv.get('targets');
      if (row) {
        const v = row.value as { targets: Targets; ownStock: OwnStock };
        await remote.upsert('targets', [targetsToRow(v.targets, v.ownStock, row.updatedAt, userId)]);
      }
    }
    if (keys('plan').length) {
      const row = await db.kv.get('plan');
      if (row) await remote.upsert('plan', [planToRow(row.value as Plan, row.updatedAt, userId)]);
    }
    const txs = (await db.transactions.bulkGet(keys('tx'))).filter(isDefined);
    await remote.insertTransactions(txs.map((t) => txToRow(t, userId)));
    for (const date of keys('snapshot')) {
      const snapshot = await db.snapshots.get(date);
      if (!snapshot) continue;
      const items = await db.snapshotItems.where('date').equals(date).toArray();
      await remote.insertSnapshot(snapshotToRow(snapshot, userId), items.map((item) => snapshotItemToRow(item, userId)));
    }
    // Delete only what was read this time; items queued during the upload wait for the next round
    await db.outbox.bulkDelete(entries.map((e) => e.seq!));
  }

  async function pull() {
    const cursor = (await db.kv.get('pulledAt'))?.value as string | undefined;
    const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;
    const changes = await remote.pull(since);
    await local.applyRemote(changes);
    const latest = latestServerTime(changes);
    if (latest && (!cursor || latest > cursor)) await db.kv.put({ key: 'pulledAt', value: latest, updatedAt: latest });
    await pullSnapshots();
  }

  async function pullSnapshots() {
    const newest = await db.snapshots.orderBy('date').last();
    const since = newest ? addDays(newest.date, -SNAPSHOT_OVERLAP_DAYS) : null;
    const r = await remote.pullSnapshots(since);
    await local.applySnapshots(since, r.snapshots.map(rowToSnapshot), r.items.map(rowToSnapshotItem));
  }

  async function pushAi() {
    const queued = (await db.outbox.orderBy('seq').toArray()).filter((e) => AI_KINDS.has(e.kind));
    if (queued.length === 0) return;
    const keys = (kind: OutboxKind) => [...new Set(queued.filter((e) => e.kind === kind).map((e) => e.key))];
    const conversations = (await db.aiConversations.bulkGet(keys('aiConversation'))).filter(isDefined);
    const messages = (await db.aiMessages.bulkGet(keys('aiMessage'))).filter(isDefined);
    await remote.upsertAiConversations(conversations.map((c) => aiConversationToRow(c, userId)));
    await remote.insertAiMessages(messages.map((m) => aiMessageToRow(m, userId)));
    await db.outbox.bulkDelete(queued.map((e) => e.seq!));
  }

  async function pullAi() {
    const cursor = (await db.kv.get('aiPulledAt'))?.value as string | undefined;
    const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null;
    const r = await remote.pullAi(since);
    await local.applyAi(r.conversations.map(rowToAiConversation), r.messages.map(rowToAiMessage));
    const newest = latest([...r.conversations.map((c) => c.server_updated_at), ...r.messages.map((m) => m.inserted_at)]);
    if (newest && (!cursor || newest > cursor)) await db.kv.put({ key: 'aiPulledAt', value: newest, updatedAt: newest });
  }

  async function run() {
    if (!deps.isOnline()) {
      deps.setStatus({ state: 'offline' });
      return;
    }
    deps.setStatus({ state: 'syncing' });
    try {
      await push();
      await pull();
      // Transactions and settings have been read: a new device can now tell whether the account is empty, without waiting for the AI conversation step
      deps.setStatus({ pulledOnce: true });
      await pushAi();
      await pullAi();
      failures = 0;
      deps.setStatus({ state: 'idle', lastSyncedAt: deps.now().toISOString(), pulledOnce: true });
    } catch (e) {
      if (stopped) return;
      if (e instanceof RemoteError && e.kind === 'auth') {
        deps.setStatus({ state: 'signedOut' });
        return;
      }
      failures += 1;
      deps.setStatus({ state: 'error' });
      later(RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]!);
    }
  }

  // Called again while a sync is running: run another round after this one; every caller waits for the whole loop to finish
  function syncNow(): Promise<void> {
    if (stopped || suspended) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await run();
        } while (again && !stopped);
      } finally {
        await countPending();
        running = null;
      }
    })();
    return running;
  }

  void countPending();
  return {
    syncNow,
    requestSync: () => {
      if (stopped || suspended) return;
      void countPending();
      later(DEBOUNCE_MS);
    },
    suspend: async () => {
      suspended = true;
      cancelTimer?.();
      await running?.catch(() => {});
    },
    resume: () => {
      suspended = false;
    },
    stop: () => {
      stopped = true;
      cancelTimer?.();
    },
  };
}
