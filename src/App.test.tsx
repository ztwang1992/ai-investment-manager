// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { useBootStore } from './app/boot';
import { useAppStore } from './app/store';
import { INITIAL_SYNC, useSyncStore } from './app/sync';

afterEach(() => {
  cleanup();
  useSyncStore.setState(INITIAL_SYNC, true);
});

const tab = (name: string) => screen.getByRole('button', { name });

describe('App shell', () => {
  // The sample data is already off target: mark this period checked first, so the Plan tab doesn't carry the rebalancing dot (the reminder has its own tests)
  beforeEach(() => {
    useAppStore.setState((s) => ({ plan: { ...s.plan, lastRebalancedOn: s.today } }));
  });
  afterEach(() => {
    useAppStore.setState((s) => ({ plan: { ...s.plan, lastRebalancedOn: null } }));
  });

  it('shows the five tabs in the prototype order', () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Returns', 'Plan', 'Holdings', 'Records', 'AI advisor']);
  });

  it('opens on Returns', () => {
    render(<App />);
    expect(tab('Returns').getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { name: 'Returns' })).toBeTruthy();
  });

  it('switches page and highlight when another tab is tapped', () => {
    render(<App />);
    fireEvent.click(tab('Plan'));
    expect(tab('Plan').getAttribute('aria-current')).toBe('page');
    expect(tab('Returns').getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Plan' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Returns' })).toBeNull();
  });

  it('starts the new page at the top instead of keeping the old scroll position', () => {
    const { container } = render(<App />);
    const main = container.querySelector('.app-main')!;
    main.scrollTop = 400;
    fireEvent.click(tab('Plan'));
    expect(main.scrollTop).toBe(0);
  });
});

describe('records waiting to upload', () => {
  it('marks the records tab while records are waiting to upload', () => {
    useSyncStore.setState({ state: 'offline', pending: 2, lastSyncedAt: null });
    render(<App />);
    // happy-dom puts spaces between spans when computing accessible names
    expect(screen.getByRole('button', { name: /^Records\s*,\s*2 waiting to sync$/ })).toBeTruthy();
    act(() => useSyncStore.setState({ pending: 0 }));
    expect(screen.getByRole('button', { name: 'Records' })).toBeTruthy();
  });
});

describe('the sample data demo', () => {
  afterEach(() => {
    useAppStore.setState({ demo: false });
    useBootStore.setState({ kind: 'loading' }, true);
  });

  it('says the sample is not saved and offers to start entering', () => {
    const endDemo = vi.fn(async () => {});
    useBootStore.setState(
      {
        kind: 'ready',
        auth: { currentUser: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), signOut: vi.fn() },
        session: {
          user: { id: 'u', email: 'me@example.com' },
          aiVault: { load: vi.fn(async () => null), save: vi.fn(), clear: vi.fn() },
          syncNow: vi.fn(),
          completeOnboarding: vi.fn(),
          startDemo: vi.fn(),
          endDemo,
          close: vi.fn(),
        },
      },
      true,
    );
    useAppStore.setState({ demo: true });
    render(<App />);
    expect(screen.getByText('Viewing sample data. Nothing is saved.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enter my holdings' }));
    expect(endDemo).toHaveBeenCalledWith({ startOnboarding: true });
  });

  it('shows no banner for a real account', () => {
    render(<App />);
    expect(screen.queryByText('Viewing sample data. Nothing is saved.')).toBeNull();
  });
});

// Rebalancing reminder: a small dot on the Plan tab when one is due
describe('the rebalance reminder on the tab bar', () => {
  afterEach(() => {
    useAppStore.setState((s) => ({ plan: { ...s.plan, lastRebalancedOn: null } }));
  });

  it('marks Plan while this period has not been checked', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /^Plan\s*,\s*Rebalance due$/ })).toBeTruthy();
  });

  it('clears the mark once the period has been checked', () => {
    useAppStore.setState((s) => ({ plan: { ...s.plan, lastRebalancedOn: s.today } }));
    render(<App />);
    expect(screen.getByRole('button', { name: 'Plan' })).toBeTruthy();
  });
});
