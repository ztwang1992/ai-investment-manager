import { REASON, stamp } from './record';
import type { RecordCtx, TxDraft } from './record';
import { slotKeyOf } from './slots';
import type { Slot } from './slots';
import { MARKET } from './types';
import type { AllocationLine, CashCurrency, FxRates, OwnStock, Prices, Transaction } from './types';
import type { ValuedHolding } from './valuation';

// "Withdraw": sells the most overweight first, only holdings in the same currency. See README「取钱算法」.

export type WithdrawalPlan =
  | { ok: true; lines: AllocationLine[] }
  | {
      ok: false;
      /** available is the total of holdings in the same currency, in the currency being withdrawn */
      error: { kind: 'insufficient_holdings'; availableCny: number; available: number };
    };

export function planWithdrawal(i: {
  amount: number;
  currency: CashCurrency;
  slots: readonly Slot[];
  totalCny: number;
  rows: readonly ValuedHolding[];
  ownStock: OwnStock;
  fx: FxRates;
}): WithdrawalPlan {
  const amountCny = Number.isFinite(i.amount) && i.amount > 0 ? i.amount * i.fx[i.currency] : 0;
  if (amountCny <= 0) return { ok: true, lines: [] };
  const totalAfter = i.totalCny - amountCny;

  // What each slot can sell: holdings in the same currency, with a quote and a positive value, largest first
  const bySlot = i.slots
    .map((slot) => {
      const rows = i.rows
        .filter(
          (r) =>
            r.instrument.currency === i.currency &&
            !r.priceMissing &&
            r.valueCny > 0 &&
            slotKeyOf(r.exposure, i.ownStock) === slot.key,
        )
        .sort((a, b) => b.valueCny - a.valueCny);
      const held = rows.reduce((s, r) => s + r.valueCny, 0);
      const excess = Math.min(held, Math.max(0, slot.valueCny - (slot.tgtPct * totalAfter) / 100));
      return { slot, rows, held, excess };
    })
    .filter((x) => x.held > 0);

  const available = bySlot.reduce((s, x) => s + x.held, 0);
  if (amountCny > available + 1e-6) {
    return { ok: false, error: { kind: 'insufficient_holdings', availableCny: available, available: available / i.fx[i.currency] } };
  }

  const sumExcess = bySlot.reduce((s, x) => s + x.excess, 0);
  const rest = bySlot.reduce((s, x) => s + (x.held - x.excess), 0);
  const plans = bySlot
    .map((x) => ({
      ...x,
      sell:
        sumExcess >= amountCny
          ? (amountCny * x.excess) / sumExcess
          : x.excess + (rest > 0 ? ((amountCny - sumExcess) * (x.held - x.excess)) / rest : 0),
    }))
    .filter((x) => x.sell > 1e-9)
    .sort((a, b) => b.sell - a.sell);

  const lines: AllocationLine[] = [];
  for (const { slot, rows, sell } of plans) {
    const afterPct = totalAfter > 1e-9 ? ((slot.valueCny - sell) * 100) / totalAfter : 0;
    let left = sell;
    for (const r of rows) {
      if (left <= 1e-9) break;
      const take = Math.min(left, r.valueCny);
      left -= take;
      lines.push({
        slotKey: slot.key,
        code: r.code,
        accountId: r.accountId,
        amountCny: take,
        amount: take / i.fx[i.currency],
        isCash: r.instrument.market === MARKET.cash,
        isNewInstrument: false,
        beforePct: slot.curPct,
        afterPct,
      });
    }
  }
  return { ok: true, lines };
}

/** Carrying out the suggestion: records each sell, then one withdrawal per account. */
export function withdrawalTransactions(i: {
  lines: readonly AllocationLine[];
  currency: CashCurrency;
  date: string;
  prices: Prices;
  fx: FxRates;
  ctx: RecordCtx;
}): Transaction[] {
  const fx = i.fx[i.currency];
  const drafts: TxDraft[] = [];
  const perAccount = new Map<string, number>();
  for (const l of i.lines) {
    perAccount.set(l.accountId, (perAccount.get(l.accountId) ?? 0) + l.amount);
    if (l.isCash) continue;
    const price = i.prices[l.code]!;
    drafts.push({ date: i.date, type: 'sell', accountId: l.accountId, instrumentCode: l.code, qty: l.amount / price, price, fee: 0, fxToCny: fx });
  }
  for (const [accountId, amount] of perAccount) {
    drafts.push({ date: i.date, type: 'withdraw', accountId, instrumentCode: i.currency, qty: amount, price: 1, fee: 0, reason: REASON.withdraw, fxToCny: fx });
  }
  return stamp(drafts, i.ctx);
}
