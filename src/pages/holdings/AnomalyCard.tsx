import { formatQty, MASK } from '../../app/format';
import { useAppStore } from '../../app/store';
import { usePortfolio } from '../../app/usePortfolio';
import type { Anomaly } from '../../domain/ledger';
import { isCashCode } from '../../domain/types';
import { useT } from '../../i18n';

type Negative = Extract<Anomaly, { kind: 'negative_qty' }>;

/**
 * A negative share count or cash balance: only after several devices recorded offline at once and merged (rare).
 * Shown so that a holding can be calibrated to the broker's count and cash topped up with a record
 * (README「本地优先与同步」).
 */
export function AnomalyCard({ onCalibrate }: { onCalibrate: (accountId: string, code: string) => void }) {
  const t = useT();
  const portfolio = usePortfolio();
  const accounts = useAppStore((s) => s.accounts);
  const hide = useAppStore((s) => s.hideAmounts);
  const negatives = portfolio.ledger.anomalies.filter((a): a is Negative => a.kind === 'negative_qty');
  if (negatives.length === 0) return null;
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  return (
    <div className="anomaly-card" role="alert">
      <span className="anomaly-title">{t.holdings.anomaly.title(negatives.length)}</span>
      <span className="text-note">{t.holdings.anomaly.note}</span>
      <ul className="anomaly-list">
        {negatives.map((a) => (
          <li key={`${a.accountId}|${a.code}`} className="anomaly-row">
            <span>
              {accountName(a.accountId)} · {a.code} {hide ? MASK : formatQty(a.qty)}
            </span>
            {!isCashCode(a.code) && (
              <button
                type="button"
                className="btn btn-secondary"
                aria-label={t.holdings.anomaly.calibrateAria(a.code)}
                onClick={() => onCalibrate(a.accountId, a.code)}
              >
                {t.holdings.anomaly.calibrate}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
