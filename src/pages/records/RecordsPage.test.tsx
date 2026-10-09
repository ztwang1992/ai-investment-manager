// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MASK } from '../../app/format';
import { useAppStore } from '../../app/store';
import type { AppState } from '../../app/store';
import { INITIAL_SYNC, useSyncStore } from '../../app/sync';
import { RecordsPage } from './RecordsPage';

let initial: AppState;
beforeEach(() => {
  initial = useAppStore.getState();
});
afterEach(() => {
  cleanup();
  useAppStore.setState(initial, true);
  useSyncStore.setState(INITIAL_SYNC, true);
});

const rows = () => [...document.querySelectorAll('.rec-row')].map((r) => r.textContent);
const months = () => [...document.querySelectorAll('.rec-month')].map((m) => m.textContent);
const chip = (name: string) => screen.getByRole('button', { name });

describe('Records page', () => {
  it('lists every record newest first, grouped by month', () => {
    render(<RecordsPage />);
    expect(screen.getByText('36 records')).toBeTruthy();
    expect(months()[0]).toBe('September 2026');
    expect(rows().slice(0, 3)).toEqual([
      '513500 标普500ETFBuyChina Merchants Securities · Sep 1810,000 × ¥2.05',
      'Money inDepositChina Merchants Securities · Sep 18+¥20,500 · Auto deposit to cover a buy',
      'VOO Vanguard S&P 500BuyFutu · Sep 210 × $528',
    ]);
    expect(chip('All').getAttribute('aria-pressed')).toBe('true');
  });

  it('filters by time', () => {
    render(<RecordsPage />);
    fireEvent.click(chip('7 days'));
    expect(screen.getByText('0 records')).toBeTruthy();
    expect(screen.getByText('No matching records in this period')).toBeTruthy();
    fireEvent.click(chip('Last month'));
    expect(months()).toEqual(['August 2026']);
    expect(rows()).toHaveLength(3);
  });

  it('filters by type', () => {
    render(<RecordsPage />);
    fireEvent.click(screen.getByRole('radio', { name: 'Calibration' }));
    expect(rows()).toEqual(['VOO Vanguard S&P 500CalibrationFutu · Jun 20+0.84 shares · Dividends reinvested']);
  });

  it('flips to oldest first, where the opening records come first', () => {
    render(<RecordsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Newest first ↓' }));
    expect(screen.getByRole('button', { name: 'Oldest first ↑' })).toBeTruthy();
    expect(months()[0]).toBe('January 2025');
    expect(rows()[0]).toBe('VOO Vanguard S&P 500Opening entryFutu · Jan 2109.16 × $450');
  });

  it('hides every amount when the eye is closed', () => {
    useAppStore.setState({ hideAmounts: true });
    render(<RecordsPage />);
    const amounts = [...document.querySelectorAll('.rec-amount')].map((a) => a.textContent);
    expect(amounts).toHaveLength(36);
    expect(new Set(amounts)).toEqual(new Set([MASK]));
  });

  it('reads as before in Chinese', () => {
    useAppStore.setState({ locale: 'zh' });
    render(<RecordsPage />);
    expect(screen.getByText('共 36 条记录')).toBeTruthy();
    expect(months()[0]).toBe('2026 年 9 月');
    expect(chip('全部').getAttribute('aria-pressed')).toBe('true');
    expect(rows()[1]).toMatch(/^转入资金入金.* · 09-18\+¥20,500 · 买入时现金不足自动补记$/);
  });
});

describe('records waiting to upload', () => {
  it('says how many records are waiting under the title', () => {
    useSyncStore.setState({ state: 'offline', pending: 2, lastSyncedAt: null });
    render(<RecordsPage />);
    expect(screen.getByText('2 records waiting to sync · uploads when online')).toBeTruthy();
  });

  it('says nothing when everything is uploaded', () => {
    render(<RecordsPage />);
    expect(screen.queryByText(/waiting to sync/)).toBeNull();
  });
});
