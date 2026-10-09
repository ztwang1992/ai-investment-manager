import { isCashCode } from './types';
import type { CashCurrency, Instrument, Transaction } from './types';

// Derives holdings, cash and principal from the transactions. Rules in README「流水类型」.

/** What an account holds of one instrument. Cash is a holding too: code is the currency, and cost always equals qty. */
export interface Holding {
  accountId: string;
  code: string;
  qty: number;
  /** Total cost in the original currency */
  cost: number;
}

export type Anomaly =
  | { kind: 'negative_qty'; accountId: string; code: string; qty: number }
  | { kind: 'unknown_instrument'; txId: string; code: string };

export interface Ledger {
  holdings: Holding[];
  netInvestedCny: number;
  /** Calibration transaction id -> share difference (actual shares − shares before calibration) */
  calibrationDiffs: Record<string, number>;
  anomalies: Anomaly[];
}

export type CurrencyOf = (code: string) => CashCurrency | undefined;

export interface PrincipalEvent {
  txId: string;
  date: string;
  accountId: string;
  kind: 'deposit' | 'withdraw';
  /** Negative for withdrawals */
  amountCny: number;
}

/** A share count no larger than this in absolute value counts as 0. */
const QTY_EPS = 1e-9;
/** Only negatives beyond these count as anomalies; smaller ones are floating-point residue. */
const NEGATIVE_QTY_TOLERANCE = 1e-6;
const NEGATIVE_CASH_TOLERANCE = 0.005;

export function currencyLookup(instruments: Record<string, Instrument>): CurrencyOf {
  return (code) => (isCashCode(code) ? code : instruments[code]?.currency);
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Sorted by date -> creation time -> id, so transactions merged from several devices have a fixed order. */
export function sortTransactions(txns: readonly Transaction[]): Transaction[] {
  return [...txns].sort(
    (a, b) => compare(a.date, b.date) || compare(a.createdAt, b.createdAt) || compare(a.id, b.id),
  );
}

export function deriveLedger(txns: readonly Transaction[], currencyOf: CurrencyOf): Ledger {
  const book = new Map<string, Holding>();
  const anomalies: Anomaly[] = [];
  const calibrationDiffs: Record<string, number> = {};
  let netInvestedCny = 0;

  const get = (accountId: string, code: string): Holding => {
    const key = `${accountId}|${code}`;
    let h = book.get(key);
    if (!h) {
      h = { accountId, code, qty: 0, cost: 0 };
      book.set(key, h);
    }
    return h;
  };
  const moveCash = (t: Transaction, amount: number) => {
    const currency = currencyOf(t.instrumentCode);
    if (!currency) {
      anomalies.push({ kind: 'unknown_instrument', txId: t.id, code: t.instrumentCode });
      return;
    }
    const cash = get(t.accountId, currency);
    cash.qty += amount;
    cash.cost += amount;
  };
  const settle = (h: Holding) => {
    if (Math.abs(h.qty) <= QTY_EPS) {
      h.qty = 0;
      h.cost = 0;
    }
  };

  for (const t of sortTransactions(txns)) {
    const h = get(t.accountId, t.instrumentCode);
    switch (t.type) {
      case 'opening':
        h.qty += t.qty;
        h.cost += t.qty * t.price;
        netInvestedCny += t.qty * t.price * t.fxToCny;
        break;
      case 'buy': {
        const amount = t.qty * t.price + t.fee;
        h.qty += t.qty;
        h.cost += amount;
        moveCash(t, -amount);
        break;
      }
      case 'sell': {
        const avgCost = h.qty > QTY_EPS ? h.cost / h.qty : 0;
        h.qty -= t.qty;
        h.cost -= avgCost * t.qty;
        settle(h);
        moveCash(t, t.qty * t.price - t.fee);
        break;
      }
      case 'deposit':
        h.qty += t.qty;
        h.cost += t.qty;
        netInvestedCny += t.qty * t.fxToCny;
        break;
      case 'withdraw':
        h.qty -= t.qty;
        h.cost -= t.qty;
        settle(h);
        netInvestedCny -= t.qty * t.fxToCny;
        break;
      case 'calibrate':
        calibrationDiffs[t.id] = t.qty - h.qty;
        h.qty = t.qty;
        settle(h);
        break;
    }
  }

  const holdings: Holding[] = [];
  for (const h of book.values()) {
    if (Math.abs(h.qty) <= QTY_EPS) continue;
    if (h.qty < 0) {
      const tolerance = isCashCode(h.code) ? NEGATIVE_CASH_TOLERANCE : NEGATIVE_QTY_TOLERANCE;
      if (h.qty >= -tolerance) continue;
      anomalies.push({ kind: 'negative_qty', accountId: h.accountId, code: h.code, qty: h.qty });
    }
    holdings.push({ ...h });
  }
  return { holdings, netInvestedCny, calibrationDiffs, anomalies };
}

export function holdingQty(ledger: Ledger, accountId: string, code: string): number {
  return ledger.holdings.find((h) => h.accountId === accountId && h.code === code)?.qty ?? 0;
}

export function cashBalance(ledger: Ledger, accountId: string, currency: CashCurrency): number {
  return holdingQty(ledger, accountId, currency);
}

/** Deposit and withdrawal events (the dots on the Returns page and "Money in and out"). Openings don't count. */
export function principalEvents(txns: readonly Transaction[]): PrincipalEvent[] {
  const events: PrincipalEvent[] = [];
  for (const t of sortTransactions(txns)) {
    if (t.type !== 'deposit' && t.type !== 'withdraw') continue;
    const sign = t.type === 'deposit' ? 1 : -1;
    events.push({ txId: t.id, date: t.date, accountId: t.accountId, kind: t.type, amountCny: sign * t.qty * t.fxToCny });
  }
  return events;
}

/** Net invested principal up to and including a given day. */
export function netInvestedOn(txns: readonly Transaction[], date: string): number {
  let total = 0;
  for (const t of txns) {
    if (t.date > date) continue;
    if (t.type === 'opening') total += t.qty * t.price * t.fxToCny;
    else if (t.type === 'deposit') total += t.qty * t.fxToCny;
    else if (t.type === 'withdraw') total -= t.qty * t.fxToCny;
  }
  return total;
}
