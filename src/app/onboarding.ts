import type { StoreApi } from 'zustand';
import { computeSnapshot } from '../domain/snapshot';
import { MESSAGES } from '../i18n';
import type { OnboardingResult } from '../pages/onboarding/OnboardingPage';
import type { LocalController } from './persistence';
import type { AppState } from './store';

// Finishing onboarding (README「首次录入引导」item 5) writes the accounts, new instruments, single-stock assets, opening transactions and targets to the account;
// after one quote fetch, it stores the day's first snapshot locally and queues it for sync (at 06:00 the next day the Worker overwrites it with closing values).

const byKey = <T>(list: readonly T[], key: (item: T) => string): Record<string, T> => Object.fromEntries(list.map((x) => [key(x), x]));

export async function finishOnboarding(
  result: OnboardingResult,
  deps: { store: Pick<StoreApi<AppState>, 'getState'>; local: Pick<LocalController, 'saveFirstSnapshot'> },
): Promise<void> {
  const s = deps.store.getState();
  for (const exposure of result.exposures) s.addExposure(exposure);
  for (const instrument of result.instruments) s.addInstrument(instrument);
  for (const account of result.accounts) s.addAccount(account);
  s.appendTransactions(result.transactions);
  s.saveTargets(result.targets, {});
  s.flash(MESSAGES[s.locale].shell.onboardingDone);
  // At market prices when there are quotes; at cost when there aren't (offline)
  await deps.store.getState().refreshQuotes();
  const now = deps.store.getState();
  const { snapshot, items } = computeSnapshot({
    date: now.today,
    transactions: now.transactions,
    instruments: byKey(now.instruments, (i) => i.code),
    exposures: byKey(now.exposures, (e) => e.id),
    prices: now.prices,
    fx: now.fx,
  });
  await deps.local.saveFirstSnapshot(snapshot, items);
}
