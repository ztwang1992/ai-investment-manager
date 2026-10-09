import { formatMoney } from '../../app/format';
import { slotName } from '../../app/palette';
import { Sheet } from '../../app/Sheet';
import { useAppStore } from '../../app/store';
import { useT } from '../../i18n';
import type { RebalanceStep } from '../../domain/slots';
import type { Exposure } from '../../domain/types';

/** Rebalancing steps: sales first, then buys; amounts are estimates. */
export function RebalanceSheet({
  steps,
  exposures,
  onClose,
}: {
  steps: readonly RebalanceStep[];
  exposures: Record<string, Exposure>;
  onClose: () => void;
}) {
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const fx = useAppStore((s) => s.fx);
  const t = useT();
  const hide = useAppStore((s) => s.hideAmounts);
  const flash = useAppStore((s) => s.flash);
  const updatePlan = useAppStore((s) => s.updatePlan);
  const today = useAppStore((s) => s.today);

  return (
    <Sheet
      title={t.plan.rebalanceSheet.title}
      subtitleApart
      subtitle={t.plan.rebalanceSheet.subtitle}
      onClose={onClose}
    >
      <div className="list-box">
        {steps.length === 0 && <div className="list-empty rebal-empty">{t.plan.rebalanceSheet.nothingToDo}</div>}
        {steps.map((step) => (
          <div key={step.slotKey} className="rebal-row list-row">
            <span className={`tag ${step.action === 'sell' ? 'tag-accent' : 'tag-accent-2'}`}>{step.action === 'sell' ? t.common.txTypes.sell : t.common.txTypes.buy}</span>
            <span>
              {slotName(step.slotKey, exposures, t)}
              {step.untargeted ? t.plan.rebalanceSheet.notInTarget : ''}
            </span>
            <span className="rebal-amount">{formatMoney(step.amountCny, displayCurrency, fx, t.locale, hide)}</span>
          </div>
        ))}
      </div>
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            // Remember today: no more reminders this period (synced with the plan to every device)
            updatePlan({ lastRebalancedOn: today });
            flash(t.plan.rebalanceSheet.recorded);
            onClose();
          }}
        >
          {t.plan.rebalanceSheet.markDone}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t.common.close}
        </button>
      </div>
    </Sheet>
  );
}
