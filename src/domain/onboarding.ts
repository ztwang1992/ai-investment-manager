import { newInstrument, normalizeCode, OWN_STOCK, ownStockExposure } from './instruments';
import { slotKeyOf } from './slots';
import { isCashCode } from './types';
import type { AccountType, CashCurrency, DigitMarket, Exposure, FxRates, Instrument, OwnStock, Targets, Transaction } from './types';

export { OWN_STOCK, ownStockExposure };

// Onboarding (README「首次录入引导」; obAdd / obPreview / obFinish in prototype v5):
// holdings and cash are entered by account; on finishing, each holding and each cash balance gets an opening transaction, and the targets can be generated from the cost mix entered.

export interface OnbAccount {
  id: string;
  name: string;
  type: AccountType;
  currency: CashCurrency;
}

/** A holding entered: shares and cost price as the broker app shows them */
export interface OnbPosition {
  accountId: string;
  code: string;
  qty: number;
  cost: number;
  instrument: Instrument;
}

/** The row being filled in. exposureId and market are only used when the code isn't recognized */
export interface OnbForm {
  code: string;
  qty: string;
  cost: string;
  exposureId: string;
  /** A 6-digit code could be an A-share or a mutual fund; the user picks */
  market: DigitMarket;
}

/** Why a row can't be added; the UI words it */
export type RowError = 'incompleteRow' | 'cashInBalance';

export type PendingRow =
  | { kind: 'empty' }
  | { kind: 'error'; error: RowError }
  | { kind: 'added'; positions: OnbPosition[]; form: OnbForm };

/** A code that isn't recognized: created with the asset (or single stock) and market picked in the form */
const unknownInstrument = (code: string, form: OnbForm): Instrument =>
  newInstrument(code, form.exposureId === OWN_STOCK ? ownStockExposure(code).id : form.exposureId, form.market);

/**
 * Adds the row being filled in to the list (called on Add, on switching accounts and on Next).
 * All three fields empty doesn't count; half-filled is an error, never silently dropped; the same code in the same account replaces the old row.
 */
export function addPendingRow(
  form: OnbForm,
  accountId: string,
  positions: readonly OnbPosition[],
  find: (code: string) => Instrument | null,
): PendingRow {
  const code = normalizeCode(form.code);
  if (!code && !form.qty.trim() && !form.cost.trim()) return { kind: 'empty' };
  if (isCashCode(code)) return { kind: 'error', error: 'cashInBalance' };
  const qty = form.qty.trim() === '' ? NaN : Number(form.qty);
  const cost = form.cost.trim() === '' ? NaN : Number(form.cost);
  if (!code || !(qty > 0) || !(cost > 0) || !Number.isFinite(qty) || !Number.isFinite(cost)) return { kind: 'error', error: 'incompleteRow' };
  const instrument = find(code) ?? unknownInstrument(code, form);
  return {
    kind: 'added',
    positions: [...positions.filter((p) => !(p.accountId === accountId && p.code === code)), { accountId, code, qty, cost, instrument }],
    form: { ...form, code: '', qty: '', cost: '' },
  };
}

/** The opening transactions on finishing: one per holding (price is the cost price), one per account's cash balance (price is 1) */
export function openingTransactions(i: {
  date: string;
  createdAt: string;
  accounts: readonly OnbAccount[];
  positions: readonly OnbPosition[];
  cash: Readonly<Record<string, number>>;
  fx: FxRates;
  newId: () => string;
}): Transaction[] {
  const opening = (accountId: string, code: string, qty: number, price: number, currency: CashCurrency): Transaction => ({
    id: i.newId(),
    date: i.date,
    createdAt: i.createdAt,
    type: 'opening',
    accountId,
    instrumentCode: code,
    qty,
    price,
    fee: 0,
    fxToCny: i.fx[currency],
  });
  const out: Transaction[] = [];
  for (const a of i.accounts) {
    for (const p of i.positions) if (p.accountId === a.id) out.push(opening(a.id, p.code, p.qty, p.cost, p.instrument.currency));
    const cash = i.cash[a.id] ?? 0;
    if (cash > 0) out.push(opening(a.id, a.currency, cash, 1, a.currency));
  }
  return out;
}

/**
 * Targets from "Use my current mix": each slot's share of the cost entered (in CNY); single stocks fold into Individual stocks by default.
 * The rounding remainder goes to the largest item, so the total is exactly 100.
 */
export function targetsFromCost(i: {
  positions: readonly OnbPosition[];
  cash: Readonly<Record<string, number>>;
  accounts: readonly OnbAccount[];
  instruments: Record<string, Instrument>;
  exposures: Record<string, Exposure>;
  ownStock: OwnStock;
  fx: FxRates;
}): Targets {
  const values = new Map<string, number>();
  const add = (key: string, value: number) => values.set(key, (values.get(key) ?? 0) + value);
  const slotOf = (exposureId: string) => {
    const exposure = i.exposures[exposureId];
    return exposure ? slotKeyOf(exposure, i.ownStock) : exposureId;
  };
  for (const p of i.positions) add(slotOf(p.instrument.exposureId), p.qty * p.cost * i.fx[p.instrument.currency]);
  for (const a of i.accounts) {
    const cash = i.cash[a.id] ?? 0;
    if (cash > 0) add(slotOf(i.instruments[a.currency]?.exposureId ?? a.currency.toLowerCase()), cash * i.fx[a.currency]);
  }
  const total = [...values.values()].reduce((a, b) => a + b, 0);
  if (!(total > 0)) return {};
  const rows = [...values]
    .map(([key, value]) => ({ key, pct: Math.round((value / total) * 100) }))
    .filter((r) => r.pct > 0)
    .sort((a, b) => b.pct - a.pct);
  const diff = 100 - rows.reduce((a, r) => a + r.pct, 0);
  if (rows[0]) rows[0].pct += diff;
  return Object.fromEntries(rows.map((r) => [r.key, r.pct]));
}
