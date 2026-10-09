// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../app/store';
import type { AppState } from '../../app/store';
import { PortfolioSettings } from './PortfolioSettings';

let initial: AppState;
beforeEach(() => {
  initial = useAppStore.getState();
});
afterEach(() => {
  cleanup();
  useAppStore.setState(initial, true);
});

const state = () => useAppStore.getState();
const input = (name: string) => screen.getByLabelText(`${name} target share`) as HTMLInputElement;
const setInput = (name: string, value: string) => fireEvent.change(input(name), { target: { value } });
const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const edit = () => fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
const openAddSheet = () => {
  edit();
  fireEvent.click(screen.getByRole('button', { name: '+ Add a target asset' }));
  return screen.getByRole('dialog', { name: 'Add a target asset' });
};

describe('Target allocation — view and edit', () => {
  it('lists the targets and a 100% total', () => {
    render(<PortfolioSettings />);
    expect(screen.getByTestId('targets-sum').textContent).toBe('100%');
    expect(screen.getByText('S&P 500')).toBeTruthy();
  });

  it('refuses to save over 100%, then saves once the total is back to 100%', () => {
    render(<PortfolioSettings />);
    edit();
    expect(screen.getByText('Editing')).toBeTruthy();
    setInput('S&P 500', '50');
    expect(screen.getByText('Total 110%, 10% over. Lower some shares before saving.')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
    setInput('S&P 500', '35');
    setInput('Nasdaq 100', '20');
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    expect(state().targets).toMatchObject({ sp500: 35, ndx: 20 });
    expect(state().toast).toBe('Target allocation saved');
    expect(screen.queryByText('Editing')).toBeNull();
  });

  it('flags a blank entry', () => {
    render(<PortfolioSettings />);
    edit();
    setInput('Gold', '');
    expect(screen.getByText('Each share must be a number from 0 to 100')).toBeTruthy();
    expect(saveButton().disabled).toBe(true);
  });

  it('says how much is missing after removing a target', () => {
    render(<PortfolioSettings />);
    edit();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Gold' }));
    expect(screen.getByText('5% not assigned yet. The total must be 100% to save.')).toBeTruthy();
  });

  it('sets a stock apart from individual stocks and merges it back', () => {
    render(<PortfolioSettings />);
    edit();
    fireEvent.click(screen.getByRole('button', { name: 'Apple · set apart' }));
    expect(input('Apple').value).toBe('0');
    setInput('Apple', '4');
    fireEvent.click(screen.getByRole('button', { name: 'Apple · merge back into individual stocks' }));
    expect(screen.queryByLabelText('Apple target share')).toBeNull();
    expect(input('Individual stocks').value).toBe('14');
  });
});

describe('Target allocation — adding assets', () => {
  it('only offers to add a target asset while editing (as in the prototype)', () => {
    render(<PortfolioSettings />);
    expect(screen.queryByRole('button', { name: '+ Add a target asset' })).toBeNull();
    edit();
    expect(screen.getByRole('button', { name: '+ Add a target asset' })).toBeTruthy();
  });

  it('adds a preset asset from the sheet', () => {
    render(<PortfolioSettings />);
    const sheet = openAddSheet();
    fireEvent.click(within(sheet).getByRole('button', { name: 'International ex-US · held' }));
    expect(screen.queryByRole('dialog', { name: 'Add a target asset' })).toBeNull();
    expect(input('International ex-US').value).toBe('0');
    expect(state().toast).toBe('Added · International ex-US. Fill in its share, then save.');
  });

  it('adds a custom asset and rejects blank or duplicate names', () => {
    render(<PortfolioSettings />);
    const sheet = openAddSheet();
    const name = within(sheet).getByLabelText('Asset name');
    const add = () => fireEvent.click(within(sheet).getByRole('button', { name: 'Add custom asset' }));
    add();
    expect(within(sheet).getByText('Enter an asset name')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'Bitcoin' } });
    add();
    expect(input('Bitcoin').value).toBe('0');
    expect(state().exposures.some((e) => e.name === 'Bitcoin')).toBe(true);
    expect(state().toast).toBe('Custom asset added · Bitcoin');
  });

  // A preset is stored under its Chinese name but shown under its English one: both are taken
  it('treats a preset name as taken in either language', () => {
    render(<PortfolioSettings />);
    const sheet = openAddSheet();
    const name = within(sheet).getByLabelText('Asset name');
    for (const taken of ['Gold', '黄金']) {
      fireEvent.change(name, { target: { value: taken } });
      fireEvent.click(within(sheet).getByRole('button', { name: 'Add custom asset' }));
      expect(within(sheet).getByText('An asset with this name already exists'), taken).toBeTruthy();
    }
  });
});

describe('Assets not in target', () => {
  it('lists held assets without a target and can add one to the draft', () => {
    render(<PortfolioSettings />);
    expect(screen.getByText('1 asset')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'International ex-US · add to target' }));
    expect(input('International ex-US').value).toBe('0');
    expect(state().toast).toBe('Added to the edit: International ex-US. Fill in its share, then save.');
  });

  it('can leave them out of rebalancing', () => {
    render(<PortfolioSettings />);
    expect(screen.getByRole('radio', { name: 'Suggest selling' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Leave out' }));
    expect(state().plan.undefinedMode).toBe('ignore');
  });
});

describe('rules, goals and display currency', () => {
  it('adjusts the threshold within 1–20%', () => {
    render(<PortfolioSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Raise the drift threshold' }));
    expect(state().plan.threshold).toBe(4);
    expect(screen.getByText('±4%')).toBeTruthy();
    for (let k = 0; k < 10; k++) fireEvent.click(screen.getByRole('button', { name: 'Lower the drift threshold' }));
    expect(state().plan.threshold).toBe(1);
  });

  it('changes the check and calibration periods', () => {
    render(<PortfolioSettings />);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Regular check' })).getByRole('radio', { name: 'Monthly' }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Calibration reminder' })).getByRole('radio', { name: 'Yearly' }));
    expect(state().plan).toMatchObject({ rebalancePeriod: 'month', calibPeriod: 'year' });
  });

  it('updates the long-term goals, treating a cleared field as 0', () => {
    render(<PortfolioSettings />);
    fireEvent.change(screen.getByLabelText('Yearly spending in retirement (¥)'), { target: { value: '400000' } });
    fireEvent.change(screen.getByLabelText('Expected yearly return %'), { target: { value: '' } });
    expect(state().plan).toMatchObject({ annualSpend: 400000, expectedReturnPct: 0 });
  });

  it('changes the display currency', () => {
    render(<PortfolioSettings />);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Display currency' })).getByRole('radio', { name: 'HKD' }));
    expect(state().displayCurrency).toBe('HKD');
  });
});

describe('in Chinese', () => {
  it('reads as before', () => {
    useAppStore.setState({ locale: 'zh' });
    render(<PortfolioSettings />);
    expect(screen.getByText('标普 500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.change(screen.getByLabelText('标普 500 目标比例'), { target: { value: '50' } });
    expect(screen.getByText('合计 110%，超出 10%，请调低后再保存')).toBeTruthy();
  });
});
