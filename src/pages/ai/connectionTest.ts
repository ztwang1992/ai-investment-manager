import type { TestOutcome } from './types';

// "Test connection": requests {API address}/models (OpenAI-compatible).
// The browser sends it straight to the provider: DeepSeek allows cross-origin requests from any origin, with CORS headers even on a 401, so no relay is needed.
// The key goes only in the Authorization header; nothing here records or logs it, and errors return only a kind, never the request.

export interface RequestDeps {
  fetch: typeof fetch;
  now: () => number;
  timeoutMs: number;
}

export const defaultRequestDeps: RequestDeps = {
  // globalThis.fetch is read at call time, so tests can replace it with vi.stubGlobal
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => performance.now(),
  timeoutMs: 6000,
};

export async function requestModels(i: { base: string; key: string }, deps: RequestDeps = defaultRequestDeps): Promise<TestOutcome> {
  const url = `${i.base.trim().replace(/\/+$/, '')}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  const started = deps.now();
  try {
    const res = await deps.fetch(url, { headers: { Authorization: `Bearer ${i.key}` }, signal: controller.signal });
    const latencyMs = Math.round(deps.now() - started);
    if (!res.ok) return { kind: 'http', status: res.status };
    const body = (await res.json().catch(() => ({}))) as { data?: { id?: unknown }[] };
    const models = (Array.isArray(body.data) ? body.data : [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string');
    return { kind: 'ok', latencyMs, models };
  } catch {
    return controller.signal.aborted ? { kind: 'timeout' } : { kind: 'network' };
  } finally {
    clearTimeout(timer);
  }
}
