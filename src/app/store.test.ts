import { describe, expect, it, vi } from 'vitest';
import type { QuotesApi } from './quotesApi';
import { createAppStore } from './store';

const fixedNow = new Date(2026, 8, 29, 9, 30);

describe('app store', () => {
  it('starts in CNY with amounts visible, and toggles both', () => {
    const store = createAppStore({ now: () => fixedNow });
    expect(store.getState()).toMatchObject({ displayCurrency: 'CNY', hideAmounts: false, refreshing: false, quotesUpdatedAt: null, quotesError: false, fxLiveOn: null });
    store.getState().toggleHideAmounts();
    store.getState().setDisplayCurrency('USD');
    expect(store.getState()).toMatchObject({ displayCurrency: 'USD', hideAmounts: true });
  });

  it('loads the sample data with history', () => {
    const s = createAppStore({ now: () => fixedNow }).getState();
    expect(s.accounts).toHaveLength(6);
    expect(s.snapshots.length).toBeGreaterThan(600);
    expect(s.snapshots.at(-1)!.date).toBe(s.today);
  });
});

describe('interface language', () => {
  const memory = () => {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  };

  it('starts in the device language', () => {
    expect(createAppStore({ now: () => fixedNow, locale: { storage: memory(), languages: ['zh-CN'] } }).getState().locale).toBe('zh');
    expect(createAppStore({ now: () => fixedNow, locale: { storage: memory(), languages: ['en-US'] } }).getState().locale).toBe('en');
  });

  // The choice is a device setting: saved here, picked up by the next start, never synced
  it('remembers a language picked in settings on this device', () => {
    const storage = memory();
    const store = createAppStore({ now: () => fixedNow, locale: { storage, languages: ['en-US'] } });
    store.getState().setLocale('zh');
    expect(store.getState().locale).toBe('zh');
    expect(createAppStore({ now: () => fixedNow, locale: { storage, languages: ['en-US'] } }).getState().locale).toBe('zh');
  });
});

describe('refreshing quotes', () => {
  // 01:00 on 2026-10-01 in Beijing is still 09-30 in UTC: "today" follows Beijing time
  const NOW = new Date('2026-09-30T17:00:00Z');
  const FX_OK = { date: '2026-09-30', rates: { USD: 6.7045, HKD: 0.8545 }, source: 'frankfurter', stale: false };
  const quote = (market: 'us' | 'cn' | 'fund', code: string, price: number, asOf = '2026-09-30T20:00:01.000Z', stale = false) => ({
    market,
    code,
    price,
    currency: market === 'us' ? ('USD' as const) : ('CNY' as const),
    asOf,
    source: 'tencent',
    stale,
  });
  const fakeApi = (over: Partial<QuotesApi> = {}): QuotesApi => ({
    quotes: vi.fn(async () => ({
      quotes: [quote('us', 'VOO', 700.86), quote('cn', '513500', 2.688), quote('fund', '050025', 5.563, '2026-09-29')],
      missing: [],
    })),
    fx: vi.fn(async () => FX_OK),
    ...over,
  });
  const offline = async (): Promise<never> => {
    throw new TypeError('Failed to fetch');
  };
  const make = (api: QuotesApi | null) => createAppStore({ now: () => NOW, schedule: () => () => {}, quotes: () => api });

  it('does nothing before the quotes API is set up', async () => {
    const store = make(null);
    const before = store.getState();
    await store.getState().refreshQuotes();
    expect(store.getState().prices).toBe(before.prices);
    expect(store.getState()).toMatchObject({ refreshing: false, quotesUpdatedAt: null, quotesError: false, today: before.today });
  });

  it('applies live prices, NAV dates and exchange rates, and moves today to the Beijing date', async () => {
    const api = fakeApi();
    const store = make(api);
    const pending = store.getState().refreshQuotes();
    expect(store.getState().refreshing).toBe(true);
    await pending;
    const s = store.getState();
    expect(api.quotes).toHaveBeenCalledWith(expect.objectContaining({ us: expect.arrayContaining(['VOO', 'BRK.B']), fund: expect.arrayContaining(['050025']) }));
    expect(s.prices).toMatchObject({ VOO: 700.86, '513500': 2.688, '050025': 5.563 });
    expect(s.navDates['050025']).toBe('2026-09-29');
    expect(s.fx).toEqual({ CNY: 1, USD: 6.7045, HKD: 0.8545 });
    expect(s).toMatchObject({ refreshing: false, quotesError: false, quotesUpdatedAt: NOW, fxLiveOn: '2026-10-01', today: '2026-10-01' });
  });

  it('keeps the last prices and says quotes are unavailable when the Worker cannot be reached', async () => {
    const store = make(fakeApi({ quotes: vi.fn(offline), fx: vi.fn(offline) }));
    const before = store.getState();
    await store.getState().refreshQuotes();
    const s = store.getState();
    expect(s.prices).toEqual(before.prices);
    expect(s.fx).toEqual(before.fx);
    expect(s).toMatchObject({ refreshing: false, quotesError: true, quotesUpdatedAt: null, fxLiveOn: null });
  });

  it('shows cached prices but still says quotes are unavailable when they are stale', async () => {
    const store = make(
      fakeApi({
        quotes: vi.fn(async () => ({ quotes: [quote('us', 'VOO', 699.5, undefined, true)], missing: [] })),
        fx: vi.fn(async () => ({ ...FX_OK, stale: true })),
      }),
    );
    await store.getState().refreshQuotes();
    expect(store.getState().prices.VOO).toBe(699.5);
    expect(store.getState()).toMatchObject({ quotesError: true, quotesUpdatedAt: null, fxLiveOn: null });
  });

  it('says quotes are unavailable when only the prices are stale', async () => {
    const store = make(fakeApi({ quotes: vi.fn(async () => ({ quotes: [quote('us', 'VOO', 699.5, undefined, true)], missing: [] })) }));
    await store.getState().refreshQuotes();
    expect(store.getState()).toMatchObject({ quotesError: true, quotesUpdatedAt: null, fxLiveOn: '2026-10-01' });
  });

  it('counts the exchange rate as fetched today even when quotes fail', async () => {
    const store = make(fakeApi({ quotes: vi.fn(offline) }));
    await store.getState().refreshQuotes();
    expect(store.getState()).toMatchObject({ quotesError: true, fxLiveOn: '2026-10-01' });
  });

  // A code no data source knows (e.g. one the user added) just has no price; quotes don't count as unavailable
  it('does not flag a few codes no source knows, only an empty answer', async () => {
    const some = make(fakeApi({ quotes: vi.fn(async () => ({ quotes: [quote('us', 'VOO', 700.86)], missing: [{ market: 'us' as const, code: 'ABCD' }] })) }));
    await some.getState().refreshQuotes();
    expect(some.getState().quotesError).toBe(false);
    const none = make(fakeApi({ quotes: vi.fn(async () => ({ quotes: [], missing: [{ market: 'us' as const, code: 'VOO' }] })) }));
    await none.getState().refreshQuotes();
    expect(none.getState().quotesError).toBe(true);
  });

  it('ignores a second refresh while one is running', async () => {
    const api = fakeApi();
    const store = make(api);
    await Promise.all([store.getState().refreshQuotes(), store.getState().refreshQuotes()]);
    expect(api.quotes).toHaveBeenCalledTimes(1);
  });
});

describe('recording and toasts', () => {
  const deps = () => {
    const scheduled: { fn: () => void; ms: number }[] = [];
    return {
      scheduled,
      deps: {
        now: () => fixedNow,
        schedule: (fn: () => void, ms: number) => {
          scheduled.push({ fn, ms });
          return () => {};
        },
      },
    };
  };

  it('appendTransactions adds to the ledger', () => {
    const { deps: d } = deps();
    const store = createAppStore(d);
    const before = store.getState().transactions.length;
    store.getState().appendTransactions([
      { id: 'x1', date: '2026-09-29', createdAt: '2026-09-29T10:00:00.000Z', type: 'deposit', accountId: 'cmb', instrumentCode: 'CNY', qty: 1000, price: 1, fee: 0, fxToCny: 1 },
    ]);
    expect(store.getState().transactions).toHaveLength(before + 1);
  });

  // Recording offline uses the last rate found; before upload it must become the recording day's (README「本地优先与同步」)
  it('marks records made without today\'s live exchange rate', () => {
    const store = createAppStore({ now: () => fixedNow });
    const usd = (id: string) => ({ id, date: '2026-09-29', createdAt: '2026-09-29T10:00:00.000Z', type: 'deposit' as const, accountId: 'futu', instrumentCode: 'USD', qty: 100, price: 1, fee: 0, fxToCny: 7.1 });
    store.getState().appendTransactions([usd('a')]);
    expect(store.getState().unconfirmedFx).toEqual(['a']);
    store.setState({ fxLiveOn: store.getState().today });
    store.getState().appendTransactions([usd('b')]);
    expect(store.getState().unconfirmedFx).toEqual(['a']);
  });

  it('flash shows a message and clears it after 2.4 seconds', () => {
    const { deps: d, scheduled } = deps();
    const store = createAppStore(d);
    store.getState().flash('已记录 3 笔买入');
    expect(store.getState().toast).toBe('已记录 3 笔买入');
    expect(scheduled.at(-1)!.ms).toBe(2400);
    scheduled.at(-1)!.fn();
    expect(store.getState().toast).toBeNull();
  });
});

describe('settings', () => {
  const make = () => createAppStore({ now: () => fixedNow, schedule: () => () => {} });

  it('saveTargets replaces the targets and which stocks have their own target', () => {
    const store = make();
    store.getState().saveTargets({ sp500: 60, aapl: 40 }, { aapl: true });
    expect(store.getState()).toMatchObject({ targets: { sp500: 60, aapl: 40 }, ownStock: { aapl: true } });
  });

  it('updatePlan changes only the given fields', () => {
    const store = make();
    const before = store.getState().plan;
    store.getState().updatePlan({ threshold: 5, undefinedMode: 'ignore' });
    expect(store.getState().plan).toEqual({ ...before, threshold: 5, undefinedMode: 'ignore' });
  });

  it('addExposure adds a custom asset to the catalogue', () => {
    const store = make();
    store.getState().addExposure({ id: 'custom-btc', name: '比特币', groupId: 'other', isStock: false });
    expect(store.getState().exposures.at(-1)).toEqual({ id: 'custom-btc', name: '比特币', groupId: 'other', isStock: false });
  });

  it('addInstrument adds a new code once', () => {
    const store = make();
    const abcd = { code: 'ABCD', name: '', market: '美股' as const, currency: 'USD' as const, exposureId: 'ndx', paysDividend: false };
    const before = store.getState().instruments.length;
    store.getState().addInstrument(abcd);
    store.getState().addInstrument(abcd);
    store.getState().addInstrument(store.getState().instruments[0]!);
    expect(store.getState().instruments).toHaveLength(before + 1);
    expect(store.getState().instruments.at(-1)).toEqual(abcd);
  });
});

describe('accounts and quotes', () => {
  const make = () => createAppStore({ now: () => fixedNow, schedule: () => () => {} });

  it('addAccount appends a new account', () => {
    const store = make();
    store.getState().addAccount({ id: 'tiger', name: '老虎', type: 'broker', currency: 'USD', market: '美股', color: 'var(--color-accent-200)' });
    expect(store.getState().accounts.at(-1)).toMatchObject({ id: 'tiger', name: '老虎' });
  });

  it('knows the T-1 NAV date of off-exchange funds', () => {
    expect(make().getState().navDates['050025']).toBe('2026-09-28');
  });

  it('gives every sample account a colour', () => {
    expect(make().getState().accounts.every((a) => a.color?.startsWith('var(--color-'))).toBe(true);
  });
});

describe('AI conversations', () => {
  const conversation = { id: 'c1', title: '美债超配要不要现在调？', createdAt: '2026-10-03T08:00:00.000Z', updatedAt: '2026-10-03T08:00:00.000Z' };
  const question = { id: 'q1', conversationId: 'c1', role: 'user' as const, content: '美债超配要不要现在调？', createdAt: '2026-10-03T08:00:00.000Z' };
  const reply = { id: 'a1', conversationId: 'c1', role: 'assistant' as const, content: '1. 超配约 11%。', createdAt: '2026-10-03T08:00:05.000Z' };

  it('starts with the two sample conversations', () => {
    const s = createAppStore({ now: () => fixedNow }).getState();
    expect(s.aiConversations.map((c) => c.title)).toEqual(['My Treasuries are overweight. Should I rebalance now?', 'Adding before year end']);
    expect(s.aiMessages).toHaveLength(4);
  });

  it('adds a conversation with its first message, then moves it forward with the next one', () => {
    const store = createAppStore({ now: () => fixedNow });
    store.setState({ aiConversations: [], aiMessages: [] });
    store.getState().recordAiMessage({ conversation, message: question });
    const later = { ...conversation, updatedAt: reply.createdAt };
    store.getState().recordAiMessage({ conversation: later, message: reply });
    expect(store.getState().aiConversations).toEqual([later]);
    expect(store.getState().aiMessages).toEqual([question, reply]);
  });

  it('skips a message it already has', () => {
    const store = createAppStore({ now: () => fixedNow });
    store.setState({ aiConversations: [], aiMessages: [] });
    store.getState().recordAiMessage({ conversation, message: question });
    store.getState().recordAiMessage({ conversation, message: question });
    expect(store.getState().aiMessages).toEqual([question]);
  });
});
