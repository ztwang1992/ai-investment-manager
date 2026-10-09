import { create } from 'zustand';
import type { StoreApi } from 'zustand';
import type { AiSaved, AiVault } from '../../app/aiVault';
import { useBootStore } from '../../app/boot';
import type { BootState } from '../../app/boot';
import { formatTimeHM } from '../../app/format';
import { newId } from '../../app/ids';
import type { Session } from '../../app/session';
import { useAppStore } from '../../app/store';
import type { AppState } from '../../app/store';
import type { AiConversation } from '../../domain/types';
import { chatMessages } from './aiContext';
import { MESSAGES } from '../../i18n';
import { DEFAULT_BASE, DEFAULT_MODEL, chatErrorText, precheck, testResultText, testingText, titleFromQuestion } from './aiText';
import type { TestResult } from './aiText';
import { streamChat } from './chatStream';
import type { ChatMessage, ChatOutcome } from './chatStream';
import { requestModels } from './connectionTest';
import type { TestOutcome } from './types';

// The AI advisor's connection and conversation state, kept apart from the app's main state:
// - the key lives only in memory and in this device's vault (encrypted); never in the main state, backups or logs, and it's sent only to the https address the user entered;
// - conversations and messages live in the main state (stored locally with it, synced to the cloud); the reply being streamed, error notes and the welcome live only here, unsaved.

export interface AiDeps {
  now: () => Date;
  newId: () => string;
  requestModels: (i: { base: string; key: string }) => Promise<TestOutcome>;
  streamChat: (i: {
    base: string;
    key: string;
    model: string;
    messages: readonly ChatMessage[];
    signal?: AbortSignal;
    onDelta: (text: string) => void;
  }) => Promise<ChatOutcome>;
  /** Conversations and messages live in the app's main state */
  app: Pick<StoreApi<AppState>, 'getState'>;
}

export interface AiState {
  base: string;
  model: string;
  /** Only in memory (and in the vault, encrypted); never in the main state, backups or logs */
  key: string;
  consent: boolean;
  test: TestResult | null;
  connected: boolean;
  web: boolean;
  /** The conversation being viewed; a new one with no question yet has an id too, and is saved at its first question */
  currentId: string | null;
  busy: boolean;
  /** The reply being streamed */
  draft: { conversationId: string; text: string } | null;
  /** The note for a failed reply (not saved) */
  error: { conversationId: string; text: string } | null;
  /** Conversations opened since this launch: the welcome is shown at the top (not saved, generated from the current data) */
  welcome: { conversationId: string; time: string } | null;
  setBase: (value: string) => void;
  setModel: (value: string) => void;
  setKey: (value: string) => void;
  toggleConsent: () => void;
  runTest: () => Promise<void>;
  /** Connects only after a successful test with consent given: saves the settings and key in this device's vault, then opens a new conversation */
  connect: () => Promise<void>;
  /** Change key: stops the reply in progress, deletes the saved key and returns to the connect page; conversations stay */
  disconnect: () => void;
  /** Opens a new conversation (saved at its first question) */
  newConversation: () => void;
  select: (id: string) => void;
  toggleWeb: () => void;
  /** Asks: stores the question, streams the reply, and stores the reply when done. system holds the answering instructions and the portfolio summary */
  ask: (question: string, system: string) => Promise<void>;
  /** On opening an account: reads the settings saved on this device, and goes straight to the conversation if there's a key */
  attach: (vault: AiVault) => Promise<void>;
  /** On sign-out: stops requests and forgets everything in memory */
  detach: () => void;
}

type Data = Omit<
  AiState,
  'setBase' | 'setModel' | 'setKey' | 'toggleConsent' | 'runTest' | 'connect' | 'disconnect' | 'newConversation' | 'select' | 'toggleWeb' | 'ask' | 'attach' | 'detach'
>;

const initial = (): Data => ({
  base: DEFAULT_BASE,
  model: DEFAULT_MODEL,
  key: '',
  consent: false,
  test: null,
  connected: false,
  web: true,
  currentId: null,
  busy: false,
  draft: null,
  error: null,
  welcome: null,
});

const defaultDeps: AiDeps = {
  now: () => new Date(),
  newId,
  requestModels: (i) => requestModels(i),
  streamChat: (i) => streamChat(i),
  app: useAppStore,
};

export function createAiStore(deps: AiDeps = defaultDeps) {
  /** Text in the interface language at the moment it is produced */
  const t = () => MESSAGES[deps.app.getState().locale];
  return create<AiState>()((set, get) => {
    // Each form change or retest gets a new number; an old request coming back with a different number is dropped
    let testSeq = 0;
    let vault: AiVault | null = null;
    /** The reply in progress; cancelled on Change key and sign-out */
    let inflight: AbortController | null = null;
    const edit = (patch: Partial<Pick<AiState, 'base' | 'model' | 'key'>>) => {
      testSeq += 1;
      set({ ...patch, test: null });
    };
    const saved = (key: string): AiSaved => {
      const s = get();
      return { base: s.base.trim(), model: s.model.trim(), key, consent: s.consent, web: s.web };
    };
    const cancel = () => {
      inflight?.abort();
      inflight = null;
    };
    const newConversation = () => {
      const id = deps.newId();
      set({ currentId: id, welcome: { conversationId: id, time: formatTimeHM(deps.now()) } });
    };

    return {
      ...initial(),
      setBase: (base) => edit({ base }),
      setModel: (model) => edit({ model }),
      setKey: (key) => edit({ key }),
      toggleConsent: () => set((s) => ({ consent: !s.consent })),
      runTest: async () => {
        const form = get();
        const seq = ++testSeq;
        const problem = precheck(form, t());
        if (problem) {
          set({ test: problem });
          return;
        }
        set({ test: testingText(form.base, t()) });
        const outcome = await deps.requestModels({ base: form.base, key: form.key.trim() });
        if (seq !== testSeq) return;
        set({ test: testResultText(outcome, form.model, t()) });
      },
      connect: async () => {
        const s = get();
        if (s.test?.status !== 'ok' || !s.consent) return;
        const key = s.key.trim();
        set({ connected: true, key });
        newConversation();
        try {
          await vault?.save(saved(key));
        } catch {
          deps.app.getState().flash(t().ai.keyNotSaved);
        }
      },
      disconnect: () => {
        testSeq += 1;
        cancel();
        set({ connected: false, key: '', test: null, busy: false, draft: null, error: null });
        void vault?.save(saved('')).catch(() => {});
      },
      newConversation,
      select: (id) => set({ currentId: id }),
      toggleWeb: () => {
        set((s) => ({ web: !s.web }));
        const s = get();
        if (s.connected) void vault?.save(saved(s.key)).catch(() => {});
      },
      ask: async (question, system) => {
        const q = question.trim();
        const s = get();
        if (!q || s.busy || !s.connected || !s.currentId) return;
        const conversationId = s.currentId;
        const app = deps.app.getState();
        const existing = app.aiConversations.find((c) => c.id === conversationId);
        const history = app.aiMessages.filter((m) => m.conversationId === conversationId);
        const askedAt = deps.now().toISOString();
        const conversation: AiConversation = existing
          ? { ...existing, updatedAt: askedAt }
          : { id: conversationId, title: titleFromQuestion(q), createdAt: askedAt, updatedAt: askedAt };
        app.recordAiMessage({ conversation, message: { id: deps.newId(), conversationId, role: 'user', content: q, createdAt: askedAt } });

        const controller = new AbortController();
        inflight = controller;
        set({ busy: true, error: null, draft: { conversationId, text: '' } });
        const outcome = await deps.streamChat({
          base: s.base.trim(),
          key: s.key,
          model: s.model.trim(),
          messages: chatMessages({ system, history, question: q }),
          signal: controller.signal,
          onDelta: (piece) => {
            if (inflight !== controller) return;
            set((st) => (st.draft ? { draft: { ...st.draft, text: st.draft.text + piece } } : {}));
          },
        });
        // Already cancelled by Change key or sign-out, with the state cleared: a late result isn't wanted
        if (inflight !== controller) return;
        inflight = null;
        if (outcome.kind === 'ok') {
          const answeredAt = deps.now().toISOString();
          const latest = deps.app.getState().aiConversations.find((c) => c.id === conversationId) ?? conversation;
          deps.app.getState().recordAiMessage({
            conversation: { ...latest, updatedAt: answeredAt },
            message: { id: deps.newId(), conversationId, role: 'assistant', content: outcome.text, createdAt: answeredAt },
          });
          set({ busy: false, draft: null });
          return;
        }
        const text = chatErrorText(outcome, t());
        set({ busy: false, draft: null, error: text ? { conversationId, text } : null });
      },
      attach: async (v) => {
        vault = v;
        let stored: AiSaved | null = null;
        try {
          stored = await v.load();
        } catch {
          stored = null;
        }
        if (vault !== v || !stored) return;
        testSeq += 1;
        set({
          base: stored.base,
          model: stored.model,
          key: stored.key,
          consent: stored.consent,
          web: stored.web,
          test: null,
          connected: stored.key !== '' && stored.consent,
        });
      },
      detach: () => {
        testSeq += 1;
        cancel();
        vault = null;
        set(initial());
      },
    };
  });
}

export const useAiStore = createAiStore();

/**
 * Follows the sign-in state: connects this account's vault when an account opens, and clears everything in memory on sign-out.
 * Started once in main.tsx; returns a function that unsubscribes.
 */
export function followSession(
  ai: Pick<StoreApi<AiState>, 'getState'> = useAiStore,
  boot: Pick<StoreApi<BootState>, 'getState' | 'subscribe'> = useBootStore,
): () => void {
  let current: Session | null = null;
  const follow = (s: BootState) => {
    const next = s.kind === 'ready' ? s.session : null;
    if (next === current) return;
    current = next;
    if (next) void ai.getState().attach(next.aiVault);
    else ai.getState().detach();
  };
  follow(boot.getState());
  return boot.subscribe(follow);
}
