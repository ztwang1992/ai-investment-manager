import { CURRENCY_SYMBOL, MASK, formatQty, sign } from '../../app/format';
import { REASON } from '../../domain/record';
import { MARKET } from '../../domain/types';
import type { Instrument, Transaction } from '../../domain/types';
import type { Messages } from '../../i18n';

// The text of each line on Records (prototype lines 1040–1043); an opening record shows as an opening entry
// (README「流水类型」). A calibration stores the actual share count; the difference shown here comes from the
// ledger (Ledger.calibrationDiffs).

export type RecordTone = 'gain' | 'loss' | 'neutral';

export interface RecordLine {
  id: string;
  title: string;
  typeLabel: string;
  tone: RecordTone;
  meta: string;
  amount: string;
  /** What follows the amount (why money came in, why a calibration changed), shown as " · note"; it may wrap on narrow screens, the amount never does */
  note?: string;
}

const TONE: Record<Transaction['type'], RecordTone> = {
  opening: 'neutral',
  buy: 'gain',
  sell: 'loss',
  deposit: 'gain',
  withdraw: 'loss',
  calibrate: 'neutral',
};

/** A price with thousands separators and at most 4 decimals. */
export function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function recordLine(
  tx: Transaction,
  ctx: {
    instrumentByCode: Record<string, Instrument>;
    accountName: (id: string) => string;
    calibrationDiffs: Record<string, number>;
    hide: boolean;
    t: Messages;
  },
): RecordLine {
  const { t } = ctx;
  const instrument = ctx.instrumentByCode[tx.instrumentCode];
  const symbol = CURRENCY_SYMBOL[instrument?.currency ?? 'CNY'];
  const title =
    tx.type === 'deposit'
      ? t.records.line.moneyIn
      : tx.type === 'withdraw'
        ? t.records.line.moneyOut
        : `${tx.instrumentCode} ${instrument ? t.names.instrument(instrument) : ''}`.trim();
  // A remark the app wrote is translated; one the user typed is shown as typed
  const remark = tx.reason ? t.common.reason(tx.reason) : undefined;

  let amount: string;
  let note: string | undefined;
  if (ctx.hide) amount = MASK;
  else if (tx.type === 'deposit' || tx.type === 'withdraw') {
    amount = `${tx.type === 'deposit' ? '+' : '−'}${symbol}${formatQty(tx.qty)}`;
    note = remark;
  } else if (tx.type === 'calibrate') {
    const diff = ctx.calibrationDiffs[tx.id] ?? 0;
    if (Math.abs(diff) < 1e-9) {
      amount = t.records.line.noChange;
      note = t.common.reason(REASON.checked);
    } else {
      amount = t.common.shares(`${sign(diff)}${formatQty(Math.abs(diff))}`);
      note = remark;
    }
  } else if (tx.type === 'opening' && instrument?.market === MARKET.cash) {
    amount = `${symbol}${formatQty(tx.qty)}`;
  } else {
    amount = `${formatQty(tx.qty)} × ${symbol}${formatPrice(tx.price)}${tx.fee ? t.records.line.fee(tx.fee) : ''}`;
  }

  return {
    id: tx.id,
    title,
    typeLabel: tx.type === 'opening' ? t.records.line.opening : t.common.txTypes[tx.type],
    tone: TONE[tx.type],
    meta: `${ctx.accountName(tx.accountId)} · ${t.records.line.date(tx.date)}`,
    amount,
    ...(note ? { note } : {}),
  };
}
