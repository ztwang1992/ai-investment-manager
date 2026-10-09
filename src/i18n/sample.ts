// The sample data in the interface language. src/mock holds it in Chinese, as in the prototype. Preset names
// (groups, assets, instruments) stay stored in Chinese and are translated on display like real data; what a user
// would have typed (account names, remarks, the AI conversation) is swapped here. A value is swapped only while
// it is still the sample's own text, so switching language in the demo never overwrites the user's changes.
import type { Account, AiConversation, AiMessage, Transaction } from '../domain/types';
import { sampleAiConversations, sampleAiMessages } from '../mock/ai';
import { accounts } from '../mock/catalog';
import type { Locale } from './locale';

const ACCOUNT_EN: Readonly<Record<string, string>> = {
  futu: 'Futu',
  ibkr: 'IBKR',
  schwab: 'Schwab',
  ft: 'Firstrade',
  cms: 'China Merchants Securities',
  cmb: 'China Merchants Bank',
};

const REMARKS: readonly { zh: string; en: string }[] = [
  { zh: '工资', en: 'Salary' },
  { zh: '年终奖', en: 'Year-end bonus' },
];

const TREASURIES_QUESTION = 'My Treasuries are overweight. Should I rebalance now?';
const CONVERSATION_EN: Readonly<Record<string, string>> = {
  h1: TREASURIES_QUESTION,
  h2: 'Adding before year end',
};

const MESSAGE_EN: Readonly<Record<string, string>> = {
  'h2-q': 'I will have about ¥200,000 more before year end. How should I put it in?',
  'h2-a':
    'Based on your target allocation, put the CNY money here first:\n1. Nasdaq 100 (for example 513100)\n2. Gold (518880)\n3. CSI 300 (510300)\nSpread it over 3–4 monthly buys.\nFor reference only, not investment advice.',
  'h1-q': TREASURIES_QUESTION,
  'h1-a':
    'Your 10-year Treasuries are about 11% above target.\n1. That is past the ±3% threshold, so the rules say rebalance.\n2. If new money comes in soon, put it into the Nasdaq 100 and gold first. That costs less than selling Treasuries.\n3. Without new money, sell in two or three steps rather than timing it all at once.\nFor reference only, not investment advice.',
};

const ACCOUNT_ZH = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
const CONVERSATION_ZH = Object.fromEntries(sampleAiConversations.map((c) => [c.id, c.title]));
const MESSAGE_ZH = Object.fromEntries(sampleAiMessages.map((m) => [m.id, m.content]));

/** The text for `locale`, if `value` is still the sample's text in the other language */
function swap(value: string, zh: string | undefined, en: string | undefined, locale: Locale): string {
  if (zh === undefined || en === undefined) return value;
  const [from, to] = locale === 'en' ? [zh, en] : [en, zh];
  return value === from ? to : value;
}

interface SampleParts {
  accounts: Account[];
  transactions: Transaction[];
  aiConversations: AiConversation[];
  aiMessages: AiMessage[];
}

export function localizeSample(data: SampleParts, locale: Locale): SampleParts {
  const remark = (reason: string | null | undefined) => {
    if (!reason) return reason;
    const r = REMARKS.find((x) => x.zh === reason || x.en === reason);
    return r ? swap(reason, r.zh, r.en, locale) : reason;
  };
  return {
    accounts: data.accounts.map((a) => ({ ...a, name: swap(a.name, ACCOUNT_ZH[a.id], ACCOUNT_EN[a.id], locale) })),
    transactions: data.transactions.map((t) => (t.reason === remark(t.reason) ? t : { ...t, reason: remark(t.reason)! })),
    aiConversations: data.aiConversations.map((c) => ({ ...c, title: swap(c.title, CONVERSATION_ZH[c.id], CONVERSATION_EN[c.id], locale) })),
    aiMessages: data.aiMessages.map((m) => ({ ...m, content: swap(m.content, MESSAGE_ZH[m.id], MESSAGE_EN[m.id], locale) })),
  };
}
