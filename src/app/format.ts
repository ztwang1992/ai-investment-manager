import type { Currency, FxRates } from '../domain/types';
import type { Locale } from '../i18n/locale';

// Amounts, percentages and times as shown in the UI (the prototype's fmtS / fmtN).

export const MASK = '••••';
export const CURRENCY_SYMBOL: Record<Currency, string> = { CNY: '¥', USD: '$', HKD: 'HK$' };

const MINUS = '−';

export function sign(value: number): '+' | '−' {
  return value >= 0 ? '+' : MINUS;
}

/** Chinese counts CNY and HKD in 万 (ten thousand), as the prototype does; English uses K and M everywhere */
function compactMagnitude(magnitude: number, currency: Currency, locale: Locale): string {
  if (currency === 'USD' || locale === 'en') {
    if (magnitude >= 1e6) return `${(magnitude / 1e6).toFixed(2)}M`;
    if (magnitude >= 1e3) return `${(magnitude / 1e3).toFixed(1)}K`;
    return magnitude.toFixed(0);
  }
  return magnitude >= 1e4 ? `${(magnitude / 1e4).toFixed(1)}万` : magnitude.toFixed(0);
}

/** Compact: ¥310.5万 (Chinese), ¥3.11M (English), $437.3K, $4.37M. The amount is already in `currency`. */
export function formatAmount(amount: number, currency: Currency, locale: Locale, hide = false): string {
  if (hide) return MASK;
  const text = compactMagnitude(Math.abs(amount), currency, locale);
  const isZero = Number(text.replace(/[^\d.]/g, '')) === 0;
  return `${amount < 0 && !isZero ? MINUS : ''}${CURRENCY_SYMBOL[currency]}${text}`;
}

/** A CNY amount converted into the display currency, then written compactly. */
export function formatMoney(amountCny: number, currency: Currency, fx: FxRates, locale: Locale, hide = false): string {
  return formatAmount(amountCny / fx[currency], currency, locale, hide);
}

/** An amount with its sign: +¥1.4万, −¥500. */
export function formatSignedAmount(amount: number, currency: Currency, locale: Locale, hide = false): string {
  if (hide) return MASK;
  return `${sign(amount)}${formatAmount(Math.abs(amount), currency, locale)}`;
}

/** A percentage with its sign: +5.19%. */
export function formatSignedPct(pct: number, digits = 2): string {
  return `${sign(pct)}${Math.abs(pct).toFixed(digits)}%`;
}

/** The full amount with thousands separators: ¥100,000. */
export function formatFull(amount: number, currency: Currency): string {
  return `${CURRENCY_SYMBOL[currency]}${Math.round(amount).toLocaleString('en-US')}`;
}

/** A share count: at most two decimals, with thousands separators (the prototype's qtyTxt). */
export function formatQty(qty: number): string {
  return qty.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function formatTimeHM(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
