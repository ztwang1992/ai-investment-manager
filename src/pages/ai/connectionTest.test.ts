import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestModels } from './connectionTest';

const response = (status: number, json: () => Promise<unknown>) =>
  ({ ok: status >= 200 && status < 300, status, json }) as unknown as Response;
const deps = (fetch: unknown, now: () => number = () => 0) => ({
  fetch: fetch as typeof globalThis.fetch,
  now,
  timeoutMs: 6000,
});

afterEach(() => {
  vi.useRealTimers();
});

describe('requestModels', () => {
  it('asks {base}/models with the key and reports the latency and the models', async () => {
    let clock = 1000;
    const fetch = vi.fn(async () => {
      clock += 142;
      return response(200, async () => ({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }));
    });
    const outcome = await requestModels({ base: ' https://api.deepseek.com/ ', key: 'sk-abc' }, deps(fetch, () => clock));
    expect(outcome).toEqual({ kind: 'ok', latencyMs: 142, models: ['deepseek-chat', 'deepseek-reasoner'] });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/models',
      expect.objectContaining({ headers: { Authorization: 'Bearer sk-abc' } }),
    );
  });

  it('passes on HTTP errors such as 401', async () => {
    const fetch = vi.fn(async () => response(401, async () => ({ error: { message: 'Authentication Fails' } })));
    expect(await requestModels({ base: 'https://api.deepseek.com', key: 'sk-bad' }, deps(fetch))).toEqual({ kind: 'http', status: 401 });
  });

  it('copes with a success that is not JSON', async () => {
    const fetch = vi.fn(async () =>
      response(200, async () => {
        throw new SyntaxError('not json');
      }),
    );
    expect(await requestModels({ base: 'https://api.deepseek.com', key: 'sk-abc' }, deps(fetch))).toEqual({
      kind: 'ok',
      latencyMs: 0,
      models: [],
    });
  });

  it('gives up after the timeout', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = requestModels({ base: 'https://api.deepseek.com', key: 'sk-abc' }, deps(fetch));
    await vi.advanceTimersByTimeAsync(6000);
    expect(await pending).toEqual({ kind: 'timeout' });
  });

  it('reports a network failure', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await requestModels({ base: 'https://api.deepseek.com', key: 'sk-abc' }, deps(fetch))).toEqual({ kind: 'network' });
  });
});
