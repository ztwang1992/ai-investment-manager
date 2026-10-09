import type { AiConversation, AiMessage } from '../domain/types';

// The two past conversations of prototype v5 (SEED_CONVS), shown with the sample data. Times are 09-12 21:40 and 08-20 09:15, Beijing time.
export const sampleAiConversations: readonly AiConversation[] = [
  { id: 'h1', title: '美债超配要不要现在调？', createdAt: '2026-09-12T13:40:00.000Z', updatedAt: '2026-09-12T13:41:00.000Z' },
  { id: 'h2', title: '年底前的加仓计划', createdAt: '2026-08-20T01:15:00.000Z', updatedAt: '2026-08-20T01:16:00.000Z' },
];

/** In time order */
export const sampleAiMessages: readonly AiMessage[] = [
  { id: 'h2-q', conversationId: 'h2', role: 'user', content: '年底前我大概还有 20 万人民币，怎么安排？', createdAt: '2026-08-20T01:15:00.000Z' },
  {
    id: 'h2-a',
    conversationId: 'h2',
    role: 'assistant',
    content: '按你的目标组合，人民币资金优先补：\n1. 纳斯达克 100（可用 513100）\n2. 黄金（518880）\n3. 沪深 300（510300）\n建议分 3–4 次，每月一次。\n仅供参考，不构成投资建议。',
    createdAt: '2026-08-20T01:16:00.000Z',
  },
  { id: 'h1-q', conversationId: 'h1', role: 'user', content: '美债超配要不要现在调？', createdAt: '2026-09-12T13:40:00.000Z' },
  {
    id: 'h1-a',
    conversationId: 'h1',
    role: 'assistant',
    content:
      '你的 10 年期美债比目标高出约 11%。\n1. 超配已超过 ±3% 阈值，按规则应调整。\n2. 近期如果有新资金，优先用增量补纳指和黄金，比直接卖美债更省成本。\n3. 没有新资金的话，可以分两三次卖出，避免一次性择时。\n仅供参考，不构成投资建议。',
    createdAt: '2026-09-12T13:41:00.000Z',
  },
];
