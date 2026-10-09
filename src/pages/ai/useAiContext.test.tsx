// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../app/store';
import type { AppState } from '../../app/store';
import { useAiContext } from './useAiContext';

let initial: AppState;
beforeEach(() => {
  initial = useAppStore.getState();
});
afterEach(() => {
  useAppStore.setState(initial, true);
});

describe('the summary of this portfolio', () => {
  it('uses the sample portfolio and names accounts without their ids', () => {
    const summary = renderHook(() => useAiContext()).result.current;
    expect(summary).toMatch(/^Total assets about ¥[\d.]+M, net invested ¥[\d.]+M, cumulative gain /);
    expect(summary).toContain('China Merchants Securities (CNY broker)');
    expect(summary).toContain('China Merchants Bank (bank)');
    expect(summary).toContain('Over the last year, by asset: ');
    expect(summary).toMatch(/Retirement goal: spending ¥300K a year, target ¥8M/);
    for (const id of ['futu', 'ibkr', 'cms', 'cmb']) expect(summary).not.toContain(id);
  });

  it('stays in yuan with amounts shown, whatever the screen shows', () => {
    const plain = renderHook(() => useAiContext()).result.current;
    useAppStore.setState({ hideAmounts: true, displayCurrency: 'USD' });
    expect(renderHook(() => useAiContext()).result.current).toBe(plain);
  });
});
