import { describe, expect, it } from 'vitest';
import type { AiMessage } from '../../domain/types';
import { MESSAGES } from '../../i18n';
import { accountKind, chatMessages, portfolioSummary, systemPrompt } from './aiContext';
import type { SummaryInput } from './aiContext';

// What goes to the model: how to answer, the portfolio summary (the prototype's this._ctx, always in CNY), and the last few messages.

const en = MESSAGES.en;
const zh = MESSAGES.zh;
const input: SummaryInput = {
  totalCny: 1_234_000,
  netInvestedCny: 1_000_000,
  slots: [
    { name: 'S&P 500', curPct: 38.24, tgtPct: 40, untargeted: false },
    { name: '10-year Treasuries', curPct: 26.06, tgtPct: 15, untargeted: false },
    { name: 'Gold', curPct: 4.95, tgtPct: 33.3, untargeted: false },
    { name: 'International ex-US', curPct: 4.1, tgtPct: 0, untargeted: true },
  ],
  undefinedMode: 'sell',
  threshold: 3,
  period: 'quarter',
  checkedThisPeriod: false,
  accounts: [
    { name: 'China Merchants Securities', kind: 'CNY broker', sharePct: 30 },
    { name: 'Futu', kind: 'USD broker', sharePct: 70 },
  ],
  performance: {
    since: null,
    items: [
      { name: 'S&P 500', pct: 12.34 },
      { name: '10-year Treasuries', pct: -3.2 },
      { name: 'Gold', pct: null },
    ],
  },
  retirement: { annualSpend: 300_000, targetAmount: 8_000_000, expectedReturnPct: 6, inflationPct: 2.5, yearsToTarget: 23, yearTarget: 2049 },
};

describe('the portfolio summary sent to the model', () => {
  it('writes the plan, holdings and returns line by line, in yuan', () => {
    expect(portfolioSummary(input, en).split('\n')).toEqual([
      'Total assets about ¥1.23M, net invested ¥1M, cumulative gain ¥234K (+23.4%).',
      'Target vs current: S&P 500 38.2%/40%; 10-year Treasuries 26.1%/15%; Gold 5.0%/33.3%; International ex-US 4.1% (no target)',
      'Drift threshold ±3%, checked every quarter, not checked yet this quarter; assets without a target are suggested for sale when rebalancing.',
      'Accounts: China Merchants Securities (CNY broker) 30.0%; Futu (USD broker) 70.0%',
      'Over the last year, by asset: S&P 500 +12.3%; 10-year Treasuries -3.2%',
      'Retirement goal: spending ¥300K a year, target ¥8M, expected return 6% a year, inflation 2.5%, expected in 2049.',
    ]);
  });

  it('says when untargeted assets stay out of rebalancing, and when this period was checked', () => {
    const lines = portfolioSummary({ ...input, undefinedMode: 'ignore', checkedThisPeriod: true, period: 'month' }, en).split('\n');
    expect(lines[2]).toBe('Drift threshold ±3%, checked every month, already checked this month; assets without a target are left out of rebalancing.');
    const allTargeted = portfolioSummary({ ...input, slots: input.slots.filter((s) => !s.untargeted) }, en).split('\n');
    expect(allTargeted[2]).toBe('Drift threshold ±3%, checked every quarter, not checked yet this quarter.');
  });

  it('counts from the first day when there is less than a year of history', () => {
    const lines = portfolioSummary({ ...input, performance: { ...input.performance, since: '2026-10-01' } }, en).split('\n');
    expect(lines[4]).toBe('Since 2026-10-01, by asset: S&P 500 +12.3%; 10-year Treasuries -3.2%');
  });

  it('says when the retirement target is out of reach or already met', () => {
    const never = portfolioSummary({ ...input, retirement: { ...input.retirement, yearsToTarget: null, yearTarget: null } }, en).split('\n');
    expect(never.at(-1)).toBe('Retirement goal: spending ¥300K a year, target ¥8M, expected return 6% a year, inflation 2.5%, out of reach on current assumptions.');
    const met = portfolioSummary({ ...input, retirement: { ...input.retirement, yearsToTarget: 0, yearTarget: 2026 } }, en).split('\n');
    expect(met.at(-1)).toBe('Retirement goal: spending ¥300K a year, target ¥8M, expected return 6% a year, inflation 2.5%, already reached.');
  });

  it('writes small amounts and losses plainly, and leaves out lines with nothing in them', () => {
    const lines = portfolioSummary(
      { ...input, totalCny: 8_500, netInvestedCny: 9_000, accounts: [], performance: { since: null, items: [{ name: 'Gold', pct: null }] } },
      en,
    ).split('\n');
    expect(lines[0]).toBe('Total assets about ¥8500, net invested ¥9000, cumulative gain -¥500 (-5.6%).');
    expect(lines.some((l) => l.startsWith('Accounts:'))).toBe(false);
    expect(lines.some((l) => l.includes('by asset'))).toBe(false);
  });

  it('names the kind of each account', () => {
    expect(accountKind({ type: 'broker', currency: 'CNY' }, en)).toBe('CNY broker');
    expect(accountKind({ type: 'broker', currency: 'USD' }, en)).toBe('USD broker');
    expect(accountKind({ type: 'bank', currency: 'CNY' }, en)).toBe('bank');
  });

  // The prototype's Chinese summary, unchanged
  it('reads as before in Chinese', () => {
    const zhInput: SummaryInput = { ...input, slots: [{ name: '标普 500', curPct: 38.24, tgtPct: 40, untargeted: false }], accounts: [{ name: '富途', kind: accountKind({ type: 'broker', currency: 'USD' }, zh), sharePct: 70 }] };
    expect(portfolioSummary(zhInput, zh).split('\n')).toEqual([
      '总资产约 ¥123.4 万，净投入 ¥100 万，累计收益 ¥23.4 万（+23.4%）。',
      '目标组合 vs 当前：标普 500 38.2%/40%',
      '偏离阈值 ±3%，季度检查，本季度还没检查。',
      '账户：富途（美元券商）占 70.0%',
      '近 1 年各资产表现：S&P 500 +12.3%；10-year Treasuries -3.2%',
      '退休目标：年支出 ¥30 万，目标 ¥800 万，预期年化 6%，通胀 2.5%，预计 2049 年达成。',
    ]);
  });
});

describe('what goes to the model with each question', () => {
  it('asks for a calm, short answer in the interface language and says whether recent markets may be used', () => {
    expect(systemPrompt({ web: true, summary: 'SUMMARY' }, en)).toBe(
      "You are the user's private investment advisor: calm, professional and direct. Answer in English in 2–4 points, under 150 words, without markdown headings or bold. You may draw on what you know of recent markets and the economy. End with a very short reminder that this is not investment advice.\n\nThe user's portfolio:\nSUMMARY",
    );
    expect(systemPrompt({ web: false, summary: 'SUMMARY' }, en)).toContain("Answer from the user's data only.");
    expect(systemPrompt({ web: false, summary: 'SUMMARY' }, en)).not.toContain('recent markets');
    expect(systemPrompt({ web: true, summary: '摘要' }, zh)).toBe(
      '你是用户的私人投资顾问，风格冷静、专业、直接。用中文回答，分 2-4 个要点，总长不超过 200 字，不用 markdown 标题和加粗。可以结合你了解的近期市场与宏观情况。最后一句提醒这不构成投资建议（很短）。\n\n用户组合数据：\n摘要',
    );
  });

  it('sends the instructions, the last seven messages and the new question', () => {
    const history: AiMessage[] = Array.from({ length: 10 }, (_, k) => ({
      id: `m${k}`,
      conversationId: 'c1',
      role: k % 2 === 0 ? 'user' : 'assistant',
      content: `message ${k}`,
      createdAt: `2026-10-03T08:00:${String(k).padStart(2, '0')}.000Z`,
    }));
    const sent = chatMessages({ system: 'instructions and summary', history: [...history].reverse(), question: 'new question' });
    expect(sent).toHaveLength(9);
    expect(sent[0]).toEqual({ role: 'system', content: 'instructions and summary' });
    expect(sent.slice(1, 8).map((m) => m.content)).toEqual(['message 3', 'message 4', 'message 5', 'message 6', 'message 7', 'message 8', 'message 9']);
    expect(sent.slice(1, 8).map((m) => m.role)).toEqual(['assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'new question' });
  });
});
