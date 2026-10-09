import { addDays } from './dates';
import { sortTransactions } from './ledger';
import type { CurrencyOf } from './ledger';
import { rangeReturn } from './returns';
import { slotKeyOf } from './slots';
import type { Exposure, Instrument, OwnStock, Snapshot, SnapshotItem, Transaction } from './types';

// Calculations for the Returns page. See README「1. 收益」「美元视图」.

/** The period shown on Returns; the labels are in the messages */
export type RangeKey = '1w' | '1m' | '3m' | '1y' | '3y' | '5y' | 'all';
export const RANGE_KEYS: readonly RangeKey[] = ['1w', '1m', '3m', '1y', '3y', '5y', 'all'];
const RANGE_DAYS: Record<RangeKey, number | null> = {
  '1w': 7,
  '1m': 30,
  '3m': 91,
  '1y': 365,
  '3y': 1095,
  '5y': 1825,
  all: null,
};

export type ChartCurrency = 'CNY' | 'USD';

/** A point on the curve, amounts in the display currency. */
export interface SeriesPoint {
  date: string;
  value: number;
  principal: number;
}

/** The cumulative gain at a point on the curve: value minus net invested principal; no return rate when the principal isn't positive. */
export function cumulativeGain(point: SeriesPoint): { gain: number; pct: number | null } {
  const gain = point.value - point.principal;
  return { gain, pct: point.principal > 0 ? (gain / point.principal) * 100 : null };
}

/** Positive for deposits, negative for withdrawals, in the display currency. */
export interface FlowEvent {
  date: string;
  kind: 'deposit' | 'withdraw';
  amount: number;
}

export interface RangeSummary {
  startValue: number;
  endValue: number;
  netInflow: number;
  gain: number;
  pct: number | null;
  flows: FlowEvent[];
}

export interface ExposurePerformance {
  exposureId: string;
  startValue: number;
  endValue: number;
  /** Net money put into this asset during the period (buys positive, sells negative), CNY */
  netFlow: number;
  gain: number;
  pct: number | null;
}

/** The start of the period: back by the period's length, but not before the first day. */
export function rangeStart(today: string, range: RangeKey, firstDate: string): string {
  const days = RANGE_DAYS[range];
  if (days === null) return firstDate;
  const start = addDays(today, -days);
  return start < firstDate ? firstDate : start;
}

/** The USD rate on a day: the snapshot of that day or the nearest one before; the first day's when there is none. */
function usdCnyOn(snapshots: readonly Snapshot[], date: string): number {
  let rate = snapshots[0]!.usdCny;
  for (const s of snapshots) {
    if (s.date > date) break;
    rate = s.usdCny;
  }
  return rate;
}

/** A change in principal (opening, deposit, withdrawal) in the display currency. USD transactions use their original amount; CNY ones the day's rate. */
function principalFlowIn(
  t: Transaction,
  currency: ChartCurrency,
  currencyOf: CurrencyOf,
  snapshots: readonly Snapshot[],
): number {
  const sign = t.type === 'withdraw' ? -1 : 1;
  const original = t.type === 'opening' ? t.qty * t.price : t.qty;
  if (currency === 'CNY') return sign * original * t.fxToCny;
  const flowCurrency = currencyOf(t.instrumentCode);
  if (flowCurrency === 'USD') return sign * original;
  return (sign * original * t.fxToCny) / usdCnyOn(snapshots, t.date);
}

const isPrincipalFlow = (t: Transaction) => t.type === 'opening' || t.type === 'deposit' || t.type === 'withdraw';

export function buildSeries(i: {
  snapshots: readonly Snapshot[];
  transactions: readonly Transaction[];
  currencyOf: CurrencyOf;
  currency: ChartCurrency;
}): SeriesPoint[] {
  if (i.currency === 'CNY') {
    return i.snapshots.map((s) => ({ date: s.date, value: s.totalValueCny, principal: s.netInvestedCny }));
  }
  if (i.snapshots.length === 0) return [];
  const flows = sortTransactions(i.transactions).filter(isPrincipalFlow);
  let k = 0;
  let principal = 0;
  return i.snapshots.map((s) => {
    while (k < flows.length && flows[k]!.date <= s.date) {
      principal += principalFlowIn(flows[k]!, 'USD', i.currencyOf, i.snapshots);
      k += 1;
    }
    return { date: s.date, value: s.totalValueCny / s.usdCny, principal };
  });
}

/** Deposit and withdrawal events (the dots on the chart and "Money in and out"). */
export function flowEvents(i: {
  transactions: readonly Transaction[];
  snapshots: readonly Snapshot[];
  currencyOf: CurrencyOf;
  currency: ChartCurrency;
}): FlowEvent[] {
  if (i.currency === 'USD' && i.snapshots.length === 0) return [];
  return sortTransactions(i.transactions)
    .filter((t) => t.type === 'deposit' || t.type === 'withdraw')
    .map((t) => ({
      date: t.date,
      kind: t.type as 'deposit' | 'withdraw',
      amount: principalFlowIn(t, i.currency, i.currencyOf, i.snapshots),
    }));
}

export function rangeSummary(i: { series: readonly SeriesPoint[]; events: readonly FlowEvent[]; start: string }): RangeSummary {
  const inRange = i.series.filter((p) => p.date >= i.start);
  const first = inRange[0];
  const last = inRange.at(-1);
  if (!first || !last) return { startValue: 0, endValue: 0, netInflow: 0, gain: 0, pct: null, flows: [] };
  const flows = i.events.filter((e) => e.date > first.date && e.date <= last.date);
  const netInflow = flows.reduce((s, e) => s + e.amount, 0);
  const { gain, pct } = rangeReturn({ startValue: first.value, endValue: last.value, netInflow });
  return { startValue: first.value, endValue: last.value, netInflow, gain, pct, flows };
}

/**
 * How each asset did over the period (start, end], in CNY.
 * Period gain = ending value − starting value − net money put into the asset during the period;
 * a buy moves money from cash into the asset and a sell the other way, so trading itself isn't a gain, while reinvested dividends (calibration) are.
 */
export function exposurePerformance(i: {
  items: readonly SnapshotItem[];
  transactions: readonly Transaction[];
  instruments: Record<string, Instrument>;
  start: string;
  end: string;
}): ExposurePerformance[] {
  const startValues = new Map<string, number>();
  const endValues = new Map<string, number>();
  for (const item of i.items) {
    if (item.date === i.start) startValues.set(item.exposureId, (startValues.get(item.exposureId) ?? 0) + item.valueCny);
    if (item.date === i.end) endValues.set(item.exposureId, (endValues.get(item.exposureId) ?? 0) + item.valueCny);
  }

  const flows = new Map<string, number>();
  const add = (exposureId: string | undefined, amount: number) => {
    if (exposureId !== undefined) flows.set(exposureId, (flows.get(exposureId) ?? 0) + amount);
  };
  const exposureOf = (code: string) => i.instruments[code]?.exposureId;
  const cashExposureOf = (code: string) => {
    const currency = i.instruments[code]?.currency;
    return currency ? i.instruments[currency]?.exposureId : undefined;
  };
  for (const t of i.transactions) {
    if (t.date <= i.start || t.date > i.end) continue;
    switch (t.type) {
      case 'opening':
        add(exposureOf(t.instrumentCode), t.qty * t.price * t.fxToCny);
        break;
      case 'buy': {
        const amount = (t.qty * t.price + t.fee) * t.fxToCny;
        add(exposureOf(t.instrumentCode), amount);
        add(cashExposureOf(t.instrumentCode), -amount);
        break;
      }
      case 'sell': {
        const amount = (t.qty * t.price - t.fee) * t.fxToCny;
        add(exposureOf(t.instrumentCode), -amount);
        add(cashExposureOf(t.instrumentCode), amount);
        break;
      }
      case 'deposit':
        add(exposureOf(t.instrumentCode), t.qty * t.fxToCny);
        break;
      case 'withdraw':
        add(exposureOf(t.instrumentCode), -t.qty * t.fxToCny);
        break;
      case 'calibrate':
        break;
    }
  }

  const ids = new Set([...startValues.keys(), ...endValues.keys(), ...flows.keys()]);
  return [...ids].map((exposureId) => {
    const startValue = startValues.get(exposureId) ?? 0;
    const endValue = endValues.get(exposureId) ?? 0;
    const netFlow = flows.get(exposureId) ?? 0;
    const { gain, pct } = rangeReturn({ startValue, endValue, netInflow: netFlow });
    return { exposureId, startValue, endValue, netFlow, gain, pct };
  });
}

/** Today's live valuation (after prices refresh). */
export interface LiveSnapshot {
  date: string;
  totalValueCny: number;
  netInvestedCny: number;
  usdCny: number;
  byExposure: Record<string, number>;
}

/** Replaces (or adds) today in the history with today's live valuation. */
export function withLiveSnapshot(i: {
  snapshots: readonly Snapshot[];
  items: readonly SnapshotItem[];
  live: LiveSnapshot;
}): { snapshots: Snapshot[]; items: SnapshotItem[] } {
  const { date, totalValueCny, netInvestedCny, usdCny, byExposure } = i.live;
  const snapshots = i.snapshots.filter((s) => s.date < date);
  snapshots.push({ date, totalValueCny, netInvestedCny, usdCny });
  const items = i.items.filter((it) => it.date < date);
  for (const [exposureId, valueCny] of Object.entries(byExposure)) items.push({ date, exposureId, valueCny });
  return { snapshots, items };
}

export interface SlotPerformance {
  slotKey: string;
  startValue: number;
  endValue: number;
  netFlow: number;
  gain: number;
  pct: number | null;
}

/** Sums the assets' performance by slot (single stocks fold into Individual stocks by default), then recomputes the return rate. */
export function slotPerformance(i: {
  performance: readonly ExposurePerformance[];
  exposures: Record<string, Exposure>;
  ownStock: OwnStock;
}): SlotPerformance[] {
  const bySlot = new Map<string, { startValue: number; endValue: number; netFlow: number }>();
  for (const p of i.performance) {
    const exposure = i.exposures[p.exposureId];
    const slotKey = exposure ? slotKeyOf(exposure, i.ownStock) : p.exposureId;
    const acc = bySlot.get(slotKey) ?? { startValue: 0, endValue: 0, netFlow: 0 };
    acc.startValue += p.startValue;
    acc.endValue += p.endValue;
    acc.netFlow += p.netFlow;
    bySlot.set(slotKey, acc);
  }
  return [...bySlot].map(([slotKey, v]) => {
    const { gain, pct } = rangeReturn({ startValue: v.startValue, endValue: v.endValue, netInflow: v.netFlow });
    return { slotKey, ...v, gain, pct };
  });
}
