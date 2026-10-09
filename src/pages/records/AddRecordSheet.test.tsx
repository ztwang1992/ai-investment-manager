// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../app/store';
import type { AppState } from '../../app/store';
import { MARKET } from '../../domain/types';
import { RecordsPage } from './RecordsPage';

// In the sample data Futu (the first account, selected by default) has $8,000 of USD cash and 120 VOO, no CNY cash and no QQQ.

let initial: AppState;
beforeEach(() => {
  initial = useAppStore.getState();
});
afterEach(() => {
  cleanup();
  useAppStore.setState(initial, true);
});

const state = () => useAppStore.getState();
const count = () => state().transactions.length;
const sheet = () => screen.getByRole('dialog', { name: 'Add record' });
const reopen = () => fireEvent.click(screen.getByRole('button', { name: 'Add record' }));
const open = () => {
  render(<RecordsPage />);
  reopen();
};
const pick = (type: 'Buy' | 'Sell' | 'Deposit' | 'Withdrawal') => fireEvent.click(within(sheet()).getByRole('radio', { name: type }));
const fill = (label: string | RegExp, value: string) =>
  fireEvent.change(within(sheet()).getByLabelText(label), { target: { value } });
const save = () => fireEvent.click(within(sheet()).getByRole('button', { name: 'Save' }));
const trade = (code: string, qty: string, price: string, fee = '') => {
  fill('Code', code);
  fill('Quantity', qty);
  fill(/^Price/, price);
  if (fee) fill('Fee', fee);
};
const firstRow = () => document.querySelector('.rec-row')!.textContent;

const unknown = 'Not recognized. Choose its underlying asset';

describe('Add record · buy', () => {
  it('pays from the account cash', () => {
    open();
    const before = count();
    trade('VOO', '5', '500', '1');
    save();
    expect(count()).toBe(before + 1);
    expect(state().transactions.at(-1)).toMatchObject({
      type: 'buy',
      accountId: 'futu',
      instrumentCode: 'VOO',
      qty: 5,
      price: 500,
      fee: 1,
      date: '2026-09-29',
    });
    expect(state().toast).toBe('VOO recorded, paid from account cash');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(firstRow()).toBe('VOO Vanguard S&P 500BuyFutu · Sep 295 × $500 · fee 1');
  });

  it('records the shortfall as a deposit', () => {
    open();
    const before = count();
    trade('VOO', '20', '500');
    save();
    expect(state().transactions.slice(before).map((tx) => [tx.type, tx.qty])).toEqual([
      ['deposit', 2000],
      ['buy', 20],
    ]);
    expect(state().toast).toBe('VOO recorded; the $2,000 shortfall was recorded as a deposit');
  });

  it('records a buy in another currency as new money', () => {
    open();
    fill('Code', '513500');
    expect(within(sheet()).getByLabelText('Price CNY')).toBeTruthy();
    expect(within(sheet()).getByText("The instrument's currency differs from the account's, so this buy is recorded as new money in. Fees count toward cost.")).toBeTruthy();
    fill('Quantity', '100');
    fill('Price CNY', '2');
    save();
    expect(state().toast).toBe('513500 recorded as new money in');
  });

  it('recognises preset codes', () => {
    open();
    fill('Code', '513100');
    expect(within(sheet()).getByText('Recognized as Nasdaq 100 · US stock indexes · A-share')).toBeTruthy();
    expect(within(sheet()).queryByLabelText(unknown)).toBeNull();
  });

  it('asks for the underlying asset of an unknown code and remembers it', () => {
    open();
    const before = count();
    trade('abcd', '1', '10');
    save();
    expect(within(sheet()).getByText('Choose an underlying asset')).toBeTruthy();
    expect(count()).toBe(before);
    fill(unknown, 'ndx');
    save();
    expect(state().instruments.filter((i) => i.code === 'ABCD')).toEqual([
      { code: 'ABCD', name: '', market: MARKET.us, currency: 'USD', exposureId: 'ndx', paysDividend: false },
    ]);
    reopen();
    fill('Code', 'ABCD');
    expect(within(sheet()).getByText('Recognized as Nasdaq 100 · US stock indexes · US')).toBeTruthy();
  });

  // A stock you hold (such as Microsoft) can be listed as an asset of its own
  it('can list an unknown code as a stock of its own', () => {
    open();
    trade('msft', '1', '400');
    fill(unknown, '__own_stock__');
    save();
    expect(state().exposures.find((e) => e.id === 'stock-MSFT')).toEqual({ id: 'stock-MSFT', name: 'MSFT', groupId: 'stk', isStock: true });
    expect(state().instruments.find((i) => i.code === 'MSFT')).toMatchObject({ exposureId: 'stock-MSFT', market: MARKET.us, currency: 'USD' });
  });

  // A six-digit code can be an A-share or a mutual fund: the user picks, and only a fund is priced by its NAV
  it('records an unknown six-digit code in the market chosen', () => {
    open();
    fill('Account', 'cms');
    trade('161125', '100', '2.5');
    expect(within(sheet()).getByRole('radiogroup', { name: 'Market' })).toBeTruthy();
    fill(unknown, 'sp500');
    fireEvent.click(within(sheet()).getByRole('radio', { name: 'Mutual fund' }));
    save();
    expect(state().instruments.find((i) => i.code === '161125')).toMatchObject({ market: MARKET.fund, currency: 'CNY', exposureId: 'sp500' });
  });

  it('refuses cash codes', () => {
    open();
    const before = count();
    trade('usd', '1', '1');
    save();
    expect(within(sheet()).getByText('Record cash with Deposit or Withdrawal')).toBeTruthy();
    expect(count()).toBe(before);
  });

  it('asks for the missing fields', () => {
    open();
    save();
    expect(within(sheet()).getByText('Enter a code')).toBeTruthy();
    fill('Code', 'VOO');
    save();
    expect(within(sheet()).getByText('Enter the quantity and price')).toBeTruthy();
    trade('VOO', '1', '500', '-1');
    save();
    expect(within(sheet()).getByText("The fee isn't valid")).toBeTruthy();
  });
});

describe('Add record · sell', () => {
  it('refuses to sell more than the account holds', () => {
    open();
    pick('Sell');
    const before = count();
    trade('VOO', '200', '600');
    save();
    expect(within(sheet()).getByText('This account holds only 120 shares, not enough to sell')).toBeTruthy();
    // Futu has no QQQ
    trade('QQQ', '1', '400');
    save();
    expect(within(sheet()).getByText('This account holds only 0 shares, not enough to sell')).toBeTruthy();
    expect(count()).toBe(before);
  });

  it('adds the proceeds to the account cash', () => {
    open();
    pick('Sell');
    expect(within(sheet()).getByText("Proceeds after fees go to the account's cash and leave the principal line alone.")).toBeTruthy();
    trade('VOO', '10', '600');
    save();
    expect(state().toast).toBe('VOO recorded; the proceeds went to account cash');
  });
});

describe('Add record · deposit and withdrawal', () => {
  it('records money in and never takes out more than the cash', () => {
    open();
    pick('Deposit');
    fill('Amount ($)', '10000');
    save();
    expect(state().toast).toBe('Deposit of $10,000 recorded · principal line updated');
    expect(firstRow()).toBe('Money inDepositFutu · Sep 29+$10,000');
    reopen();
    pick('Withdrawal');
    expect(within(sheet()).getByText('Money leaving the portfolio lowers the principal line. Account cash now $18,000.')).toBeTruthy();
    fill('Amount ($)', '20000');
    save();
    expect(within(sheet()).getByText('Account cash is only $18,000, not enough to withdraw')).toBeTruthy();
  });

  it('hides amounts in hints and errors when the eye is closed', () => {
    useAppStore.setState({ hideAmounts: true });
    open();
    pick('Withdrawal');
    expect(within(sheet()).getByText('Money leaving the portfolio lowers the principal line. Account cash now ••••.')).toBeTruthy();
    fill('Amount ($)', '9000');
    save();
    expect(within(sheet()).getByText('Account cash is only ••••, not enough to withdraw')).toBeTruthy();
  });

  it('cancels without writing anything', () => {
    open();
    const before = count();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(count()).toBe(before);
  });
});
