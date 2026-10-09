import { formatTimeHM } from '../../app/format';
import type { Messages } from '../../i18n';
import type { ChatOutcome } from './chatStream';
import type { TestOutcome } from './types';

// The AI advisor's wording (prototype v5 lines 810–850, 1063–1065, 1168–1187); the words are in the messages.

export const PROVIDER = 'DeepSeek';
export const DEFAULT_BASE = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-chat';

export type TestStatus = 'testing' | 'ok' | 'fail';

export interface TestResult {
  status: TestStatus;
  title: string;
  message: string;
}

const fail = (message: string, title: string): TestResult => ({ status: 'fail', title, message });

/** Checks before any request; null means go ahead. The key is only ever sent to an https address. */
export function precheck(i: { base: string; model: string; key: string }, t: Messages): TestResult | null {
  const m = t.ai.test;
  if (!i.key.trim()) return fail(m.needKey, m.failTitle);
  if (!i.base.trim()) return fail(m.needBase, m.failTitle);
  if (!i.base.trim().startsWith('https://')) return fail(m.needHttps, m.failTitle);
  if (!i.model.trim()) return fail(m.needModel, m.failTitle);
  return null;
}

export function testingText(base: string, t: Messages): TestResult {
  return { status: 'testing', title: t.ai.test.testingTitle, message: t.ai.test.testingMessage(`${base.trim().replace(/\/+$/, '')}/models`) };
}

export function testResultText(outcome: TestOutcome, model: string, t: Messages): TestResult {
  const m = t.ai.test;
  const wanted = model.trim();
  switch (outcome.kind) {
    case 'ok':
      if (outcome.models.length > 0 && !outcome.models.includes(wanted)) return fail(m.modelMissing(wanted, outcome.models), m.modelMissingTitle);
      return { status: 'ok', title: m.okTitle, message: m.ok(outcome.latencyMs, outcome.models.length > 0 ? outcome.models : [wanted]) };
    case 'http':
      if (outcome.status === 401) return fail(m.unauthorized, m.failTitle);
      if (outcome.status === 402) return fail(m.noBalance(PROVIDER), m.failTitle);
      return fail(m.failed(outcome.status), m.failTitle);
    case 'timeout':
      return fail(m.timeout, m.failTitle);
    case 'network':
      return fail(m.network, m.failTitle);
  }
}

/** What to say when a reply fails (worded like the connection test); nothing for a cancelled one. */
export function chatErrorText(outcome: ChatOutcome, t: Messages): string | null {
  const m = t.ai.chatError;
  switch (outcome.kind) {
    case 'ok':
    case 'aborted':
      return null;
    case 'http':
      if (outcome.status === 401) return m.unauthorized;
      if (outcome.status === 402) return m.noBalance(PROVIDER);
      if (outcome.status === 429) return m.tooMany;
      if (outcome.status >= 500) return m.unavailable(PROVIDER, outcome.status);
      return m.failed(outcome.status);
    case 'timeout':
      return m.timeout;
    case 'network':
      return m.network(PROVIDER);
    case 'broken':
      return m.broken;
  }
}

/** The first line of a new conversation (the prototype's welcome()); with nothing off target it names no biggest. */
export function welcomeText(i: { model: string; total: string; offCount: number; biggest: string | null }, t: Messages): string {
  return t.ai.welcome(PROVIDER, i.model, i.total, i.offCount, i.biggest);
}

/** Chinese and full-width characters take two units of width, everything else one */
const width = (c: string) => (/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(c) ? 2 : 1);
/** 18 Chinese characters (README) */
const TITLE_WIDTH = 36;

/**
 * A new conversation is titled with the start of its first question: 18 Chinese characters (README), or about
 * as wide in other languages, cut at a word with an ellipsis.
 */
export function titleFromQuestion(question: string): string {
  const chars = Array.from(question);
  let used = 0;
  let end = 0;
  while (end < chars.length && used + width(chars[end]!) <= TITLE_WIDTH) used += width(chars[end++]!);
  if (end >= chars.length) return question;
  const kept = chars.slice(0, end);
  if (kept.some((c) => width(c) === 2)) return kept.join('');
  const cut = kept.join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A conversation in the history list: when it started (on this device's clock) and how many messages it has */
export function conversationMeta(i: { createdAt: string; count: number }, t: Messages): string {
  const d = new Date(i.createdAt);
  return t.ai.meta(d.getMonth() + 1, d.getDate(), formatTimeHM(d), i.count);
}

export function connectionLabel(model: string, t: Messages): string {
  return t.ai.connection(PROVIDER, model);
}
