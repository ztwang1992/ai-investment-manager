import { describe, expect, it } from 'vitest';
import type { Transaction } from '../../domain/types';
import { MESSAGES } from '../../i18n';
import * as mock from '../../mock';
import { cashHint, entryCurrency, formErrorText, recognizedText, savedMessage, tradeHint } from './recordForm';

const en = MESSAGES.en;
const futu = { ...mock.accountById.futu!, name: 'Futu' }; // a USD broker
const cms = { ...mock.accountById.cms!, name: 'China Merchants Securities' }; // a CNY broker
const tx = (type: Transaction['type'], qty: number, code = 'USD'): Transaction => ({
  id: `${type}-${code}`,
  date: '2026-09-29',
  createdAt: '2026-09-29T01:00:00.000Z',
  type,
  accountId: 'futu',
  instrumentCode: code,
  qty,
  price: 1,
  fee: 0,
  fxToCny: 7.1,
});

describe('tradeHint', () => {
  it('buys from the cash of the instrument currency when the account has it', () => {
    expect(tradeHint({ type: 'buy', account: futu, currency: 'USD', cash: 8000, hide: false }, en)).toBe(
      "Paid from Futu's USD cash (now $8,000); any shortfall is recorded as a deposit.",
    );
    expect(tradeHint({ type: 'buy', account: futu, currency: 'CNY', cash: 500, hide: false }, en)).toBe(
      "Paid from Futu's CNY cash (now ¥500); any shortfall is recorded as a deposit.",
    );
    expect(tradeHint({ type: 'buy', account: futu, currency: 'CNY', cash: 0, hide: false }, en)).toBe(
      "The instrument's currency differs from the account's, so this buy is recorded as new money in. Fees count toward cost.",
    );
    expect(tradeHint({ type: 'buy', account: futu, currency: 'USD', cash: 8000, hide: true }, en)).toBe(
      "Paid from Futu's USD cash (now ••••); any shortfall is recorded as a deposit.",
    );
  });

  it('sells into the account cash, or out of the portfolio in another currency', () => {
    expect(tradeHint({ type: 'sell', account: futu, currency: 'USD', cash: 0, hide: false }, en)).toBe(
      "Proceeds after fees go to the account's cash and leave the principal line alone.",
    );
    expect(tradeHint({ type: 'sell', account: futu, currency: 'CNY', cash: 0, hide: false }, en)).toBe('The proceeds are recorded as a withdrawal.');
  });
});

describe('cashHint', () => {
  it('explains what money in and out does to the principal line', () => {
    expect(cashHint({ type: 'deposit', account: futu, cash: 8000, hide: false }, en)).toBe(
      'Money coming in from outside the portfolio, such as salary or savings, raises the principal line on Returns.',
    );
    expect(cashHint({ type: 'withdraw', account: futu, cash: 8000, hide: false }, en)).toBe(
      'Money leaving the portfolio lowers the principal line. Account cash now $8,000.',
    );
    expect(cashHint({ type: 'withdraw', account: cms, cash: 0, hide: false }, en)).toBe('Money leaving the portfolio lowers the principal line. Account cash now ¥0.');
    expect(cashHint({ type: 'withdraw', account: futu, cash: 8000, hide: true }, en)).toBe(
      'Money leaving the portfolio lowers the principal line. Account cash now ••••.',
    );
  });
});

describe('recognizedText / entryCurrency', () => {
  it('names the underlying asset, its group and the market', () => {
    const inst = mock.instrumentByCode['513100']!;
    expect(recognizedText(inst, mock.exposureById.ndx!, mock.groups.find((g) => g.id === 'us')!, en)).toBe(
      'Recognized as Nasdaq 100 · US stock indexes · A-share',
    );
  });

  it('prices in the instrument currency, a guess for unknown codes, or the account currency before a code is typed', () => {
    expect(entryCurrency('', null, cms)).toBe('CNY');
    expect(entryCurrency('513100', mock.instrumentByCode['513100']!, futu)).toBe('CNY');
    expect(entryCurrency('ABCD', null, cms)).toBe('USD');
  });
});

describe('formErrorText', () => {
  it('explains each problem', () => {
    expect(formErrorText({ kind: 'missing_code' }, false, en)).toBe('Enter a code');
    expect(formErrorText({ kind: 'invalid_trade' }, false, en)).toBe('Enter the quantity and price');
    expect(formErrorText({ kind: 'invalid_fee' }, false, en)).toBe("The fee isn't valid");
    expect(formErrorText({ kind: 'missing_exposure' }, false, en)).toBe('Choose an underlying asset');
    expect(formErrorText({ kind: 'cash_trade' }, false, en)).toBe('Record cash with Deposit or Withdrawal');
    expect(formErrorText({ kind: 'insufficient_holding', available: 120 }, false, en)).toBe('This account holds only 120 shares, not enough to sell');
    expect(formErrorText({ kind: 'invalid_amount' }, false, en)).toBe('Enter an amount');
    expect(formErrorText({ kind: 'insufficient_cash', available: 8000, currency: 'USD' }, false, en)).toBe(
      'Account cash is only $8,000, not enough to withdraw',
    );
  });

  it('hides balances when the eye is closed', () => {
    expect(formErrorText({ kind: 'insufficient_holding', available: 120 }, true, en)).toBe('This account holds only •••• shares, not enough to sell');
    expect(formErrorText({ kind: 'insufficient_cash', available: 8000, currency: 'USD' }, true, en)).toBe('Account cash is only ••••, not enough to withdraw');
  });
});

describe('savedMessage', () => {
  const base = { code: 'VOO', account: futu, currency: 'USD' as const, cashBefore: 8000, hide: false };

  it('says where the money for a buy came from', () => {
    expect(savedMessage({ ...base, type: 'buy', transactions: [tx('buy', 5, 'VOO')] }, en)).toBe('VOO recorded, paid from account cash');
    expect(savedMessage({ ...base, type: 'buy', transactions: [tx('deposit', 2000), tx('buy', 20, 'VOO')] }, en)).toBe(
      'VOO recorded; the $2,000 shortfall was recorded as a deposit',
    );
    const cny = { ...base, code: '513500', currency: 'CNY' as const };
    expect(savedMessage({ ...cny, type: 'buy', cashBefore: 0, transactions: [tx('deposit', 200, 'CNY'), tx('buy', 100, '513500')] }, en)).toBe(
      '513500 recorded as new money in',
    );
    expect(savedMessage({ ...cny, type: 'buy', cashBefore: 50, transactions: [tx('deposit', 150, 'CNY'), tx('buy', 100, '513500')] }, en)).toBe(
      '513500 recorded; the ¥150 shortfall was recorded as a deposit',
    );
  });

  it('says where the proceeds of a sale went', () => {
    expect(savedMessage({ ...base, type: 'sell', transactions: [tx('sell', 10, 'VOO')] }, en)).toBe('VOO recorded; the proceeds went to account cash');
    expect(
      savedMessage({ ...base, type: 'sell', code: '513500', currency: 'CNY', transactions: [tx('sell', 10, '513500'), tx('withdraw', 20, 'CNY')] }, en),
    ).toBe('513500 recorded; the proceeds were recorded as a withdrawal');
  });

  it('confirms money in and out, hiding amounts when asked', () => {
    expect(savedMessage({ ...base, type: 'deposit', code: '', transactions: [tx('deposit', 10000)] }, en)).toBe(
      'Deposit of $10,000 recorded · principal line updated',
    );
    expect(savedMessage({ ...base, type: 'withdraw', code: '', transactions: [tx('withdraw', 500)] }, en)).toBe(
      'Withdrawal of $500 recorded · principal line updated',
    );
    expect(savedMessage({ ...base, type: 'deposit', code: '', hide: true, transactions: [tx('deposit', 10000)] }, en)).toBe(
      'Deposit of •••• recorded · principal line updated',
    );
    expect(savedMessage({ ...base, type: 'buy', hide: true, transactions: [tx('deposit', 2000), tx('buy', 20, 'VOO')] }, en)).toBe(
      'VOO recorded; the •••• shortfall was recorded as a deposit',
    );
  });
});

describe('in Chinese', () => {
  it('reads as before', () => {
    const zh = MESSAGES.zh;
    const futuZh = mock.accountById.futu!;
    expect(tradeHint({ type: 'buy', account: futuZh, currency: 'USD', cash: 8000, hide: false }, zh)).toBe('从富途的USD现金扣款（当前 $8,000），不足部分自动记为入金。');
    expect(recognizedText(mock.instrumentByCode['513100']!, mock.exposureById.ndx!, mock.groups.find((g) => g.id === 'us')!, zh)).toBe(
      '识别为：纳斯达克 100 · 美股指数 · A股',
    );
    expect(formErrorText({ kind: 'insufficient_holding', available: 120 }, false, zh)).toBe('该账户只有 120 份，不够卖出');
    expect(savedMessage({ code: 'VOO', account: futuZh, currency: 'USD', cashBefore: 8000, hide: false, type: 'buy', transactions: [tx('buy', 5, 'VOO')] }, zh)).toBe(
      '已记录 VOO，已从账户现金扣款',
    );
  });
});
