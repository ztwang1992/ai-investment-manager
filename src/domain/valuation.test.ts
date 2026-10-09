import { describe, expect, it } from 'vitest';
import { totalValue, valueHoldings } from './valuation';
import type { Holding } from './ledger';
import type { Exposure, FxRates, Instrument } from './types';

const instruments: Record<string, Instrument> = {
  VOO: { code: 'VOO', name: 'Vanguard 标普500', market: '美股', currency: 'USD', exposureId: 'sp500', paysDividend: true },
  '513500': { code: '513500', name: '标普500ETF', market: 'A股', currency: 'CNY', exposureId: 'sp500', paysDividend: true },
  USD: { code: 'USD', name: '美元现金', market: '现金', currency: 'USD', exposureId: 'usd', paysDividend: false },
};
const exposures: Record<string, Exposure> = {
  sp500: { id: 'sp500', name: '标普 500', groupId: 'us', isStock: false },
  usd: { id: 'usd', name: '美元现金', groupId: 'cash', isStock: false },
};
const fx: FxRates = { CNY: 1, USD: 7.1, HKD: 0.91 };

describe('valueHoldings', () => {
  it('values securities at price × fx and converts cost at the current rate', () => {
    const holdings: Holding[] = [{ accountId: 'futu', code: 'VOO', qty: 10, cost: 5000 }];
    const [row] = valueHoldings({ holdings, instruments, exposures, prices: { VOO: 540 }, fx });
    expect(row).toMatchObject({ code: 'VOO', price: 540, priceMissing: false, valueCny: 38340, costCny: 35500 });
    expect(row!.exposure.id).toBe('sp500');
    expect(row!.instrument.market).toBe('美股');
  });

  it('values cash at 1 without needing a price', () => {
    const holdings: Holding[] = [{ accountId: 'futu', code: 'USD', qty: 1000, cost: 1000 }];
    const [row] = valueHoldings({ holdings, instruments, exposures, prices: {}, fx });
    expect(row).toMatchObject({ price: 1, priceMissing: false, valueCny: 7100 });
  });

  it('falls back to the average cost when a price is missing', () => {
    const holdings: Holding[] = [{ accountId: 'cms', code: '513500', qty: 1000, cost: 1800 }];
    const [row] = valueHoldings({ holdings, instruments, exposures, prices: {}, fx });
    expect(row).toMatchObject({ price: 1.8, priceMissing: true, valueCny: 1800 });
  });

  it('skips holdings whose instrument is unknown (the ledger already flags them)', () => {
    const holdings: Holding[] = [{ accountId: 'futu', code: 'XYZ', qty: 1, cost: 1 }];
    expect(valueHoldings({ holdings, instruments, exposures, prices: {}, fx })).toEqual([]);
  });
});

describe('totalValue', () => {
  it('sums the CNY values', () => {
    const holdings: Holding[] = [
      { accountId: 'futu', code: 'VOO', qty: 10, cost: 5000 },
      { accountId: 'futu', code: 'USD', qty: 1000, cost: 1000 },
    ];
    expect(totalValue(valueHoldings({ holdings, instruments, exposures, prices: { VOO: 540 }, fx }))).toBe(45440);
    expect(totalValue([])).toBe(0);
  });
});
