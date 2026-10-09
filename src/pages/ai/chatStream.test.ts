import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSseDecoder, streamChat } from './chatStream';
import type { ChatDeps, ChatMessage } from './chatStream';

// Chat requests: the browser sends them straight to DeepSeek and reads the reply as an SSE stream. The tests replace fetch; nothing goes over the network.

afterEach(() => {
  vi.useRealTimers();
});

/** A fake key for the tests, not a real one */
const KEY = 'sk-test-0123456789abcdefFAKE';
const BASE = 'https://api.deepseek.com/';
const messages: ChatMessage[] = [
  { role: 'system', content: '用户组合数据：…' },
  { role: 'user', content: '美债超配要不要现在调？' },
];
const enc = new TextEncoder();
const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;

/** Like the browser's fetch: streams the body in the given chunks; when the request is cancelled, the body stream errors */
function stubFetch(i: { status?: number; chunks?: (string | Uint8Array)[]; then?: 'end' | 'hang' | 'fail' } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const signal = init.signal!;
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const chunks = [...(i.chunks ?? [])];
    let ctrl!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        ctrl = c;
      },
      pull(c) {
        const next = chunks.shift();
        if (next !== undefined) return void c.enqueue(typeof next === 'string' ? enc.encode(next) : next);
        const then = i.then ?? 'end';
        if (then === 'end') return void c.close();
        if (then === 'fail') return void c.error(new TypeError('network error'));
        return new Promise<void>(() => {});
      },
    });
    signal.addEventListener('abort', () => {
      try {
        ctrl.error(new DOMException('Aborted', 'AbortError'));
      } catch {
        // already finished
      }
    });
    return new Response(body, { status: i.status ?? 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}
const deps = (fetch: typeof globalThis.fetch): ChatDeps => ({ fetch, connectTimeoutMs: 30_000, idleTimeoutMs: 60_000 });
const ask = (fetch: typeof globalThis.fetch, extra: { signal?: AbortSignal; onDelta?: (t: string) => void } = {}) =>
  streamChat({ base: BASE, key: KEY, model: 'deepseek-chat', messages, onDelta: extra.onDelta ?? (() => {}), ...(extra.signal ? { signal: extra.signal } : {}) }, deps(fetch));

describe('reading server-sent events', () => {
  it('splits lines across chunks and line endings, and keeps only data', () => {
    const sse = createSseDecoder();
    expect(sse.push('data: a\r\nda')).toEqual(['a']);
    expect(sse.push('ta: b\n')).toEqual(['b']);
    expect(sse.push(': keep-alive\n\nevent: ping\nid: 7\n')).toEqual([]);
    expect(sse.push('data:c')).toEqual([]);
    expect(sse.end()).toEqual(['c']);
  });
});

describe('asking DeepSeek', () => {
  it('passes the reply on piece by piece and returns the whole text', async () => {
    const { fetch } = stubFetch({
      chunks: [
        ': keep-alive\n\n',
        delta('从数据'),
        'data: {"choices":[{"delta":{"reasoning_content":"先想一想"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"看',
        '："}}]}\r\n\r\n',
        delta('1. 美债超配。'),
        'data: [DONE]\n\n',
      ],
    });
    const pieces: string[] = [];
    expect(await ask(fetch, { onDelta: (t) => pieces.push(t) })).toEqual({ kind: 'ok', text: '从数据看：1. 美债超配。' });
    expect(pieces).toEqual(['从数据', '看：', '1. 美债超配。']);
  });

  it('keeps a character whose bytes arrive in two chunks', async () => {
    const bytes = enc.encode(delta('看'));
    const cut = bytes.indexOf(enc.encode('看')[0]!) + 1;
    const { fetch } = stubFetch({ chunks: [bytes.slice(0, cut), bytes.slice(cut), 'data: [DONE]\n\n'] });
    expect(await ask(fetch)).toEqual({ kind: 'ok', text: '看' });
  });

  it('accepts a reply that ends without [DONE]', async () => {
    const { fetch } = stubFetch({ chunks: [delta('好的。')] });
    expect(await ask(fetch)).toEqual({ kind: 'ok', text: '好的。' });
  });

  it('skips data it cannot read', async () => {
    const { fetch } = stubFetch({ chunks: ['data: {oops\n\n', delta('好'), 'data: [DONE]\n\n'] });
    expect(await ask(fetch)).toEqual({ kind: 'ok', text: '好' });
  });

  it('treats a reply without any text as cut off', async () => {
    const { fetch } = stubFetch({ chunks: ['data: [DONE]\n\n'] });
    expect(await ask(fetch)).toEqual({ kind: 'broken' });
  });

  it('reports the status of a refused request', async () => {
    for (const status of [401, 402, 429, 503]) {
      const { fetch } = stubFetch({ status, chunks: ['{"error":{"message":"…"}}'] });
      expect(await ask(fetch)).toEqual({ kind: 'http', status });
    }
  });

  it('gives up when no answer arrives within 30 seconds', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: RequestInfo | URL, init: RequestInit = {}) =>
        new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))),
    ) as unknown as typeof globalThis.fetch;
    const result = ask(fetch);
    await vi.advanceTimersByTimeAsync(29_999);
    let settled = false;
    void result.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ kind: 'timeout' });
  });

  it('gives up when the reply stalls for 60 seconds', async () => {
    vi.useFakeTimers();
    const { fetch } = stubFetch({ chunks: [delta('从数据')], then: 'hang' });
    const pieces: string[] = [];
    const result = ask(fetch, { onDelta: (t) => pieces.push(t) });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toEqual({ kind: 'timeout' });
    expect(pieces).toEqual(['从数据']);
  });

  it('reports a reply cut off midway', async () => {
    const { fetch } = stubFetch({ chunks: [delta('从数据')], then: 'fail' });
    expect(await ask(fetch)).toEqual({ kind: 'broken' });
  });

  it('stops quietly when the question is cancelled', async () => {
    const { fetch } = stubFetch({ chunks: [delta('从数据')], then: 'hang' });
    const controller = new AbortController();
    const result = ask(fetch, { signal: controller.signal, onDelta: () => controller.abort() });
    expect(await result).toEqual({ kind: 'aborted' });
  });

  it('reports a request that cannot reach the address', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;
    expect(await ask(fetch)).toEqual({ kind: 'network' });
  });

  it('sends the key only in the Authorization header, to the chat address', async () => {
    const { fetch, calls } = stubFetch({ chunks: [delta('好'), 'data: [DONE]\n\n'] });
    await ask(fetch);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.deepseek.com/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(String(init.body))).toEqual({ model: 'deepseek-chat', messages, stream: true });
    expect(String(init.body)).not.toContain(KEY);
  });
});
