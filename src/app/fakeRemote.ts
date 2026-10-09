import { isoTime } from '../domain/rows';
import type {
  AccountRow,
  AiConversationRow,
  AiMessageRow,
  ExposureRow,
  InstrumentRow,
  PlanRow,
  SnapshotItemRow,
  SnapshotRow,
  TargetsRow,
  TxRow,
} from '../domain/rows';
import { exposures, instruments } from '../mock/catalog';
import { RemoteError } from './remote';
import type { Remote, RemoteChanges, RemoteErrorKind, SettingsKind, SettingsRows } from './remote';

// An in-memory cloud for the tests, behaving like supabase/migrations and remote.ts:
// - transactions are deduplicated by (user_id, id) and only ever added, never changed;
// - settings: the later updated_at wins (older changes are skipped);
// - each write records the server time, and pulls filter by it; a user sees only their own rows and the global presets;
// - an empty list does nothing (as in remote.ts, no request is sent);
// - daily snapshots are written by the Worker (here writeSnapshot); the app can only read its own, by date;
// - AI conversations behave like settings (the later updated_at wins), AI messages like transactions (only added).

const PRESET = '2026-09-30T00:00:00.000Z';

export interface FakeCloud {
  remoteFor(userId: string): Remote & { sinceSeen: (string | null)[]; aiSinceSeen: (string | null)[] };
  rows: {
    transactions: TxRow[];
    accounts: AccountRow[];
    exposures: ExposureRow[];
    instruments: InstrumentRow[];
    targets: TargetsRow[];
    plans: PlanRow[];
    snapshots: SnapshotRow[];
    snapshotItems: SnapshotItemRow[];
    aiConversations: AiConversationRow[];
    aiMessages: AiMessageRow[];
  };
  /** false: like a cloud that hasn't run the phase 6 migration; pulling AI conversations fails (no server-time column), uploads work */
  setAiReady(ready: boolean): void;
  /** true: uploading AI conversations and messages fails (a network problem); everything else works */
  failAiUploads(fail: boolean): void;
  /** The next call fails; with afterStoring, it stores first and then fails (the request arrived, the response was lost) */
  failNext(kind: RemoteErrorKind, opts?: { afterStoring?: boolean }): void;
  /** Writes a day's snapshot as the Worker does: overwrites the snapshot and replaces that day's value of each asset */
  writeSnapshot(snapshot: SnapshotRow, items: readonly SnapshotItemRow[]): void;
}

export function createFakeCloud(): FakeCloud {
  let tick = Date.parse('2026-09-30T12:00:00.000Z');
  const serverNow = () => new Date((tick += 1000)).toISOString();
  const rows: FakeCloud['rows'] = {
    transactions: [],
    accounts: [],
    exposures: exposures.map((e, position) => ({
      user_id: null,
      id: e.id,
      name: e.name,
      group_id: e.groupId,
      is_stock: e.isStock,
      position,
      updated_at: PRESET,
      server_updated_at: PRESET,
    })),
    instruments: instruments.map((i, position) => ({
      user_id: null,
      code: i.code,
      name: i.name,
      market: i.market,
      currency: i.currency,
      exposure_id: i.exposureId,
      pays_dividend: i.paysDividend,
      position,
      updated_at: PRESET,
      server_updated_at: PRESET,
    })),
    targets: [],
    plans: [],
    snapshots: [],
    snapshotItems: [],
    aiConversations: [],
    aiMessages: [],
  };
  let aiReady = true;
  let aiUploadsFail = false;
  let failure: { kind: RemoteErrorKind; afterStoring: boolean } | null = null;
  const maybeFail = (stage: 'before' | 'after') => {
    if (!failure || (stage === 'after') !== failure.afterStoring) return;
    const kind = failure.kind;
    failure = null;
    throw new RemoteError(kind, `fake ${kind}`);
  };

  const keyOf: { [K in SettingsKind]: (r: SettingsRows[K]) => string } = {
    account: (r) => `${r.user_id}:${r.id}`,
    exposure: (r) => `${r.user_id}:${r.id}`,
    instrument: (r) => `${r.user_id}:${r.code}`,
    targets: (r) => r.user_id,
    plan: (r) => r.user_id,
  };
  const tableOf = { account: 'accounts', exposure: 'exposures', instrument: 'instruments', targets: 'targets', plan: 'plans' } as const;

  return {
    rows,
    setAiReady(ready) {
      aiReady = ready;
    },
    failAiUploads(fail) {
      aiUploadsFail = fail;
    },
    failNext(kind, opts = {}) {
      failure = { kind, afterStoring: opts.afterStoring ?? false };
    },
    writeSnapshot(snapshot, items) {
      const same = (r: { user_id: string; date: string }) => r.user_id === snapshot.user_id && r.date === snapshot.date;
      rows.snapshots = [...rows.snapshots.filter((r) => !same(r)), { ...snapshot }];
      rows.snapshotItems = [...rows.snapshotItems.filter((r) => !same(r)), ...items.map((i) => ({ ...i }))];
    },
    remoteFor(userId) {
      const sinceSeen: (string | null)[] = [];
      const aiSinceSeen: (string | null)[] = [];
      const own = (r: { user_id: string }) => {
        if (r.user_id !== userId) throw new RemoteError('server', 'new row violates row-level security policy');
      };
      const mine = <T extends { user_id: string | null }>(list: T[], global = false) =>
        list.filter((r) => r.user_id === userId || (global && r.user_id === null));
      const after = <T>(list: T[], time: (r: T) => string | undefined, since: string | null) =>
        since === null ? list : list.filter((r) => isoTime(time(r) ?? PRESET) > since);
      return {
        sinceSeen,
        aiSinceSeen,
        async insertTransactions(txs) {
          if (txs.length === 0) return;
          maybeFail('before');
          for (const r of txs) {
            if (r.user_id !== userId) throw new RemoteError('server', 'new row violates row-level security policy');
            if (!rows.transactions.some((x) => x.user_id === r.user_id && x.id === r.id)) rows.transactions.push({ ...r, inserted_at: serverNow() });
          }
          maybeFail('after');
        },
        async upsert<K extends SettingsKind>(kind: K, list: readonly SettingsRows[K][]) {
          if (list.length === 0) return;
          maybeFail('before');
          const table = rows[tableOf[kind]] as unknown as SettingsRows[K][];
          const key = keyOf[kind] as (r: SettingsRows[K]) => string;
          for (const r of list) {
            if (r.user_id !== userId) throw new RemoteError('server', 'new row violates row-level security policy');
            const i = table.findIndex((x) => key(x) === key(r));
            if (i >= 0 && !(isoTime(r.updated_at) > isoTime(table[i]!.updated_at))) continue;
            const next = { ...r, server_updated_at: serverNow() };
            if (i >= 0) table[i] = next;
            else table.push(next);
          }
          maybeFail('after');
        },
        async pull(since): Promise<RemoteChanges> {
          maybeFail('before');
          sinceSeen.push(since);
          return {
            transactions: after(mine(rows.transactions), (r) => r.inserted_at, since),
            accounts: after(mine(rows.accounts), (r) => r.server_updated_at, since),
            exposures: after(mine(rows.exposures, true), (r) => r.server_updated_at, since),
            instruments: after(mine(rows.instruments, true), (r) => r.server_updated_at, since),
            targets: after(mine(rows.targets), (r) => r.server_updated_at, since),
            plans: after(mine(rows.plans), (r) => r.server_updated_at, since),
          };
        },
        async insertSnapshot(snapshot, items) {
          maybeFail('before');
          if (snapshot.user_id !== userId) throw new RemoteError('server', 'new row violates row-level security policy');
          if (!rows.snapshots.some((r) => r.user_id === userId && r.date === snapshot.date)) rows.snapshots.push({ ...snapshot });
          for (const item of items) {
            if (!rows.snapshotItems.some((r) => r.user_id === userId && r.date === item.date && r.exposure_id === item.exposure_id)) rows.snapshotItems.push({ ...item });
          }
          maybeFail('after');
        },
        async upsertAiConversations(list) {
          if (list.length === 0) return;
          if (aiUploadsFail) throw new RemoteError('network', 'fake network');
          maybeFail('before');
          for (const r of list) {
            own(r);
            const i = rows.aiConversations.findIndex((x) => x.user_id === r.user_id && x.id === r.id);
            if (i >= 0 && !(isoTime(r.updated_at) > isoTime(rows.aiConversations[i]!.updated_at))) continue;
            const next = { ...r, server_updated_at: serverNow() };
            if (i >= 0) rows.aiConversations[i] = next;
            else rows.aiConversations.push(next);
          }
          maybeFail('after');
        },
        async insertAiMessages(list) {
          if (list.length === 0) return;
          if (aiUploadsFail) throw new RemoteError('network', 'fake network');
          maybeFail('before');
          for (const r of list) {
            own(r);
            if (!rows.aiMessages.some((x) => x.user_id === r.user_id && x.id === r.id)) rows.aiMessages.push({ ...r, inserted_at: serverNow() });
          }
          maybeFail('after');
        },
        async pullAi(since) {
          maybeFail('before');
          if (!aiReady) throw new RemoteError('server', 'column ai_conversations.server_updated_at does not exist');
          aiSinceSeen.push(since);
          return {
            conversations: after(mine(rows.aiConversations), (r) => r.server_updated_at, since),
            messages: after(mine(rows.aiMessages), (r) => r.inserted_at, since),
          };
        },
        async pullSnapshots(sinceDate) {
          maybeFail('before');
          const from = <T extends { date: string }>(list: T[]) =>
            list.filter((r) => sinceDate === null || r.date >= sinceDate).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
          return { snapshots: from(mine(rows.snapshots)), items: from(mine(rows.snapshotItems)) };
        },
      };
    },
  };
}
