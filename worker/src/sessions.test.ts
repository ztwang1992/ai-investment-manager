import { describe, expect, it } from 'vitest';
import { freshUntil, inSession } from './sessions';

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();

describe('trading sessions', () => {
  // US stocks: 9:30–16:30 New York time (half an hour extra for the closing price)
  it('knows US hours in Eastern time', () => {
    expect(inSession('us', at('2026-09-30T13:29:00Z'))).toBe(false); // 09:29 EDT
    expect(inSession('us', at('2026-09-30T13:30:00Z'))).toBe(true);
    expect(inSession('us', at('2026-09-30T20:29:00Z'))).toBe(true); // 16:29 EDT
    expect(inSession('us', at('2026-09-30T20:30:00Z'))).toBe(false);
    expect(inSession('us', at('2026-10-03T15:00:00Z'))).toBe(false); // Saturday
  });

  // In 2026, daylight saving runs from March 8 to November 1: the opening time in UTC shifts by an hour
  it('moves the US open with daylight saving time', () => {
    expect(inSession('us', at('2026-03-06T13:30:00Z'))).toBe(false); // Friday 08:30 EST
    expect(inSession('us', at('2026-03-06T14:30:00Z'))).toBe(true);
    expect(inSession('us', at('2026-03-09T13:30:00Z'))).toBe(true); // Monday 09:30 EDT
    expect(inSession('us', at('2026-11-02T13:30:00Z'))).toBe(false); // Monday 08:30 EST
    expect(inSession('us', at('2026-11-02T14:30:00Z'))).toBe(true);
  });

  // A-shares and funds: 9:30–15:30 Beijing time
  it('knows A-share hours in Beijing time', () => {
    expect(inSession('cn', at('2026-09-30T01:29:00Z'))).toBe(false); // 09:29
    expect(inSession('cn', at('2026-09-30T01:30:00Z'))).toBe(true);
    expect(inSession('fund', at('2026-09-30T07:29:00Z'))).toBe(true); // 15:29
    expect(inSession('fund', at('2026-09-30T07:30:00Z'))).toBe(false);
    expect(inSession('cn', at('2026-10-03T03:00:00Z'))).toBe(false); // Saturday
  });

  it('treats every weekday as an FX session', () => {
    expect(inSession('fx', at('2026-10-02T23:59:00Z'))).toBe(true); // Friday
    expect(inSession('fx', at('2026-10-03T12:00:00Z'))).toBe(false); // Saturday
  });
});

describe('how long a price stays fresh', () => {
  it('lasts 15 minutes in session', () => {
    expect(iso(freshUntil('us', at('2026-09-30T19:55:00Z')))).toBe('2026-09-30T20:10:00.000Z'); // 15:55 EDT
  });

  it('lasts 6 hours after the close', () => {
    expect(iso(freshUntil('us', at('2026-09-30T20:40:00Z')))).toBe('2026-10-01T02:40:00.000Z'); // 16:40 EDT
    expect(iso(freshUntil('fx', at('2026-10-03T12:00:00Z')))).toBe('2026-10-03T18:00:00.000Z');
  });

  it('ends at the next open', () => {
    expect(iso(freshUntil('us', at('2026-10-01T10:00:00Z')))).toBe('2026-10-01T13:30:00.000Z'); // 06:00 EDT → 09:30
    expect(iso(freshUntil('cn', at('2026-09-30T23:00:00Z')))).toBe('2026-10-01T01:30:00.000Z'); // Beijing 07:00 -> 09:30
    expect(iso(freshUntil('fx', at('2026-10-04T21:00:00Z')))).toBe('2026-10-05T00:00:00.000Z'); // Sunday -> Monday
    expect(iso(freshUntil('us', at('2026-03-09T09:07:00Z')))).toBe('2026-03-09T13:30:00.000Z'); // first trading day of daylight saving
    expect(iso(freshUntil('us', at('2026-11-02T10:00:00Z')))).toBe('2026-11-02T14:30:00.000Z'); // first trading day of standard time, 05:00 EST -> 09:30
    expect(iso(freshUntil('cn', at('2026-10-04T23:00:00Z')))).toBe('2026-10-05T01:30:00.000Z'); // Beijing Monday 07:00 -> 09:30
  });

  it('takes the 6 hours when the next open is further away', () => {
    expect(iso(freshUntil('us', at('2026-10-02T21:00:00Z')))).toBe('2026-10-03T03:00:00.000Z'); // Friday 17:00 EDT
    expect(iso(freshUntil('cn', at('2026-10-02T08:00:00Z')))).toBe('2026-10-02T14:00:00.000Z'); // Beijing Friday 16:00
    expect(iso(freshUntil('cn', at('2026-10-03T23:00:00Z')))).toBe('2026-10-04T05:00:00.000Z'); // Beijing Sunday 07:00
    expect(iso(freshUntil('fx', at('2026-10-03T00:00:00Z')))).toBe('2026-10-03T06:00:00.000Z'); // Saturday
  });
});
