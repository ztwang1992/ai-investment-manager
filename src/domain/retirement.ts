// Retirement projection. See README「计划 · 退休目标卡片」:
// real return = (1 + return) / (1 + inflation) − 1; years to target = ceil(ln(target / total assets) / ln(1 + real return)), with no monthly contributions.

export interface RetirementProjection {
  realReturn: number;
  /** The amount the 4% rule needs = annual spending ÷ 4% */
  need4: number;
  yearsToTarget: number | null;
  yearsTo4: number | null;
  yearTarget: number | null;
  year4: number | null;
  /** Percentage reached, at most 100 */
  pctOfTarget: number;
  pctOf4: number;
}

export function projectRetirement(i: {
  totalCny: number;
  annualSpend: number;
  targetAmount: number;
  expectedReturnPct: number;
  inflationPct: number;
  currentYear: number;
}): RetirementProjection {
  const realReturn = (1 + i.expectedReturnPct / 100) / (1 + i.inflationPct / 100) - 1;
  const need4 = i.annualSpend / 0.04;

  const yearsTo = (target: number): number | null => {
    if (i.totalCny >= target) return 0;
    if (i.totalCny <= 0 || realReturn <= 0) return null;
    return Math.ceil(Math.log(target / i.totalCny) / Math.log(1 + realReturn));
  };
  const pctOf = (target: number) => (target > 0 ? Math.min(100, Math.max(0, (i.totalCny / target) * 100)) : 100);

  const yearsToTarget = yearsTo(i.targetAmount);
  const yearsTo4 = yearsTo(need4);
  return {
    realReturn,
    need4,
    yearsToTarget,
    yearsTo4,
    yearTarget: yearsToTarget === null ? null : i.currentYear + yearsToTarget,
    year4: yearsTo4 === null ? null : i.currentYear + yearsTo4,
    pctOfTarget: pctOf(i.targetAmount),
    pctOf4: pctOf(need4),
  };
}
