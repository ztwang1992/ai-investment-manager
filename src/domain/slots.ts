import type { Exposure, OwnStock, Targets, UndefinedMode } from './types';
import type { ValuedHolding } from './valuation';

// Slots: targets are set on assets; single stocks fold into Individual stocks by default. See the README's「计划」section.

export const STOCK_BUCKET = 'stocks';

/** Rebalancing ignores adjustments under 0.3% of total assets. */
const MIN_REBALANCE_SHARE = 0.003;

export interface Slot {
  key: string;
  valueCny: number;
  costCny: number;
  curPct: number;
  tgtPct: number;
  /** Current − target, in percentage points */
  diffPct: number;
  /** Off by more than the threshold, or held without a target (sell mode) */
  off: boolean;
  untargeted: boolean;
}

export interface RebalanceStep {
  slotKey: string;
  action: 'buy' | 'sell';
  amountCny: number;
  untargeted: boolean;
}

export function slotKeyOf(exposure: Exposure, ownStock: OwnStock): string {
  return exposure.isStock && !ownStock[exposure.id] ? STOCK_BUCKET : exposure.id;
}

export function computeSlots(i: {
  rows: readonly ValuedHolding[];
  targets: Targets;
  ownStock: OwnStock;
  threshold: number;
  undefinedMode: UndefinedMode;
  order?: readonly string[];
}): { totalCny: number; slots: Slot[] } {
  const held = new Map<string, { value: number; cost: number }>();
  let totalCny = 0;
  for (const r of i.rows) {
    const key = slotKeyOf(r.exposure, i.ownStock);
    const acc = held.get(key) ?? { value: 0, cost: 0 };
    acc.value += r.valueCny;
    acc.cost += r.costCny;
    held.set(key, acc);
    totalCny += r.valueCny;
  }

  const keys = [...new Set([...Object.keys(i.targets), ...held.keys()])];
  if (i.order) {
    const rank = (k: string) => {
      const idx = i.order!.indexOf(k);
      return idx < 0 ? Number.POSITIVE_INFINITY : idx;
    };
    keys.sort((a, b) => rank(a) - rank(b));
  }

  const slots = keys.map((key): Slot => {
    const valueCny = held.get(key)?.value ?? 0;
    const costCny = held.get(key)?.cost ?? 0;
    const curPct = totalCny > 0 ? (valueCny * 100) / totalCny : 0;
    const target = i.targets[key];
    const untargeted = target === undefined;
    const tgtPct = untargeted ? (i.undefinedMode === 'ignore' ? curPct : 0) : target;
    const diffPct = curPct - tgtPct;
    const off = untargeted ? i.undefinedMode === 'sell' && valueCny > 0 : Math.abs(diffPct) > i.threshold;
    return { key, valueCny, costCny, curPct, tgtPct, diffPct, off, untargeted };
  });
  return { totalCny, slots };
}

/** The trades needed to reach the targets, sells first, then buys. */
export function rebalanceSteps(slots: readonly Slot[], totalCny: number): RebalanceStep[] {
  const minMove = totalCny * MIN_REBALANCE_SHARE;
  return slots
    .map((s) => ({ s, delta: (s.tgtPct * totalCny) / 100 - s.valueCny }))
    .filter(({ delta }) => Math.abs(delta) > minMove)
    .sort((a, b) => a.delta - b.delta)
    .map(({ s, delta }) => ({
      slotKey: s.key,
      action: delta < 0 ? 'sell' : 'buy',
      amountCny: Math.abs(delta),
      untargeted: s.untargeted,
    }));
}
