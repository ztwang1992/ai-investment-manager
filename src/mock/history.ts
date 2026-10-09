import { addDays, daysBetween } from '../domain/dates';
import { currencyLookup, deriveLedger, sortTransactions } from '../domain/ledger';
import type { Ledger } from '../domain/ledger';
import { isCashCode } from '../domain/types';
import type { FxRates, Instrument, Prices, Snapshot, SnapshotItem, Transaction } from '../domain/types';

// The sample's daily snapshots: holdings are rolled forward day by day from the sample transactions, prices run back from today along a simulated index per asset,
// and rates move slightly, so principal, holdings and curve stay consistent. Accounts use the real snapshots the Worker writes each day (phase 4).

/** Simulated index parameters per asset: annual drift, volatility, phase (the prototype's SLOTPARAM). */
const INDEX_PARAMS: Record<string, [number, number, number]> = {
  sp500: [0.1, 1, 0.3],
  ndx: [0.14, 1.4, 1.1],
  brk: [0.11, 0.9, 2.9],
  aapl: [0.15, 1.5, 3.7],
  moutai: [0.02, 1.4, 4.1],
  exus: [0.05, 0.9, 5.2],
  csi300: [-0.01, 1.2, 6.4],
  ust10: [0.01, 0.4, 7.3],
  gold: [0.09, 0.8, 8.8],
};

function indexLevel(exposureId: string, t: number): number {
  const [mu, vol, phase] = INDEX_PARAMS[exposureId] ?? [0, 0, 0];
  const wave = 0.08 * Math.sin(t / 61 + phase) + 0.05 * Math.sin(t / 17 + 2 * phase) + 0.02 * Math.sin(t / 3.1 + 3 * phase);
  return Math.exp((mu * t) / 365 + vol * wave);
}

function fxLevel(t: number): number {
  return 1 + 0.012 * Math.sin(t / 97) + 0.006 * Math.sin(t / 23 + 1);
}

export function simulateHistory(i: {
  transactions: readonly Transaction[];
  instruments: Record<string, Instrument>;
  prices: Prices;
  fx: FxRates;
  end: string;
}): { snapshots: Snapshot[]; items: SnapshotItem[] } {
  const sorted = sortTransactions(i.transactions);
  if (sorted.length === 0) return { snapshots: [], items: [] };
  const start = sorted[0]!.date;
  const days = daysBetween(start, i.end);
  const currencyOf = currencyLookup(i.instruments);

  const snapshots: Snapshot[] = [];
  const items: SnapshotItem[] = [];
  const applied: Transaction[] = [];
  let next = 0;
  let ledger: Ledger = deriveLedger([], currencyOf);

  for (let t = 0; t <= days; t++) {
    const date = addDays(start, t);
    let changed = false;
    while (next < sorted.length && sorted[next]!.date <= date) {
      applied.push(sorted[next]!);
      next += 1;
      changed = true;
    }
    if (changed) ledger = deriveLedger(applied, currencyOf);

    const usdCny = (i.fx.USD * fxLevel(t)) / fxLevel(days);
    const byExposure = new Map<string, number>();
    for (const h of ledger.holdings) {
      const inst = i.instruments[h.code];
      if (!inst) continue;
      const today = i.prices[h.code] ?? (h.qty !== 0 ? h.cost / h.qty : 0);
      const price = isCashCode(h.code) ? 1 : (today * indexLevel(inst.exposureId, t)) / indexLevel(inst.exposureId, days);
      const value = h.qty * price * (inst.currency === 'USD' ? usdCny : 1);
      byExposure.set(inst.exposureId, (byExposure.get(inst.exposureId) ?? 0) + value);
    }
    let totalValueCny = 0;
    for (const [exposureId, valueCny] of byExposure) {
      items.push({ date, exposureId, valueCny });
      totalValueCny += valueCny;
    }
    snapshots.push({ date, totalValueCny, netInvestedCny: ledger.netInvestedCny, usdCny });
  }
  return { snapshots, items };
}
