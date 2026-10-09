import { describe, expect, it } from 'vitest';
import { sampleAiConversations, sampleAiMessages } from '../mock/ai';
import { accounts } from '../mock/catalog';
import { transactions } from '../mock/ledger';
import { localizeSample } from './sample';

const zh = { accounts, transactions, aiConversations: [...sampleAiConversations], aiMessages: [...sampleAiMessages] };

describe('sample data in English', () => {
  // What a user would have typed (account names, remarks, the conversation) comes in the interface language;
  // preset names stay stored in Chinese and are translated on display like real data
  it('names the sample accounts, remarks and conversation in English', () => {
    const en = localizeSample(zh, 'en');
    expect(en.accounts.find((a) => a.id === 'futu')?.name).toBe('Futu');
    expect(en.accounts.find((a) => a.id === 'cms')?.name).toBe('China Merchants Securities');
    expect(en.transactions.filter((t) => t.reason === 'Salary')).toHaveLength(zh.transactions.filter((t) => t.reason === '工资').length);
    expect(en.aiConversations.find((c) => c.id === 'h1')?.title).toBe('My Treasuries are overweight. Should I rebalance now?');
    expect(en.aiMessages.find((m) => m.id === 'h1-a')?.content).toMatch(/^Your 10-year Treasuries are about 11% above target\./);
    expect(en.aiMessages.every((m) => !/[\u4e00-\u9fff]/.test(m.content.replace(/\d{6}/g, '')))).toBe(true);
  });

  it('leaves the Chinese sample as it is, and switches back', () => {
    expect(localizeSample(zh, 'zh')).toEqual(zh);
    expect(localizeSample(localizeSample(zh, 'en'), 'zh')).toEqual(zh);
  });

  // Switching language in the demo must not overwrite what the user changed
  it('keeps names and remarks the user changed', () => {
    const edited = {
      ...zh,
      accounts: zh.accounts.map((a) => (a.id === 'futu' ? { ...a, name: '我的富途' } : a)),
      transactions: zh.transactions.map((t, i) => (i === 0 ? { ...t, reason: '给孩子的学费' } : t)),
    };
    const en = localizeSample(edited, 'en');
    expect(en.accounts.find((a) => a.id === 'futu')?.name).toBe('我的富途');
    expect(en.transactions[0]!.reason).toBe('给孩子的学费');
  });
});
