import { describe, expect, it } from 'vitest';
import { addPendingRow, openingTransactions, OWN_STOCK, ownStockExposure, targetsFromCost } from './onboarding';
import type { OnbAccount, OnbForm, OnbPosition } from './onboarding';
import type { Exposure, Instrument } from './types';

const exposure = (id: string, isStock = false): Exposure => ({ id, name: id, groupId: 'g', isStock });
const exposures: Record<string, Exposure> = Object.fromEntries(['sp500', 'ndx', 'csi300', 'usd', 'cny'].map((id) => [id, exposure(id)]));
exposures.aapl = exposure('aapl', true);
const inst = (code: string, market: Instrument['market'], currency: Instrument['currency'], exposureId: string): Instrument => ({
  code,
  name: code,
  market,
  currency,
  exposureId,
  paysDividend: false,
});
const catalog = [
  inst('VOO', '美股', 'USD', 'sp500'),
  inst('513500', 'A股', 'CNY', 'sp500'),
  inst('AAPL', '美股', 'USD', 'aapl'),
  inst('USD', '现金', 'USD', 'usd'),
  inst('CNY', '现金', 'CNY', 'cny'),
];
const find = (code: string) => catalog.find((i) => i.code === code) ?? null;
const instruments = Object.fromEntries(catalog.map((i) => [i.code, i]));
const form = (code: string, qty: string, cost: string, exposureId = 'sp500', market: OnbForm['market'] = 'A股'): OnbForm => ({ code, qty, cost, exposureId, market });
const fx = { CNY: 1, USD: 7, HKD: 0.9 };
const futu: OnbAccount = { id: 'a1', name: '富途', type: 'broker', currency: 'USD' };
const cms: OnbAccount = { id: 'a2', name: '招商证券', type: 'broker', currency: 'CNY' };

describe('the row being typed', () => {
  it('is nothing when all three boxes are empty', () => {
    expect(addPendingRow(form('', '', ''), 'a1', [], find)).toEqual({ kind: 'empty' });
    expect(addPendingRow(form(' ', ' ', ''), 'a1', [], find)).toEqual({ kind: 'empty' });
  });

  it('is an error when only part of it is filled, or the numbers are not positive', () => {
    for (const f of [form('VOO', '', ''), form('', '10', '500'), form('VOO', '0', '500'), form('VOO', '10', '-1'), form('VOO', 'abc', '500')]) {
      expect(addPendingRow(f, 'a1', [], find)).toEqual({ kind: 'error', error: 'incompleteRow' });
    }
  });

  it('sends cash to the cash box', () => {
    expect(addPendingRow(form('usd', '100', '1'), 'a1', [], find)).toEqual({ kind: 'error', error: 'cashInBalance' });
  });

  it('adds a known code, replacing an earlier row for the same code in the same account', () => {
    const first = addPendingRow(form(' voo ', '10', '500'), 'a1', [], find);
    expect(first.kind).toBe('added');
    const positions = first.kind === 'added' ? first.positions : [];
    expect(positions).toEqual([{ accountId: 'a1', code: 'VOO', qty: 10, cost: 500, instrument: catalog[0] }]);
    expect(first.kind === 'added' && first.form).toEqual(form('', '', ''));
    const again = addPendingRow(form('VOO', '12', '510'), 'a1', positions, find);
    const elsewhere = addPendingRow(form('VOO', '3', '600'), 'a2', positions, find);
    expect(again.kind === 'added' && again.positions.map((p) => [p.accountId, p.qty])).toEqual([['a1', 12]]);
    expect(elsewhere.kind === 'added' && elsewhere.positions.map((p) => [p.accountId, p.qty])).toEqual([
      ['a1', 10],
      ['a2', 3],
    ]);
  });

  it('makes an unknown code an instrument of the chosen asset and market', () => {
    const us = addPendingRow(form('XYZ', '5', '20', 'ndx'), 'a1', [], find);
    expect(us.kind === 'added' && us.positions[0]!.instrument).toEqual({ code: 'XYZ', name: '', market: '美股', currency: 'USD', exposureId: 'ndx', paysDividend: false });
    // A 6-digit code could be an A-share or a mutual fund: use the one picked in the form
    const fund = addPendingRow(form('161125', '1000', '2.5', 'sp500', '场外基金'), 'a2', [], find);
    expect(fund.kind === 'added' && fund.positions[0]!.instrument).toMatchObject({ market: '场外基金', currency: 'CNY', exposureId: 'sp500' });
    const share = addPendingRow(form('600036', '100', '30', 'csi300', 'A股'), 'a2', [], find);
    expect(share.kind === 'added' && share.positions[0]!.instrument).toMatchObject({ market: 'A股', currency: 'CNY' });
  });

  // With a single stock held (e.g. Microsoft), it can be listed as an asset of its own
  it('can list an unknown code as a stock of its own', () => {
    const r = addPendingRow(form('MSFT', '4', '400', OWN_STOCK), 'a1', [], find);
    expect(r.kind === 'added' && r.positions[0]!.instrument.exposureId).toBe(ownStockExposure('MSFT').id);
    expect(ownStockExposure('MSFT')).toEqual({ id: 'stock-MSFT', name: 'MSFT', groupId: 'stk', isStock: true });
  });
});

describe('opening records', () => {
  const positions: OnbPosition[] = [
    { accountId: 'a1', code: 'VOO', qty: 10, cost: 500, instrument: catalog[0]! },
    { accountId: 'a2', code: '513500', qty: 1000, cost: 2, instrument: catalog[1]! },
  ];
  let n = 0;
  const newId = () => `id-${++n}`;

  it('writes one opening per holding and per cash balance, priced at cost', () => {
    const txs = openingTransactions({ date: '2026-10-02', createdAt: '2026-10-02T02:00:00.000Z', accounts: [futu, cms], positions, cash: { a1: 300, a2: 0 }, fx, newId });
    expect(txs.map((t) => [t.type, t.accountId, t.instrumentCode, t.qty, t.price, t.fxToCny])).toEqual([
      ['opening', 'a1', 'VOO', 10, 500, 7],
      ['opening', 'a1', 'USD', 300, 1, 7],
      ['opening', 'a2', '513500', 1000, 2, 1],
    ]);
    expect(new Set(txs.map((t) => t.id)).size).toBe(3);
    expect(txs.every((t) => t.date === '2026-10-02' && t.fee === 0)).toBe(true);
    // Net invested principal = total cost (CNY)
    expect(txs.reduce((sum, t) => sum + t.qty * t.price * t.fxToCny, 0)).toBe(10 * 500 * 7 + 300 * 7 + 1000 * 2);
  });
});

describe('targets from what was entered', () => {
  const p = (code: string, qty: number, cost: number): OnbPosition => ({ accountId: 'a1', code, qty, cost, instrument: find(code)! });

  it('splits by cost in yuan and adds up to exactly 100', () => {
    // Three equal parts: 33 + 33 + 33 = 99, and the missing 1 goes to the largest
    const t = targetsFromCost({ positions: [p('VOO', 1, 100), p('AAPL', 1, 100)], cash: { a2: 700 }, accounts: [futu, cms], instruments, exposures, ownStock: {}, fx });
    expect(Object.values(t).reduce((a, b) => a + b, 0)).toBe(100);
    expect(t).toEqual({ sp500: 34, stocks: 33, cny: 33 });
  });

  it('lets a stock with its own target keep it, and is empty with nothing entered', () => {
    const t = targetsFromCost({ positions: [p('VOO', 1, 100), p('AAPL', 1, 100)], cash: {}, accounts: [futu], instruments, exposures, ownStock: { aapl: true }, fx });
    expect(t).toEqual({ sp500: 50, aapl: 50 });
    expect(targetsFromCost({ positions: [], cash: {}, accounts: [futu], instruments, exposures, ownStock: {}, fx })).toEqual({});
  });

  it('is all cash when only cash was entered', () => {
    expect(targetsFromCost({ positions: [], cash: { a1: 100 }, accounts: [futu], instruments, exposures, ownStock: {}, fx })).toEqual({ usd: 100 });
  });
});
