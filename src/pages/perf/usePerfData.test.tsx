// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyData, stateFromData } from '../../app/persistence';
import { useAppStore } from '../../app/store';
import type { AppState } from '../../app/store';
import type { Transaction } from '../../domain/types';
import { usePerfData } from './usePerfData';

// Phase 4b: an account's curve comes from the Worker's daily snapshots, plus today's live point

const tx = (id: string, instrumentCode: string, accountId: string, qty: number, price: number, fxToCny: number): Transaction => ({
  id,
  date: '2026-09-01',
  createdAt: '2026-09-01T08:00:00.000Z',
  type: 'opening',
  accountId,
  instrumentCode,
  qty,
  price,
  fee: 0,
  fxToCny,
});
const snapshots = [
  { date: '2026-09-28', totalValueCny: 20000, netInvestedCny: 17100, usdCny: 7.0 },
  { date: '2026-09-29', totalValueCny: 20500, netInvestedCny: 17100, usdCny: 7.1 },
  { date: '2026-09-30', totalValueCny: 21000, netInvestedCny: 17100, usdCny: 6.9 },
];
const snapshotItems = snapshots.flatMap((s) => [
  { date: s.date, exposureId: 'cny', valueCny: 10000 },
  { date: s.date, exposureId: 'sp500', valueCny: s.totalValueCny - 10000 },
]);

let initial: AppState;
beforeEach(() => {
  initial = useAppStore.getState();
  useAppStore.setState({
    ...stateFromData({ ...emptyData({ displayCurrency: 'CNY', hideAmounts: false }), snapshots, snapshotItems }),
    today: '2026-10-01',
    transactions: [tx('a', 'CNY', 'cmb', 10000, 1, 1), tx('b', 'VOO', 'futu', 2, 500, 7.1)],
    prices: { VOO: 700 },
    fx: { CNY: 1, USD: 6.7, HKD: 0.86 },
  });
});
afterEach(() => {
  useAppStore.setState(initial, true);
});

describe('performance data from the daily snapshots', () => {
  it('draws one point per snapshot and today\'s live value', () => {
    const { result } = renderHook(() => usePerfData('1w'));
    const live = 10000 + 2 * 700 * 6.7;
    expect(result.current.isFresh).toBe(false);
    expect(result.current.points.map((p) => [p.date, p.value])).toEqual([
      ['2026-09-28', 20000],
      ['2026-09-29', 20500],
      ['2026-09-30', 21000],
      ['2026-10-01', live],
    ]);
  });

  it('converts each day at that day\'s dollar rate in the USD view', () => {
    useAppStore.setState({ displayCurrency: 'USD' });
    const { result } = renderHook(() => usePerfData('1w'));
    expect(result.current.points.map((p) => p.value)).toEqual([20000 / 7.0, 20500 / 7.1, 21000 / 6.9, (10000 + 2 * 700 * 6.7) / 6.7]);
  });

  it('shows how each asset did from the snapshot items', () => {
    const { result } = renderHook(() => usePerfData('1w'));
    expect(result.current.slots.map((s) => s.slotKey).sort()).toEqual(['cny', 'sp500']);
    expect(result.current.slots.find((s) => s.slotKey === 'sp500')!.startValue).toBe(10000);
  });
});
