import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../../i18n';
import { quoteStatusText } from './quoteStatus';

const en = MESSAGES.en;

// Local time: the status line shows the time on this device's clock
const now = new Date(2026, 9, 1, 21, 30);
const base = { connected: true, refreshing: false, error: false, updatedAt: null as Date | null, usdCny: 6.7045, now };

describe('quote status line', () => {
  it('says it is refreshing', () => {
    expect(quoteStatusText({ ...base, refreshing: true, error: true }, en)).toBe('Updating prices and exchange rates…');
  });

  it('shows the time, the dollar rate and the NAV note after an update', () => {
    expect(quoteStatusText({ ...base, updatedAt: new Date(2026, 9, 1, 21, 5) }, en)).toBe('Updated 21:05 · USD/CNY 6.7045 · mutual funds at T-1 NAV');
  });

  it('says quotes are unavailable and when the shown prices are from', () => {
    expect(quoteStatusText({ ...base, error: true, updatedAt: new Date(2026, 9, 1, 9, 5) }, en)).toBe('Quotes unavailable · showing prices from 09:05');
    expect(quoteStatusText({ ...base, error: true, updatedAt: new Date(2026, 8, 30, 21, 5) }, en)).toBe('Quotes unavailable · showing prices from Sep 30 21:05');
    expect(quoteStatusText({ ...base, error: true }, en)).toBe('Quotes unavailable');
  });

  it('waits before the first update', () => {
    expect(quoteStatusText(base, en)).toBe('Waiting for update');
  });

  // No VITE_API_BASE (viewing the sample data only, or a deployment without the quotes Worker): don't keep showing "Waiting for update"
  it('says there is no quotes service when none is set up', () => {
    expect(quoteStatusText({ ...base, connected: false }, en)).toBe('No quotes service');
  });

  it('says the same in Chinese, with a Chinese date', () => {
    expect(quoteStatusText({ ...base, error: true, updatedAt: new Date(2026, 8, 30, 21, 5) }, MESSAGES.zh)).toBe('行情暂不可用 · 显示的是 9月30日 21:05 的价格');
    expect(quoteStatusText({ ...base, connected: false }, MESSAGES.zh)).toBe('未连接行情服务');
  });
});
