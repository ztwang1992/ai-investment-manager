import { create } from 'zustand';
import type {
  Account,
  AiConversation,
  AiMessage,
  Currency,
  Exposure,
  ExposureGroup,
  FxRates,
  Instrument,
  OwnStock,
  Plan,
  Prices,
  Snapshot,
  SnapshotItem,
  Targets,
  Transaction,
} from '../domain/types';
import { beijingDate } from '../domain/dates';
import { readLocale, saveLocale } from '../i18n/locale';
import { localizeSample } from '../i18n/sample';
import type { Locale, LocaleStorage } from '../i18n/locale';
import { mockAppData } from '../mock/initial';
import { getQuotesApi, quoteRequest } from './quotesApi';
import type { QuotesApi } from './quotesApi';

// Global state. Phase 1 loaded the sample data; since phase 2 data is read from and written to the local database. Interface preferences (currency, hidden amounts) live here.

export interface AppState {
  today: string;
  transactions: Transaction[];
  accounts: Account[];
  instruments: Instrument[];
  exposures: Exposure[];
  groups: ExposureGroup[];
  targets: Targets;
  ownStock: OwnStock;
  plan: Plan;
  prices: Prices;
  fx: FxRates;
  /** The NAV date of mutual funds (T-1) */
  navDates: Record<string, string>;
  snapshots: Snapshot[];
  snapshotItems: SnapshotItem[];
  /** The AI advisor's conversations and messages (phase 6: stored locally, synced to the cloud) */
  aiConversations: AiConversation[];
  aiMessages: AiMessage[];
  /** When the latest quotes and rates were last fetched */
  quotesUpdatedAt: Date | null;
  /** The last refresh didn't get fresh values (the API was unreachable, or the Worker only had old cached ones) */
  quotesError: boolean;
  /** The Beijing date the current rate was last fetched online; when it isn't today, foreign-currency transactions get their recording day's rate before upload */
  fxLiveOn: string | null;
  /** Since this launch, the ids of transactions recorded with a rate not fetched online today (marked when queued; given the recording day's rate before upload) */
  unconfirmedFx: readonly string[];
  refreshing: boolean;
  /** Viewing the sample data (a demo on this device only, not saved, not synced) */
  demo: boolean;
  /** The onboarding step to start at: coming back from the demo's "Enter my holdings" goes straight to step 1 */
  onboardingStep: 0 | 1;
  displayCurrency: Currency;
  hideAmounts: boolean;
  /** Interface language: a device setting, not synced with the account */
  locale: Locale;
  /** Switch the language and remember the choice on this device */
  setLocale: (locale: Locale) => void;
  setDisplayCurrency: (currency: Currency) => void;
  toggleHideAmounts: () => void;
  /** Fetches prices, NAVs and exchange rates from the quotes Worker; when it can't, keeps the previous ones and marks quotes unavailable */
  refreshQuotes: () => Promise<void>;
  /** Records: appends transactions, then writes them to the local database and queues them for sync. */
  appendTransactions: (transactions: readonly Transaction[]) => void;
  /** The toast text; disappears after 2.4 seconds */
  toast: string | null;
  flash: (message: string) => void;
  /** Settings (synced with "last change wins" since phase 2) */
  saveTargets: (targets: Targets, ownStock: OwnStock) => void;
  updatePlan: (patch: Partial<Plan>) => void;
  addExposure: (exposure: Exposure) => void;
  /** New codes "Add record" couldn't recognize; a code that already exists isn't added again */
  addInstrument: (instrument: Instrument) => void;
  addAccount: (account: Account) => void;
  /** Stores an AI conversation message: adds or updates the conversation (last-changed time etc.), then appends the message; skipped if it already exists */
  recordAiMessage: (i: { conversation: AiConversation; message: AiMessage }) => void;
}

export interface AppDeps {
  now: () => Date;
  /** Runs later; returns a cancel function */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** The quotes API; set at start-up (boot); before that and in tests there is none, and refresh does nothing */
  quotes?: () => QuotesApi | null;
  /** Where the language choice is saved, and the device's preferred languages */
  locale?: { storage: LocaleStorage | null; languages: readonly string[] };
}

const defaultDeps: AppDeps = {
  now: () => new Date(),
  quotes: getQuotesApi,
};

const defaultSchedule = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};
const TOAST_MS = 2400;

/** localStorage and the browser's languages; either can be missing (Node, blocked storage) */
function deviceLocale(): { storage: LocaleStorage | null; languages: readonly string[] } {
  let storage: LocaleStorage | null = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    storage = null;
  }
  return { storage, languages: globalThis.navigator?.languages ?? [] };
}

export function createAppStore(deps: AppDeps = defaultDeps) {
  const schedule = deps.schedule ?? defaultSchedule;
  const device = deps.locale ?? deviceLocale();
  const locale = readLocale(device.storage, device.languages);
  let cancelToast: (() => void) | null = null;
  return create<AppState>()((set, get) => ({
    ...mockAppData(locale),
    quotesUpdatedAt: null,
    quotesError: false,
    fxLiveOn: null,
    unconfirmedFx: [],
    refreshing: false,
    demo: false,
    onboardingStep: 0,
    displayCurrency: 'CNY',
    hideAmounts: false,
    locale,
    setLocale: (next) => {
      saveLocale(device.storage, next);
      // The demo's sample accounts, remarks and conversation follow the language too
      set((s) => ({ locale: next, ...(s.demo ? localizeSample(s, next) : {}) }));
    },
    toast: null,
    appendTransactions: (transactions) =>
      set((s) => ({
        transactions: [...s.transactions, ...transactions],
        // The rate wasn't fetched online today (offline, or not refreshed yet): before upload it becomes the recording day's
        ...(s.fxLiveOn === s.today ? {} : { unconfirmedFx: [...s.unconfirmedFx, ...transactions.map((t) => t.id)] }),
      })),
    saveTargets: (targets, ownStock) => set({ targets: { ...targets }, ownStock: { ...ownStock } }),
    updatePlan: (patch) => set((s) => ({ plan: { ...s.plan, ...patch } })),
    addExposure: (exposure) => set((s) => ({ exposures: [...s.exposures, exposure] })),
    addInstrument: (instrument) =>
      set((s) => (s.instruments.some((i) => i.code === instrument.code) ? s : { instruments: [...s.instruments, instrument] })),
    addAccount: (account) => set((s) => ({ accounts: [...s.accounts, account] })),
    recordAiMessage: ({ conversation, message }) =>
      set((s) => ({
        aiConversations: s.aiConversations.some((c) => c.id === conversation.id)
          ? s.aiConversations.map((c) => (c.id === conversation.id ? conversation : c))
          : [...s.aiConversations, conversation],
        aiMessages: s.aiMessages.some((m) => m.id === message.id) ? s.aiMessages : [...s.aiMessages, message],
      })),
    flash: (message) => {
      cancelToast?.();
      set({ toast: message });
      cancelToast = schedule(() => set({ toast: null }), TOAST_MS);
    },
    setDisplayCurrency: (currency) => set({ displayCurrency: currency }),
    toggleHideAmounts: () => set((s) => ({ hideAmounts: !s.hideAmounts })),
    refreshQuotes: async () => {
      const api = deps.quotes?.() ?? null;
      if (!api || get().refreshing) return;
      set({ refreshing: true });
      const req = quoteRequest(get().instruments);
      const [quotes, fx] = await Promise.allSettled([api.quotes(req), api.fx()]);
      const now = deps.now();
      const today = beijingDate(now);
      const s = get();
      const q = quotes.status === 'fulfilled' ? quotes.value : null;
      // When no price came back, keep the old object so the local database isn't written for nothing
      let prices = s.prices;
      let navDates = s.navDates;
      if (q && q.quotes.length > 0) {
        prices = { ...prices };
        navDates = { ...navDates };
        for (const quote of q.quotes) {
          prices[quote.code] = quote.price;
          if (quote.market === 'fund') navDates[quote.code] = quote.asOf.slice(0, 10);
        }
      }
      const r = fx.status === 'fulfilled' ? fx.value : null;
      const asked = req.us.length + req.cn.length + req.fund.length;
      // A few codes unknown to every data source isn't a failure; only getting nothing at all is
      const quotesOk = q !== null && !q.quotes.some((x) => x.stale) && !(asked > 0 && q.quotes.length === 0);
      const fxOk = r !== null && !r.stale;
      set({
        today,
        prices,
        navDates,
        fx: r ? { ...s.fx, USD: r.rates.USD, HKD: r.rates.HKD } : s.fx,
        fxLiveOn: fxOk ? today : s.fxLiveOn,
        quotesError: !(quotesOk && fxOk),
        quotesUpdatedAt: quotesOk && fxOk ? now : s.quotesUpdatedAt,
        refreshing: false,
      });
    },
  }));
}

export const useAppStore = createAppStore();
