import type { AccountType, CashCurrency } from '../../domain/types';

export type PlatformId = 'futu' | 'ibkr' | 'schwab' | 'firstrade' | 'tiger' | 'longbridge' | 'cms' | 'huatai' | 'cmb' | 'alipay';

/** Step 1's common platforms (the prototype's PRESETS); their names are in the messages. Banks and fund platforms hold CNY mutual funds. */
export const PLATFORMS: readonly { id: PlatformId; currency: CashCurrency; type: AccountType }[] = [
  { id: 'futu', currency: 'USD', type: 'broker' },
  { id: 'ibkr', currency: 'USD', type: 'broker' },
  { id: 'schwab', currency: 'USD', type: 'broker' },
  { id: 'firstrade', currency: 'USD', type: 'broker' },
  { id: 'tiger', currency: 'USD', type: 'broker' },
  { id: 'longbridge', currency: 'USD', type: 'broker' },
  { id: 'cms', currency: 'CNY', type: 'broker' },
  { id: 'huatai', currency: 'CNY', type: 'broker' },
  { id: 'cmb', currency: 'CNY', type: 'bank' },
  { id: 'alipay', currency: 'CNY', type: 'bank' },
];
