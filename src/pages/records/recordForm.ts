import { CURRENCY_SYMBOL, MASK, formatQty } from '../../app/format';
import { guessCurrency } from '../../domain/instruments';
import type { RecordError } from '../../domain/record';
import type { Account, CashCurrency, Exposure, ExposureGroup, Instrument, Transaction } from '../../domain/types';
import type { Messages } from '../../i18n';

// Hints, errors and the toast after saving in the Add record sheet (prototype lines 757–790, 1154–1157).
// The buy hint looks at the account's cash in that currency (README「记一笔」); a sale that is too big names the shares held.

export type EntryType = 'buy' | 'sell' | 'deposit' | 'withdraw';
export type FormError = RecordError | { kind: 'missing_code' } | { kind: 'missing_exposure' };

const money = (amount: number, currency: CashCurrency, hide: boolean) =>
  hide ? MASK : `${CURRENCY_SYMBOL[currency]}${formatQty(amount)}`;

/** A recognized instrument's own currency; a guess from the code otherwise; the account's before a code is typed. */
export function entryCurrency(code: string, found: Instrument | null, account: Account): CashCurrency {
  if (found) return found.currency;
  return code.trim() ? guessCurrency(code) : account.currency;
}

export function tradeHint(
  i: {
    type: 'buy' | 'sell';
    account: Account;
    currency: CashCurrency;
    cash: number;
    hide: boolean;
  },
  t: Messages,
): string {
  const sameCurrency = i.currency === i.account.currency;
  if (i.type === 'sell') return sameCurrency ? t.records.hints.sellSameCurrency : t.records.hints.sellOtherCurrency;
  return sameCurrency || i.cash > 0
    ? t.records.hints.buyFromCash(i.account.name, i.currency, money(i.cash, i.currency, i.hide))
    : t.records.hints.buyAsNewMoney;
}

export function cashHint(i: { type: 'deposit' | 'withdraw'; account: Account; cash: number; hide: boolean }, t: Messages): string {
  return i.type === 'deposit' ? t.records.hints.deposit : t.records.hints.withdraw(money(i.cash, i.account.currency, i.hide));
}

export function recognizedText(instrument: Instrument, exposure: Exposure, group: ExposureGroup, t: Messages): string {
  return t.records.hints.recognized(t.names.exposure(exposure), t.names.group(group), t.common.markets[instrument.market]);
}

export function formErrorText(error: FormError, hide: boolean, t: Messages): string {
  const e = t.records.errors;
  switch (error.kind) {
    case 'missing_code':
      return e.codeRequired;
    case 'invalid_trade':
      return e.qtyPriceRequired;
    case 'invalid_fee':
      return e.badFee;
    case 'missing_exposure':
      return e.exposureRequired;
    case 'cash_trade':
      return e.cashTrade;
    case 'insufficient_holding':
      return e.notEnoughShares(hide ? MASK : formatQty(error.available));
    case 'invalid_amount':
      return e.amountRequired;
    case 'insufficient_cash':
      return e.notEnoughCash(money(error.available, error.currency, hide));
  }
}

export function savedMessage(
  i: {
    type: EntryType;
    code: string;
    account: Account;
    /** The instrument's currency for a trade; the account's for money in or out */
    currency: CashCurrency;
    /** The account's cash in that currency before recording */
    cashBefore: number;
    /** The records just written */
    transactions: readonly Transaction[];
    hide: boolean;
  },
  t: Messages,
): string {
  const auto = (type: 'deposit' | 'withdraw') => i.transactions.find((tx) => tx.type === type);
  const s = t.records.saved;
  switch (i.type) {
    case 'deposit':
    case 'withdraw':
      return s.cash(i.type === 'deposit', money(i.transactions[0]!.qty, i.currency, i.hide));
    case 'buy': {
      const deposit = auto('deposit');
      if (!deposit) return s.buyFromCash(i.code);
      if (i.currency !== i.account.currency && i.cashBefore <= 0) return s.buyAsNewMoney(i.code);
      return s.buyWithTopUp(i.code, money(deposit.qty, i.currency, i.hide));
    }
    case 'sell':
      return auto('withdraw') ? s.sellWithdrawn(i.code) : s.sellToCash(i.code);
  }
}
