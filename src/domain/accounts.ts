import { MARKET } from './types';
import type { AccountType, CashCurrency, Market } from './types';

/**
 * Which market a new account can buy in (the prototype's mktFor): a USD account -> US; a CNY bank -> mutual funds; any other CNY account -> A-shares.
 * "One account" filters the instruments it can buy by this market.
 */
export function marketFor(type: AccountType, currency: CashCurrency): Market {
  if (currency === 'USD') return MARKET.us;
  return type === 'bank' ? MARKET.fund : MARKET.cn;
}
