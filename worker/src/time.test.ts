import { describe, expect, it } from 'vitest';
import { beijingToUtc, easternToUtc } from './time';

describe('local market time to UTC', () => {
  it('reads US Eastern time, summer and winter', () => {
    expect(easternToUtc('2026-09-30 16:00:01')).toBe('2026-09-30T20:00:01.000Z');
    // In 2026, daylight saving runs from March 8 to November 1
    expect(easternToUtc('2026-03-06 16:00:00')).toBe('2026-03-06T21:00:00.000Z');
    expect(easternToUtc('2026-03-09 16:00:00')).toBe('2026-03-09T20:00:00.000Z');
    expect(easternToUtc('2026-10-30 09:30:00')).toBe('2026-10-30T13:30:00.000Z');
    expect(easternToUtc('2026-11-02 09:30:00')).toBe('2026-11-02T14:30:00.000Z');
  });

  it('reads Beijing time in both source formats', () => {
    expect(beijingToUtc('20260930161435')).toBe('2026-09-30T08:14:35.000Z');
    expect(beijingToUtc('2026-10-01 09:46:25')).toBe('2026-10-01T01:46:25.000Z');
    expect(beijingToUtc('2026-10-01 07:30:00')).toBe('2026-09-30T23:30:00.000Z');
  });

  it('gives null for text that is not a time', () => {
    expect(easternToUtc('')).toBeNull();
    expect(beijingToUtc('2026-13-01 10:00:00')).toBeNull();
    expect(beijingToUtc('--')).toBeNull();
  });
});
