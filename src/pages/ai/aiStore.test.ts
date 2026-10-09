import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import type { AiSaved, AiVault } from '../../app/aiVault';
import type { BootState } from '../../app/boot';
import type { Session } from '../../app/session';
import { createAppStore } from '../../app/store';
import type { AiMessage } from '../../domain/types';
import { createAiStore, followSession } from './aiStore';
import type { ChatMessage, ChatOutcome } from './chatStream';
import type { TestOutcome } from './types';

/** A fake key for tests, not a real one */
const KEY = 'sk-test-0123456789abcdefFAKE';
const SUCCESS: TestOutcome = { kind: 'ok', latencyMs: 142, models: ['deepseek-chat', 'deepseek-reasoner'] };

/** An in-memory vault (the encryption itself is tested in aiVault.test.ts) */
function memoryVault(saved: AiSaved | null = null) {
  const vault = {
    saved,
    load: async () => vault.saved,
    save: async (s: AiSaved) => {
      vault.saved = { ...s };
    },
    clear: async () => {
      vault.saved = null;
    },
  };
  return vault;
}

interface Chat {
  base: string;
  key: string;
  model: string;
  messages: readonly ChatMessage[];
  signal?: AbortSignal;
  onDelta: (text: string) => void;
  settle: (o: ChatOutcome) => void;
}

function make() {
  const app = createAppStore({ now: () => new Date(2026, 9, 3, 21, 5), schedule: () => () => {} });
  const tests: { base: string; key: string; settle: (o: TestOutcome) => void }[] = [];
  const chats: Chat[] = [];
  let n = 0;
  // Every read of the clock moves on a second: a question always comes before its answer
  let clock = new Date(2026, 9, 3, 21, 5).getTime();
  const store = createAiStore({
    now: () => new Date((clock += 1000)),
    newId: () => `new-${String(++n).padStart(3, '0')}`,
    requestModels: (i) => new Promise<TestOutcome>((settle) => tests.push({ ...i, settle })),
    streamChat: (i) => new Promise<ChatOutcome>((settle) => chats.push({ ...i, settle })),
    app,
  });
  const s = () => store.getState();
  const passTest = async () => {
    const pending = s().runTest();
    tests.at(-1)!.settle(SUCCESS);
    await pending;
  };
  const vault = memoryVault();
  const connected = async () => {
    await s().attach(vault);
    s().setKey(`  ${KEY}  `);
    await passTest();
    s().toggleConsent();
    await s().connect();
  };
  const mine = () => app.getState().aiMessages.filter((m) => !m.conversationId.startsWith('h'));
  return { s, app, store, tests, chats, vault, passTest, connected, mine };
}

describe('ai store · connecting', () => {
  it('starts disconnected with DeepSeek defaults', () => {
    const { s } = make();
    expect(s()).toMatchObject({
      base: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      key: '',
      consent: false,
      connected: false,
      web: true,
      busy: false,
      test: null,
      currentId: null,
      draft: null,
      error: null,
    });
  });

  it('does not send anything without a key or with a plain http address', async () => {
    const { s, tests } = make();
    await s().runTest();
    expect(s().test).toMatchObject({ status: 'fail', message: 'Enter an API key first' });
    s().setKey(KEY);
    s().setBase('http://api.deepseek.com');
    await s().runTest();
    expect(s().test?.message).toBe('The API address must start with https://');
    expect(tests).toHaveLength(0);
  });

  it('tests the trimmed key against the address and shows the result', async () => {
    const { s, tests } = make();
    s().setKey(`  ${KEY}  `);
    const pending = s().runTest();
    expect(s().test).toEqual({ status: 'testing', title: 'Testing the connection…', message: 'Requesting https://api.deepseek.com/models' });
    expect(tests[0]).toMatchObject({ base: 'https://api.deepseek.com', key: KEY });
    tests[0]!.settle({ kind: 'http', status: 401 });
    await pending;
    expect(s().test).toMatchObject({ status: 'fail', message: '401 unauthorized: the API key is invalid or has expired' });
  });

  it('drops the result of a test whose form was changed meanwhile', async () => {
    const { s, tests } = make();
    s().setKey(KEY);
    const pending = s().runTest();
    s().setKey('sk-test-other');
    tests[0]!.settle(SUCCESS);
    await pending;
    expect(s().test).toBeNull();
  });

  it('connects only after a successful test and the consent, then saves the settings on this device', async () => {
    const { s, tests, passTest, vault, app } = make();
    await s().attach(vault);
    s().toggleConsent();
    await s().connect();
    expect(s().connected).toBe(false);
    s().setKey(`  ${KEY}  `);
    const failing = s().runTest();
    tests.at(-1)!.settle({ kind: 'http', status: 401 });
    await failing;
    await s().connect();
    expect(s().connected).toBe(false);
    s().toggleConsent();
    await passTest();
    await s().connect();
    expect(s().connected).toBe(false);
    expect(vault.saved).toBeNull();
    s().toggleConsent();
    const before = app.getState().aiConversations;
    await s().connect();
    expect(s()).toMatchObject({ connected: true, key: KEY, currentId: 'new-001' });
    expect(s().welcome).toEqual({ conversationId: 'new-001', time: expect.stringMatching(/^\d\d:\d\d$/) });
    expect(vault.saved).toEqual({ base: 'https://api.deepseek.com', model: 'deepseek-chat', key: KEY, consent: true, web: true });
    // A new conversation is saved with its first question
    expect(app.getState().aiConversations).toBe(before);
  });

  it('asks for a new test after the address, model or key changes', async () => {
    const { s, passTest } = make();
    s().setKey(KEY);
    for (const change of [() => s().setBase('https://example.com'), () => s().setModel('deepseek-reasoner'), () => s().setKey('sk-test-b')]) {
      await passTest();
      expect(s().test?.status).toBe('ok');
      change();
      expect(s().test).toBeNull();
    }
  });

  it('forgets the key on Change key, also on this device, and keeps the conversations', async () => {
    const { s, connected, vault, app } = make();
    await connected();
    const conversations = app.getState().aiConversations;
    s().disconnect();
    await Promise.resolve();
    expect(s()).toMatchObject({ connected: false, key: '', test: null });
    expect(vault.saved).toEqual({ base: 'https://api.deepseek.com', model: 'deepseek-chat', key: '', consent: true, web: true });
    expect(app.getState().aiConversations).toBe(conversations);
  });

  it('opens straight into the chat with a key saved on this device', async () => {
    const { s } = make();
    await s().attach(memoryVault({ base: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner', key: KEY, consent: true, web: false }));
    expect(s()).toMatchObject({ connected: true, key: KEY, base: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner', consent: true, web: false });
  });

  it('stays on the start page when no key is saved, keeping the address and model', async () => {
    const { s } = make();
    await s().attach(memoryVault());
    expect(s().connected).toBe(false);
    await s().attach(memoryVault({ base: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner', key: '', consent: true, web: true }));
    expect(s()).toMatchObject({ connected: false, key: '', base: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner' });
  });

  it('forgets everything in memory when the account closes', async () => {
    const { s, connected } = make();
    await connected();
    s().detach();
    expect(s()).toMatchObject({ connected: false, key: '', consent: false, currentId: null, test: null, base: 'https://api.deepseek.com' });
  });

  it('follows signing in and out', async () => {
    const { store } = make();
    const boot = create<BootState>()(() => ({ kind: 'loading' }));
    const vault: AiVault = memoryVault({ base: 'https://api.deepseek.com', model: 'deepseek-chat', key: KEY, consent: true, web: true });
    const session = { aiVault: vault } as unknown as Session;
    const auth = {} as never;
    const stop = followSession(store, boot);
    boot.setState({ kind: 'ready', auth, session }, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().connected).toBe(true);
    boot.setState({ kind: 'signedOut', auth }, true);
    expect(store.getState()).toMatchObject({ connected: false, key: '' });
    stop();
  });
});

describe('ai store · conversation', () => {
  const SYSTEM = "How to answer…\n\nThe user's portfolio:\nTotal assets about ¥3.10M";

  it('saves the question, streams the reply and saves it once complete', async () => {
    const { s, app, chats, connected, mine } = make();
    await connected();
    const pending = s().ask('  Where is my risk?  ', SYSTEM);
    const conversation = app.getState().aiConversations.find((c) => c.id === 'new-001')!;
    expect(conversation.title).toBe('Where is my risk?');
    expect(mine().map((m) => [m.role, m.content])).toEqual([['user', 'Where is my risk?']]);
    expect(s()).toMatchObject({ busy: true, draft: { conversationId: 'new-001', text: '' } });
    expect(chats[0]).toMatchObject({ base: 'https://api.deepseek.com', key: KEY, model: 'deepseek-chat' });
    expect(chats[0]!.messages).toEqual([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Where is my risk?' },
    ]);
    chats[0]!.onDelta('From the data');
    expect(s().draft?.text).toBe('From the data');
    chats[0]!.onDelta(': 1. Treasuries are overweight.');
    expect(s().draft?.text).toBe('From the data: 1. Treasuries are overweight.');
    chats[0]!.settle({ kind: 'ok', text: 'From the data: 1. Treasuries are overweight.' });
    await pending;
    expect(mine().map((m) => [m.role, m.content])).toEqual([
      ['user', 'Where is my risk?'],
      ['assistant', 'From the data: 1. Treasuries are overweight.'],
    ]);
    const after = app.getState().aiConversations.find((c) => c.id === 'new-001')!;
    expect(after.updatedAt).toBe(mine()[1]!.createdAt);
    expect(after.createdAt).toBe(conversation.createdAt);
    expect(s()).toMatchObject({ busy: false, draft: null, error: null });
  });

  it('sends the last seven messages of this conversation with the new question', async () => {
    const { s, app, chats, connected } = make();
    await connected();
    const history: AiMessage[] = Array.from({ length: 10 }, (_, k) => ({
      id: `old-${k}`,
      conversationId: 'c-old',
      role: k % 2 === 0 ? 'user' : 'assistant',
      content: `message ${k}`,
      createdAt: `2026-10-02T08:00:${String(k).padStart(2, '0')}.000Z`,
    }));
    app.setState({
      aiConversations: [{ id: 'c-old', title: 'Earlier', createdAt: history[0]!.createdAt, updatedAt: history[9]!.createdAt }],
      aiMessages: history,
    });
    s().select('c-old');
    void s().ask('Anything else?', SYSTEM);
    expect(chats[0]!.messages.map((m) => m.content)).toEqual([SYSTEM, 'message 3', 'message 4', 'message 5', 'message 6', 'message 7', 'message 8', 'message 9', 'Anything else?']);
  });

  it('explains a failed reply, keeps the question and saves no reply', async () => {
    const { s, chats, connected, mine } = make();
    await connected();
    const pending = s().ask('Where is my risk?', SYSTEM);
    chats[0]!.onDelta('From the data');
    chats[0]!.settle({ kind: 'http', status: 402 });
    await pending;
    expect(s().error).toEqual({ conversationId: 'new-001', text: '402 insufficient balance: top up in the DeepSeek console' });
    expect(mine().map((m) => m.role)).toEqual(['user']);
    expect(s()).toMatchObject({ busy: false, draft: null });
    // Asking again clears the old error
    void s().ask('Once more', SYSTEM);
    expect(s().error).toBeNull();
  });

  it('ignores blank questions and questions while a reply is pending', async () => {
    const { s, chats, connected, mine } = make();
    await connected();
    await s().ask('   ', SYSTEM);
    const pending = s().ask('First question', SYSTEM);
    await s().ask('Second question', SYSTEM);
    expect(chats).toHaveLength(1);
    chats[0]!.settle({ kind: 'ok', text: 'Answer' });
    await pending;
    expect(mine().map((m) => m.content)).toEqual(['First question', 'Answer']);
  });

  it('writes a reply back to its own conversation after switching to another', async () => {
    const { s, app, chats, connected } = make();
    await connected();
    const pending = s().ask('First question', SYSTEM);
    s().select('h1');
    chats[0]!.onDelta('Ans');
    chats[0]!.settle({ kind: 'ok', text: 'Answer' });
    await pending;
    expect(s().currentId).toBe('h1');
    const reply = app.getState().aiMessages.find((m) => m.content === 'Answer')!;
    expect(reply.conversationId).toBe('new-001');
    expect(app.getState().aiMessages.filter((m) => m.conversationId === 'h1')).toHaveLength(2);
  });

  it('cancels the question on Change key and keeps nothing of the reply', async () => {
    const { s, chats, connected, mine } = make();
    await connected();
    const pending = s().ask('First question', SYSTEM);
    chats[0]!.onDelta('Half');
    s().disconnect();
    expect(chats[0]!.signal?.aborted).toBe(true);
    chats[0]!.settle({ kind: 'aborted' });
    await pending;
    expect(mine().map((m) => m.role)).toEqual(['user']);
    expect(s()).toMatchObject({ busy: false, draft: null, error: null, connected: false });
  });

  it('cancels the question when the account closes', async () => {
    const { s, chats, connected, mine } = make();
    await connected();
    const pending = s().ask('First question', SYSTEM);
    s().detach();
    expect(chats[0]!.signal?.aborted).toBe(true);
    chats[0]!.settle({ kind: 'ok', text: 'A late answer' });
    await pending;
    expect(mine().map((m) => m.role)).toEqual(['user']);
    expect(s()).toMatchObject({ busy: false, draft: null, connected: false });
  });

  it('starts another conversation without saving it until the first question', async () => {
    const { s, app, connected } = make();
    await connected();
    const before = app.getState().aiConversations;
    s().newConversation();
    expect(s().currentId).toBe('new-002');
    expect(s().welcome?.conversationId).toBe('new-002');
    expect(app.getState().aiConversations).toBe(before);
  });

  it('switches web analysis and remembers it on this device', async () => {
    const { s, connected, vault } = make();
    await connected();
    s().toggleWeb();
    await Promise.resolve();
    expect(s().web).toBe(false);
    expect(vault.saved).toMatchObject({ web: false, key: KEY });
  });
});
