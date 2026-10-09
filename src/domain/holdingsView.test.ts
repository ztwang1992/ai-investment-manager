import { describe, expect, it } from 'vitest';
import { groupByAccount, groupByExposure } from './holdingsView';
import { currencyLookup, deriveLedger } from './ledger';
import { valueHoldings } from './valuation';
import type { Account } from './types';
import * as mock from '../mock';

const ledger = deriveLedger(mock.transactions, currencyLookup(mock.instrumentByCode));
const rows = valueHoldings({ holdings: ledger.holdings, instruments: mock.instrumentByCode, exposures: mock.exposureById, prices: mock.prices, fx: mock.fx });

describe('groupByExposure', () => {
  const view = groupByExposure({ rows, groups: mock.groups, exposures: mock.exposures });
  const exposure = (id: string) => view.flatMap((g) => g.exposures).find((e) => e.exposureId === id)!;

  it('merges VOO, 513500 and the QDII fund under the S&P 500 asset across five accounts', () => {
    const sp500 = exposure('sp500');
    expect(sp500.instruments.map((i) => i.code)).toEqual(['VOO', '513500', '050025']);
    expect(sp500.instrumentCount).toBe(3);
    expect(sp500.accountCount).toBe(5);
    const voo = sp500.instruments[0]!;
    expect(voo.accountCount).toBe(3);
    expect(voo.platforms.map((p) => [p.accountId, p.qty])).toEqual([
      ['futu', 120],
      ['ibkr', 80],
      ['schwab', 60],
    ]);
    expect(voo.valueCny).toBeCloseTo(260 * 540 * 7.1, 6);
  });

  it('reports floating P&L for securities and none for cash', () => {
    expect(exposure('usd').pnlPct).toBeNull();
    expect(exposure('cny').pnlPct).toBeNull();
    const ndx = exposure('ndx');
    expect(ndx.pnlPct).toBeCloseTo(((ndx.valueCny - ndx.costCny) / ndx.costCny) * 100, 9);
  });

  it('keeps the group order, drops empty groups and shares add up to 100%', () => {
    expect(view.map((g) => g.groupId)).toEqual(['us', 'stk', 'intl', 'cn', 'bond', 'gold', 'cash']);
    expect(view.reduce((sum, g) => sum + g.pct, 0)).toBeCloseTo(100, 9);
  });

  it('shows the average cost per platform in the original currency', () => {
    const futu = exposure('sp500').instruments[0]!.platforms[0]!;
    expect(futu.avgCost).toBeCloseTo((109.16 * 450 + 10 * 528) / 120, 9);
  });

  it('returns nothing for an empty portfolio', () => {
    expect(groupByExposure({ rows: [], groups: mock.groups, exposures: mock.exposures })).toEqual([]);
  });
});

describe('groupByAccount', () => {
  it('summarises every account with its share and group composition', () => {
    const view = groupByAccount({ rows, accounts: mock.accounts, groups: mock.groups });
    expect(view.map((a) => a.accountId)).toEqual(['futu', 'ibkr', 'schwab', 'ft', 'cms', 'cmb']);
    expect(view.reduce((sum, a) => sum + a.sharePct, 0)).toBeCloseTo(100, 9);
    const futu = view[0]!;
    expect(futu.itemCount).toBe(2);
    expect(futu.composition.map((c) => c.groupId)).toEqual(['us', 'cash']);
  });

  it('gives each group its share of the account and its span on the ring chart', () => {
    const view = groupByAccount({ rows, accounts: mock.accounts, groups: mock.groups });
    for (const account of view) {
      let from = 0;
      for (const c of account.composition) {
        expect(c.pct).toBeCloseTo((c.valueCny / account.valueCny) * 100, 9);
        expect(c.fromPct).toBe(from);
        expect(c.toPct).toBeCloseTo(from + c.pct, 9);
        from = c.toPct;
      }
      expect(from).toBeCloseTo(100, 9);
    }
  });

  it('keeps accounts without holdings at zero instead of NaN', () => {
    const empty: Account = { id: 'tiger', name: '老虎', type: 'broker', currency: 'USD', market: '美股' };
    const view = groupByAccount({ rows: [], accounts: [empty], groups: mock.groups });
    expect(view).toEqual([{ accountId: 'tiger', valueCny: 0, sharePct: 0, itemCount: 0, composition: [], items: [] }]);
  });
});
