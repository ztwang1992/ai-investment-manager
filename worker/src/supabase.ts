import { snapshotItemToRow, snapshotToRow } from '../../src/domain/rows';
import type { ExposureRow, InstrumentRow, TxRow } from '../../src/domain/rows';
import type { Snapshot, SnapshotItem } from '../../src/domain/types';
import type { Fetch } from './types';

// Daily snapshots call PostgREST directly with the service role key (no supabase-js). The service role bypasses RLS and can read every user's rows,
// so this reads only the tables snapshots need and writes only snapshots and snapshot_items. The key stays in request headers, never in errors or logs.

export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
}

export interface Admin {
  /** Users who have created an account; new users who haven't done onboarding don't count */
  userIds(): Promise<string[]>;
  /** All users' transactions, instruments and assets (global presets included) */
  loadAll(): Promise<{ transactions: TxRow[]; instruments: InstrumentRow[]; exposures: ExposureRow[] }>;
  usersWithSnapshot(date: string): Promise<Set<string>>;
  /** First deletes these users' per-asset values for the day and writes the new ones, finally overwriting the snapshot: if it fails midway the snapshot isn't written yet, and the rerun redoes it all */
  writeSnapshots(date: string, rows: readonly { userId: string; snapshot: Snapshot; items: SnapshotItem[] }[]): Promise<void>;
}

const PAGE = 1000;
const TX_COLUMNS = 'user_id,id,date,created_at,type,account_id,instrument_code,qty,price,fee,reason,fx_to_cny';
const INSTRUMENT_COLUMNS = 'user_id,code,name,market,currency,exposure_id,pays_dividend,position,updated_at';
const EXPOSURE_COLUMNS = 'user_id,id,name,group_id,is_stock,position,updated_at';

/** The old service_role key is a JWT; the new ones starting with sb_secret_ aren't and can only go in the apikey header */
const isJwt = (key: string) => /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(key);

export function createAdmin(env: SupabaseEnv, fetch: Fetch): Admin {
  const base = `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`;
  const key = env.SUPABASE_SECRET_KEY;
  const auth: Record<string, string> = isJwt(key) ? { apikey: key, Authorization: `Bearer ${key}` } : { apikey: key };

  const call = async (method: string, table: string, query: string, body?: unknown, prefer?: string): Promise<Response> => {
    const headers: Record<string, string> = { ...auth };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${base}/${table}?${query}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    if (!res.ok) throw new Error(`Supabase ${method} ${table} returned ${res.status}`);
    return res;
  };

  const all = async <T>(table: string, select: string, order: string, filter = ''): Promise<T[]> => {
    const rows: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = (await (await call('GET', table, `select=${select}&order=${order}${filter}&limit=${PAGE}&offset=${offset}`)).json()) as T[];
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  };

  return {
    async userIds() {
      const rows = await all<{ user_id: string }>('accounts', 'user_id', 'user_id.asc');
      return [...new Set(rows.map((r) => r.user_id))];
    },
    async loadAll() {
      const [transactions, instruments, exposures] = await Promise.all([
        all<TxRow>('transactions', TX_COLUMNS, 'user_id.asc,date.asc,created_at.asc,id.asc'),
        all<InstrumentRow>('instruments', INSTRUMENT_COLUMNS, 'user_id.asc.nullsfirst,code.asc'),
        all<ExposureRow>('exposures', EXPOSURE_COLUMNS, 'user_id.asc.nullsfirst,id.asc'),
      ]);
      return { transactions, instruments, exposures };
    },
    async usersWithSnapshot(date) {
      const rows = await all<{ user_id: string }>('snapshots', 'user_id', 'user_id.asc', `&date=eq.${date}`);
      return new Set(rows.map((r) => r.user_id));
    },
    async writeSnapshots(date, rows) {
      if (rows.length === 0) return;
      const users = rows.map((r) => r.userId).join(',');
      await call('DELETE', 'snapshot_items', `date=eq.${date}&user_id=in.(${users})`, undefined, 'return=minimal');
      const items = rows.flatMap((r) => r.items.map((item) => snapshotItemToRow(item, r.userId)));
      if (items.length > 0) await call('POST', 'snapshot_items', '', items, 'return=minimal');
      await call(
        'POST',
        'snapshots',
        'on_conflict=user_id,date',
        rows.map((r) => snapshotToRow(r.snapshot, r.userId)),
        'resolution=merge-duplicates,return=minimal',
      );
    },
  };
}
