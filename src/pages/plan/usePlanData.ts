import { useMemo } from 'react';
import { useAppStore } from '../../app/store';
import { usePortfolio } from '../../app/usePortfolio';
import { calibrationDue } from '../../domain/calibration';
import { daysBetween, nextPeriodStart } from '../../domain/dates';
import { rebalanceStatus } from '../../domain/rebalance';
import { projectRetirement } from '../../domain/retirement';
import { rebalanceSteps } from '../../domain/slots';

/** What the Plan page derives: the retirement target, deviations, rebalancing steps, calibration reminders and countdown. */
export function usePlanData() {
  const portfolio = usePortfolio();
  const plan = useAppStore((s) => s.plan);
  const today = useAppStore((s) => s.today);
  const transactions = useAppStore((s) => s.transactions);

  return useMemo(() => {
    const retirement = projectRetirement({
      totalCny: portfolio.totalCny,
      annualSpend: plan.annualSpend,
      targetAmount: plan.targetAmount,
      expectedReturnPct: plan.expectedReturnPct,
      inflationPct: plan.inflationPct,
      currentYear: Number(today.slice(0, 4)),
    });
    const offSlots = portfolio.slots.filter((s) => s.off);
    const biggest = [...offSlots].sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct))[0];
    return {
      portfolio,
      plan,
      retirement,
      offCount: offSlots.length,
      biggest,
      steps: rebalanceSteps(portfolio.slots, portfolio.totalCny),
      rebalance: rebalanceStatus({ slots: portfolio.slots, plan, today }),
      rebalanceDays: daysBetween(today, nextPeriodStart(today, plan.rebalancePeriod)),
      calibrationDays: daysBetween(today, nextPeriodStart(today, plan.calibPeriod)),
      due: calibrationDue({ rows: portfolio.rows, totalCny: portfolio.totalCny, transactions, today, period: plan.calibPeriod }),
    };
  }, [portfolio, plan, today, transactions]);
}


/** Whether a rebalancing reminder is due (for the small dot on the Plan tab) */
export function useRebalanceDue(): boolean {
  const portfolio = usePortfolio();
  const plan = useAppStore((s) => s.plan);
  const today = useAppStore((s) => s.today);
  return useMemo(() => rebalanceStatus({ slots: portfolio.slots, plan, today }).due, [portfolio, plan, today]);
}
