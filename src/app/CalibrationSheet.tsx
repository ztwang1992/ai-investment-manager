import { useId, useState } from 'react';
import { calibrationDiff } from '../domain/calibration';
import { holdingQty } from '../domain/ledger';
import { CALIBRATION_REASON, recordCalibration } from '../domain/record';
import type { CalibrationReason } from '../domain/record';
import { MASK, formatMoney, formatQty } from './format';
import { recordCtx } from './ids';
import { Seg } from './Seg';
import { Sheet } from './Sheet';
import { useAppStore } from './store';
import { useT } from '../i18n';
import { usePortfolio } from './usePortfolio';

const REASONS = Object.keys(CALIBRATION_REASON) as (keyof typeof CALIBRATION_REASON)[];

/**
 * Calibrate a holding: enter the share count the broker shows. Total cost stays the same and the average cost
 * adjusts; it is not a trade and does not change principal. Saving an unchanged count records it as checked.
 * Used by the Plan page's list and by Holdings.
 */
export function CalibrationSheet({ accountId, code, onDone }: { accountId: string; code: string; onDone: () => void }) {
  const portfolio = usePortfolio();
  const accounts = useAppStore((s) => s.accounts);
  const today = useAppStore((s) => s.today);
  const fx = useAppStore((s) => s.fx);
  const t = useT();
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const hide = useAppStore((s) => s.hideAmounts);
  const appendTransactions = useAppStore((s) => s.appendTransactions);
  const flash = useAppStore((s) => s.flash);
  const refreshQuotes = useAppStore((s) => s.refreshQuotes);

  const instrument = portfolio.instrumentByCode[code];
  const row = portfolio.rows.find((r) => r.accountId === accountId && r.code === code);
  const recorded = holdingQty(portfolio.ledger, accountId, code);

  const [qtyText, setQtyText] = useState(String(Number(recorded.toFixed(4))));
  const [reason, setReason] = useState<CalibrationReason>(CALIBRATION_REASON.dividend);
  const [invalid, setInvalid] = useState(false);
  const qtyId = useId();

  const entered = Number.parseFloat(qtyText);
  const diff = calibrationDiff({ recordedQty: recorded, enteredQty: entered, row });

  const save = () => {
    if (!instrument) return;
    // recordCalibration checks that the count is a valid, non-negative number
    const result = recordCalibration({
      ledger: portfolio.ledger,
      accountId,
      instrument,
      date: today,
      actualQty: entered,
      reason,
      fx,
      ctx: recordCtx,
    });
    if (!result.ok) {
      setInvalid(true);
      return;
    }
    appendTransactions(result.transactions);
    if (diff.changed) {
      flash(t.calibration.calibrated(code, `${diff.qty > 0 ? '+' : ''}${formatQty(diff.qty)}`));
      void refreshQuotes();
    } else {
      flash(t.calibration.unchanged);
    }
    onDone();
  };

  const accountName = accounts.find((a) => a.id === accountId)?.name ?? accountId;
  return (
    <Sheet
      maxHeight="none"
      title={t.calibration.title}
      subtitle={`${code} ${instrument ? t.names.instrument(instrument) : ''} · ${accountName}`}
      onClose={onDone}
    >
      <div className="stat-grid">
        <div className="stat">
          <span className="stat-label">{t.calibration.appShares}</span>
          <span className="stat-value">{hide ? MASK : formatQty(recorded)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">{t.calibration.currentValue}</span>
          <span className="stat-value">{formatMoney(row?.valueCny ?? 0, displayCurrency, fx, t.locale, hide)}</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor={qtyId}>{t.calibration.brokerShares}</label>
        <input
          id={qtyId}
          className="input"
          type="number"
          inputMode="decimal"
          value={qtyText}
          onChange={(e) => {
            setQtyText(e.target.value);
            setInvalid(false);
          }}
        />
      </div>
      <div className="field">
        <label>{t.calibration.reason}</label>
        <Seg label={t.calibration.reason} options={REASONS.map((r) => [CALIBRATION_REASON[r], t.calibration.reasonOptions[r]] as const)} value={reason} onChange={setReason} />
      </div>
      {diff.changed && (
        <div className={`calib-diff ${diff.qty > 0 ? 'is-up' : 'is-down'}`}>
          {t.calibration.difference(
            `${diff.qty > 0 ? '+' : '−'}${formatQty(Math.abs(diff.qty))}`,
            `${diff.qty > 0 ? '+' : '−'}${formatMoney(Math.abs(diff.valueCny), displayCurrency, fx, t.locale, hide)}`,
          )}
        </div>
      )}
      <span className="text-note">{t.calibration.note}</span>
      {invalid && <span className="text-error">{t.calibration.invalidQty}</span>}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={save}>
          {t.calibration.saveCalibration}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onDone}>
          {t.common.cancel}
        </button>
      </div>
    </Sheet>
  );
}
