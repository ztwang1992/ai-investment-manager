import { describe, expect, it } from 'vitest';
import { currencyLookup } from './ledger';
import { buildSeries, cumulativeGain, exposurePerformance, flowEvents, rangeStart, rangeSummary, slotPerformance, withLiveSnapshot } from './performance';
import type { SeriesPoint } from './performance';
import type { Instrument, Snapshot, SnapshotItem, Transaction, TxType } from './types';

const instruments: Record<string, Instrument> = {
  VOO: { code: 'VOO', name: 'VOO', market: '美股', currency: 'USD', exposureId: 'sp500', paysDividend: true },
  '513500': { code: '513500', name: '513500', market: 'A股', currency: 'CNY', exposureId: 'sp500', paysDividend: true },
  USD: { code: 'USD', name: '美元现金', market: '现金', currency: 'USD', exposureId: 'usd', paysDividend: false },
  CNY: { code: 'CNY', name: '人民币现金', market: '现金', currency: 'CNY', exposureId: 'cny', paysDividend: false },
};
const currencyOf = currencyLookup(instruments);

let seq = 0;
const tx = (date: string, type: TxType, code: string, qty: number, price: number, fxToCny: number): Transaction => ({
  id: `p${++seq}`,
  date,
  createdAt: `${date}T00:00:00.${String(seq).padStart(3, '0')}Z`,
  type,
  accountId: 'a',
  instrumentCode: code,
  qty,
  price,
  fee: 0,
  fxToCny,
});
const snap = (date: string, totalValueCny: number, netInvestedCny: number, usdCny: number): Snapshot => ({
  date,
  totalValueCny,
  netInvestedCny,
  usdCny,
});

describe('rangeStart', () => {
  it('goes back the range length but never before the first snapshot', () => {
    expect(rangeStart('2026-09-29', '1y', '2025-01-02')).toBe('2025-09-29');
    expect(rangeStart('2026-09-29', '1w', '2025-01-02')).toBe('2026-09-22');
    expect(rangeStart('2026-09-29', '5y', '2025-01-02')).toBe('2025-01-02');
    expect(rangeStart('2026-09-29', 'all', '2025-01-02')).toBe('2025-01-02');
  });
});

describe('buildSeries', () => {
  const snapshots = [snap('2026-01-01', 700, 700, 7.0), snap('2026-01-02', 792, 772, 7.2)];
  const transactions = [
    tx('2026-01-01', 'opening', '513500', 350, 2, 1),
    tx('2026-01-02', 'deposit', 'USD', 10, 1, 7.2),
  ];

  it('uses the snapshots directly in CNY', () => {
    expect(buildSeries({ snapshots, transactions, currencyOf, currency: 'CNY' })).toEqual([
      { date: '2026-01-01', value: 700, principal: 700 },
      { date: '2026-01-02', value: 792, principal: 772 },
    ]);
  });

  it('converts value at each day’s rate and principal at each flow’s own rate in USD', () => {
    const [d1, d2] = buildSeries({ snapshots, transactions, currencyOf, currency: 'USD' });
    expect(d1!.value).toBeCloseTo(100, 9);
    expect(d1!.principal).toBeCloseTo(100, 9);
    expect(d2!.value).toBeCloseTo(110, 9);
    // Principal is a staircase: the original 100 USD doesn't change when the rate moves from 7.0 to 7.2; only the new 10 USD deposit is added
    expect(d2!.principal).toBeCloseTo(110, 9);
  });
});

describe('flowEvents', () => {
  const snapshots = [snap('2026-01-01', 0, 0, 7.0), snap('2026-01-02', 0, 0, 7.2)];
  const transactions = [
    tx('2026-01-02', 'deposit', 'CNY', 720, 1, 1),
    tx('2026-01-02', 'withdraw', 'USD', 5, 1, 7.2),
    tx('2026-01-02', 'buy', 'VOO', 1, 100, 7.2),
  ];

  it('lists deposits and withdrawals only, withdrawals negative, in CNY', () => {
    expect(flowEvents({ transactions, snapshots, currencyOf, currency: 'CNY' }).map((e) => [e.kind, e.amount])).toEqual([
      ['deposit', 720],
      ['withdraw', -36],
    ]);
  });

  it('converts CNY flows at that day’s rate in USD', () => {
    expect(flowEvents({ transactions, snapshots, currencyOf, currency: 'USD' }).map((e) => [e.kind, e.amount])).toEqual([
      ['deposit', 100],
      ['withdraw', -5],
    ]);
  });
});

describe('rangeSummary', () => {
  const series: SeriesPoint[] = [
    { date: '2026-01-01', value: 100, principal: 100 },
    { date: '2026-01-02', value: 104, principal: 100 },
    { date: '2026-01-03', value: 130, principal: 110 },
  ];
  const events = [{ date: '2026-01-03', kind: 'deposit' as const, amount: 10 }];

  it('computes the gain and the range return', () => {
    const r = rangeSummary({ series, events, start: '2026-01-01' });
    expect(r).toMatchObject({ startValue: 100, endValue: 130, netInflow: 10, gain: 20 });
    expect(r.pct).toBeCloseTo((20 / 105) * 100, 9);
    expect(r.flows).toEqual(events);
  });

  it('starts from the point at the range start and ignores flows on that day', () => {
    const r = rangeSummary({ series, events: [{ date: '2026-01-02', kind: 'deposit', amount: 99 }], start: '2026-01-02' });
    expect(r).toMatchObject({ startValue: 104, endValue: 130, netInflow: 0, gain: 26 });
  });

  it('returns zeros and no percentage for an empty series', () => {
    expect(rangeSummary({ series: [], events: [], start: '2026-01-01' })).toEqual({
      startValue: 0,
      endValue: 0,
      netInflow: 0,
      gain: 0,
      pct: null,
      flows: [],
    });
  });
});

describe('exposurePerformance', () => {
  const item = (date: string, exposureId: string, valueCny: number): SnapshotItem => ({ date, exposureId, valueCny });

  it('removes money moved in or out so that buying is not counted as gain', () => {
    const items = [item('2026-01-01', 'sp500', 1000), item('2026-01-01', 'usd', 500), item('2026-01-02', 'sp500', 1400), item('2026-01-02', 'usd', 300)];
    const transactions = [
      tx('2026-01-02', 'buy', 'VOO', 1, 300, 1), // bought 300 with USD cash
      tx('2026-01-02', 'deposit', 'USD', 100, 1, 1), // then moved in another 100 USD
    ];
    const perf = Object.fromEntries(
      exposurePerformance({ items, transactions, instruments, start: '2026-01-01', end: '2026-01-02' }).map((p) => [p.exposureId, p]),
    );
    expect(perf.sp500).toMatchObject({ startValue: 1000, endValue: 1400, netFlow: 300, gain: 100 });
    expect(perf.sp500!.pct).toBeCloseTo((100 / 1150) * 100, 9);
    expect(perf.usd).toMatchObject({ startValue: 500, endValue: 300, netFlow: -200, gain: 0 });
  });

  it('counts reinvested dividends (calibration) as gain', () => {
    const items = [item('2026-01-01', 'sp500', 1000), item('2026-01-02', 'sp500', 1010)];
    const transactions = [tx('2026-01-02', 'calibrate', 'VOO', 10.1, 0, 1)];
    const [p] = exposurePerformance({ items, transactions, instruments, start: '2026-01-01', end: '2026-01-02' });
    expect(p).toMatchObject({ exposureId: 'sp500', netFlow: 0, gain: 10 });
  });
});

describe('withLiveSnapshot', () => {
  const snapshots = [snap('2026-01-01', 100, 100, 7), snap('2026-01-02', 110, 100, 7.1)];
  const items = [
    { date: '2026-01-01', exposureId: 'sp500', valueCny: 100 },
    { date: '2026-01-02', exposureId: 'sp500', valueCny: 110 },
  ];

  it('replaces today’s stored snapshot with the live valuation', () => {
    const r = withLiveSnapshot({
      snapshots,
      items,
      live: { date: '2026-01-02', totalValueCny: 120, netInvestedCny: 100, usdCny: 7.2, byExposure: { sp500: 120 } },
    });
    expect(r.snapshots.map((s) => [s.date, s.totalValueCny, s.usdCny])).toEqual([
      ['2026-01-01', 100, 7],
      ['2026-01-02', 120, 7.2],
    ]);
    expect(r.items.filter((it) => it.date === '2026-01-02')).toEqual([{ date: '2026-01-02', exposureId: 'sp500', valueCny: 120 }]);
  });

  it('appends today when the history stops earlier', () => {
    const r = withLiveSnapshot({
      snapshots,
      items,
      live: { date: '2026-01-03', totalValueCny: 125, netInvestedCny: 100, usdCny: 7.2, byExposure: { sp500: 125 } },
    });
    expect(r.snapshots.map((s) => s.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });
});

describe('slotPerformance', () => {
  it('adds exposures into their slots and recomputes the return', () => {
    const exposures = {
      aapl: { id: 'aapl', name: '苹果', groupId: 'stk', isStock: true },
      brk: { id: 'brk', name: '伯克希尔', groupId: 'stk', isStock: true },
      sp500: { id: 'sp500', name: '标普 500', groupId: 'us', isStock: false },
    };
    const perf = [
      { exposureId: 'aapl', startValue: 100, endValue: 120, netFlow: 0, gain: 20, pct: 20 },
      { exposureId: 'brk', startValue: 100, endValue: 90, netFlow: 0, gain: -10, pct: -10 },
      { exposureId: 'sp500', startValue: 200, endValue: 210, netFlow: 0, gain: 10, pct: 5 },
    ];
    const bySlot = Object.fromEntries(slotPerformance({ performance: perf, exposures, ownStock: {} }).map((p) => [p.slotKey, p]));
    expect(bySlot.stocks).toMatchObject({ startValue: 200, endValue: 210, gain: 10, pct: 5 });
    expect(bySlot.sp500).toMatchObject({ gain: 10, pct: 5 });
  });
});

describe('cumulativeGain', () => {
  it('is the value above the net principal, as a share of the principal', () => {
    expect(cumulativeGain({ date: '2026-09-29', value: 110, principal: 100 })).toEqual({ gain: 10, pct: 10 });
    expect(cumulativeGain({ date: '2026-09-29', value: 90, principal: 100 })).toEqual({ gain: -10, pct: -10 });
  });

  it('has no percentage when the net principal is not positive', () => {
    expect(cumulativeGain({ date: '2026-09-29', value: 50, principal: 0 })).toEqual({ gain: 50, pct: null });
    expect(cumulativeGain({ date: '2026-09-29', value: 50, principal: -20 })).toEqual({ gain: 70, pct: null });
  });
});
