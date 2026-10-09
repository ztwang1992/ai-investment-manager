import { MASK, formatMoney, formatQty } from '../../app/format';
import { recordCtx } from '../../app/ids';
import { Sheet } from '../../app/Sheet';
import { useAppStore } from '../../app/store';
import { useT } from '../../i18n';
import { usePortfolio } from '../../app/usePortfolio';
import type { CalibrationDueItem } from '../../domain/calibration';
import { CALIBRATION_REASON, recordCalibration } from '../../domain/record';
import type { Transaction } from '../../domain/types';

/** To check this period: calibrate each one, or mark them all as checked at once. */
export function CalibrationListSheet({
  items,
  onOpen,
  onClose,
}: {
  items: readonly CalibrationDueItem[];
  onOpen: (item: CalibrationDueItem) => void;
  onClose: () => void;
}) {
  const portfolio = usePortfolio();
  const accounts = useAppStore((s) => s.accounts);
  const today = useAppStore((s) => s.today);
  const fx = useAppStore((s) => s.fx);
  const t = useT();
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const hide = useAppStore((s) => s.hideAmounts);
  const appendTransactions = useAppStore((s) => s.appendTransactions);
  const flash = useAppStore((s) => s.flash);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  const markAll = () => {
    if (items.length === 0) return;
    const transactions: Transaction[] = [];
    for (const item of items) {
      const instrument = portfolio.instrumentByCode[item.code];
      if (!instrument) continue;
      const result = recordCalibration({
        ledger: portfolio.ledger,
        accountId: item.accountId,
        instrument,
        date: today,
        actualQty: item.qty,
        reason: CALIBRATION_REASON.manual,
        fx,
        ctx: recordCtx,
      });
      if (result.ok) transactions.push(...result.transactions);
    }
    appendTransactions(transactions);
    flash(t.calibration.markedAll(items.length));
    onClose();
  };

  return (
    <Sheet
      title={t.calibration.listTitle}
      subtitle={t.calibration.listSubtitle}
      subtitleClassName="text-hint"
      onClose={onClose}
    >
      <div className="list-box flat">
        {items.length === 0 && <div className="list-empty calib-empty">{t.calibration.allDone}</div>}
        {items.map((item) => {
          const instrument = portfolio.instrumentByCode[item.code];
          const tags = [item.big && t.calibration.big, item.paysDividend && t.calibration.dividend].filter(Boolean).join(' · ');
          return (
            <button key={`${item.accountId}|${item.code}`} type="button" className="calib-item list-row" onClick={() => onOpen(item)}>
              <span className="calib-item-name">
                {item.code} {instrument ? t.names.instrument(instrument) : ''}
              </span>
              <span className="calib-item-value">{formatMoney(item.valueCny, displayCurrency, fx, t.locale, hide)}</span>
              <span className="calib-item-sub">
                {accountName(item.accountId)} · {t.common.shares(hide ? MASK : formatQty(item.qty))} ·{' '}
                {item.lastCalibratedOn ? t.calibration.lastOn(item.lastCalibratedOn) : t.calibration.never}
              </span>
              <span className="tag tag-accent-2 calib-item-tag">{tags}</span>
            </button>
          );
        })}
      </div>
      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={markAll}>
          {t.calibration.markAll}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t.common.close}
        </button>
      </div>
    </Sheet>
  );
}
