import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
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

// The cloud operations the sync engine uses. The real implementation goes through supabase-js (PostgREST); the tests use the in-memory version in fakeRemote.ts, with the same semantics.

export type SettingsKind = 'account' | 'exposure' | 'instrument' | 'targets' | 'plan';

export interface SettingsRows {
  account: AccountRow;
  exposure: ExposureRow;
  instrument: InstrumentRow;
  targets: TargetsRow;
  plan: PlanRow;
}

export interface RemoteChanges {
  transactions: TxRow[];
  accounts: AccountRow[];
  exposures: ExposureRow[];
  instruments: InstrumentRow[];
  targets: TargetsRow[];
  plans: PlanRow[];
}

export type RemoteErrorKind = 'auth' | 'network' | 'server';

export class RemoteError extends Error {
  readonly kind: RemoteErrorKind;
  constructor(kind: RemoteErrorKind, message: string) {
    super(message);
    this.name = 'RemoteError';
    this.kind = kind;
  }
}

export interface Remote {
  /** Uploads transactions; one already in the cloud (same user_id, id) is skipped without an error */
  insertTransactions(rows: readonly TxRow[]): Promise<void>;
  /** Uploads settings; the cloud accepts only an updated_at later than the current one (a database trigger enforces it) */
  upsert<K extends SettingsKind>(kind: K, rows: readonly SettingsRows[K][]): Promise<void>;
  /** Pulls the rows added or changed after server time since (global presets included); everything when since is null */
  pull(since: string | null): Promise<RemoteChanges>;
  /** Pulls the daily snapshots and per-asset values from sinceDate onwards (written by the Worker; a user reads only their own); everything when sinceDate is null */
  pullSnapshots(sinceDate: string | null): Promise<{ snapshots: SnapshotRow[]; items: SnapshotItemRow[] }>;
  /** The first snapshot on the day of onboarding: insert only, skipped if that day already exists (users can insert, not change) */
  insertSnapshot(snapshot: SnapshotRow, items: readonly SnapshotItemRow[]): Promise<void>;
  /** Uploads AI conversations; the cloud accepts only an updated_at later than the current one (a database trigger enforces it) */
  upsertAiConversations(rows: readonly AiConversationRow[]): Promise<void>;
  /** Uploads AI messages; one already in the cloud is skipped without an error */
  insertAiMessages(rows: readonly AiMessageRow[]): Promise<void>;
  /** Pulls the conversations and messages added or changed after server time since; everything when since is null */
  pullAi(since: string | null): Promise<{ conversations: AiConversationRow[]; messages: AiMessageRow[] }>;
}

const PAGE = 1000;
const BATCH = 500;

const SETTINGS: Record<SettingsKind, { table: string; conflict: string }> = {
  account: { table: 'accounts', conflict: 'user_id,id' },
  exposure: { table: 'exposures', conflict: 'user_id,id' },
  instrument: { table: 'instruments', conflict: 'user_id,code' },
  targets: { table: 'targets', conflict: 'user_id' },
  plan: { table: 'plans', conflict: 'user_id' },
};

interface Result {
  error: { message: string; code?: string } | null;
  status: number;
}

function check(r: Result): void {
  if (!r.error) return;
  if (r.status === 401 || r.error.code === 'PGRST301' || r.error.code === 'PGRST302') throw new RemoteError('auth', r.error.message);
  if (r.status === 0) throw new RemoteError('network', r.error.message);
  throw new RemoteError('server', r.error.message);
}

export function createSupabaseRemote(client: SupabaseClient): Remote {
  // First make sure this device has a valid session: failing to reach the server while renewing is a network problem (try again later); no session means signing in again
  const ensureSession = async () => {
    const { data, error } = await client.auth.getSession();
    if (data.session) return;
    if (error && isAuthRetryableFetchError(error)) throw new RemoteError('network', error.message);
    throw new RemoteError('auth', 'Sign in again');
  };

  const pullTable = async <T>(table: string, column: string, since: string | null, inclusive = false): Promise<T[]> => {
    const rows: T[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = client.from(table).select('*');
      if (since) query = inclusive ? query.gte(column, since) : query.gt(column, since);
      const r = await query.order(column, { ascending: true }).range(from, from + PAGE - 1);
      check(r);
      const page = (r.data ?? []) as T[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  };

  return {
    async insertTransactions(rows) {
      if (rows.length === 0) return;
      await ensureSession();
      for (let i = 0; i < rows.length; i += BATCH) {
        check(await client.from('transactions').upsert(rows.slice(i, i + BATCH), { onConflict: 'user_id,id', ignoreDuplicates: true }));
      }
    },
    async upsert(kind, rows) {
      if (rows.length === 0) return;
      await ensureSession();
      const { table, conflict } = SETTINGS[kind];
      check(await client.from(table).upsert([...rows], { onConflict: conflict }));
    },
    async pull(since) {
      await ensureSession();
      const [transactions, accounts, exposures, instruments, targets, plans] = await Promise.all([
        pullTable<TxRow>('transactions', 'inserted_at', since),
        pullTable<AccountRow>('accounts', 'server_updated_at', since),
        pullTable<ExposureRow>('exposures', 'server_updated_at', since),
        pullTable<InstrumentRow>('instruments', 'server_updated_at', since),
        pullTable<TargetsRow>('targets', 'server_updated_at', since),
        pullTable<PlanRow>('plans', 'server_updated_at', since),
      ]);
      return { transactions, accounts, exposures, instruments, targets, plans };
    },
    async insertSnapshot(snapshot, items) {
      await ensureSession();
      check(await client.from('snapshots').upsert([snapshot], { onConflict: 'user_id,date', ignoreDuplicates: true }));
      if (items.length > 0) check(await client.from('snapshot_items').upsert([...items], { onConflict: 'user_id,date,exposure_id', ignoreDuplicates: true }));
    },
    async upsertAiConversations(rows) {
      if (rows.length === 0) return;
      await ensureSession();
      check(await client.from('ai_conversations').upsert([...rows], { onConflict: 'user_id,id' }));
    },
    async insertAiMessages(rows) {
      if (rows.length === 0) return;
      await ensureSession();
      for (let i = 0; i < rows.length; i += BATCH) {
        check(await client.from('ai_messages').upsert(rows.slice(i, i + BATCH), { onConflict: 'user_id,id', ignoreDuplicates: true }));
      }
    },
    async pullAi(since) {
      await ensureSession();
      const [conversations, messages] = await Promise.all([
        pullTable<AiConversationRow>('ai_conversations', 'server_updated_at', since),
        pullTable<AiMessageRow>('ai_messages', 'inserted_at', since),
      ]);
      return { conversations, messages };
    },
    async pullSnapshots(sinceDate) {
      await ensureSession();
      const [snapshots, items] = await Promise.all([
        pullTable<SnapshotRow>('snapshots', 'date', sinceDate, true),
        pullTable<SnapshotItemRow>('snapshot_items', 'date', sinceDate, true),
      ]);
      return { snapshots, items };
    },
  };
}
