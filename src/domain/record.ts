import { cashBalance, holdingQty } from './ledger';
import type { Ledger } from './ledger';
import { MARKET } from './types';
import type { Account, CashCurrency, FxRates, Instrument, Transaction } from './types';

// "Add record": turns the user's input into transactions to append, including automatic deposits / withdrawals.
// Rules in the README's「记一笔」table and「流水类型」.

export interface RecordCtx {
  newId: () => string;
  /** The current time (ISO) */
  now: () => string;
}

export type RecordError =
  | { kind: 'invalid_amount' }
  /** Quantity or price isn't positive */
  | { kind: 'invalid_trade' }
  /** The fee is negative or not a number, or exceeds the trade amount on a sell */
  | { kind: 'invalid_fee' }
  /** Trading a cash code such as USD / CNY; cash is recorded with deposits / withdrawals */
  | { kind: 'cash_trade' }
  | { kind: 'insufficient_cash'; available: number; currency: CashCurrency }
  | { kind: 'insufficient_holding'; available: number };

export type RecordResult = { ok: true; transactions: Transaction[] } | { ok: false; error: RecordError };

export type TxDraft = Omit<Transaction, 'id' | 'createdAt'>;
/**
 * Remarks the app writes into records. Like the market values they are stored in Chinese (existing data);
 * the UI translates them, and a remark typed by the user is shown as typed.
 */
export const REASON = {
  /** A buy needed more cash than the account had: the difference is recorded as a deposit */
  autoDeposit: '买入时现金不足自动补记',
  /** A sale into another currency: the proceeds leave as a withdrawal */
  autoWithdraw: '跨币种卖出自动补记',
  /** A calibration where the share count had not changed */
  checked: '已核对',
  /** The deposit recorded by "Invest new money" */
  invest: '投入一笔钱',
  /** The withdrawal recorded by "Withdraw" */
  withdraw: '取钱',
} as const;

/** Why a calibration changed the share count */
export const CALIBRATION_REASON = { dividend: '红利再投', split: '拆股合股', manual: '手动修正' } as const;
export type CalibrationReason = (typeof CALIBRATION_REASON)[keyof typeof CALIBRATION_REASON];

/** No automatic transaction for a cash shortfall under half a cent. */
const CASH_EPS = 0.005;
const QTY_EPS = 1e-9;

interface TradeInput {
  ledger: Ledger;
  account: Account;
  instrument: Instrument;
  date: string;
  qty: number;
  price: number;
  fee?: number;
  fx: FxRates;
  ctx: RecordCtx;
}

const isPositive = (x: number) => Number.isFinite(x) && x > 0;
const isNonNegative = (x: number) => Number.isFinite(x) && x >= 0;
const fail = (error: RecordError): RecordResult => ({ ok: false, error });

/** Gives a batch of transactions ids and creation times, each 1 millisecond after the one before, to keep their order. */
export function stamp(drafts: readonly TxDraft[], ctx: RecordCtx): Transaction[] {
  const start = Date.parse(ctx.now());
  return drafts.map((d, i) => ({ ...d, id: ctx.newId(), createdAt: new Date(start + i).toISOString() }));
}

function cashDraft(
  type: 'deposit' | 'withdraw',
  accountId: string,
  currency: CashCurrency,
  amount: number,
  date: string,
  fx: FxRates,
  reason?: string,
): TxDraft {
  return {
    date,
    type,
    accountId,
    instrumentCode: currency,
    qty: amount,
    price: 1,
    fee: 0,
    fxToCny: fx[currency],
    ...(reason ? { reason } : {}),
  };
}

function tradeError(i: TradeInput, fee: number, side: 'buy' | 'sell'): RecordError | null {
  if (i.instrument.market === MARKET.cash) return { kind: 'cash_trade' };
  if (!isPositive(i.qty) || !isPositive(i.price)) return { kind: 'invalid_trade' };
  if (!isNonNegative(fee) || (side === 'sell' && fee > i.qty * i.price)) return { kind: 'invalid_fee' };
  return null;
}

export function recordBuy(i: TradeInput): RecordResult {
  const fee = i.fee ?? 0;
  const error = tradeError(i, fee, 'buy');
  if (error) return fail(error);
  const currency = i.instrument.currency;
  const amount = i.qty * i.price + fee;
  const shortfall = amount - cashBalance(i.ledger, i.account.id, currency);
  const drafts: TxDraft[] = [];
  if (shortfall > CASH_EPS) {
    drafts.push(cashDraft('deposit', i.account.id, currency, shortfall, i.date, i.fx, REASON.autoDeposit));
  }
  drafts.push({
    date: i.date,
    type: 'buy',
    accountId: i.account.id,
    instrumentCode: i.instrument.code,
    qty: i.qty,
    price: i.price,
    fee,
    fxToCny: i.fx[currency],
  });
  return { ok: true, transactions: stamp(drafts, i.ctx) };
}

export function recordSell(i: TradeInput): RecordResult {
  const fee = i.fee ?? 0;
  const error = tradeError(i, fee, 'sell');
  if (error) return fail(error);
  const held = holdingQty(i.ledger, i.account.id, i.instrument.code);
  if (i.qty > held + QTY_EPS) return fail({ kind: 'insufficient_holding', available: held });
  const currency = i.instrument.currency;
  const proceeds = i.qty * i.price - fee;
  const drafts: TxDraft[] = [
    {
      date: i.date,
      type: 'sell',
      accountId: i.account.id,
      instrumentCode: i.instrument.code,
      qty: i.qty,
      price: i.price,
      fee,
      fxToCny: i.fx[currency],
    },
  ];
  if (currency !== i.account.currency && proceeds > CASH_EPS) {
    drafts.push(cashDraft('withdraw', i.account.id, currency, proceeds, i.date, i.fx, REASON.autoWithdraw));
  }
  return { ok: true, transactions: stamp(drafts, i.ctx) };
}

export function recordDeposit(i: {
  account: Account;
  date: string;
  amount: number;
  fx: FxRates;
  ctx: RecordCtx;
  reason?: string;
}): RecordResult {
  if (!isPositive(i.amount)) return fail({ kind: 'invalid_amount' });
  const draft = cashDraft('deposit', i.account.id, i.account.currency, i.amount, i.date, i.fx, i.reason);
  return { ok: true, transactions: stamp([draft], i.ctx) };
}

export function recordWithdraw(i: {
  ledger: Ledger;
  account: Account;
  date: string;
  amount: number;
  fx: FxRates;
  ctx: RecordCtx;
  reason?: string;
}): RecordResult {
  if (!isPositive(i.amount)) return fail({ kind: 'invalid_amount' });
  const currency = i.account.currency;
  const available = cashBalance(i.ledger, i.account.id, currency);
  if (i.amount > available + QTY_EPS) return fail({ kind: 'insufficient_cash', available, currency });
  const draft = cashDraft('withdraw', i.account.id, currency, i.amount, i.date, i.fx, i.reason);
  return { ok: true, transactions: stamp([draft], i.ctx) };
}

/** Calibration: qty stores the actual share count the broker shows; an unchanged count is recorded as checked. */
export function recordCalibration(i: {
  ledger: Ledger;
  accountId: string;
  instrument: Instrument;
  date: string;
  actualQty: number;
  reason: CalibrationReason;
  fx: FxRates;
  ctx: RecordCtx;
}): RecordResult {
  if (!isNonNegative(i.actualQty)) return fail({ kind: 'invalid_trade' });
  const current = holdingQty(i.ledger, i.accountId, i.instrument.code);
  const unchanged = Math.abs(i.actualQty - current) <= QTY_EPS;
  const draft: TxDraft = {
    date: i.date,
    type: 'calibrate',
    accountId: i.accountId,
    instrumentCode: i.instrument.code,
    qty: i.actualQty,
    price: 0,
    fee: 0,
    reason: unchanged ? REASON.checked : i.reason,
    fxToCny: i.fx[i.instrument.currency],
  };
  return { ok: true, transactions: stamp([draft], i.ctx) };
}
