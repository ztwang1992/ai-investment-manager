import { periodStart } from './dates';
import type { Slot } from './slots';
import type { Plan } from './types';

// Rebalancing reminder (BUILD_PLAN phase 5, item 4): by threshold and check period, shown in the app.
// Remind when this period (month / quarter / year) hasn't been marked done and some asset is off by more than the threshold; once marked, look again next period.
// Whether a slot is off target is decided in computeSlots: an asset not in the target is off under "Suggest selling", not under "Leave out".

export interface RebalanceStatus {
  /** Time for a reminder */
  due: boolean;
  /** Slots off by more than the threshold */
  offCount: number;
  /** This period has already been marked done */
  checkedThisPeriod: boolean;
  /** The day this period starts */
  periodStart: string;
}

export function rebalanceStatus(i: { slots: readonly Slot[]; plan: Plan; today: string }): RebalanceStatus {
  const start = periodStart(i.today, i.plan.rebalancePeriod);
  const last = i.plan.lastRebalancedOn;
  const checkedThisPeriod = !!last && last >= start;
  const offCount = i.slots.filter((s) => s.off).length;
  return { due: offCount > 0 && !checkedThisPeriod, offCount, checkedThisPeriod, periodStart: start };
}
