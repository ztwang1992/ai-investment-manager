import type { Account, AiMessage, Period, UndefinedMode } from '../../domain/types';
import type { Messages } from '../../i18n';
import type { ChatMessage } from './chatStream';

// What is sent to the model with each question (the prototype's ask() and this._ctx): how to answer, a summary
// of the portfolio (plan, holdings, returns; always in CNY, whatever the display currency or the hidden amounts;
// no account numbers), and the last few messages. The summary and the prompt are in the interface language.

export interface SummaryInput {
  totalCny: number;
  netInvestedCny: number;
  slots: readonly { name: string; curPct: number; tgtPct: number; untargeted: boolean }[];
  undefinedMode: UndefinedMode;
  threshold: number;
  period: Period;
  checkedThisPeriod: boolean;
  /** kind: a CNY broker, a USD broker or a bank, in words */
  accounts: readonly { name: string; kind: string; sharePct: number }[];
  /** since is null for a full year */
  performance: { since: string | null; items: readonly { name: string; pct: number | null }[] };
  retirement: {
    annualSpend: number;
    targetAmount: number;
    expectedReturnPct: number;
    inflationPct: number;
    yearsToTarget: number | null;
    yearTarget: number | null;
  };
}

const signedPct = (pct: number) => `${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(1)}%`;
const plain = (n: number) => String(Number(n.toFixed(2)));

export function accountKind(a: Pick<Account, 'type' | 'currency'>, t: Messages): string {
  const kinds = t.ai.summary.kinds;
  if (a.type === 'bank') return kinds.bank;
  return a.currency === 'USD' ? kinds.usdBroker : kinds.cnyBroker;
}

export function portfolioSummary(i: SummaryInput, t: Messages): string {
  const m = t.ai.summary;
  const gain = i.totalCny - i.netInvestedCny;
  const lines = [m.totals(m.money(i.totalCny), m.money(i.netInvestedCny), m.money(gain), i.netInvestedCny > 0 ? signedPct((gain * 100) / i.netInvestedCny) : null)];
  if (i.slots.length > 0) {
    const slot = (s: SummaryInput['slots'][number]) =>
      s.untargeted ? m.slotNoTarget(s.name, s.curPct.toFixed(1)) : m.slot(s.name, s.curPct.toFixed(1), plain(s.tgtPct));
    lines.push(m.targets(i.slots.map(slot).join(m.sep)));
  }
  const untargeted = i.slots.some((s) => s.untargeted) ? m.untargeted(i.undefinedMode) : '';
  lines.push(m.rules(plain(i.threshold), i.period, i.checkedThisPeriod, untargeted));
  if (i.accounts.length > 0) lines.push(m.accounts(i.accounts.map((a) => m.account(a.name, a.kind, a.sharePct.toFixed(1))).join(m.sep)));
  const performance = i.performance.items.filter((x): x is { name: string; pct: number } => x.pct !== null);
  if (performance.length > 0) lines.push(m.performance(i.performance.since, performance.map((x) => `${x.name} ${signedPct(x.pct)}`).join(m.sep)));
  const r = i.retirement;
  const when = r.yearsToTarget === 0 ? m.reached : r.yearTarget === null ? m.unreachable : m.expected(r.yearTarget);
  lines.push(m.retirement(m.money(r.annualSpend), m.money(r.targetAmount), plain(r.expectedReturnPct), plain(r.inflationPct), when));
  return lines.join('\n');
}

/** The system prompt: how to answer (as in the prototype), the web line, and the portfolio summary */
export function systemPrompt(i: { web: boolean; summary: string }, t: Messages): string {
  return t.ai.prompt(i.web, i.summary);
}

/** The messages for the model: the system prompt first, then this conversation's last 7, then the new question (8 in all, as in the prototype) */
export function chatMessages(i: { system: string; history: readonly AiMessage[]; question: string }): ChatMessage[] {
  const recent = [...i.history]
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
    .slice(-7);
  return [{ role: 'system', content: i.system }, ...recent.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: i.question }];
}
