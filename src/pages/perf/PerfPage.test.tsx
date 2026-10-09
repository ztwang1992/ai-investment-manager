// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../app/store';
import type { AppState } from '../../app/store';
import { MASK } from '../../app/format';
import { PerfPage } from './PerfPage';

let initial: AppState;
beforeEach(() => {
  initial = useAppStore.getState();
});
afterEach(() => {
  cleanup();
  useAppStore.setState(initial, true);
});

describe('PerfPage', () => {
  it('shows the current total assets, the range gain and the principal', () => {
    render(<PerfPage />);
    expect(screen.getByRole('heading', { name: 'Returns' })).toBeTruthy();
    expect(screen.getByTestId('perf-big').textContent).toBe('¥3.10M');
    expect(screen.getByTestId('perf-gain').textContent).toMatch(/^1-year gain [+−]¥[\d.]+K · [+−][\d.]+%$/);
    expect(screen.getByTestId('perf-sub').textContent).toMatch(/^Net invested ¥[\d.]+M$/);
  });

  it('hides every amount but keeps percentages when the eye is closed', () => {
    render(<PerfPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Show or hide amounts' }));
    expect(screen.getByTestId('perf-big').textContent).toBe(MASK);
    expect(screen.getByTestId('perf-gain').textContent).toMatch(/^1-year gain [+−][\d.]+%$/);
    expect(screen.getByTestId('perf-range-pct').textContent).toMatch(/%$/);
    expect(screen.getByTestId('perf-range-in').textContent).toBe(MASK);
  });

  it('switches the range', () => {
    render(<PerfPage />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Period' }), { target: { value: '3m' } });
    expect(screen.getByTestId('perf-gain').textContent).toMatch(/^3-month gain /);
    expect(screen.getByText('Performance by asset · 3 months')).toBeTruthy();
  });

  it('shows ¥0 net inflow and no flow list when nothing moved in the range', () => {
    render(<PerfPage />);
    // The sample's last deposit is on 09-18: nothing moved in the last week
    fireEvent.change(screen.getByRole('combobox', { name: 'Period' }), { target: { value: '1w' } });
    expect(screen.getByTestId('perf-range-in').textContent).toBe('¥0');
    expect(screen.queryByText('Money in and out')).toBeNull();
  });

  it('shows dollars in the USD view', () => {
    render(<PerfPage />);
    fireEvent.click(screen.getByRole('radio', { name: 'USD' }));
    expect(screen.getByTestId('perf-big').textContent).toMatch(/^\$[\d.]+K$/);
  });

  it('shows the empty state for a brand-new portfolio', () => {
    useAppStore.setState({ snapshots: [], snapshotItems: [] });
    render(<PerfPage />);
    expect(screen.getByText(/Your returns chart starts today/)).toBeTruthy();
    expect(screen.queryByTestId('perf-gain')).toBeNull();
  });

  it('reads the same in Chinese', () => {
    useAppStore.setState({ locale: 'zh' });
    render(<PerfPage />);
    expect(screen.getByRole('heading', { name: '收益' })).toBeTruthy();
    expect(screen.getByTestId('perf-gain').textContent).toMatch(/^1年收益 [+−]¥[\d.]+万 · [+−][\d.]+%$/);
    expect(screen.getByTestId('perf-sub').textContent).toMatch(/^净投入本金 ¥[\d.]+万$/);
    expect(screen.getByText('各资产表现 · 1年')).toBeTruthy();
  });
});
