import { describe, expect, it } from 'vitest';
import { accounts, exposures, instruments } from '../mock/catalog';
import { transactions } from '../mock/ledger';
import { plan } from '../mock/settings';
import {
  accountToRow,
  aiConversationToRow,
  aiMessageToRow,
  exposureToRow,
  instrumentToRow,
  isoTime,
  planToRow,
  rowStamp,
  rowToAccount,
  rowToAiConversation,
  rowToAiMessage,
  rowToExposure,
  rowToInstrument,
  rowToPlan,
  rowToSnapshot,
  rowToSnapshotItem,
  rowToTx,
  snapshotItemToRow,
  snapshotToRow,
  targetsToRow,
  txToRow,
} from './rows';
import type { AiConversation, AiMessage } from './types';

const U = '11111111-1111-1111-1111-111111111111';
const STAMP = { updatedAt: '2026-09-30T08:00:00.000Z', order: 3 };

describe('rows for the cloud', () => {
  it('turns every sample transaction into a row and back unchanged', () => {
    for (const t of transactions) expect(rowToTx(txToRow(t, U))).toEqual(t);
    expect(txToRow(transactions[0]!, U).user_id).toBe(U);
  });

  it('reads times and numbers the way Postgres returns them', () => {
    const row = { ...txToRow(transactions[0]!, U), created_at: '2026-09-29T01:00:00.001+00:00', qty: '5.5', price: '1', fee: '0', fx_to_cny: '7.2' };
    const t = rowToTx(row);
    expect(t.createdAt).toBe('2026-09-29T01:00:00.001Z');
    expect(t.qty).toBe(5.5);
    expect(t.fxToCny).toBe(7.2);
  });

  it('keeps accounts, assets and instruments with their position', () => {
    for (const a of accounts) expect(rowToAccount(accountToRow(a, STAMP, U))).toEqual(a);
    expect(rowToAccount({ ...accountToRow(accounts[0]!, STAMP, U), color: null })).not.toHaveProperty('color');
    for (const e of exposures) expect(rowToExposure(exposureToRow(e, STAMP, U))).toEqual(e);
    for (const i of instruments) expect(rowToInstrument(instrumentToRow(i, STAMP, U))).toEqual(i);
    expect(accountToRow(accounts[0]!, STAMP, U)).toMatchObject({ position: 3, updated_at: STAMP.updatedAt });
    expect(rowStamp({ updated_at: '2026-09-30T08:00:00+00:00', position: 3 })).toEqual(STAMP);
  });

  it('keeps the plan and the whole target set', () => {
    expect(rowToPlan(planToRow(plan, STAMP.updatedAt, U))).toEqual(plan);
    expect(rowToPlan({ ...planToRow(plan, STAMP.updatedAt, U), threshold: '3' })).toEqual(plan);
    expect(targetsToRow({ sp500: 100 }, { AAPL: true }, STAMP.updatedAt, U)).toEqual({
      user_id: U,
      slots: { sp500: 100 },
      own_stock: { AAPL: true },
      updated_at: STAMP.updatedAt,
    });
  });

  it('writes times in one format so they sort correctly', () => {
    expect(isoTime('2026-09-30T08:00:00+00:00')).toBe('2026-09-30T08:00:00.000Z');
  });
});

describe('snapshot rows', () => {
  it('turns a snapshot and its items into rows and back', () => {
    const snapshot = { date: '2026-09-30', totalValueCny: 32350.25, netInvestedCny: 29200, usdCny: 7.0123 };
    const item = { date: '2026-09-30', exposureId: 'sp500', valueCny: 12300.5 };
    expect(snapshotToRow(snapshot, U)).toEqual({ user_id: U, date: '2026-09-30', total_value_cny: 32350.25, net_invested_cny: 29200, usd_cny: 7.0123 });
    expect(rowToSnapshot(snapshotToRow(snapshot, U))).toEqual(snapshot);
    expect(snapshotItemToRow(item, U)).toEqual({ user_id: U, date: '2026-09-30', exposure_id: 'sp500', value_cny: 12300.5 });
    expect(rowToSnapshotItem(snapshotItemToRow(item, U))).toEqual(item);
  });

  // Postgres numeric comes back from PGlite as a string
  it('reads numbers that come back as text', () => {
    expect(rowToSnapshot({ user_id: U, date: '2026-09-30', total_value_cny: '32350.25', net_invested_cny: '29200', usd_cny: '7.0123' })).toEqual({
      date: '2026-09-30',
      totalValueCny: 32350.25,
      netInvestedCny: 29200,
      usdCny: 7.0123,
    });
    expect(rowToSnapshotItem({ user_id: U, date: '2026-09-30', exposure_id: 'gold', value_cny: '1400' }).valueCny).toBe(1400);
  });
});

describe('plan rows and the last rebalance', () => {
  // A cloud that hasn't run the new migration lacks this column: when nothing has been marked, it's left out of the write
  it('carries the date the last rebalance was marked done, and leaves the column out until there is one', () => {
    const marked = { ...plan, lastRebalancedOn: '2026-10-03' };
    expect(planToRow(marked, STAMP.updatedAt, U)).toMatchObject({ last_rebalanced_on: '2026-10-03' });
    expect(rowToPlan(planToRow(marked, STAMP.updatedAt, U))).toEqual(marked);
    expect('last_rebalanced_on' in planToRow(plan, STAMP.updatedAt, U)).toBe(false);
    expect(rowToPlan({ ...planToRow(plan, STAMP.updatedAt, U), last_rebalanced_on: null })).toEqual(plan);
  });
});

describe('AI conversation rows', () => {
  const conversation: AiConversation = {
    id: 'c1',
    title: '美债超配要不要现在调？',
    createdAt: '2026-10-03T08:00:00.000Z',
    updatedAt: '2026-10-03T08:01:00.000Z',
  };
  const message: AiMessage = {
    id: 'm1',
    conversationId: 'c1',
    role: 'assistant',
    content: '1. 美债超配约 11%。\n仅供参考，不构成投资建议。',
    createdAt: '2026-10-03T08:01:00.000Z',
  };

  it('turns a conversation and a message into rows and back', () => {
    expect(aiConversationToRow(conversation, U)).toEqual({
      user_id: U,
      id: 'c1',
      title: '美债超配要不要现在调？',
      created_at: '2026-10-03T08:00:00.000Z',
      updated_at: '2026-10-03T08:01:00.000Z',
    });
    expect(aiMessageToRow(message, U)).toEqual({
      user_id: U,
      id: 'm1',
      conversation_id: 'c1',
      role: 'assistant',
      content: message.content,
      created_at: '2026-10-03T08:01:00.000Z',
    });
    expect(rowToAiConversation(aiConversationToRow(conversation, U))).toEqual(conversation);
    expect(rowToAiMessage(aiMessageToRow(message, U))).toEqual(message);
  });

  it('reads times the way Postgres returns them', () => {
    const c = { ...aiConversationToRow(conversation, U), created_at: '2026-10-03T08:00:00+00:00', updated_at: '2026-10-03T08:01:00+00:00', server_updated_at: '2026-10-03T08:01:02.5+00:00' };
    expect(rowToAiConversation(c)).toEqual(conversation);
    const m = { ...aiMessageToRow(message, U), created_at: '2026-10-03T08:01:00+00:00', inserted_at: '2026-10-03T08:01:02.5+00:00' };
    expect(rowToAiMessage(m)).toEqual(message);
  });
});
