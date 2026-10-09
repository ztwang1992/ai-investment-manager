// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyData, stateFromData } from '../app/persistence';
import { useAppStore } from '../app/store';
import type { AppState } from '../app/store';
import { AiPage } from './ai/AiPage';
import { HoldingsPage } from './holdings/HoldingsPage';
import { PerfPage } from './perf/PerfPage';
import { PlanPage } from './plan/PlanPage';
import { RecordsPage } from './records/RecordsPage';

let initial: AppState;
beforeEach(() => {
  initial = useAppStore.getState();
  useAppStore.setState(stateFromData(emptyData({ displayCurrency: 'CNY', hideAmounts: false })));
});
afterEach(() => {
  cleanup();
  useAppStore.setState(initial, true);
});

// A new account (no sample imported, no onboarding yet) must open every page without crashing; empty states are designed in phase 3
describe('a brand-new account', () => {
  it.each([
    ['Returns', PerfPage],
    ['Plan', PlanPage],
    ['Holdings', HoldingsPage],
    ['Records', RecordsPage],
    ['AI advisor', AiPage],
  ])('opens %s without crashing', (title, Page) => {
    render(<Page />);
    expect(screen.getAllByText(title).length).toBeGreaterThan(0);
  });

  it('counts no records', () => {
    render(<RecordsPage />);
    expect(screen.getByText('0 records')).toBeTruthy();
  });
});
