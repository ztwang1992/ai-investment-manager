// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthClient } from './app/auth';
import { useBootStore } from './app/boot';
import { emptyData, stateFromData } from './app/persistence';
import type { Session } from './app/session';
import { useAppStore } from './app/store';
import type { AppState } from './app/store';
import { INITIAL_SYNC, useSyncStore } from './app/sync';
import { Root } from './Root';

const auth: AuthClient = { currentUser: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), signOut: vi.fn() };
const session: Session = {
  user: { id: 'u', email: 'me@example.com' },
  aiVault: { load: vi.fn(async () => null), save: vi.fn(), clear: vi.fn() },
  syncNow: vi.fn(),
  completeOnboarding: vi.fn(),
  startDemo: vi.fn(),
  endDemo: vi.fn(),
  close: vi.fn(),
};
afterEach(() => {
  cleanup();
  useBootStore.setState({ kind: 'loading' }, true);
});

describe('what the app shows first', () => {
  it('shows the login page when nobody is signed in', () => {
    useBootStore.setState({ kind: 'signedOut', auth }, true);
    render(<Root />);
    expect(screen.getByRole('button', { name: 'Send code' })).toBeTruthy();
  });

  it('shows the app once signed in', () => {
    useBootStore.setState({ kind: 'ready', auth, session }, true);
    render(<Root />);
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
  });

  // No cloud configured (a fresh clone, a public demo): straight to the sample data, with no "Enter my holdings"
  it('shows the sample data when no cloud is set up', () => {
    const before = useAppStore.getState();
    useBootStore.setState({ kind: 'noCloud' }, true);
    useAppStore.setState({ demo: true });
    try {
      render(<Root />);
      expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
      expect(screen.getByText('Viewing sample data. Nothing is saved.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Enter my holdings' })).toBeNull();
    } finally {
      useAppStore.setState(before, true);
    }
  });

  it('explains a device that cannot store data', () => {
    useBootStore.setState({ kind: 'unavailable' }, true);
    render(<Root />);
    expect(screen.getByRole('heading', { name: "This device can't save data" })).toBeTruthy();
  });

  it('shows an empty frame while loading, without the sample data', () => {
    render(<Root />);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByText('Returns')).toBeNull();
  });
});

// A new account (no accounts at all) must do onboarding first; but until a new device has read the cloud once, it can't tell an empty account from data not yet downloaded
describe('the first entry', () => {
  let initial: AppState;
  beforeEach(() => {
    initial = useAppStore.getState();
    useAppStore.setState({ ...stateFromData(emptyData({ displayCurrency: 'CNY', hideAmounts: false })), today: '2026-10-02' });
    useBootStore.setState({ kind: 'ready', auth, session }, true);
  });
  afterEach(() => {
    useAppStore.setState(initial, true);
    useSyncStore.setState(INITIAL_SYNC, true);
  });

  it('starts once the cloud has been read and the account has no accounts', () => {
    useSyncStore.setState({ state: 'idle', pulledOnce: true });
    render(<Root />);
    expect(screen.getByRole('heading', { name: 'Start managing your portfolio' })).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('waits for the first read on a new device, then opens the app if the account has data', () => {
    useSyncStore.setState({ state: 'syncing', pulledOnce: false });
    render(<Root />);
    expect(screen.getByRole('heading', { name: 'Reading your data from the cloud…' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Start managing your portfolio' })).toBeNull();
    act(() => {
      useAppStore.setState({ accounts: initial.accounts });
      useSyncStore.setState({ state: 'idle', pulledOnce: true });
    });
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
  });

  it('asks a new device that is offline to go online once', () => {
    useSyncStore.setState({ state: 'offline', pulledOnce: false });
    render(<Root />);
    expect(screen.getByRole('heading', { name: 'Connect to the internet' })).toBeTruthy();
    expect(screen.getByText(/first time on this device/)).toBeTruthy();
  });

  it('starts offline too when this device has already read an empty account', () => {
    useSyncStore.setState({ state: 'offline', pulledOnce: true });
    render(<Root />);
    expect(screen.getByRole('heading', { name: 'Start managing your portfolio' })).toBeTruthy();
  });

  it('shows the sample data when chosen on the welcome page', async () => {
    useSyncStore.setState({ state: 'idle', pulledOnce: true });
    const startDemo = vi.fn(async () => {
      useAppStore.setState({ demo: true, accounts: initial.accounts, transactions: initial.transactions });
    });
    useBootStore.setState({ kind: 'ready', auth, session: { ...session, startDemo } }, true);
    render(<Root />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Look at sample data first' }));
    });
    expect(startDemo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
  });

  it('comes back from the sample data to the first step', () => {
    useSyncStore.setState({ state: 'idle', pulledOnce: true });
    useAppStore.setState({ onboardingStep: 1 });
    render(<Root />);
    expect(screen.getByRole('heading', { name: 'Where do you hold assets?' })).toBeTruthy();
  });

  it('hands the entry to the account and opens the app on Returns', async () => {
    useSyncStore.setState({ state: 'idle', pulledOnce: true });
    const complete = vi.fn(async () => {
      useAppStore.setState({ accounts: initial.accounts.slice(0, 1) });
    });
    useBootStore.setState({ kind: 'ready', auth, session: { ...session, completeOnboarding: complete } }, true);
    render(<Root />);
    fireEvent.click(screen.getByRole('button', { name: 'Start from scratch' }));
    fireEvent.click(screen.getByRole('button', { name: 'Futu · USD' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.change(screen.getByLabelText('Cash in Futu ($)'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Finish and start' }));
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
    expect(screen.getByText(/Your returns chart starts today/)).toBeTruthy();
  });
});
