// Chat requests: the browser POSTs straight to {API address}/chat/completions (OpenAI-compatible, stream: true) and reads the reply chunk by chunk as SSE.
// DeepSeek allows cross-origin requests from our site (checked 2026-10-03), so nothing goes through the Worker.
// The key goes only in the Authorization header; nothing here records or logs it, and errors return only a kind, never the request.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ChatOutcome =
  | { kind: 'ok'; text: string }
  | { kind: 'http'; status: number }
  | { kind: 'timeout' }
  | { kind: 'network' }
  /** The reply broke off midway, or not a single character came */
  | { kind: 'broken' }
  /** Cancelled by the caller (Change key, sign-out) */
  | { kind: 'aborted' };

export interface ChatDeps {
  fetch: typeof fetch;
  /** No response headers this long after sending counts as a timeout */
  connectTimeoutMs: number;
  /** No data at all this long after receiving started (keep-alive comments sent while the server queues count as data) counts as a timeout */
  idleTimeoutMs: number;
}

export const defaultChatDeps: ChatDeps = {
  // globalThis.fetch is read at call time, so tests can replace it with vi.stubGlobal
  fetch: (input, init) => globalThis.fetch(input, init),
  connectTimeoutMs: 30_000,
  idleTimeoutMs: 60_000,
};

/** SSE decoding: splits into lines (\r\n, \n, \r, and half lines split across two chunks) and returns what follows each data:; comments, empty lines and other fields are ignored. */
export function createSseDecoder(): { push(chunk: string): string[]; end(): string[] } {
  let buffer = '';
  const data = (line: string) => (line.startsWith('data:') ? [line.slice(5).replace(/^ /, '')] : []);
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() ?? '';
      return lines.flatMap(data);
    },
    end() {
      const rest = buffer;
      buffer = '';
      return data(rest);
    },
  };
}

/** The reply text in a data chunk; reasoning_content (the thinking) and anything unreadable are skipped */
function contentOf(payload: string): string {
  try {
    const content = (JSON.parse(payload) as { choices?: { delta?: { content?: unknown } }[] }).choices?.[0]?.delta?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
}

export async function streamChat(
  i: {
    base: string;
    key: string;
    model: string;
    messages: readonly ChatMessage[];
    signal?: AbortSignal;
    onDelta: (text: string) => void;
  },
  deps: ChatDeps = defaultChatDeps,
): Promise<ChatOutcome> {
  if (i.signal?.aborted) return { kind: 'aborted' };
  const url = `${i.base.trim().replace(/\/+$/, '')}/chat/completions`;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    controller.abort();
    void reader?.cancel().catch(() => {});
  };
  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, ms);
  };
  // Cancellation and timeouts win over a result already read: they end the pending read early
  const halted = (): ChatOutcome | null => (i.signal?.aborted ? { kind: 'aborted' } : timedOut ? { kind: 'timeout' } : null);
  i.signal?.addEventListener('abort', stop);
  try {
    arm(deps.connectTimeoutMs);
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${i.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: i.model, messages: i.messages, stream: true }),
        credentials: 'omit',
        signal: controller.signal,
      });
    } catch {
      return halted() ?? { kind: 'network' };
    }
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      return halted() ?? { kind: 'http', status: res.status };
    }
    if (!res.body) return halted() ?? { kind: 'broken' };
    reader = res.body.getReader();
    const decoder = new TextDecoder();
    const sse = createSseDecoder();
    let text = '';
    /** Handles the data read; returns true on [DONE] */
    const take = (payloads: readonly string[]) => {
      for (const p of payloads) {
        if (p === '[DONE]') return true;
        const piece = contentOf(p);
        if (!piece) continue;
        text += piece;
        i.onDelta(piece);
      }
      return false;
    };
    const finish = (): ChatOutcome => halted() ?? (text ? { kind: 'ok', text } : { kind: 'broken' });
    for (;;) {
      arm(deps.idleTimeoutMs);
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        return halted() ?? { kind: 'broken' };
      }
      const stopped = halted();
      if (stopped) return stopped;
      if (chunk.done) {
        take([...sse.push(decoder.decode()), ...sse.end()]);
        return finish();
      }
      if (take(sse.push(decoder.decode(chunk.value, { stream: true })))) {
        void reader.cancel().catch(() => {});
        return finish();
      }
    }
  } finally {
    clearTimeout(timer);
    i.signal?.removeEventListener('abort', stop);
  }
}
