import { periodStart } from './dates';
import { MARKET } from './types';
import type { Period, Transaction } from './types';
import type { ValuedHolding } from './valuation';

// The calibration list: holdings that are at least 3% of total assets, or that reinvest dividends, and haven't been checked this period (calendar month / quarter / year).
// Share counts on the day of onboarding (openings) come from the broker, so they count as checked. See README「校准提醒规则」.

export interface CalibrationDueItem {
  accountId: string;
  code: string;
  qty: number;
  valueCny: number;
  lastCalibratedOn: string | null;
  big: boolean;
  paysDividend: boolean;
}

const DEFAULT_BIG_PCT = 3;

export interface CalibrationDiff {
  /** The share count entered minus the share count recorded */
  qty: number;
  /** The difference in CNY at the current price; 0 when there is no holding to go by */
  valueCny: number;
  changed: boolean;
}

/** The difference preview in the calibration sheet. Input that isn't a number counts as no difference; recordCalibration decides whether it's valid. */
export function calibrationDiff(i: {
  recordedQty: number;
  enteredQty: number;
  row: { qty: number; valueCny: number } | undefined;
}): CalibrationDiff {
  const qty = Number.isFinite(i.enteredQty) ? i.enteredQty - i.recordedQty : 0;
  const unitCny = i.row && i.row.qty > 0 ? i.row.valueCny / i.row.qty : 0;
  return { qty, valueCny: qty * unitCny, changed: Math.abs(qty) > 1e-9 };
}

export function calibrationDue(i: {
  rows: readonly ValuedHolding[];
  totalCny: number;
  transactions: readonly Transaction[];
  today: string;
  period: Period;
  bigPct?: number;
}): CalibrationDueItem[] {
  const bigPct = i.bigPct ?? DEFAULT_BIG_PCT;
  const since = periodStart(i.today, i.period);

  const lastChecked = new Map<string, string>();
  for (const t of i.transactions) {
    if (t.type !== 'calibrate' && t.type !== 'opening') continue;
    const key = `${t.accountId}|${t.instrumentCode}`;
    const prev = lastChecked.get(key);
    if (!prev || t.date > prev) lastChecked.set(key, t.date);
  }

  const items: CalibrationDueItem[] = [];
  for (const r of i.rows) {
    if (r.instrument.market === MARKET.cash) continue;
    const big = i.totalCny > 0 && (r.valueCny * 100) / i.totalCny >= bigPct;
    const paysDividend = r.instrument.paysDividend;
    const lastCalibratedOn = lastChecked.get(`${r.accountId}|${r.code}`) ?? null;
    const checkedThisPeriod = lastCalibratedOn !== null && lastCalibratedOn >= since;
    if ((big || paysDividend) && !checkedThisPeriod) {
      items.push({ accountId: r.accountId, code: r.code, qty: r.qty, valueCny: r.valueCny, lastCalibratedOn, big, paysDividend });
    }
  }
  return items.sort((a, b) => b.valueCny - a.valueCny);
}
