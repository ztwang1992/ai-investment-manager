import { useMemo } from 'react';
import { currencyLookup, deriveLedger } from '../domain/ledger';
import { computeSlots } from '../domain/slots';
import type { Exposure, Instrument } from '../domain/types';
import { totalValue, valueHoldings } from '../domain/valuation';
import { SLOT_ORDER } from './palette';
import { useAppStore } from './store';

const byKey = <T,>(list: readonly T[], key: (item: T) => string): Record<string, T> =>
  Object.fromEntries(list.map((item) => [key(item), item]));

/** The portfolio as derived from transactions and quotes (holdings, values, slots), shared by the pages. */
export function usePortfolio() {
  const transactions = useAppStore((s) => s.transactions);
  const instruments = useAppStore((s) => s.instruments);
  const exposures = useAppStore((s) => s.exposures);
  const prices = useAppStore((s) => s.prices);
  const fx = useAppStore((s) => s.fx);
  const targets = useAppStore((s) => s.targets);
  const ownStock = useAppStore((s) => s.ownStock);
  const plan = useAppStore((s) => s.plan);

  return useMemo(() => {
    const instrumentByCode: Record<string, Instrument> = byKey(instruments, (i) => i.code);
    const exposureById: Record<string, Exposure> = byKey(exposures, (e) => e.id);
    const currencyOf = currencyLookup(instrumentByCode);
    const ledger = deriveLedger(transactions, currencyOf);
    const rows = valueHoldings({ holdings: ledger.holdings, instruments: instrumentByCode, exposures: exposureById, prices, fx });
    const totalCny = totalValue(rows);
    const { slots } = computeSlots({
      rows,
      targets,
      ownStock,
      threshold: plan.threshold,
      undefinedMode: plan.undefinedMode,
      order: SLOT_ORDER,
    });
    return { instrumentByCode, exposureById, currencyOf, ledger, rows, totalCny, slots };
  }, [transactions, instruments, exposures, prices, fx, targets, ownStock, plan]);
}
