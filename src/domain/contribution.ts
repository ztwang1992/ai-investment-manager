import { REASON, stamp } from './record';
import type { RecordCtx, TxDraft } from './record';
import { slotKeyOf } from './slots';
import type { Slot } from './slots';
import { MARKET, isCashCode } from './types';
import type {
  Account,
  AllocationLine,
  CashCurrency,
  Exposure,
  FxRates,
  Instrument,
  OwnStock,
  Prices,
  Transaction,
} from './types';
import type { ValuedHolding } from './valuation';

// "Invest new money": only buys, never sells; allocated by water-filling, without diluting the slots it buys. See README「增量投入算法」.

export interface ContributionPlan {
  /** Largest amount first */
  lines: AllocationLine[];
  maxDeviationBefore: number;
  maxDeviationAfter: number;
  /** Underweight slots with no instrument to buy */
  missingSlots: string[];
}

export interface ContributionInput {
  amount: number;
  currency: CashCurrency;
  mode: 'account' | 'any';
  /** Required when mode is 'account' */
  account?: Account;
  slots: readonly Slot[];
  totalCny: number;
  rows: readonly ValuedHolding[];
  /** Instruments that can be suggested, in mapping order */
  candidates: readonly Instrument[];
  exposures: Record<string, Exposure>;
  ownStock: OwnStock;
  accounts: readonly Account[];
  prices: Prices;
  fx: FxRates;
}

/** Suggestions under 0.2% of the amount invested are merged into the largest one. */
const MIN_LINE_SHARE = 0.002;

interface FillItem {
  value: number;
  weight: number;
}

/**
 * Finds the water level such that Σ max(0, level × weight − value) = amount; returns the level and the amount each item gets.
 * Adds items in order of value / weight, lowest first, until the solved level doesn't exceed the next item's starting point.
 */
function waterFill(items: readonly FillItem[], amount: number): { level: number; amounts: number[] } {
  const order = items
    .map((it, index) => ({ index, start: it.value / it.weight }))
    .sort((a, b) => a.start - b.start);
  let sumValue = 0;
  let sumWeight = 0;
  let level = 0;
  for (let k = 0; k < order.length; k++) {
    const it = items[order[k]!.index]!;
    sumValue += it.value;
    sumWeight += it.weight;
    level = (amount + sumValue) / sumWeight;
    const next = order[k + 1];
    if (!next || level <= next.start) break;
  }
  return { level, amounts: items.map((it) => Math.max(0, level * it.weight - it.value)) };
}

/**
 * Water-filling, but no slot that is bought may be diluted (the user's phase 5 rule): its share after investing is at least what it was before; one that was overweight only needs topping back up to its target.
 * So each slot is either not bought, or bought at least at its "floor" = min(value × amount ÷ total assets, the gap to its target).
 * Starting from the most underweight (lowest value ÷ target), consider "buy the first m" in turn: the floors are paid first, and the rest of the money is water-filled.
 * 1. Buy as many as possible: take the largest m where the first m are all below the water level, water-filling gives each at least its floor, and the level doesn't exceed the target.
 *    The buys that would be diluted are skipped, and their money goes to more underweight assets.
 * 2. When that doesn't fit (a more underweight one would go over its target), take the smallest m whose level doesn't exceed the target: the skipped ones are bought back at their floors.
 *    There isn't enough money to bring every candidate to its target, so buying them all keeps the level at or under the target; this step always has a solution.
 * Used only when the money can't bring every candidate to its target (README step 3); otherwise step 4 applies, and everything bought ends at or above its target.
 */
function fillWithoutDilution(items: readonly FillItem[], amount: number, total: number): number[] {
  const targetLevel = (total + amount) / 100; // at this level, a slot is exactly on target
  const keep = items.map((it) =>
    Math.max(0, Math.min(total > 0 ? (it.value * amount) / total : 0, targetLevel * it.weight - it.value)),
  );
  const order = items
    .map((it, index) => ({ index, start: it.value / it.weight }))
    .sort((a, b) => a.start - b.start);
  const slack = amount * 1e-9;
  const options = order.map((_, m) => {
    const chosen = order.slice(0, m + 1);
    const keepSum = chosen.reduce((s, o) => s + keep[o.index]!, 0);
    const fill = waterFill(
      chosen.map(({ index }) => ({ value: items[index]!.value + keep[index]!, weight: items[index]!.weight })),
      amount - keepSum,
    );
    const amounts = items.map(() => 0);
    chosen.forEach(({ index }, k) => (amounts[index] = keep[index]! + fill.amounts[k]!));
    const plain = chosen.every(({ index, start }) => {
      const byLevel = fill.level * items[index]!.weight - items[index]!.value;
      return start < fill.level && byLevel >= keep[index]! - slack;
    });
    return { amounts, plain, withinTarget: fill.level <= targetLevel * (1 + 1e-9) };
  });
  const redirected = options.filter((o) => o.plain && o.withinTarget).at(-1);
  return (redirected ?? options.find((o) => o.withinTarget) ?? options.at(-1)!).amounts;
}

export function planContribution(i: ContributionInput): ContributionPlan {
  const targeted = i.slots.filter((s) => !s.untargeted && s.tgtPct > 0);
  const maxDeviationBefore = Math.max(0, ...targeted.map((s) => Math.abs(s.curPct - s.tgtPct)));
  const amountCny = Number.isFinite(i.amount) && i.amount > 0 ? i.amount * i.fx[i.currency] : 0;
  if (amountCny <= 0) return { lines: [], maxDeviationBefore, maxDeviationAfter: maxDeviationBefore, missingSlots: [] };

  const totalAfter = i.totalCny + amountCny;
  const heldValue = new Map<string, number>();
  for (const r of i.rows) heldValue.set(r.code, (heldValue.get(r.code) ?? 0) + r.valueCny);

  const accountFor = (inst: Instrument): string | undefined => {
    if (i.mode === 'account') return i.account?.id;
    const holder = i.rows.filter((r) => r.code === inst.code).sort((a, b) => b.valueCny - a.valueCny)[0];
    if (holder) return holder.accountId;
    const match =
      i.accounts.find((a) => a.currency === inst.currency && a.market === inst.market) ??
      i.accounts.find((a) => a.currency === inst.currency);
    return match?.id;
  };
  const canBuy = (inst: Instrument): boolean =>
    inst.currency === i.currency &&
    (isCashCode(inst.code) || (i.prices[inst.code] ?? 0) > 0) &&
    (i.mode === 'any' || inst.market === i.account?.market || inst.market === MARKET.cash) &&
    accountFor(inst) !== undefined;
  const pick = (slotKey: string): Instrument | undefined =>
    i.candidates
      .filter((inst) => {
        const exposure = i.exposures[inst.exposureId];
        return exposure !== undefined && slotKeyOf(exposure, i.ownStock) === slotKey && canBuy(inst);
      })
      .sort((a, b) => (heldValue.get(b.code) ?? 0) - (heldValue.get(a.code) ?? 0))[0];

  const eligible: { slot: Slot; inst: Instrument }[] = [];
  for (const slot of targeted) {
    const inst = pick(slot.key);
    if (inst) eligible.push({ slot, inst });
  }

  const need = eligible.map(({ slot }) => Math.max(0, (slot.tgtPct * totalAfter) / 100 - slot.valueCny));
  const sumNeed = need.reduce((s, x) => s + x, 0);
  let amounts: number[];
  if (sumNeed <= amountCny) {
    const sumTarget = eligible.reduce((s, e) => s + e.slot.tgtPct, 0);
    amounts = need.map((n, k) => n + ((amountCny - sumNeed) * eligible[k]!.slot.tgtPct) / sumTarget);
  } else {
    amounts = fillWithoutDilution(
      eligible.map(({ slot }) => ({ value: slot.valueCny, weight: slot.tgtPct })),
      amountCny,
      i.totalCny,
    );
  }

  const kept = eligible
    .map((e, k) => ({ ...e, amount: amounts[k]! }))
    .filter((x) => x.amount > amountCny * MIN_LINE_SHARE)
    .sort((a, b) => b.amount - a.amount);
  if (kept.length > 0) {
    kept[0]!.amount += amountCny - kept.reduce((s, x) => s + x.amount, 0);
  }

  const lines: AllocationLine[] = kept.map(({ slot, inst, amount }) => {
    const isCash = inst.market === MARKET.cash;
    return {
      slotKey: slot.key,
      code: inst.code,
      accountId: accountFor(inst)!,
      amountCny: amount,
      amount: amount / i.fx[i.currency],
      isCash,
      isNewInstrument: !isCash && (heldValue.get(inst.code) ?? 0) <= 0,
      beforePct: slot.curPct,
      afterPct: ((slot.valueCny + amount) * 100) / totalAfter,
    };
  });

  const bought = new Map(lines.map((l) => [l.slotKey, l.amountCny]));
  const maxDeviationAfter = Math.max(
    0,
    ...targeted.map((s) => Math.abs(((s.valueCny + (bought.get(s.key) ?? 0)) * 100) / totalAfter - s.tgtPct)),
  );
  const buyable = new Set(eligible.map((e) => e.slot.key));
  const missingSlots = targeted.filter((s) => s.curPct < s.tgtPct && !buyable.has(s.key)).map((s) => s.key);

  return { lines, maxDeviationBefore, maxDeviationAfter, missingSlots };
}

/** Carrying out the suggestion: each account first records a deposit, then each buy. */
export function contributionTransactions(i: {
  lines: readonly AllocationLine[];
  currency: CashCurrency;
  date: string;
  prices: Prices;
  fx: FxRates;
  ctx: RecordCtx;
}): Transaction[] {
  const fx = i.fx[i.currency];
  const perAccount = new Map<string, number>();
  for (const l of i.lines) perAccount.set(l.accountId, (perAccount.get(l.accountId) ?? 0) + l.amount);

  const drafts: TxDraft[] = [];
  for (const [accountId, amount] of perAccount) {
    drafts.push({ date: i.date, type: 'deposit', accountId, instrumentCode: i.currency, qty: amount, price: 1, fee: 0, reason: REASON.invest, fxToCny: fx });
  }
  for (const l of i.lines) {
    if (l.isCash) continue;
    const price = i.prices[l.code]!;
    drafts.push({ date: i.date, type: 'buy', accountId: l.accountId, instrumentCode: l.code, qty: l.amount / price, price, fee: 0, fxToCny: fx });
  }
  return stamp(drafts, i.ctx);
}
