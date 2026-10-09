import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { formatTimeHM } from '../../app/format';
import { PanelLeftIcon, SendIcon } from '../../app/icons';
import { useAppStore } from '../../app/store';
import { systemPrompt } from './aiContext';
import { useAiStore } from './aiStore';
import { useT } from '../../i18n';
import { PROVIDER } from './aiText';
import { ConversationDrawer } from './ConversationDrawer';
import { useAiContext } from './useAiContext';
import { useWelcome } from './useWelcome';

function Bubble({ who, text, time }: { who: 'me' | 'ai'; text: string; time: string }) {
  const t = useT();
  return (
    <div className="ai-msg">
      <span className={`ai-avatar ${who === 'ai' ? 'is-ai' : 'is-me'}`}>{who === 'ai' ? 'AI' : t.ai.avatarMe}</span>
      <div className="ai-msg-body">
        <div className="ai-msg-head">
          <span className="ai-msg-name">{who === 'ai' ? t.ai.title : t.ai.me}</span>
          <span className="ai-msg-time">{time}</span>
        </div>
        <span className="ai-msg-text">{text}</span>
      </div>
    </div>
  );
}

/**
 * The chat: a channel-style title, what was read, the web switch, the messages, suggested questions and the input
 * (prototype v5 lines 257–283). Messages come from the app state (saved questions and answers); the greeting, the
 * reply being streamed and errors come from the AI store and are not saved.
 */
export function AiChat() {
  const t = useT();
  const { currentId, busy, web, draft, error, welcome: greeting, ask, toggleWeb, newConversation } = useAiStore();
  const conversations = useAppStore((s) => s.aiConversations);
  const allMessages = useAppStore((s) => s.aiMessages);
  const welcome = useWelcome();
  const summary = useAiContext();
  const [input, setInput] = useState('');
  const [drawer, setDrawer] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Opened with a key saved on this device but no conversation yet: start one
  useEffect(() => {
    if (!currentId) newConversation();
  }, [currentId, newConversation]);

  const current = conversations.find((c) => c.id === currentId);
  const messages = useMemo(() => allMessages.filter((m) => m.conversationId === currentId), [allMessages, currentId]);
  const streaming = draft && draft.conversationId === currentId ? draft.text : null;
  const failed = error && error.conversationId === currentId ? error.text : null;

  // Scroll to the bottom for a new message, a growing reply or another conversation
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length, streaming, failed, currentId]);

  const send = (question: string) => void ask(question, systemPrompt({ web, summary }, t));
  const submit = () => {
    if (!input.trim() || busy) return;
    send(input);
    setInput('');
  };
  // Enter while an input method is composing only confirms the candidate (Safari may report isComposing false, but keyCode 229)
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submit();
  };

  return (
    <section className="ai-chat">
      <header className="ai-chat-head">
        <div className="ai-chat-bar">
          <div className="ai-chat-title-wrap">
            <button type="button" className="btn btn-secondary btn-icon" aria-label={t.ai.history} onClick={() => setDrawer(true)}>
              <PanelLeftIcon />
            </button>
            <h1 className="ai-chat-title">
              <span className="ai-hash">#</span> {current?.title ?? t.ai.newTitle}
            </h1>
          </div>
          <button type="button" className="btn btn-ghost ai-small" onClick={() => newConversation()}>
            {t.ai.newConversation}
          </button>
        </div>
        <div className="ai-tags">
          <span className="tag tag-accent-2">{t.ai.dataRead}</span>
          <span className="tag tag-neutral">{PROVIDER}</span>
          <button type="button" className={`tag ai-web ${web ? 'tag-accent' : 'tag-outline'}`} aria-pressed={web} onClick={toggleWeb}>
            {t.ai.web(web)}
          </button>
        </div>
      </header>
      <div className="ai-msgs" ref={listRef}>
        {greeting?.conversationId === currentId && <Bubble who="ai" text={welcome} time={greeting.time} />}
        {messages.map((m) => (
          <Bubble key={m.id} who={m.role === 'user' ? 'me' : 'ai'} text={m.content} time={formatTimeHM(new Date(m.createdAt))} />
        ))}
        {streaming ? <Bubble who="ai" text={streaming} time={formatTimeHM(new Date())} /> : null}
        {streaming === '' && (
          <div className="ai-busy" role="status">
            <span className="ai-busy-dot" />
            {t.ai.busy}
          </div>
        )}
        {failed && (
          <div className="ai-error" role="alert">
            {failed}
          </div>
        )}
      </div>
      {messages.length === 0 && !busy && (
        <div className="ai-suggests">
          {t.ai.suggestions.map((q) => (
            <button key={q} type="button" className="btn btn-secondary ai-suggest" onClick={() => send(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
      <div className="ai-input-row">
        <input
          className="input ai-input"
          aria-label={t.ai.ask}
          placeholder={t.ai.askPlaceholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="btn btn-primary btn-icon ai-send" aria-label={t.ai.send} onClick={submit}>
          <SendIcon />
        </button>
      </div>
      {drawer && <ConversationDrawer onClose={() => setDrawer(false)} />}
    </section>
  );
}
