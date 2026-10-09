import { MARKET } from './types';
import type { CashCurrency, DigitMarket, Exposure, Instrument } from './types';

// "Add record" recognizes instruments by code. Phase 1c looked them up in the sample catalog; phase 3 switched to the instruments table (the user's own first).
// When a code isn't recognized, the user picks the asset, and the currency and market are guessed from the code (as in the prototype).

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function findInstrument(code: string, instruments: readonly Instrument[]): Instrument | null {
  const c = normalizeCode(code);
  return c ? (instruments.find((i) => i.code === c) ?? null) : null;
}

const isDigits = (code: string) => /^\d+$/.test(code);

/** All digits counts as CNY; anything else as USD. */
export function guessCurrency(code: string): CashCurrency {
  return isDigits(normalizeCode(code)) ? 'CNY' : 'USD';
}

/**
 * A code that isn't recognized: no name; all digits is CNY in the market the user picked (A-share or mutual fund, which can't be told apart); anything else counts as US.
 */
export function newInstrument(code: string, exposureId: string, digitMarket: DigitMarket = MARKET.cn): Instrument {
  const c = normalizeCode(code);
  return { code: c, name: '', market: isDigits(c) ? digitMarket : MARKET.us, currency: guessCurrency(c), exposureId, paysDividend: false };
}

/** The "List as an individual stock" option in the picker, for a code that isn't recognized */
export const OWN_STOCK = '__own_stock__';

/** Creates the user's own single-stock asset for this code, named after the code by default */
export function ownStockExposure(code: string): Exposure {
  return { id: `stock-${code}`, name: code, groupId: 'stk', isStock: true };
}
