import { describe, expect, it } from 'vitest';
import { cashBalance, currencyLookup, deriveLedger, holdingQty } from './ledger';
import {
  REASON,
  recordBuy,
  recordCalibration,
  recordDeposit,
  recordSell,
  recordWithdraw,
  stamp,
} from './record';
import type { RecordCtx, RecordResult } from './record';
import type { Account, FxRates, Instrument, Transaction } from './types';

const VOO: Instrument = { code: 'VOO', name: 'Vanguard 标普500', market: '美股', currency: 'USD', exposureId: 'sp500', paysDividend: true };
const ETF: Instrument = { code: '513500', name: '标普500ETF', market: 'A股', currency: 'CNY', exposureId: 'sp500', paysDividend: true };
const futu: Account = { id: 'futu', name: '富途', type: 'broker', currency: 'USD', market: '美股' };
const cms: Account = { id: 'cms', name: '招商证券', type: 'broker', currency: 'CNY', market: 'A股' };
const fx: FxRates = { CNY: 1, USD: 7.1, HKD: 0.91 };
const currencyOf = currencyLookup({ VOO, '513500': ETF });

function makeCtx(): RecordCtx {
  let n = 0;
  return { newId: () => `new-${++n}`, now: () => '2026-09-29T10:00:00.000Z' };
}

const opening: Transaction[] = [
  { id: 'o1', date: '2026-01-02', createdAt: '2026-01-02T00:00:00.000Z', type: 'opening', accountId: 'futu', instrumentCode: 'VOO', qty: 10, price: 500, fee: 0, fxToCny: 7 },
  { id: 'o2', date: '2026-01-02', createdAt: '2026-01-02T00:00:00.001Z', type: 'opening', accountId: 'futu', instrumentCode: 'USD', qty: 1000, price: 1, fee: 0, fxToCny: 7 },
  { id: 'o3', date: '2026-01-02', createdAt: '2026-01-02T00:00:00.002Z', type: 'opening', accountId: 'cms', instrumentCode: 'VOO', qty: 2, price: 500, fee: 0, fxToCny: 7 },
];
const ledger = deriveLedger(opening, currencyOf);

function txnsOf(result: RecordResult): Transaction[] {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.transactions;
}
const after = (txns: Transaction[]) => deriveLedger([...opening, ...txns], currencyOf);
const base = { date: '2026-09-29', fx };

describe('recordBuy', () => {
  it('pays from cash when there is enough', () => {
    const txns = txnsOf(recordBuy({ ...base, ledger, account: futu, instrument: VOO, qty: 1, price: 500, fee: 1, ctx: makeCtx() }));
    expect(txns).toEqual([
      expect.objectContaining({ type: 'buy', accountId: 'futu', instrumentCode: 'VOO', qty: 1, price: 500, fee: 1, fxToCny: 7.1, date: '2026-09-29' }),
    ]);
    expect(cashBalance(after(txns), 'futu', 'USD')).toBe(499);
  });

  it('adds an automatic deposit for the shortfall before the buy', () => {
    const txns = txnsOf(recordBuy({ ...base, ledger, account: futu, instrument: VOO, qty: 3, price: 500, ctx: makeCtx() }));
    expect(txns.map((t) => [t.type, t.instrumentCode, t.qty, t.reason])).toEqual([
      ['deposit', 'USD', 500, REASON.autoDeposit],
      ['buy', 'VOO', 3, undefined],
    ]);
    expect(txns[0]!.createdAt < txns[1]!.createdAt).toBe(true);
    const result = after(txns);
    expect(cashBalance(result, 'futu', 'USD')).toBe(0);
    expect(result.netInvestedCny - ledger.netInvestedCny).toBeCloseTo(500 * 7.1, 9);
  });

  it('records the whole amount as a deposit when buying in a currency the account holds no cash in', () => {
    const txns = txnsOf(recordBuy({ ...base, ledger, account: cms, instrument: VOO, qty: 1, price: 500, ctx: makeCtx() }));
    expect(txns.map((t) => [t.type, t.accountId, t.instrumentCode, t.qty])).toEqual([
      ['deposit', 'cms', 'USD', 500],
      ['buy', 'cms', 'VOO', 1],
    ]);
    expect(cashBalance(after(txns), 'cms', 'USD')).toBe(0);
  });

  it('rejects non-positive quantity or price and negative fees', () => {
    const args = { ...base, ledger, account: futu, instrument: VOO, ctx: makeCtx() };
    expect(recordBuy({ ...args, qty: 0, price: 500 })).toEqual({ ok: false, error: { kind: 'invalid_trade' } });
    expect(recordBuy({ ...args, qty: 1, price: -1 })).toEqual({ ok: false, error: { kind: 'invalid_trade' } });
    expect(recordBuy({ ...args, qty: 1, price: 500, fee: -1 })).toEqual({ ok: false, error: { kind: 'invalid_fee' } });
    expect(recordBuy({ ...args, qty: 1, price: 500, fee: Number.NaN })).toEqual({ ok: false, error: { kind: 'invalid_fee' } });
    expect(recordBuy({ ...args, qty: Number.NaN, price: 500 })).toEqual({ ok: false, error: { kind: 'invalid_trade' } });
  });

  it('refuses to buy or sell cash', () => {
    const USD: Instrument = { code: 'USD', name: '美元现金', market: '现金', currency: 'USD', exposureId: 'usd', paysDividend: false };
    expect(recordBuy({ ...base, ledger, account: futu, instrument: USD, qty: 1, price: 1, ctx: makeCtx() })).toEqual({
      ok: false,
      error: { kind: 'cash_trade' },
    });
    expect(recordSell({ ...base, ledger, account: futu, instrument: USD, qty: 1, price: 1, ctx: makeCtx() })).toEqual({
      ok: false,
      error: { kind: 'cash_trade' },
    });
  });
});

describe('recordSell', () => {
  it('adds proceeds net of fee to same-currency cash', () => {
    const txns = txnsOf(recordSell({ ...base, ledger, account: futu, instrument: VOO, qty: 2, price: 550, fee: 1, ctx: makeCtx() }));
    expect(txns.map((t) => t.type)).toEqual(['sell']);
    const result = after(txns);
    expect(cashBalance(result, 'futu', 'USD')).toBe(2099);
    expect(holdingQty(result, 'futu', 'VOO')).toBe(8);
  });

  it('withdraws the proceeds when the instrument currency differs from the account', () => {
    const txns = txnsOf(recordSell({ ...base, ledger, account: cms, instrument: VOO, qty: 2, price: 550, ctx: makeCtx() }));
    expect(txns.map((t) => [t.type, t.instrumentCode, t.qty, t.reason])).toEqual([
      ['sell', 'VOO', 2, undefined],
      ['withdraw', 'USD', 1100, REASON.autoWithdraw],
    ]);
    const result = after(txns);
    expect(cashBalance(result, 'cms', 'USD')).toBe(0);
    expect(ledger.netInvestedCny - result.netInvestedCny).toBeCloseTo(1100 * 7.1, 9);
  });

  it('refuses to sell more than held', () => {
    expect(recordSell({ ...base, ledger, account: futu, instrument: VOO, qty: 11, price: 550, ctx: makeCtx() })).toEqual({
      ok: false,
      error: { kind: 'insufficient_holding', available: 10 },
    });
  });

  it('refuses a fee larger than the trade value', () => {
    expect(recordSell({ ...base, ledger, account: futu, instrument: VOO, qty: 1, price: 5, fee: 6, ctx: makeCtx() })).toEqual({
      ok: false,
      error: { kind: 'invalid_fee' },
    });
  });
});

describe('recordDeposit / recordWithdraw', () => {
  it('deposits in the account currency', () => {
    const txns = txnsOf(recordDeposit({ ...base, account: futu, amount: 300, reason: '工资', ctx: makeCtx() }));
    expect(txns).toEqual([
      expect.objectContaining({ type: 'deposit', accountId: 'futu', instrumentCode: 'USD', qty: 300, price: 1, fee: 0, fxToCny: 7.1, reason: '工资' }),
    ]);
  });

  it('rejects a non-positive deposit', () => {
    expect(recordDeposit({ ...base, account: futu, amount: 0, ctx: makeCtx() })).toEqual({ ok: false, error: { kind: 'invalid_amount' } });
  });

  it('withdraws up to the available cash', () => {
    const txns = txnsOf(recordWithdraw({ ...base, ledger, account: futu, amount: 1000, ctx: makeCtx() }));
    expect(txns.map((t) => [t.type, t.instrumentCode, t.qty])).toEqual([['withdraw', 'USD', 1000]]);
    expect(cashBalance(after(txns), 'futu', 'USD')).toBe(0);
  });

  it('refuses to withdraw more than the cash', () => {
    expect(recordWithdraw({ ...base, ledger, account: futu, amount: 1000.5, ctx: makeCtx() })).toEqual({
      ok: false,
      error: { kind: 'insufficient_cash', available: 1000, currency: 'USD' },
    });
  });
});

describe('recordCalibration', () => {
  it('records an unchanged share count as checked', () => {
    const txns = txnsOf(recordCalibration({ ...base, ledger, accountId: 'futu', instrument: VOO, actualQty: 10, reason: '红利再投', ctx: makeCtx() }));
    expect(txns).toEqual([expect.objectContaining({ type: 'calibrate', instrumentCode: 'VOO', qty: 10, reason: '已核对' })]);
  });

  it('stores the actual share count with the given reason', () => {
    const txns = txnsOf(recordCalibration({ ...base, ledger, accountId: 'futu', instrument: VOO, actualQty: 10.84, reason: '红利再投', ctx: makeCtx() }));
    expect(txns).toEqual([expect.objectContaining({ type: 'calibrate', qty: 10.84, reason: '红利再投' })]);
    expect(holdingQty(after(txns), 'futu', 'VOO')).toBe(10.84);
  });

  it('rejects a negative share count', () => {
    expect(recordCalibration({ ...base, ledger, accountId: 'futu', instrument: VOO, actualQty: -1, reason: '手动修正', ctx: makeCtx() })).toEqual({
      ok: false,
      error: { kind: 'invalid_trade' },
    });
  });
});

describe('stamp', () => {
  it('assigns ids and createdAt one millisecond apart', () => {
    const draft = { date: '2026-09-29', type: 'deposit' as const, accountId: 'futu', instrumentCode: 'USD', qty: 1, price: 1, fee: 0, fxToCny: 7.1 };
    const out = stamp([draft, draft], makeCtx());
    expect(out.map((t) => [t.id, t.createdAt])).toEqual([
      ['new-1', '2026-09-29T10:00:00.000Z'],
      ['new-2', '2026-09-29T10:00:00.001Z'],
    ]);
  });
});
