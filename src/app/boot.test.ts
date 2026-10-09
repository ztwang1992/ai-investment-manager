// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthClient } from './auth';
import { boot, signOut, useBootStore } from './boot';
import { emptyData, sampleData, stateFromData } from './persistence';
import { getQuotesApi, setQuotesApi } from './quotesApi';
import type { Session } from './session';
import { useAppStore } from './store';
import type { AppState } from './store';

const auth: AuthClient = { currentUser: vi.fn(), sendCode: vi.fn(), verifyCode: vi.fn(), signOut: vi.fn(async () => {}) };
const order: string[] = [];
const session: Session = {
  user: { id: 'u', email: 'me@example.com' },
  aiVault: {
    load: vi.fn(async () => null),
    save: vi.fn(async () => {}),
    clear: vi.fn(async () => void order.push('clear key')),
  },
  syncNow: vi.fn(async () => {}),
  completeOnboarding: vi.fn(async () => {}),
  startDemo: vi.fn(async () => {}),
  endDemo: vi.fn(async () => {}),
  close: vi.fn(async () => void order.push('close')),
};
let initial: AppState;

afterEach(() => {
  useAppStore.setState(initial, true);
  useBootStore.setState({ kind: 'loading' }, true);
});

describe('signing out', () => {
  // Signing out while viewing the sample data: the next sign-in must not still be in the demo
  it('leaves the sample data demo and the first-entry step behind', async () => {
    initial = useAppStore.getState();
    useBootStore.setState({ kind: 'ready', auth, session }, true);
    useAppStore.setState({ demo: true, onboardingStep: 1 });
    await signOut();
    expect(useAppStore.getState()).toMatchObject({ demo: false, onboardingStep: 0, accounts: [] });
    expect(useBootStore.getState().kind).toBe('signedOut');
    expect(session.close).toHaveBeenCalled();
  });

  // Decision 3: signing out deletes the AI key saved on this device; conversations stay in the cloud and on the device, just no longer shown
  it('deletes the AI key saved on this device before closing the account', async () => {
    initial = useAppStore.getState();
    order.length = 0;
    useBootStore.setState({ kind: 'ready', auth, session }, true);
    await signOut();
    expect(order).toEqual(['clear key', 'close']);
    expect(useAppStore.getState()).toMatchObject({ aiConversations: [], aiMessages: [] });
  });
});

describe('starting without a cloud', () => {
  afterEach(() => setQuotesApi(null));

  // Open source: no default to the author's Worker; without VITE_API_BASE there are no quotes
  it('fetches no quotes unless VITE_API_BASE is set', async () => {
    initial = useAppStore.getState();
    await boot({});
    expect(getQuotesApi()).toBeNull();
    await boot({ VITE_API_BASE: 'http://localhost:8787' });
    expect(getQuotesApi()).not.toBeNull();
  });

  // Someone who clones the repo without configuring Supabase can still view the sample data (not saved, not synced)
  it('shows the sample data when Supabase is not configured', async () => {
    initial = useAppStore.getState();
    const prefs = { displayCurrency: 'CNY' as const, hideAmounts: false };
    useAppStore.setState(stateFromData(emptyData(prefs)));
    await boot({ VITE_SUPABASE_URL: ' ', VITE_SUPABASE_ANON_KEY: '' });
    expect(useBootStore.getState().kind).toBe('noCloud');
    const s = useAppStore.getState();
    expect(s.demo).toBe(true);
    expect(s.transactions).toEqual(sampleData(prefs, 'en').transactions);
    expect(s.accounts.length).toBeGreaterThan(0);
  });
});
