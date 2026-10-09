import { describe, expect, it } from 'vitest';
import { rangeReturn } from './returns';

describe('rangeReturn', () => {
  it('counts half of a positive net inflow in the base', () => {
    const r = rangeReturn({ startValue: 100, endValue: 120, netInflow: 10 });
    expect(r.gain).toBe(10);
    expect(r.pct).toBeCloseTo((10 / 105) * 100, 12);
  });

  it('does not shrink the base for a net outflow', () => {
    const r = rangeReturn({ startValue: 100, endValue: 120, netInflow: -10 });
    expect(r.gain).toBe(30);
    expect(r.pct).toBeCloseTo(30, 12);
  });

  it('works from an empty start when money came in', () => {
    const r = rangeReturn({ startValue: 0, endValue: 110, netInflow: 100 });
    expect(r.gain).toBe(10);
    expect(r.pct).toBeCloseTo(20, 12);
  });

  it('returns null when there is no base to divide by', () => {
    expect(rangeReturn({ startValue: 0, endValue: 0, netInflow: 0 })).toEqual({ gain: 0, pct: null });
  });
});
