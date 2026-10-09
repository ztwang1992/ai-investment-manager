import { create } from 'zustand';
import { beijingDate } from '../domain/dates';
import { createSupabaseAuth } from './auth';
import type { AuthClient, AuthUser } from './auth';
import { emptyData, sampleData, stateFromData } from './persistence';
import { createSupabaseRemote } from './remote';
import type { Remote } from './remote';
import { keepDeviceData } from './keepData';
import { apiBase, createQuotesApi, getQuotesApi, setQuotesApi, usdCnyOn } from './quotesApi';
import { openSession } from './session';
import type { Session } from './session';
import { currentMessages } from '../i18n';
import { useAppStore } from './store';
import { createSupabase } from './supabase';
import type { SupabaseEnv } from './supabase';

// Start-up: no cloud configured -> the sample data; not signed in -> the sign-in page; signed in (offline too) -> this account's data.

export type BootState =
  | { kind: 'loading' }
  /** No cloud configured (a fresh clone, a public demo): the sample data only, not saved, not synced */
  | { kind: 'noCloud' }
  | { kind: 'unavailable' }
  | { kind: 'signedOut'; auth: AuthClient }
  | { kind: 'ready'; auth: AuthClient; session: Session };

export const useBootStore = create<BootState>()(() => ({ kind: 'loading' }));

let cloud: { auth: AuthClient; remote: Remote } | null = null;

const localStorageSafe = () => {
  try {
    return window.localStorage;
  } catch {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
  }
};

/** Syncs when the network comes back or the app returns to the foreground */
function listenForWake(onWake: () => void) {
  const onVisible = () => {
    if (document.visibilityState === 'visible') onWake();
  };
  window.addEventListener('online', onWake);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('online', onWake);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export async function boot(env: SupabaseEnv & { VITE_API_BASE?: string }): Promise<void> {
  const base = apiBase(env);
  setQuotesApi(base ? createQuotesApi(base) : null);
  const client = createSupabase(env);
  if (!client) {
    // No local database, no sync: changes in the interface stay in memory
    const s = useAppStore.getState();
    useAppStore.setState({ ...stateFromData(sampleData({ displayCurrency: s.displayCurrency, hideAmounts: s.hideAmounts }, s.locale)), demo: true });
    useBootStore.setState({ kind: 'noCloud' }, true);
    return;
  }
  cloud = { auth: createSupabaseAuth(client, localStorageSafe()), remote: createSupabaseRemote(client) };
  const user = await cloud.auth.currentUser();
  if (user) await enter(user);
  else useBootStore.setState({ kind: 'signedOut', auth: cloud.auth }, true);
}

export async function enter(user: AuthUser): Promise<void> {
  if (!cloud) return;
  // The placeholder data before start-up uses the sample's dates; real data uses today in Beijing time
  useAppStore.setState({ today: beijingDate(new Date()) });
  const session = await openSession(user, {
    store: useAppStore,
    remote: cloud.remote,
    listen: listenForWake,
    onWriteError: () => useAppStore.getState().flash(currentMessages().shell.saveFailed),
    fxOn: (date) => usdCnyOn(getQuotesApi(), date),
  });
  if (session === 'unavailable') return useBootStore.setState({ kind: 'unavailable' }, true);
  useBootStore.setState({ kind: 'ready', auth: cloud.auth, session }, true);
  // Once signed in, the account's data lives on this device: ask the browser not to clear it
  void keepDeviceData();
}

/** Sign-out: stops syncing and clears the data in memory; the local database stays for the next sign-in with the same email */
export async function signOut(): Promise<void> {
  const s = useBootStore.getState();
  if (s.kind !== 'ready') return;
  // Decision 3: signing out deletes the AI key saved on this device (while the local database is still open)
  await s.session.aiVault.clear().catch(() => {});
  await s.session.close();
  await s.auth.signOut();
  const app = useAppStore.getState();
  // Back to an empty account; signing out during the sample data ends the demo too
  useAppStore.setState({
    ...stateFromData(emptyData({ displayCurrency: app.displayCurrency, hideAmounts: app.hideAmounts })),
    demo: false,
    onboardingStep: 0,
    unconfirmedFx: [],
  });
  useBootStore.setState({ kind: 'signedOut', auth: s.auth }, true);
}
