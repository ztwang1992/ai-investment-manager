import { describe, expect, it } from 'vitest';
import { projectRetirement } from './retirement';

const prototype = {
  totalCny: 3_105_000,
  annualSpend: 300_000,
  targetAmount: 8_000_000,
  expectedReturnPct: 7,
  inflationPct: 2.5,
  currentYear: 2026,
};

describe('projectRetirement', () => {
  it('reproduces the prototype screenshot: target in 2049, 4% rule in 2047', () => {
    const p = projectRetirement(prototype);
    expect(p.realReturn).toBeCloseTo(1.07 / 1.025 - 1, 12);
    expect(p.need4).toBe(7_500_000);
    expect(p.yearTarget).toBe(2049);
    expect(p.year4).toBe(2047);
    expect(Math.round(p.pctOfTarget)).toBe(39);
    expect(Math.round(p.pctOf4)).toBe(41);
  });

  it('says 0 years and 100% once the target is reached', () => {
    const p = projectRetirement({ ...prototype, totalCny: 9_000_000 });
    expect(p.yearsToTarget).toBe(0);
    expect(p.yearTarget).toBe(2026);
    expect(p.pctOfTarget).toBe(100);
  });

  it('cannot project with a real return of zero or less', () => {
    const p = projectRetirement({ ...prototype, expectedReturnPct: 2, inflationPct: 3 });
    expect(p.yearsToTarget).toBeNull();
    expect(p.yearTarget).toBeNull();
    expect(p.year4).toBeNull();
  });

  it('cannot project from an empty portfolio', () => {
    const p = projectRetirement({ ...prototype, totalCny: 0 });
    expect(p.yearsToTarget).toBeNull();
    expect(p.pctOfTarget).toBe(0);
    expect(Number.isNaN(p.pctOf4)).toBe(false);
  });
});
