import { useMemo } from 'react';
import { useAppStore } from '../../app/store';
import { bySlotOrder } from '../../app/palette';
import { usePortfolio } from '../../app/usePortfolio';
import {
  buildSeries,
  exposurePerformance,
  flowEvents,
  rangeStart,
  rangeSummary,
  slotPerformance,
  withLiveSnapshot,
} from '../../domain/performance';
import type { ChartCurrency, RangeKey } from '../../domain/performance';
import { computeSnapshot } from '../../domain/snapshot';

/** The data the Returns page needs: today from the live valuation, history from snapshots. */
export function usePerfData(range: RangeKey) {
  const snapshots = useAppStore((s) => s.snapshots);
  const snapshotItems = useAppStore((s) => s.snapshotItems);
  const transactions = useAppStore((s) => s.transactions);
  const today = useAppStore((s) => s.today);
  const fx = useAppStore((s) => s.fx);
  const prices = useAppStore((s) => s.prices);
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const ownStock = useAppStore((s) => s.ownStock);
  const portfolio = usePortfolio();

  return useMemo(() => {
    // Today's point uses the live valuation, computed the same way as the Worker's daily snapshots
    const now = computeSnapshot({ date: today, transactions, instruments: portfolio.instrumentByCode, exposures: portfolio.exposureById, prices, fx });
    const live = withLiveSnapshot({
      snapshots,
      items: snapshotItems,
      live: { ...now.snapshot, byExposure: Object.fromEntries(now.items.map((it) => [it.exposureId, it.valueCny])) },
    });

    // HKD is only a display currency: the curve is computed in CNY and converted at the current rate for display
    const chartCurrency: ChartCurrency = displayCurrency === 'USD' ? 'USD' : 'CNY';
    const series = buildSeries({ snapshots: live.snapshots, transactions, currencyOf: portfolio.currencyOf, currency: chartCurrency });
    const events = flowEvents({ transactions, snapshots: live.snapshots, currencyOf: portfolio.currencyOf, currency: chartCurrency });
    const start = rangeStart(today, range, series[0]?.date ?? today);
    const points = series.filter((p) => p.date >= start);
    const summary = rangeSummary({ series, events, start });

    const perf = exposurePerformance({
      items: live.items,
      transactions,
      instruments: portfolio.instrumentByCode,
      start: points[0]?.date ?? start,
      end: today,
    });
    const slots = bySlotOrder(
      slotPerformance({ performance: perf, exposures: portfolio.exposureById, ownStock }).filter((s) => s.endValue > 0),
      (s) => s.slotKey,
    );

    return {
      isFresh: snapshots.filter((s) => s.date < today).length === 0,
      totalCny: portfolio.totalCny,
      chartCurrency,
      points,
      summary,
      slots,
      exposureById: portfolio.exposureById,
    };
  }, [snapshots, snapshotItems, transactions, today, fx, prices, displayCurrency, ownStock, portfolio, range]);
}
