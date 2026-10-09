import { currencyLookup, deriveLedger } from './ledger';
import type { Exposure, FxRates, Instrument, Prices, Snapshot, SnapshotItem, Transaction } from './types';
import { totalValue, valueHoldings } from './valuation';

// A day's snapshot: total assets, net invested principal, the USD rate, and the value of each held asset (README「数据模型」snapshots / snapshot_items).
// The Worker's daily snapshots and the app's live point for today both use this one function, so the two agree.

export function computeSnapshot(i: {
  date: string;
  transactions: readonly Transaction[];
  instruments: Record<string, Instrument>;
  exposures: Record<string, Exposure>;
  prices: Prices;
  fx: FxRates;
}): { snapshot: Snapshot; items: SnapshotItem[] } {
  // Only transactions recorded on or before this day
  const ledger = deriveLedger(
    i.transactions.filter((t) => t.date <= i.date),
    currencyLookup(i.instruments),
  );
  // Holdings without a price are valued at cost (valueHoldings)
  const rows = valueHoldings({ holdings: ledger.holdings, instruments: i.instruments, exposures: i.exposures, prices: i.prices, fx: i.fx });
  const byExposure = new Map<string, number>();
  for (const r of rows) byExposure.set(r.exposure.id, (byExposure.get(r.exposure.id) ?? 0) + r.valueCny);
  const items = [...byExposure]
    .filter(([, valueCny]) => valueCny !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([exposureId, valueCny]) => ({ date: i.date, exposureId, valueCny }));
  return {
    snapshot: { date: i.date, totalValueCny: totalValue(rows), netInvestedCny: ledger.netInvestedCny, usdCny: i.fx.USD },
    items,
  };
}
