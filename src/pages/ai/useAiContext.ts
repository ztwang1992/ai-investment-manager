import { useMemo } from 'react';
import { slotName } from '../../app/palette';
import { useAppStore } from '../../app/store';
import { groupByAccount } from '../../domain/holdingsView';
import { rangeStart } from '../../domain/performance';
import { usePerfData } from '../perf/usePerfData';
import { usePlanData } from '../plan/usePlanData';
import { accountKind, portfolioSummary } from './aiContext';
import type { SummaryInput } from './aiContext';
import { useT } from '../../i18n';

/** The portfolio summary for the model: the same data as Plan and Returns (last year), always in CNY, in the interface language. */
export function useAiContext(): string {
  const t = useT();
  const data = usePlanData();
  const perf = usePerfData('1y');
  const accounts = useAppStore((s) => s.accounts);
  const groups = useAppStore((s) => s.groups);
  const today = useAppStore((s) => s.today);

  return useMemo(() => {
    const { portfolio, plan, retirement, rebalance } = data;
    const name = (key: string) => slotName(key, portfolio.exposureById, t);
    const shares = groupByAccount({ rows: portfolio.rows, accounts, groups });
    // With less than a year of history, Returns' period starts on the first day
    const yearAgo = rangeStart(today, '1y', '0000-01-01');
    const first = perf.points[0]?.date;
    const input: SummaryInput = {
      totalCny: portfolio.totalCny,
      netInvestedCny: portfolio.ledger.netInvestedCny,
      slots: portfolio.slots.map((s) => ({ name: name(s.key), curPct: s.curPct, tgtPct: s.tgtPct, untargeted: s.untargeted })),
      undefinedMode: plan.undefinedMode,
      threshold: plan.threshold,
      period: plan.rebalancePeriod,
      checkedThisPeriod: rebalance.checkedThisPeriod,
      accounts: accounts.map((a) => ({ name: a.name, kind: accountKind(a, t), sharePct: shares.find((l) => l.accountId === a.id)?.sharePct ?? 0 })),
      performance: { since: first && first > yearAgo ? first : null, items: perf.slots.map((s) => ({ name: name(s.slotKey), pct: s.pct })) },
      retirement: {
        annualSpend: plan.annualSpend,
        targetAmount: plan.targetAmount,
        expectedReturnPct: plan.expectedReturnPct,
        inflationPct: plan.inflationPct,
        yearsToTarget: retirement.yearsToTarget,
        yearTarget: retirement.yearTarget,
      },
    };
    return portfolioSummary(input, t);
  }, [data, perf, accounts, groups, today, t]);
}
