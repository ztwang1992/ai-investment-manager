import { AiChat } from './AiChat';
import { AiOnboarding } from './AiOnboarding';
import { useAiStore } from './aiStore';
import './ai.css';

/** "AI advisor": the connect page when not connected, the conversation page once connected (prototype v5 lines 235–296). */
export function AiPage() {
  const connected = useAiStore((s) => s.connected);
  return connected ? <AiChat /> : <AiOnboarding />;
}
