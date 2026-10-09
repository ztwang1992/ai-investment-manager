// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../app/store';
import type { AppState } from '../../app/store';
import { AiPage } from './AiPage';
import { useAiStore } from './aiStore';
import type { AiState } from './aiStore';

/** A fake key for tests, not a real one */
const KEY = 'sk-test-only-not-a-real-key';
const MODELS = { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] };
const response = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, body: null }) as unknown as Response;

/** One streamed reply: the test speaks it piece by piece, then ends it; a cancelled request errors the stream (as browsers do) */
interface Reply {
  say(text: string): void;
  done(): void;
}
let replies: Reply[];
let chatStatus: number;
function streaming(init: RequestInit): Response {
  if (chatStatus !== 200) return response(chatStatus);
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  const enc = new TextEncoder();
  init.signal?.addEventListener('abort', () => {
    try {
      ctrl.error(new DOMException('Aborted', 'AbortError'));
    } catch {
      // Already ended
    }
  });
  replies.push({
    say: (text) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`)),
    done: () => {
      ctrl.enqueue(enc.encode('data: [DONE]\n\n'));
      ctrl.close();
    },
  });
  return { ok: true, status: 200, body } as unknown as Response;
}

let app: AppState;
let ai: AiState;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 29, 21, 5));
  replies = [];
  chatStatus = 200;
  fetchMock = vi.fn(async (url: RequestInfo | URL, init: RequestInit = {}) => (String(url).endsWith('/models') ? response(200, MODELS) : streaming(init)));
  vi.stubGlobal('fetch', fetchMock);
  app = useAppStore.getState();
  ai = useAiStore.getState();
});
afterEach(() => {
  cleanup();
  useAppStore.setState(app, true);
  useAiStore.setState(ai, true);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Let the stream's data go all the way through: read, decode, update the page */
const flush = () =>
  act(async () => {
    for (let k = 0; k < 20; k++) await Promise.resolve();
  });
const Q = "Where is my portfolio's risk concentrated?";
const start = () => screen.getByRole('button', { name: 'Start a conversation' }) as HTMLButtonElement;
const test = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
  });
};
const connect = async () => {
  render(<AiPage />);
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: KEY } });
  await test();
  fireEvent.click(screen.getByRole('checkbox'));
  await act(async () => {
    fireEvent.click(start());
  });
};
const ask = async (question = Q) => {
  fireEvent.click(screen.getByRole('button', { name: question }));
  await flush();
};
const answer = async (...pieces: string[]) => {
  for (const piece of pieces) replies.at(-1)!.say(piece);
  replies.at(-1)!.done();
  await flush();
};
const messages = () => [...document.querySelectorAll('.ai-msg-text')].map((m) => m.textContent);
const chatCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/chat/completions'));
const sent = (k = 0) =>
  JSON.parse(String((chatCalls()[k]![1] as RequestInit).body)) as { model: string; stream: boolean; messages: { role: string; content: string }[] };
/** "Sep 12 21:40" on this device's clock */
const at = (iso: string) => {
  const d = new Date(iso);
  const two = (n: number) => String(n).padStart(2, '0');
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `${month} ${d.getDate()} ${two(d.getHours())}:${two(d.getMinutes())}`;
};

describe('AI advisor · first visit', () => {
  it('offers DeepSeek now and the other providers later', () => {
    render(<AiPage />);
    expect(screen.getByRole('heading', { name: 'AI advisor' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^DeepSeek/ }).getAttribute('aria-pressed')).toBe('true');
    for (const name of [/^Qwen/, /^Claude/]) {
      const provider = screen.getByRole('button', { name }) as HTMLButtonElement;
      expect(provider.disabled).toBe(true);
      expect(provider.textContent).toContain('Coming soon');
    }
  });

  it("fills in DeepSeek's address and model, and hides the key", () => {
    render(<AiPage />);
    expect((screen.getByLabelText('API address (OpenAI-compatible)') as HTMLInputElement).value).toBe('https://api.deepseek.com');
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('deepseek-chat');
    expect(screen.getByLabelText('API Key').getAttribute('type')).toBe('password');
  });

  it('does not promise a web search it does not do', () => {
    render(<AiPage />);
    expect(document.body.textContent).not.toMatch(/search|latest market/i);
  });

  it('tests the connection for real, then starts only with the consent', async () => {
    let settle: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    );
    render(<AiPage />);
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: KEY } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect((screen.getByRole('button', { name: 'Testing…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Testing the connection…Requesting https://api.deepseek.com/models');
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/models', expect.objectContaining({ headers: { Authorization: `Bearer ${KEY}` } }));
    await act(async () => {
      settle(response(200, MODELS));
    });
    expect(screen.getByRole('status').textContent).toMatch(/^ConnectedLatency \d+ms · available models: deepseek-chat, deepseek-reasoner$/);
    expect(start().disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(start().disabled).toBe(false);
  });

  it('explains a wrong key, an empty balance and a timeout', async () => {
    render(<AiPage />);
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: KEY } });
    fetchMock.mockImplementationOnce(async () => response(401));
    await test();
    expect(screen.getByRole('status').textContent).toBe('Connection failed401 unauthorized: the API key is invalid or has expired');
    fetchMock.mockImplementationOnce(async () => response(402));
    await test();
    expect(screen.getByRole('status').textContent).toBe('Connection failed402 insufficient balance: top up in the DeepSeek console');
    fetchMock.mockImplementationOnce(
      (_url: RequestInfo | URL, init: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(screen.getByRole('status').textContent).toBe('Connection failedConnection timed out: check your network or the API address');
    expect(start().disabled).toBe(true);
  });

  it('sends nothing without a key or to a plain http address', async () => {
    render(<AiPage />);
    await test();
    expect(screen.getByRole('status').textContent).toBe('Connection failedEnter an API key first');
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: KEY } });
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.change(screen.getByLabelText('API address (OpenAI-compatible)'), { target: { value: 'http://api.deepseek.com' } });
    await test();
    expect(screen.getByRole('status').textContent).toBe('Connection failedThe API address must start with https://');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for a new test after the model changes', async () => {
    render(<AiPage />);
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: KEY } });
    await test();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(start().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'deepseek-reasoner' } });
    expect(screen.queryByRole('status')).toBeNull();
    expect(start().disabled).toBe(true);
  });
});

describe('AI advisor · conversation', () => {
  it('greets a new conversation with the portfolio summary', async () => {
    await connect();
    expect(screen.getByRole('heading', { name: '# New conversation' })).toBeTruthy();
    expect(screen.getByText('Read Plan · Holdings · Returns')).toBeTruthy();
    expect(messages()[0]).toMatch(
      /^Connected to DeepSeek · deepseek-chat\. I've read your plan, holdings and returns: total assets about ¥[\d.]+M, \d+ assets are off target, the biggest being 10-year Treasuries\.\nWhere would you like to start\?$/,
    );
    expect(screen.getAllByRole('button', { name: /\?$/ })).toHaveLength(4);
  });

  it('asks a suggested question and shows the reply as it streams in, then keeps it', async () => {
    await connect();
    await ask();
    expect(screen.getByRole('heading', { name: "# Where is my portfolio's risk…" })).toBeTruthy();
    expect(messages().at(-1)).toBe(Q);
    expect(screen.getByText('The AI advisor is thinking…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'How should I invest ¥100,000?' })).toBeNull();
    await act(async () => {
      replies[0]!.say('From the data');
    });
    await flush();
    expect(messages().at(-1)).toBe('From the data');
    expect(screen.queryByText(/thinking/)).toBeNull();
    await answer(': 1. Treasuries are overweight.');
    expect(messages()).toHaveLength(3);
    expect(messages().at(-1)).toBe('From the data: 1. Treasuries are overweight.');
    expect(useAppStore.getState().aiMessages.slice(-2).map((m) => [m.role, m.content])).toEqual([
      ['user', Q],
      ['assistant', 'From the data: 1. Treasuries are overweight.'],
    ]);
  });

  it('sends the plan, holdings and returns with the question, straight to DeepSeek', async () => {
    await connect();
    await ask();
    expect(chatCalls()).toHaveLength(1);
    expect(chatCalls()[0]![0]).toBe('https://api.deepseek.com/chat/completions');
    const body = sent();
    expect(body).toMatchObject({ model: 'deepseek-chat', stream: true });
    expect(body.messages[0]!.role).toBe('system');
    expect(body.messages[0]!.content).toContain('You may draw on what you know of recent markets and the economy.');
    expect(body.messages[0]!.content).toMatch(/The user's portfolio:\nTotal assets about ¥[\d.]+M/);
    expect(body.messages.slice(1)).toEqual([{ role: 'user', content: Q }]);
  });

  it('sends with Enter, but not while an input method is still composing', async () => {
    await connect();
    const input = screen.getByRole('textbox', { name: 'Ask about your portfolio' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'How far from retirement?' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(messages()).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' });
    await flush();
    expect(messages().at(-1)).toBe('How far from retirement?');
    expect(input.value).toBe('');
  });

  it('keeps a typed question when a reply is still pending', async () => {
    await connect();
    await ask();
    const input = screen.getByRole('textbox', { name: 'Ask about your portfolio' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Anything else?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(messages().at(-1)).toBe(Q);
    expect(input.value).toBe('Anything else?');
  });

  it('switches web analysis on and off, changing what the model is told', async () => {
    await connect();
    const on = screen.getByRole('button', { name: 'Web analysis · on' });
    expect(on.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(on);
    expect(screen.getByRole('button', { name: 'Web analysis · off' }).getAttribute('aria-pressed')).toBe('false');
    await ask();
    expect(screen.getByText('The AI advisor is thinking…')).toBeTruthy();
    expect(sent().messages[0]!.content).toContain("Answer from the user's data only.");
    expect(sent().messages[0]!.content).not.toContain('recent markets');
  });

  it('hides the total in the greeting when amounts are hidden', async () => {
    useAppStore.setState({ hideAmounts: true });
    await connect();
    expect(messages()[0]).toContain('total assets about ••••');
  });

  it('explains a failed reply and keeps the question', async () => {
    chatStatus = 402;
    await connect();
    await ask();
    expect(screen.getByRole('alert').textContent).toBe('402 insufficient balance: top up in the DeepSeek console');
    expect(messages().at(-1)).toBe(Q);
    expect(useAppStore.getState().aiMessages.at(-1)).toMatchObject({ role: 'user', content: Q });
    expect(screen.queryByText(/thinking/)).toBeNull();
  });

  it('sends the key only in the request headers, and keeps it out of the app state, the page and the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method));
    await connect();
    await ask();
    await answer('OK.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls as [RequestInfo | URL, RequestInit][]) {
      expect(String(url).startsWith('https://api.deepseek.com/')).toBe(true);
      expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
      expect(String(init.body ?? '')).not.toContain(KEY);
    }
    for (const spy of spies) for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(KEY);
    expect(JSON.stringify(useAppStore.getState())).not.toContain(KEY);
    expect(document.body.textContent).not.toContain(KEY);
    for (const spy of spies) spy.mockRestore();
  });

  it('opens straight into a new conversation with a key saved on this device', () => {
    useAiStore.setState({ connected: true, key: KEY, consent: true, currentId: null });
    render(<AiPage />);
    expect(screen.getByRole('heading', { name: '# New conversation' })).toBeTruthy();
    expect(messages()[0]).toMatch(/^Connected to DeepSeek · deepseek-chat\./);
  });
});

describe('AI advisor · conversation history', () => {
  const openDrawer = () => fireEvent.click(screen.getByRole('button', { name: 'Conversation history' }));
  const drawer = () => screen.getByRole('dialog', { name: 'Conversation history' });
  const items = () => within(drawer()).queryAllByRole('button', { name: / messages?$/ });

  it('lists saved conversations newest first and switches between them', async () => {
    await connect();
    openDrawer();
    // As in the prototype: the drawer sits inside the chat page and covers only the area above the tab bar
    expect(drawer().closest('.ai-chat')).not.toBeNull();
    expect(items().map((b) => b.textContent)).toEqual([
      `My Treasuries are overweight. Should I rebalance now?${at('2026-09-12T13:40:00.000Z')} · 2 messages`,
      `Adding before year end${at('2026-08-20T01:15:00.000Z')} · 2 messages`,
    ]);
    fireEvent.click(items()[1]!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: '# Adding before year end' })).toBeTruthy();
    expect(messages()[0]).toBe('I will have about ¥200,000 more before year end. How should I put it in?');
  });

  it('puts a new conversation in the list once it has its first question', async () => {
    await connect();
    await ask();
    await answer('OK.');
    openDrawer();
    expect(items()).toHaveLength(3);
    expect(items()[0]!.textContent).toBe("Where is my portfolio's risk…Sep 29 21:05 · 2 messages");
    expect(items()[0]!.getAttribute('aria-current')).toBe('true');
  });

  it('starts another conversation from the drawer', async () => {
    await connect();
    await ask();
    await answer('OK.');
    openDrawer();
    fireEvent.click(within(drawer()).getByRole('button', { name: '+ New conversation' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('heading', { name: '# New conversation' })).toBeTruthy();
    openDrawer();
    expect(items()).toHaveLength(3);
  });

  it('changes the key: back to the start with the key cleared, conversations kept', async () => {
    await connect();
    openDrawer();
    expect(within(drawer()).getByText('DeepSeek · deepseek-chat · connected')).toBeTruthy();
    fireEvent.click(within(drawer()).getByRole('button', { name: 'Change key' }));
    expect(screen.getByRole('heading', { name: 'AI advisor' })).toBeTruthy();
    expect((screen.getByLabelText('API Key') as HTMLInputElement).value).toBe('');
    expect(useAppStore.getState().aiConversations).toHaveLength(2);
  });

  it('closes with Escape or a tap outside', async () => {
    await connect();
    openDrawer();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    openDrawer();
    fireEvent.click(document.querySelector('.ai-drawer-backdrop')!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('in Chinese', () => {
  it('greets and answers in Chinese', async () => {
    useAppStore.setState({ locale: 'zh' });
    render(<AiPage />);
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: KEY } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    });
    fireEvent.click(screen.getByRole('checkbox'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '开始对话' }));
    });
    expect(screen.getByRole('heading', { name: '# 新对话' })).toBeTruthy();
    expect(messages()[0]).toMatch(/^已连接 DeepSeek · deepseek-chat。我读取了你的计划、持仓和收益数据：总资产约 ¥[\d.]+万，/);
    await ask('我的组合风险集中在哪？');
    expect(sent().messages[0]!.content).toMatch(/^你是用户的私人投资顾问.*用中文回答/);
    expect(screen.getByRole('heading', { name: '# 我的组合风险集中在哪？' })).toBeTruthy();
  });
});
