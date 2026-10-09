import type { Account, Exposure } from '../domain/types';
import type { Messages } from '../i18n';

// The order, colors and names of the slots (the prototype's SLOT_ORDER / SLOTCOL). The colors are all tokens.css variables.

export const SLOT_ORDER = [
  'sp500',
  'total_us',
  'ndx',
  'r2000',
  'us_div',
  'stocks',
  'brk',
  'aapl',
  'moutai',
  'exus',
  'global',
  'em',
  'csi300',
  'csi500',
  'chinext',
  'star50',
  'cn_div',
  'hsi',
  'hstech',
  'ust10',
  'us_bond',
  'ust_long',
  'ust_short',
  'cn_bond',
  'gold',
  'reit',
  'usd',
  'cny',
];

const SLOT_COLORS: Record<string, string> = {
  sp500: 'var(--color-accent)',
  ndx: 'var(--color-accent-300)',
  stocks: 'var(--color-accent-700)',
  brk: 'var(--color-accent-800)',
  aapl: 'var(--color-accent-500)',
  moutai: 'var(--color-accent-900)',
  exus: 'var(--color-accent-200)',
  csi300: 'var(--color-accent-2)',
  ust10: 'var(--color-accent-2-300)',
  gold: 'var(--color-accent-2-700)',
  usd: 'var(--color-neutral-500)',
  cny: 'var(--color-neutral-300)',
  // Presets added in phase 3: similar hues within a group
  total_us: 'var(--color-accent-400)',
  r2000: 'var(--color-accent-600)',
  us_div: 'var(--color-accent-200)',
  global: 'var(--color-accent-2-200)',
  em: 'var(--color-accent-2-400)',
  csi500: 'var(--color-accent-2-500)',
  chinext: 'var(--color-accent-2-600)',
  star50: 'var(--color-accent-2-800)',
  cn_div: 'var(--color-accent-2-900)',
  hsi: 'var(--color-neutral-700)',
  hstech: 'var(--color-neutral-800)',
  us_bond: 'var(--color-accent-2-300)',
  ust_long: 'var(--color-neutral-400)',
  ust_short: 'var(--color-neutral-200)',
  cn_bond: 'var(--color-neutral-600)',
  reit: 'var(--color-neutral-900)',
};

/** Colors for custom assets, used in turn. */
const CUSTOM_COLORS = ['var(--color-neutral-700)', 'var(--color-accent-2-500)', 'var(--color-accent-600)', 'var(--color-accent-2-900)'];

export function slotColor(key: string, customIndex = 0): string {
  return SLOT_COLORS[key] ?? CUSTOM_COLORS[customIndex % CUSTOM_COLORS.length]!;
}

/** A slot's display name: 'stocks' holds every individual stock not set apart in the target; the rest are assets */
export function slotName(key: string, exposures: Record<string, Exposure>, t: Messages): string {
  if (key === 'stocks') return t.common.stocksTotal;
  const exposure = exposures[key];
  return exposure ? t.names.exposure(exposure) : key;
}

/** In display order; unknown ones last (in their original order). */
export function bySlotOrder<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const rank = (k: string) => {
    const i = SLOT_ORDER.indexOf(k);
    return i < 0 ? Number.POSITIVE_INFINITY : i;
  };
  return [...items].sort((a, b) => rank(keyOf(a)) - rank(keyOf(b)));
}

/** Group colors (the prototype's GROUPS). */
const GROUP_COLORS: Record<string, string> = {
  us: 'var(--color-accent)',
  stk: 'var(--color-accent-700)',
  intl: 'var(--color-accent-300)',
  cn: 'var(--color-accent-2)',
  bond: 'var(--color-accent-2-300)',
  gold: 'var(--color-accent-2-700)',
  cash: 'var(--color-neutral-400)',
  other: 'var(--color-neutral-600)',
};

export function groupColor(groupId: string): string {
  return GROUP_COLORS[groupId] ?? 'var(--color-neutral-600)';
}

/** Account colors, cycled in the order the accounts were added (the prototype's ACOL). */
export const ACCOUNT_COLORS = [
  'var(--color-accent-700)',
  'var(--color-accent-400)',
  'var(--color-accent-2-700)',
  'var(--color-accent-2-400)',
  'var(--color-neutral-600)',
  'var(--color-neutral-400)',
  'var(--color-accent-200)',
  'var(--color-accent-2-200)',
];

export function accountColor(account: Account, index: number): string {
  return account.color ?? ACCOUNT_COLORS[index % ACCOUNT_COLORS.length]!;
}

