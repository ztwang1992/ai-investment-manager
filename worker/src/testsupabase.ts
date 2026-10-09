// For tests: an in-memory Supabase PostgREST implementing only the few requests the daily snapshots make.

type Row = Record<string, unknown>;

export interface FakeSupabase {
  tables: Record<string, Row[]>;
  requests: { method: string; table: string; query: URLSearchParams; headers: Headers }[];
  /** The next matching request returns this status code */
  failNext(method: string, table: string, status: number): void;
  /** Handles requests to https://proj.supabase.co/rest/v1/...; returns undefined for other addresses */
  handle(url: URL, init?: RequestInit): Promise<Response> | undefined;
}

export const SUPABASE_URL = 'https://proj.supabase.co';

/** PostgREST filters: date=eq.X, user_id=in.(a,b) */
function matches(row: Row, query: URLSearchParams): boolean {
  for (const [key, value] of query) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) continue;
    if (value.startsWith('eq.') && String(row[key]) !== value.slice(3)) return false;
    if (value.startsWith('in.(') && !value.slice(4, -1).split(',').includes(String(row[key]))) return false;
  }
  return true;
}

export function createFakeSupabase(tables: Record<string, Row[]> = {}): FakeSupabase {
  const fake: FakeSupabase = {
    tables: { accounts: [], transactions: [], instruments: [], exposures: [], snapshots: [], snapshot_items: [], ...tables },
    requests: [],
    failNext(method, table, status) {
      failures.push({ method, table, status });
    },
    handle(url, init = {}) {
      if (url.origin !== SUPABASE_URL || !url.pathname.startsWith('/rest/v1/')) return undefined;
      return respond(url, init);
    },
  };
  const failures: { method: string; table: string; status: number }[] = [];

  async function respond(url: URL, init: RequestInit): Promise<Response> {
    const method = init.method ?? 'GET';
    const table = url.pathname.slice('/rest/v1/'.length);
    const query = url.searchParams;
    fake.requests.push({ method, table, query, headers: new Headers(init.headers) });
    const failure = failures.findIndex((f) => f.method === method && f.table === table);
    if (failure >= 0) {
      const [f] = failures.splice(failure, 1);
      return new Response(JSON.stringify({ message: 'failed' }), { status: f!.status });
    }
    const rows = (fake.tables[table] ??= []);
    if (method === 'GET') {
      const offset = Number(query.get('offset') ?? 0);
      const limit = Number(query.get('limit') ?? 1000);
      const select = query.get('select')?.split(',') ?? [];
      const found = rows.filter((r) => matches(r, query)).slice(offset, offset + limit);
      return Response.json(found.map((r) => Object.fromEntries(select.map((c) => [c, r[c] ?? null]))));
    }
    if (method === 'DELETE') {
      fake.tables[table] = rows.filter((r) => !matches(r, query));
      return new Response(null, { status: 204 });
    }
    if (method === 'POST') {
      const body = JSON.parse(String(init.body)) as Row[];
      const conflict = query.get('on_conflict')?.split(',');
      for (const row of body) {
        const same = conflict ? rows.findIndex((r) => conflict.every((c) => r[c] === row[c])) : -1;
        if (same >= 0) rows[same] = { ...rows[same], ...row };
        else rows.push({ ...row });
      }
      return new Response(null, { status: 201 });
    }
    return new Response(null, { status: 405 });
  }

  return fake;
}
