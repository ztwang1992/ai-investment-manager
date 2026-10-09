// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MASK } from '../../app/format';
import { REASON } from '../../domain/record';
import { MARKET } from '../../domain/types';
import { useAppStore } from '../../app/store';
import { INITIAL_SYNC, useSyncStore } from '../../app/sync';
import type { AppState } from '../../app/store';
import { HoldingsPage } from './HoldingsPage';

vi.mock('../../app/download', () => ({ downloadText: vi.fn() }));
const { downloadText } = await import('../../app/download');
vi.mock('../../app/boot', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../app/boot')>()), signOut: vi.fn() }));
const { signOut, useBootStore } = await import('../../app/boot');
const session = {
  user: { id: 'u-1', email: 'me@example.com' },
  aiVault: { load: vi.fn(async () => null), save: vi.fn(async () => {}), clear: vi.fn(async () => {}) },
  syncNow: vi.fn(async () => {}),
  completeOnboarding: vi.fn(async () => {}),
  startDemo: vi.fn(async () => {}),
  endDemo: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
};
const auth = { currentUser: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), signOut: vi.fn() };

let initial: AppState;
beforeEach(() => {
  initial = useAppStore.getState();
  vi.mocked(downloadText).mockClear();
  vi.mocked(signOut).mockClear();
  useBootStore.setState({ kind: 'ready', auth, session }, true);
  useSyncStore.setState(INITIAL_SYNC, true);
});
afterEach(() => {
  cleanup();
  useAppStore.setState(initial, true);
});

const state = () => useAppStore.getState();
const dialog = (name: string) => screen.getByRole('dialog', { name });

// happy-dom gives spans no display, so a button's accessible name has a space between every span
describe('By asset', () => {
  it('opens with S&P 500 expanded, merging VOO, 513500 and the QDII fund', () => {
    render(<HoldingsPage />);
    const sp500 = screen.getByRole('button', { name: /^S&P 500/ });
    expect(sp500.getAttribute('aria-expanded')).toBe('true');
    expect(sp500.textContent).toMatch(/3 instruments · 5 accounts · [\d.]+% of total/);
    expect(screen.getByRole('button', { name: /^VOO Vanguard S&P 500/ }).textContent).toContain('US · USD · 3 accounts');
    expect(screen.getByRole('button', { name: /^513500 / })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^050025 / }).textContent).toContain('Mutual fund · CNY · 1 account · NAV Sep 28');
    expect(screen.getByRole('button', { name: /^Nasdaq 100/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('shows each platform with shares @ average cost, and opens calibration from it', () => {
    render(<HoldingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /^VOO Vanguard S&P 500/ }));
    const futu = screen.getByRole('button', { name: /^Futu 120 @ \$453\.35 ¥/ });
    expect(screen.getByRole('button', { name: /^IBKR 80 @ \$480 ¥/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Schwab 60 @ \$501\.67 ¥/ })).toBeTruthy();
    fireEvent.click(futu);
    expect(within(dialog('Calibrate holding')).getByText('VOO Vanguard S&P 500 · Futu')).toBeTruthy();
    fireEvent.click(within(dialog('Calibrate holding')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('hides amounts and share counts, but keeps percentages and unit costs', () => {
    useAppStore.setState({ hideAmounts: true });
    render(<HoldingsPage />);
    fireEvent.click(screen.getByRole('button', { name: /^VOO Vanguard S&P 500/ }));
    const futu = screen.getByRole('button', { name: /^Futu/ });
    expect(futu.textContent).toBe(`Futu${MASK} @ $453.35${MASK}`);
    expect(screen.getByRole('button', { name: /^S&P 500/ }).textContent).toMatch(/[+−][\d.]+%$/);
  });

  it('shows no gain or loss for cash', () => {
    render(<HoldingsPage />);
    expect(screen.getByRole('button', { name: /^USD cash/ }).textContent).not.toMatch(/%$/);
  });

  it('reads the same in Chinese', () => {
    useAppStore.setState({ locale: 'zh' });
    render(<HoldingsPage />);
    expect(screen.getByRole('button', { name: /^标普 500/ }).textContent).toMatch(/3 个品种 · 5 个账户 · 占 [\d.]+%/);
    expect(screen.getByRole('button', { name: /^050025 / }).textContent).toContain('场外基金 · CNY · 1 个账户 · 净值 09-28');
  });
});

// README「本地优先与同步」: a negative share count or cash balance after merging devices (rare) is flagged, to fix by calibrating or recording
describe('holdings below zero', () => {
  const sellTooMuch = () => {
    const s = state();
    useAppStore.setState({
      transactions: [
        ...s.transactions,
        { id: 'neg-1', date: '2026-09-29', createdAt: '2026-09-29T09:00:00.000Z', type: 'sell', accountId: 'futu', instrumentCode: 'VOO', qty: 200, price: 500, fee: 0, fxToCny: 7.1 },
      ],
    });
  };

  it('flags them at the top and offers to calibrate', () => {
    sellTooMuch();
    render(<HoldingsPage />);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('1 negative share count or cash balance')).toBeTruthy();
    expect(within(alert).getByText(/Futu · VOO/)).toBeTruthy();
    fireEvent.click(within(alert).getByRole('button', { name: 'Calibrate VOO' }));
    expect(dialog('Calibrate holding')).toBeTruthy();
  });

  it('shows nothing when every holding is fine', () => {
    render(<HoldingsPage />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('By account', () => {
  const toAccounts = () => fireEvent.click(screen.getByRole('radio', { name: 'By account' }));

  it('lists every account with type, currency, count, value and share', () => {
    render(<HoldingsPage />);
    toAccounts();
    expect(screen.getByText('Spread over 6 accounts')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Futu Broker · USD · 2 instruments ¥[\d.]+[KM] [\d.]+%$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^China Merchants Bank Bank · CNY · 2 instruments/ })).toBeTruthy();
  });

  it('opens the account detail and returns to it after calibrating', () => {
    render(<HoldingsPage />);
    toAccounts();
    fireEvent.click(screen.getByRole('button', { name: /^Futu Broker/ }));
    const sheet = dialog('Futu');
    expect(within(sheet).getByText(/^Broker · USD · [\d.]+% of total assets$/)).toBeTruthy();
    expect(within(sheet).getByText('US stock indexes')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: /^VOO S&P 500/ }));
    fireEvent.click(within(dialog('Calibrate holding')).getByRole('button', { name: 'Save calibration' }));
    expect(state().transactions.at(-1)!.reason).toBe(REASON.checked);
    expect(dialog('Futu')).toBeTruthy();
  });

  it('handles an account with no holdings', () => {
    useAppStore.getState().addAccount({ id: 'tiger', name: 'Tiger', type: 'broker', currency: 'USD', market: MARKET.us });
    render(<HoldingsPage />);
    toAccounts();
    // As in the prototype: an empty account counts, but takes no room in the share bar
    expect(screen.getByText('Spread over 7 accounts')).toBeTruthy();
    expect(document.querySelectorAll('.accounts-bar > *')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: /^Tiger Broker · USD · 0 instruments ¥0/ }));
    expect(within(dialog('Tiger')).getByText('No holdings yet. Record a trade in Records.')).toBeTruthy();
  });
});

describe('Settings', () => {
  const openSettings = () => fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

  it('lists the accounts', () => {
    render(<HoldingsPage />);
    openSettings();
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /instruments? .*›$/ })).toHaveLength(6);
  });

  it('adds an account, rejecting blank and duplicate names, USD / CNY only', () => {
    render(<HoldingsPage />);
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: '+ Add account' }));
    const sheet = dialog('Add account');
    expect(within(sheet).queryByRole('radio', { name: 'HKD' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(within(sheet).getByText('Enter an account name')).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Futu' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(within(sheet).getByText('An account with this name already exists')).toBeTruthy();
    fireEvent.change(within(sheet).getByLabelText('Name'), { target: { value: 'Longbridge' } });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'CNY' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    expect(state().accounts.at(-1)).toMatchObject({ name: 'Longbridge', type: 'broker', currency: 'CNY', market: MARKET.cn });
    expect(state().toast).toBe('Account added · Longbridge');
    expect(screen.getByRole('button', { name: /^Longbridge Broker · CNY · 0 instruments/ })).toBeTruthy();
  });

  it('says the data syncs to the cloud and who is signed in', () => {
    render(<HoldingsPage />);
    openSettings();
    expect(screen.getByText('Your data is kept on this device and syncs to the cloud when online. You can also export a copy.')).toBeTruthy();
    expect(screen.getByText('Signed in as me@example.com · Synced')).toBeTruthy();
  });

  // No cloud set up (someone cloned the repo, or the public demo): say it is sample data only and how to connect a cloud; no sign-out
  it('explains how to connect a cloud when there is none', () => {
    useBootStore.setState({ kind: 'noCloud' }, true);
    render(<HoldingsPage />);
    openSettings();
    expect(screen.getByText(/^Not connected to a cloud: this is sample data only, and changes are not saved\./)).toBeTruthy();
    expect(screen.getByText(/VITE_SUPABASE_URL/)).toBeTruthy();
    expect(screen.queryByText(/syncs to the cloud when online/)).toBeNull();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export full backup (JSON)' })).toBeTruthy();
  });

  // The sample data is a demo on this device only (Onboarding's "look at sample data first"), never written into the account
  it('does not offer to put the sample data into the account', () => {
    useAppStore.setState({ transactions: [] });
    render(<HoldingsPage />);
    openSettings();
    expect(screen.queryByRole('button', { name: /sample data/i })).toBeNull();
  });

  it('signs out straight away when everything is uploaded', () => {
    render(<HoldingsPage />);
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('warns before signing out with records still waiting', () => {
    useSyncStore.setState({ state: 'offline', pending: 2, lastSyncedAt: null });
    render(<HoldingsPage />);
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).not.toHaveBeenCalled();
    const sheet = dialog('Sign out');
    expect(within(sheet).getByText('2 records are not synced yet. They stay on this device and upload when you sign in again with the same email.')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it('offers to sign in again after the login has expired', () => {
    useSyncStore.setState({ state: 'signedOut', pending: 0, lastSyncedAt: null });
    render(<HoldingsPage />);
    openSettings();
    expect(screen.getByText('Signed in as me@example.com · Login expired, sign in again to keep syncing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    expect(signOut).toHaveBeenCalledOnce();
  });

  // A device setting: the copy switches at once, without a reload
  it('switches the interface language', () => {
    render(<HoldingsPage />);
    openSettings();
    const group = screen.getByRole('radiogroup', { name: 'Language' });
    fireEvent.click(within(group).getByRole('radio', { name: '中文' }));
    expect(state().locale).toBe('zh');
    expect(screen.getByRole('radiogroup', { name: '语言' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '设置账户' })).toBeTruthy();
    localStorage.removeItem('locale');
  });

  it('exports a JSON backup and a CSV of transactions', () => {
    render(<HoldingsPage />);
    openSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Export full backup (JSON)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export transactions (CSV)' }));
    const calls = vi.mocked(downloadText).mock.calls;
    expect(calls[0]![0]).toBe('portfolio-backup-2026-09-29.json');
    expect(JSON.parse(calls[0]![1]).transactions).toHaveLength(state().transactions.length);
    expect(calls[1]![0]).toBe('transactions-2026-09-29.csv');
    expect(calls[1]![1].startsWith('Date,Type,Account,Code,Quantity,Price,Fee,Remark')).toBe(true);
    expect(calls[1]![3]).toEqual({ bom: true });
    expect(state().toast).toBe('Transactions exported');
  });
});
