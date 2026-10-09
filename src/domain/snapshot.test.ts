import { describe, expect, it } from 'vitest';
import { computeSnapshot } from './snapshot';
import type { Exposure, Instrument, Transaction } from './types';

const exposure = (id: string, isStock = false): Exposure => ({ id, name: id, groupId: 'g', isStock });
const exposures = Object.fromEntries(['sp500', 'moutai', 'gold', 'usd', 'cny'].map((id) => [id, exposure(id, id === 'moutai')]));
const inst = (code: string, market: Instrument['market'], currency: Instrument['currency'], exposureId: string): Instrument => ({
  code,
  name: code,
  market,
  currency,
  exposureId,
  paysDividend: false,
});
const instruments = Object.fromEntries(
  [
    inst('CNY', '现金', 'CNY', 'cny'),
    inst('USD', '现金', 'USD', 'usd'),
    inst('VOO', '美股', 'USD', 'sp500'),
    inst('513500', 'A股', 'CNY', 'sp500'),
    inst('600519', 'A股', 'CNY', 'moutai'),
    inst('GLD', '美股', 'USD', 'gold'),
  ].map((i) => [i.code, i]),
);

let n = 0;
const tx = (date: string, type: Transaction['type'], accountId: string, instrumentCode: string, qty: number, price: number, fxToCny: number): Transaction => ({
  id: `t${++n}`,
  date,
  createdAt: `${date}T08:00:00.000Z`,
  type,
  accountId,
  instrumentCode,
  qty,
  price,
  fee: 0,
  fxToCny,
});
const transactions: Transaction[] = [
  tx('2026-09-01', 'opening', 'cmb', 'CNY', 10000, 1, 1),
  tx('2026-09-01', 'opening', 'futu', 'USD', 1000, 1, 7.1),
  tx('2026-09-01', 'opening', 'futu', 'VOO', 2, 500, 7.1),
  tx('2026-09-10', 'buy', 'cmb', '513500', 1000, 2, 1),
  tx('2026-09-20', 'deposit', 'cmb', 'CNY', 5000, 1, 1),
  tx('2026-09-25', 'buy', 'cmb', '600519', 1, 1200, 1),
  tx('2026-09-28', 'sell', 'cmb', '600519', 1, 1250, 1),
  tx('2026-09-29', 'buy', 'futu', 'GLD', 1, 200, 7.1),
  tx('2026-10-02', 'deposit', 'cmb', 'CNY', 99999, 1, 1),
];
const prices = { VOO: 700, '513500': 2.5 };
const fx = { CNY: 1, USD: 7, HKD: 0.9 };

describe('snapshot of one day', () => {
  it('values every held asset in yuan, cash included, and adds them up', () => {
    const r = computeSnapshot({ date: '2026-09-30', transactions, instruments, exposures, prices, fx });
    // CNY cash 10000 − 2000 + 5000 − 1200 + 1250; USD cash 1000 − 200; VOO 2 × 700; 513500 1000 × 2.5; GLD has no price, so at cost 200
    expect(r.items).toEqual([
      { date: '2026-09-30', exposureId: 'cny', valueCny: 13050 },
      { date: '2026-09-30', exposureId: 'gold', valueCny: 1400 },
      { date: '2026-09-30', exposureId: 'sp500', valueCny: 9800 + 2500 },
      { date: '2026-09-30', exposureId: 'usd', valueCny: 5600 },
    ]);
    expect(r.snapshot).toEqual({ date: '2026-09-30', totalValueCny: 13050 + 1400 + 12300 + 5600, netInvestedCny: 10000 + 7100 + 7100 + 5000, usdCny: 7 });
  });

  it('counts only records made on or before that day', () => {
    const r = computeSnapshot({ date: '2026-09-25', transactions, instruments, exposures, prices, fx });
    // Moutai not sold yet and without a price, so at cost 1200; gold not bought yet
    expect(r.items.map((i) => [i.exposureId, i.valueCny])).toEqual([
      ['cny', 11800],
      ['moutai', 1200],
      ['sp500', 12300],
      ['usd', 7000],
    ]);
    expect(r.snapshot.netInvestedCny).toBe(29200);
  });

  it('is empty before the first record', () => {
    expect(computeSnapshot({ date: '2026-08-31', transactions, instruments, exposures, prices, fx })).toEqual({
      snapshot: { date: '2026-08-31', totalValueCny: 0, netInvestedCny: 0, usdCny: 7 },
      items: [],
    });
  });
});
