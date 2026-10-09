import { describe, expect, it } from 'vitest';
import { addDays, beijingDate, daysBetween, nextPeriodStart, periodStart } from './dates';

describe('addDays', () => {
  it('moves forward and backward across month and year ends', () => {
    expect(addDays('2026-09-29', 3)).toBe('2026-10-02');
    expect(addDays('2026-09-29', -365)).toBe('2025-09-29');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
  });
});

describe('periodStart', () => {
  it('returns the first day of the month, quarter or year', () => {
    expect(periodStart('2026-09-29', 'month')).toBe('2026-09-01');
    expect(periodStart('2026-09-29', 'quarter')).toBe('2026-07-01');
    expect(periodStart('2026-09-29', 'year')).toBe('2026-01-01');
  });

  it('treats the first day itself as inside the period', () => {
    expect(periodStart('2026-10-01', 'quarter')).toBe('2026-10-01');
  });
});

describe('nextPeriodStart', () => {
  it('returns the first day of the following period', () => {
    expect(nextPeriodStart('2026-09-29', 'quarter')).toBe('2026-10-01');
    expect(nextPeriodStart('2026-09-29', 'month')).toBe('2026-10-01');
    expect(nextPeriodStart('2026-09-29', 'year')).toBe('2027-01-01');
  });

  it('rolls over the year end', () => {
    expect(nextPeriodStart('2026-12-15', 'quarter')).toBe('2027-01-01');
    expect(nextPeriodStart('2026-12-15', 'month')).toBe('2027-01-01');
  });
});

describe('daysBetween', () => {
  it('counts calendar days between two dates', () => {
    expect(daysBetween('2026-09-29', '2026-10-01')).toBe(2);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2026-10-01', '2026-09-29')).toBe(-2);
  });
});

describe('beijingDate', () => {
  // Beijing time is UTC+8 with no daylight saving: from 16:00 UTC it's already the next day
  it('gives the calendar date in Beijing', () => {
    expect(beijingDate(new Date('2026-09-30T15:59:59Z'))).toBe('2026-09-30');
    expect(beijingDate(new Date('2026-09-30T16:00:00Z'))).toBe('2026-10-01');
    expect(beijingDate(new Date('2026-12-31T16:30:00Z'))).toBe('2027-01-01');
  });
});
