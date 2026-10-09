import { useState } from 'react';
import { CalibrationSheet } from '../../app/CalibrationSheet';
import { formatMoney, sign } from '../../app/format';
import { slotColor, slotName } from '../../app/palette';
import { useAppStore } from '../../app/store';
import { useT } from '../../i18n';
import { SubPage } from '../../app/SubPage';
import type { CalibrationDueItem } from '../../domain/calibration';
import { CalibrationListSheet } from './CalibrationListSheet';
import { ContributionSheet } from './ContributionSheet';
import { RebalanceSheet } from './RebalanceSheet';
import { PortfolioSettings } from './PortfolioSettings';
import { usePlanData } from './usePlanData';
import { WithdrawalSheet } from './WithdrawalSheet';
import './plan.css';

type SheetState =
  | null
  | { kind: 'contribution' }
  | { kind: 'withdrawal' }
  | { kind: 'rebalance' }
  | { kind: 'calibrationList' }
  | { kind: 'calibration'; item: CalibrationDueItem };

/** Where a marker sits on the progress bar (0–100%). */
const markerLeft = (value: number, scale: number) => `calc(${Math.min(100, (value / scale) * 100)}% - 1.5px)`;

export function PlanPage() {
  const [sheet, setSheet] = useState<SheetState>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const fx = useAppStore((s) => s.fx);
  const t = useT();
  const hide = useAppStore((s) => s.hideAmounts);
  const data = usePlanData();
  const { portfolio, plan, retirement, biggest } = data;
  const money = (cny: number) => formatMoney(cny, displayCurrency, fx, t.locale, hide);
  const closeSheet = () => setSheet(null);

  const total = portfolio.totalCny;
  const scale = Math.max(retirement.need4, plan.targetAmount, total) || 1;
  const rebalanceSummary = biggest
    ? t.plan.biggestOff(
        slotName(biggest.key, portfolio.exposureById, t),
        biggest.curPct > biggest.tgtPct,
        Math.abs(biggest.diffPct).toFixed(1),
        data.offCount,
        plan.threshold,
      )
    : t.plan.allWithin(plan.threshold);
  const due = data.due;
  // The same instrument in several accounts counts once per account; the preview lists each code once (the prototype showed "VOO, VOO")
  const dueCodes = [...new Set(due.map((d) => d.code))];
  const calibrationSummary = due.length ? t.plan.dueToCheck(due.length, dueCodes.slice(0, 3), dueCodes.length > 3) : t.plan.allChecked;

  return (
    <section className="page plan">
      <div className="plan-header">
        <h1 className="page-title">{t.plan.title}</h1>
        <button type="button" className="btn btn-secondary" onClick={() => setSettingsOpen(true)}>
          {t.plan.portfolioSettings}
        </button>
      </div>

      <div className="plan-goal">
        <div className="plan-goal-head">
          <span className="plan-muted">{t.plan.goalLabel}</span>
          <span className="plan-goal-year">{t.plan.goalYear(retirement.yearTarget)}</span>
          <span className="plan-muted">{t.plan.goalSub(money(total), plan.expectedReturnPct, plan.inflationPct)}</span>
        </div>
        <div className="plan-progress">
          <div className="plan-progress-fill" style={{ width: `${Math.min(100, (total / scale) * 100)}%` }} />
          <div className="plan-progress-mark" style={{ left: markerLeft(retirement.need4, scale) }} />
          <div className="plan-progress-mark" style={{ left: markerLeft(plan.targetAmount, scale) }} />
        </div>
        <div className="plan-goal-cols">
          <div className="plan-goal-col">
            <span className="plan-small">{t.plan.fourPctRule(money(plan.annualSpend))}</span>
            <span className="plan-goal-amount">{money(retirement.need4)}</span>
            <span className="plan-small">{t.plan.progress(retirement.pctOf4.toFixed(0), retirement.year4)}</span>
          </div>
          <div className="plan-goal-col">
            <span className="plan-small">{t.plan.myTarget}</span>
            <span className="plan-goal-amount">{money(plan.targetAmount)}</span>
            <span className="plan-small">{t.plan.progress(retirement.pctOfTarget.toFixed(0), retirement.yearTarget)}</span>
          </div>
        </div>
      </div>

      <div className="plan-alloc">
        <div className="plan-alloc-head">
          <span className="plan-section-title">{t.plan.allocation}</span>
          <span className={`tag ${data.offCount ? 'tag-accent' : 'tag-accent-2'}`}>{data.offCount ? t.plan.offTarget(data.offCount) : t.plan.balanced}</span>
        </div>
        <div className="plan-alloc-bar">
          {portfolio.slots.map((s) => (
            <div key={s.key} style={{ flex: Math.max(s.curPct, 0.01), background: slotColor(s.key) }} />
          ))}
        </div>
        <div>
          {portfolio.slots.map((s) => (
            <div key={s.key} className="plan-slot">
              <span className="dot" style={{ background: slotColor(s.key) }} />
              <span className="plan-slot-name">
                {slotName(s.key, portfolio.exposureById, t)}
                {s.untargeted && <span className="tag tag-accent">{t.plan.notInTarget}</span>}
              </span>
              <span className="plan-slot-pct">
                {s.curPct.toFixed(1)}% / {s.untargeted ? (plan.undefinedMode === 'ignore' ? t.plan.ignored : '0%') : `${s.tgtPct}%`}
              </span>
              <span className={`plan-slot-diff${s.off ? ' is-off' : ''}`}>
                {s.diffPct > 0 ? '+' : s.diffPct < 0 ? sign(s.diffPct) : ''}
                {Math.abs(s.diffPct).toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <span className="panel-title">{t.plan.moneyTitle}</span>
        <span className="panel-text">{t.plan.moneyText}</span>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setSheet({ kind: 'contribution' })}>
            {t.plan.investNew}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setSheet({ kind: 'withdrawal' })}>
            {t.plan.withdraw}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">{t.plan.rebalanceTitle}</span>
          <span className="panel-meta">{t.plan.rebalanceEvery(plan.rebalancePeriod, data.rebalanceDays)}</span>
        </div>
        {data.rebalance.due && (
          <span className="rebal-due">{t.plan.notCheckedYet(plan.rebalancePeriod, data.rebalance.offCount, plan.threshold)}</span>
        )}
        {data.rebalance.checkedThisPeriod && plan.lastRebalancedOn && (
          <span className="rebal-checked">{t.plan.checkedOn(plan.rebalancePeriod, plan.lastRebalancedOn)}</span>
        )}
        <span className="panel-text">{rebalanceSummary}</span>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={() => setSheet({ kind: 'rebalance' })}>
            {t.plan.seeSteps}
          </button>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">{t.plan.calibrationTitle}</span>
          <span className="panel-meta">{t.plan.calibrateEvery(plan.calibPeriod, data.calibrationDays)}</span>
        </div>
        <span className="panel-text">{calibrationSummary}</span>
        {due.length > 0 && (
          <div className="actions">
            <button type="button" className="btn btn-secondary" onClick={() => setSheet({ kind: 'calibrationList' })}>
              {t.plan.startCalibrating}
            </button>
          </div>
        )}
      </div>

      {sheet?.kind === 'contribution' && <ContributionSheet onClose={closeSheet} />}
      {sheet?.kind === 'withdrawal' && <WithdrawalSheet onClose={closeSheet} />}
      {sheet?.kind === 'rebalance' && <RebalanceSheet steps={data.steps} exposures={portfolio.exposureById} onClose={closeSheet} />}
      {sheet?.kind === 'calibrationList' && (
        <CalibrationListSheet items={due} onOpen={(item) => setSheet({ kind: 'calibration', item })} onClose={closeSheet} />
      )}
      {sheet?.kind === 'calibration' && (
        <CalibrationSheet
          accountId={sheet.item.accountId}
          code={sheet.item.code}
          onDone={() => setSheet({ kind: 'calibrationList' })}
        />
      )}
      {settingsOpen && (
        <SubPage title={t.plan.portfolioSettings} backLabel={t.plan.title} onBack={() => setSettingsOpen(false)}>
          <PortfolioSettings />
        </SubPage>
      )}
    </section>
  );
}
