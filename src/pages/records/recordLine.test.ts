import { describe, expect, it } from 'vitest';
import { CALIBRATION_REASON } from '../../domain/record';
import { currencyLookup, deriveLedger } from '../../domain/ledger';
import type { Transaction } from '../../domain/types';
import { MESSAGES } from '../../i18n';
import * as mock from '../../mock';
import { formatPrice, recordLine } from './recordLine';

const ledger = deriveLedger(mock.transactions, currencyLookup(mock.instrumentByCode));
const ACCOUNTS: Record<string, string> = { cms: 'China Merchants Securities', futu: 'Futu', ft: 'Firstrade' };
const ctx = {
  instrumentByCode: mock.instrumentByCode,
  accountName: (id: string) => ACCOUNTS[id] ?? id,
  calibrationDiffs: ledger.calibrationDiffs,
  hide: false,
  t: MESSAGES.en,
};
const find = (date: string, type: Transaction['type'], code?: string) =>
  mock.transactions.find((tx) => tx.date === date && tx.type === type && (!code || tx.instrumentCode === code))!;
const line = (tx: Transaction, hide = false) => {
  const { id, ...rest } = recordLine(tx, { ...ctx, hide });
  expect(id).toBe(tx.id);
  return rest;
};

describe('recordLine', () => {
  it('shows trades as shares × price', () => {
    expect(line(find('2026-09-18', 'buy'))).toEqual({
      title: '513500 标普500ETF',
      typeLabel: 'Buy',
      tone: 'gain',
      meta: 'China Merchants Securities · Sep 18',
      amount: '10,000 × ¥2.05',
    });
    expect(line(find('2026-08-15', 'sell'))).toMatchObject({ title: 'AAPL Apple', typeLabel: 'Sell', tone: 'loss', amount: '20 × $225' });
    expect(line(find('2025-06-16', 'buy'))).toMatchObject({ amount: '20 × ¥1,580' });
    expect(line({ ...find('2026-09-02', 'buy'), fee: 1.5 })).toMatchObject({ amount: '10 × $528 · fee 1.5' });
  });

  it('shows money in and out with its reason', () => {
    // The reason goes in note: on a narrow screen it wraps to its own line instead of squeezing "account · date"
    expect(line(find('2026-09-18', 'deposit'))).toEqual({
      title: 'Money in',
      typeLabel: 'Deposit',
      tone: 'gain',
      meta: 'China Merchants Securities · Sep 18',
      amount: '+¥20,500',
      note: 'Auto deposit to cover a buy',
    });
    expect(line(find('2026-08-20', 'withdraw'))).toEqual({
      title: 'Money out',
      typeLabel: 'Withdrawal',
      tone: 'loss',
      meta: 'Firstrade · Aug 20',
      amount: '−$4,500',
    });
  });

  it('shows the share difference a calibration made, worked out from the ledger', () => {
    const calib = find('2026-06-20', 'calibrate');
    expect(line(calib)).toMatchObject({ title: 'VOO Vanguard S&P 500', typeLabel: 'Calibration', tone: 'neutral', amount: '+0.84 shares', note: 'Dividends reinvested' });
    expect(recordLine(calib, { ...ctx, calibrationDiffs: { [calib.id]: 0 } })).toMatchObject({ amount: 'No change in shares', note: 'Checked' });
    expect(recordLine({ ...calib, reason: CALIBRATION_REASON.split }, { ...ctx, calibrationDiffs: { [calib.id]: -2 } })).toMatchObject({
      amount: '−2 shares',
      note: 'Stock split',
    });
  });

  it('labels opening records and shows cash as a balance', () => {
    expect(line(find('2025-01-02', 'opening', 'VOO'))).toEqual({
      title: 'VOO Vanguard S&P 500',
      typeLabel: 'Opening entry',
      tone: 'neutral',
      meta: 'Futu · Jan 2',
      amount: '109.16 × $450',
    });
    expect(line(find('2025-01-02', 'opening', 'USD'))).toMatchObject({ title: 'USD USD cash', amount: '$13,280' });
  });

  it('shows only the code for an instrument without a name', () => {
    const tx = { ...find('2026-09-02', 'buy'), instrumentCode: 'ABCD' };
    const instrumentByCode = { ...mock.instrumentByCode, ABCD: { ...mock.instrumentByCode.VOO!, code: 'ABCD', name: '' } };
    expect(recordLine(tx, { ...ctx, instrumentByCode }).title).toBe('ABCD');
  });

  it('hides every amount, with its note, when the eye is closed', () => {
    for (const tx of mock.transactions) {
      const hidden = recordLine(tx, { ...ctx, hide: true });
      expect(hidden.amount).toBe('••••');
      expect(hidden.note).toBeUndefined();
    }
  });

  it('reads as before in Chinese', () => {
    const zh = { ...ctx, accountName: (id: string) => mock.accountById[id]?.name ?? id, t: MESSAGES.zh };
    expect(recordLine(find('2026-09-18', 'deposit'), zh)).toMatchObject({ title: '转入资金', typeLabel: '入金', meta: '招商证券 · 09-18', note: '买入时现金不足自动补记' });
    expect(recordLine(find('2025-01-02', 'opening', 'VOO'), zh)).toMatchObject({ title: 'VOO Vanguard 标普500', typeLabel: '期初录入' });
  });
});

describe('labels', () => {
  it('writes the month and the price', () => {
    expect(MESSAGES.en.records.month('2026-09')).toBe('September 2026');
    expect(MESSAGES.zh.records.month('2025-01')).toBe('2025 年 1 月');
    expect(formatPrice(1580)).toBe('1,580');
    expect(formatPrice(2.05)).toBe('2.05');
    expect(formatPrice(4.61237)).toBe('4.6124');
  });
});
