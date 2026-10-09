// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyData, stateFromData } from '../../app/persistence';
import { useAppStore } from '../../app/store';
import type { AppState } from '../../app/store';
import { MARKET } from '../../domain/types';
import { OnboardingPage } from './OnboardingPage';
import type { OnboardingResult } from './OnboardingPage';

// First-time entry (README「首次录入引导」, the prototype's four screens). A new account's instruments and assets are the global presets.

let initial: AppState;
beforeEach(() => {
  initial = useAppStore.getState();
  useAppStore.setState({
    ...stateFromData(emptyData({ displayCurrency: 'CNY', hideAmounts: false })),
    today: '2026-10-02',
    fx: { CNY: 1, USD: 7, HKD: 0.9 },
  });
});
afterEach(() => {
  cleanup();
  useAppStore.setState(initial, true);
});

function setup(initialStep?: 0 | 1) {
  const onFinish = vi.fn<(r: OnboardingResult) => void>();
  const onDemo = vi.fn();
  render(<OnboardingPage onFinish={onFinish} onDemo={onDemo} {...(initialStep !== undefined ? { initialStep } : {})} />);
  return { onFinish, onDemo };
}
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const click = (name: string | RegExp) => act(() => void fireEvent.click(button(name)));
const fill = (label: string, value: string) => act(() => void fireEvent.change(screen.getByLabelText(label), { target: { value } }));
const heading = (name: string) => screen.getByRole('heading', { name });

/** Gets to step 2 with Futu and China Merchants Securities picked */
function toHoldings() {
  const r = setup(1);
  click('Futu · USD');
  click('China Merchants Securities · CNY');
  click('Next');
  return r;
}

describe('welcome', () => {
  it('offers to start from zero or to look at sample data first', () => {
    const { onDemo } = setup();
    expect(heading('Start managing your portfolio')).toBeTruthy();
    click('Look at sample data first');
    expect(onDemo).toHaveBeenCalled();
    click('Start from scratch');
    expect(heading('Where do you hold assets?')).toBeTruthy();
    expect(screen.getByText('Step 1 of 3')).toBeTruthy();
  });
});

describe('step 1: accounts', () => {
  it('picks common platforms with one tap and drops them with another', () => {
    setup(1);
    click('Futu · USD');
    expect(button('Futu · USD').getAttribute('aria-pressed')).toBe('true');
    click('China Merchants Bank · CNY');
    expect(screen.getByText('2 selected: Futu, China Merchants Bank')).toBeTruthy();
    click('Futu · USD');
    expect(screen.getByText('1 selected: China Merchants Bank')).toBeTruthy();
  });

  it('adds an account by name and currency', () => {
    setup(1);
    click('Add');
    expect(screen.getByText('Enter an account name')).toBeTruthy();
    fill('Other account', 'My bank');
    act(() => void fireEvent.click(screen.getByRole('radio', { name: 'CNY' })));
    click('Add');
    expect(screen.getByText('1 selected: My bank')).toBeTruthy();
    fill('Other account', 'My bank');
    click('Add');
    expect(screen.getByText('This account has already been added')).toBeTruthy();
  });

  it('needs at least one account', () => {
    setup(1);
    click('Next');
    expect(screen.getByText('Pick at least one account')).toBeTruthy();
  });
});

describe('step 2: holdings', () => {
  it('recognizes a code, adds it to the list and can remove it', () => {
    toHoldings();
    expect(heading('Enter your current holdings')).toBeTruthy();
    fill('Code', 'voo');
    expect(screen.getByText('Recognized as S&P 500 · US · USD')).toBeTruthy();
    fill('Shares', '10');
    fill('Cost', '500');
    click('+ Add to list');
    expect(screen.getByText('VOO Vanguard S&P 500')).toBeTruthy();
    expect(button('Futu · 1')).toBeTruthy();
    expect((screen.getByLabelText('Code') as HTMLInputElement).value).toBe('');
    click('Delete VOO');
    expect(screen.queryByText('VOO Vanguard S&P 500')).toBeNull();
    expect(screen.getByText('No holdings entered for this account yet')).toBeTruthy();
  });

  // A row filled in but not added goes in when switching accounts; a half-filled one is an error and the switch stops
  it('keeps the row typed but not added when switching account', () => {
    toHoldings();
    fill('Code', 'VOO');
    fill('Shares', '10');
    fill('Cost', '500');
    click('China Merchants Securities · 0');
    expect(button('Futu · 1')).toBeTruthy();
    expect(screen.getByText('Add a holding to China Merchants Securities')).toBeTruthy();
    fill('Code', '513500');
    fill('Shares', '1000');
    click('Futu · 1');
    expect(screen.getByText('This row is incomplete: it needs a code, shares and cost')).toBeTruthy();
    expect(screen.getByText('Add a holding to China Merchants Securities')).toBeTruthy();
  });

  it('asks for the asset of a code it does not know, and the market of an unknown number', () => {
    toHoldings();
    fill('Code', 'MSFT');
    const select = screen.getByLabelText('Not recognized. Choose its underlying asset') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toContain('List as an individual stock');
    expect(screen.queryByRole('radiogroup', { name: 'Market' })).toBeNull();
    fill('Code', '161125');
    expect(screen.getByRole('radiogroup', { name: 'Market' })).toBeTruthy();
  });

  it('needs a holding or some cash before going on', () => {
    toHoldings();
    click('Next');
    expect(screen.getByText('Enter at least one holding or some cash')).toBeTruthy();
    fill('Cash in Futu ($)', '300');
    click('Next');
    expect(heading('Set a target allocation')).toBeTruthy();
  });
});

describe('step 3: targets and finishing', () => {
  /** Futu: 10 VOO at 500 and $300 cash; China Merchants Securities: 1000 513500 at 2 (added on Next) */
  function toTargets() {
    const r = toHoldings();
    fill('Code', 'VOO');
    fill('Shares', '10');
    fill('Cost', '500');
    click('+ Add to list');
    fill('Cash in Futu ($)', '300');
    click('China Merchants Securities · 0');
    fill('Code', '513500');
    fill('Shares', '1000');
    fill('Cost', '2');
    click('Next');
    return r;
  }

  it('proposes targets from the cost of what was entered, adding up to 100', () => {
    toTargets();
    const preview = screen.getByRole('list', { name: 'Target from current holdings' });
    const pcts = within(preview).getAllByText(/%$/).map((el) => Number.parseInt(el.textContent!, 10));
    expect(pcts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(within(preview).getByText('S&P 500')).toBeTruthy();
    click(/Skip the target for now/);
    expect(screen.queryByRole('list', { name: 'Target from current holdings' })).toBeNull();
  });

  it('finishes with the accounts, one opening record per holding and cash balance, and the targets', () => {
    const { onFinish } = toTargets();
    click('Finish and start');
    const r = onFinish.mock.calls[0]![0];
    expect(r.accounts.map((a) => [a.name, a.currency, a.market])).toEqual([
      ['Futu', 'USD', MARKET.us],
      ['China Merchants Securities', 'CNY', MARKET.cn],
    ]);
    const futu = r.accounts[0]!.id;
    const cms = r.accounts[1]!.id;
    expect(r.transactions.map((tx) => [tx.type, tx.accountId, tx.instrumentCode, tx.qty, tx.price, tx.fxToCny, tx.date])).toEqual([
      ['opening', futu, 'VOO', 10, 500, 7, '2026-10-02'],
      ['opening', futu, 'USD', 300, 1, 7, '2026-10-02'],
      ['opening', cms, '513500', 1000, 2, 1, '2026-10-02'],
    ]);
    // VOO 35000, USD cash 2100, 513500 2000 (cost in CNY)
    expect(r.targets).toEqual({ sp500: 95, usd: 5 });
    expect(r.instruments).toEqual([]);
    expect(r.exposures).toEqual([]);
  });

  it('creates the instruments and own stocks it did not know', () => {
    const { onFinish } = toHoldings();
    fill('Code', 'MSFT');
    fill('Not recognized. Choose its underlying asset', '__own_stock__');
    fill('Shares', '4');
    fill('Cost', '400');
    click('Next');
    click(/Skip the target for now/);
    click('Finish and start');
    const r = onFinish.mock.calls[0]![0];
    expect(r.exposures).toEqual([{ id: 'stock-MSFT', name: 'MSFT', groupId: 'stk', isStock: true }]);
    expect(r.instruments).toEqual([{ code: 'MSFT', name: '', market: MARKET.us, currency: 'USD', exposureId: 'stock-MSFT', paysDividend: false }]);
    expect(r.targets).toEqual({});
  });

  it('warns when only cash was entered', () => {
    toHoldings();
    fill('Cash in Futu ($)', '300');
    click('Next');
    expect(screen.getByText(/You haven't entered any stocks or funds/)).toBeTruthy();
  });

  it('goes back a step keeping everything entered', () => {
    toTargets();
    click('Back');
    expect(heading('Enter your current holdings')).toBeTruthy();
    expect(button('Futu · 1')).toBeTruthy();
    expect(button('China Merchants Securities · 1')).toBeTruthy();
  });
});

describe('in Chinese', () => {
  it('reads as before, with the platforms under their Chinese names', () => {
    useAppStore.setState({ locale: 'zh' });
    setup();
    expect(heading('开始管理你的组合')).toBeTruthy();
    click('从零开始录入');
    expect(screen.getByText('第 1 / 3 步')).toBeTruthy();
    click('富途 · USD');
    expect(screen.getByText('已选 1 个：富途')).toBeTruthy();
  });
});
