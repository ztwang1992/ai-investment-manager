// Period return = (ending value − starting value − net flow in the period) ÷ (starting value + max(0, net flow in the period) / 2). See README「收益」.

export function rangeReturn(i: { startValue: number; endValue: number; netInflow: number }): {
  gain: number;
  /** A percentage; null when the denominator isn't above 0 */
  pct: number | null;
} {
  const gain = i.endValue - i.startValue - i.netInflow;
  const base = i.startValue + Math.max(0, i.netInflow) / 2;
  return { gain, pct: base > 0 ? (gain / base) * 100 : null };
}
