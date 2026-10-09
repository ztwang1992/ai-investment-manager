import { isCashCode } from './types';
import type { Holding } from './ledger';
import type { Exposure, FxRates, Instrument, Prices } from './types';

/** A holding with its instrument, asset and value in CNY. */
export interface ValuedHolding extends Holding {
  instrument: Instrument;
  exposure: Exposure;
  /** Price in the original currency; the average cost when there's no quote */
  price: number;
  priceMissing: boolean;
  valueCny: number;
  /** Cost converted to CNY at the current rate */
  costCny: number;
}

export function valueHoldings(i: {
  holdings: readonly Holding[];
  instruments: Record<string, Instrument>;
  exposures: Record<string, Exposure>;
  prices: Prices;
  fx: FxRates;
}): ValuedHolding[] {
  const rows: ValuedHolding[] = [];
  for (const h of i.holdings) {
    const instrument = i.instruments[h.code];
    const exposure = instrument && i.exposures[instrument.exposureId];
    if (!instrument || !exposure) continue;
    const fx = i.fx[instrument.currency];
    const quoted = isCashCode(h.code) ? 1 : i.prices[h.code];
    const price = quoted ?? (h.qty !== 0 ? h.cost / h.qty : 0);
    rows.push({
      ...h,
      instrument,
      exposure,
      price,
      priceMissing: quoted === undefined,
      valueCny: h.qty * price * fx,
      costCny: h.cost * fx,
    });
  }
  return rows;
}

export function totalValue(rows: readonly ValuedHolding[]): number {
  return rows.reduce((sum, r) => sum + r.valueCny, 0);
}
