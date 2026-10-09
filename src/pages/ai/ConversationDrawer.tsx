import { useEffect, useMemo } from 'react';
import { useAppStore } from '../../app/store';
import { useAiStore } from './aiStore';
import { useT } from '../../i18n';
import { connectionLabel, conversationMeta } from './aiText';

/**
 * Conversation history: saved conversations (most recent first), a new one, change the key (prototype v5 lines
 * 285–294). Tapping outside or Esc closes it. As in the prototype it sits inside the chat page and covers only the
 * area above the tab bar (bottom sheets cover the whole screen).
 */
export function ConversationDrawer({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { currentId, model, select, newConversation, disconnect } = useAiStore();
  const conversations = useAppStore((s) => s.aiConversations);
  const messages = useAppStore((s) => s.aiMessages);
  const list = useMemo(() => {
    const count = new Map<string, number>();
    for (const m of messages) count.set(m.conversationId, (count.get(m.conversationId) ?? 0) + 1);
    return [...conversations]
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
      .map((c) => ({ c, count: count.get(c.id) ?? 0 }));
  }, [conversations, messages]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ai-drawer-backdrop" onClick={onClose}>
      <div className="ai-drawer" role="dialog" aria-modal="true" aria-label={t.ai.history} onClick={(e) => e.stopPropagation()}>
        <div className="ai-drawer-head">
          <h2 className="ai-drawer-title">{t.ai.history}</h2>
          <button
            type="button"
            className="btn btn-primary ai-drawer-new"
            onClick={() => {
              newConversation();
              onClose();
            }}
          >
            {t.ai.newConversation}
          </button>
        </div>
        <div className="ai-drawer-list">
          {list.map(({ c, count }) => (
            <button
              key={c.id}
              type="button"
              className="ai-conv"
              aria-current={c.id === currentId ? 'true' : undefined}
              onClick={() => {
                select(c.id);
                onClose();
              }}
            >
              <span className="ai-conv-title">{c.title}</span>
              <span className="ai-conv-meta">{conversationMeta({ createdAt: c.createdAt, count }, t)}</span>
            </button>
          ))}
        </div>
        <div className="ai-drawer-foot">
          <span className="ai-conn">{connectionLabel(model, t)}</span>
          <button
            type="button"
            className="btn btn-ghost ai-small"
            onClick={() => {
              disconnect();
              onClose();
            }}
          >
            {t.ai.changeKey}
          </button>
        </div>
      </div>
    </div>
  );
}
