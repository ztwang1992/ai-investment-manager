import { localizeSample } from '../i18n/sample';
import type { Locale } from '../i18n/locale';
import { sampleAiConversations, sampleAiMessages } from './ai';
import { simulateHistory } from './history';
import { accounts, exposures, groups, instrumentByCode, instruments } from './catalog';
import { transactions } from './ledger';
import { fx, navDates, prices, today } from './market';
import { ownStock, plan, targets } from './settings';

/** All the sample data, with the daily history worked out from it, in the interface language. */
export function mockAppData(locale: Locale) {
  const history = simulateHistory({ transactions, instruments: instrumentByCode, prices, fx, end: today });
  const typed = localizeSample(
    { accounts: [...accounts], transactions: [...transactions], aiConversations: [...sampleAiConversations], aiMessages: [...sampleAiMessages] },
    locale,
  );
  return {
    today,
    transactions: typed.transactions,
    accounts: typed.accounts,
    instruments: [...instruments],
    exposures: [...exposures],
    groups: [...groups],
    targets: { ...targets },
    ownStock: { ...ownStock },
    plan: { ...plan },
    prices: { ...prices },
    fx: { ...fx },
    navDates: { ...navDates },
    snapshots: history.snapshots,
    snapshotItems: history.items,
    aiConversations: typed.aiConversations,
    aiMessages: typed.aiMessages,
  };
}
