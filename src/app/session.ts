import type { StoreApi } from 'zustand';
import type { OnboardingResult } from '../pages/onboarding/OnboardingPage';
import { createAiVault } from './aiVault';
import type { AiVault } from './aiVault';
import type { AuthUser } from './auth';
import { openLocalDb, userDbName } from './localDb';
import type { LocalDb } from './localDb';
import { finishOnboarding } from './onboarding';
import { attachLocalDb, dataFromState, emptyData, hydrate, sampleData, stateFromData } from './persistence';
import type { LocalData } from './persistence';
import type { Remote } from './remote';
import type { AppState } from './store';
import { INITIAL_SYNC, startSync, useSyncStore } from './sync';
import type { SyncController } from './sync';

// A signed-in account's data on this device: the local database (one per account), writing back, sync.

export interface SessionDeps {
  store: Pick<StoreApi<AppState>, 'getState' | 'setState' | 'subscribe'>;
  remote: Remote;
  openDb?: (name: string) => LocalDb;
  now?: () => Date;
  isOnline?: () => boolean;
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Calls onWake when the network comes back or the app returns to the foreground; returns a function that stops listening */
  listen?: (onWake: () => void) => () => void;
  onWriteError?: (error: unknown) => void;
  /** How many CNY 1 USD was worth on a given day (for an offline transaction before upload); null when it can't be found */
  fxOn?: (date: string) => Promise<number | null>;
}

export interface Session {
  user: AuthUser;
  /** The AI settings and encrypted key this account saved on this device (not synced) */
  aiVault: AiVault;
  syncNow: () => Promise<void>;
  /** Finishes onboarding: writes to the account and stores the day's first snapshot */
  completeOnboarding: (result: OnboardingResult) => Promise<void>;
  /** View the sample data first: a demo on this device only; writing back and sync pause, and nothing is written to the account */
  startDemo: () => Promise<void>;
  /** Ends the demo: back to the account's data, with writing back and sync resumed; with startOnboarding, onboarding starts at step 1 */
  endDemo: (opts?: { startOnboarding?: boolean }) => Promise<void>;
  /** Stops syncing and closes the local database; local data and the sync queue stay for the next sign-in */
  close: () => Promise<void>;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export async function openSession(user: AuthUser, deps: SessionDeps): Promise<Session | 'unavailable'> {
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const iso = () => now().toISOString();
  const s0 = store.getState();
  const prefs = { displayCurrency: s0.displayCurrency, hideAmounts: s0.hideAmounts };
  // Switch to an empty account first so the previous account's data doesn't flash; when the local database is new, start from it too (with the version times of the default settings)
  const empty = emptyData(prefs);
  store.setState(stateFromData(empty));
  let db: LocalDb;
  try {
    db = (deps.openDb ?? openLocalDb)(userDbName(user.id));
    await hydrate(store, db, iso, empty);
  } catch {
    return 'unavailable';
  }
  // A pull record in the local database means this device has read the cloud (so even offline it knows whether the account is empty)
  useSyncStore.setState({ ...INITIAL_SYNC, pulledOnce: (await db.kv.get('pulledAt')) !== undefined }, true);
  let sync: SyncController | null = null;
  const local = attachLocalDb(store, db, iso, deps.onWriteError ?? (() => {}), () => sync?.requestSync());
  const engine = startSync({
    remote: deps.remote,
    db,
    local,
    userId: user.id,
    isOnline: deps.isOnline ?? (() => navigator.onLine),
    now,
    schedule: deps.schedule ?? defaultSchedule,
    setStatus: (patch) => useSyncStore.setState(patch),
    ...(deps.fxOn ? { fxOn: deps.fxOn } : {}),
  });
  sync = engine;
  const unlisten = deps.listen?.(() => void engine.syncNow()) ?? (() => {});
  /** The account's data in the interface before viewing the sample data (restored when the demo ends) */
  let beforeDemo: LocalData | null = null;
  void engine.syncNow();

  return {
    user,
    aiVault: createAiVault(db),
    // First wait for the changes just made to reach the local database (and the sync queue), then sync, so an immediate sync includes them too
    syncNow: async () => {
      await local.flush();
      await engine.syncNow();
    },
    completeOnboarding: (result) => finishOnboarding(result, { store, local }),
    startDemo: async () => {
      if (beforeDemo) return;
      await engine.suspend();
      local.suspend();
      const s = store.getState();
      beforeDemo = dataFromState(s);
      store.setState({ ...stateFromData(sampleData({ displayCurrency: s.displayCurrency, hideAmounts: s.hideAmounts }, s.locale)), demo: true });
    },
    endDemo: async (opts = {}) => {
      if (!beforeDemo) return;
      store.setState({ ...stateFromData(beforeDemo), demo: false, onboardingStep: opts.startOnboarding ? 1 : 0, unconfirmedFx: [] });
      beforeDemo = null;
      local.resume();
      engine.resume();
      await engine.syncNow();
    },
    close: async () => {
      engine.stop();
      unlisten();
      await local.flush();
      local.detach();
      db.close();
      useSyncStore.setState(INITIAL_SYNC, true);
    },
  };
}
