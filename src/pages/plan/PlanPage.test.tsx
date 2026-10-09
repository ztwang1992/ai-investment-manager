// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../app/store';
import type { AppState } from '../../app/store';
import { calibrationDue } from '../../domain/calibration';
import { planContribution } from '../../domain/contribution';
import { CALIBRATION_REASON, REASON } from '../../domain/record';
import { cashBalance, currencyLookup, deriveLedger } from '../../domain/ledger';
import type { Ledger } from '../../domain/ledger';
import { computeSlots } from '../../domain/slots';
import { isCashCode } from '../../domain/types';
import type { AllocationLine } from '../../domain/types';
import { totalValue, valueHoldings } from '../../domain/valuation';
import { planWithdrawal } from '../../domain/withdrawal';
import * as mock from '../../mock';
import { PlanPage } from './PlanPage';

let initial: AppState;
beforeEach(() => {
  initial = useAppStore.getState();
});
afterEach(() => {
  cleanup();
  useAppStore.setState(initial, true);
});

// Expected values are worked out independently with the domain functions, not hard-coded
const ledger = deriveLedger(mock.transactions, currencyLookup(mock.instrumentByCode));
const rows = valueHoldings({ holdings: ledger.holdings, instruments: mock.instrumentByCode, exposures: mock.exposureById, prices: mock.prices, fx: mock.fx });
const total = totalValue(rows);
const { slots } = computeSlots({ rows, targets: mock.targets, ownStock: {}, threshold: 3, undefinedMode: 'sell' });
const offCount = slots.filter((s) => s.off).length;
const dueCount = calibrationDue({ rows, totalCny: total, transactions: mock.transactions, today: mock.today, period: 'quarter' }).length;

const txCount = () => useAppStore.getState().transactions.length;
const dialog = (name: string) => screen.getByRole('dialog', { name });
const assets = (n: number) => (n === 1 ? '1 asset' : `${n} assets`);
/** "Sep 29" from "2026-09-29" */
const monthDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

describe('PlanPage — main view', () => {
  it('shows the retirement projection', () => {
    render(<PlanPage />);
    expect(screen.getByText('2049')).toBeTruthy();
    expect(screen.getByText(/^\d+% there · 2047$/)).toBeTruthy();
  });

  it('shows the allocation with the deviation count and untargeted assets', () => {
    render(<PlanPage />);
    expect(screen.getByText(`${offCount} off target`)).toBeTruthy();
    const exus = screen.getByText('International ex-US').closest('.plan-slot')!;
    expect(within(exus as HTMLElement).getByText('Not in target')).toBeTruthy();
  });

  it('counts down to the next quarterly check and lists what needs checking', () => {
    render(<PlanPage />);
    expect(screen.getByText('Quarterly check · 2 days left')).toBeTruthy();
    expect(screen.getByText('Quarterly calibration · 2 days left')).toBeTruthy();
    const summary = screen.getByText(new RegExp(`^${dueCount} to check: `)).textContent!;
    // VOO counts once in each of three accounts, but the preview lists each code once
    const codes = summary.replace(/^.*?: /, '').replace(/( and more)?\. .*$/, '').split(', ');
    expect(codes).toHaveLength(3);
    expect(new Set(codes).size).toBe(3);
    expect(summary).toContain(' and more. ');
  });

  it('reads the same in Chinese', () => {
    useAppStore.setState({ locale: 'zh' });
    render(<PlanPage />);
    expect(screen.getByText('2049 年')).toBeTruthy();
    expect(screen.getByText('季度检查 · 还有 2 天')).toBeTruthy();
    expect(screen.getByText(`${offCount} 项偏离`)).toBeTruthy();
    expect(screen.getByText('全球除美')).toBeTruthy();
  });
});

describe('PlanPage — invest new money', () => {
  it('suggests purchases for ¥100,000 in China Merchants Securities and records them', () => {
    render(<PlanPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Invest new money' }));
    const sheet = dialog('Invest new money');
    expect((within(sheet).getByLabelText('Amount (¥)') as HTMLInputElement).value).toBe('100000');
    expect(within(sheet).getByText(/^Largest deviation after investing: [\d.]+% → [\d.]+%$/)).toBeTruthy();
    const before = txCount();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Record these buys' }));
    expect(txCount()).toBeGreaterThan(before);
    expect(useAppStore.getState().toast).toMatch(/^(1 buy|\d+ buys) recorded$/);
    expect(screen.queryByRole('dialog', { name: 'Invest new money' })).toBeNull();
  });

  it('does not record anything for a zero amount', () => {
    render(<PlanPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Invest new money' }));
    const sheet = dialog('Invest new money');
    fireEvent.change(within(sheet).getByLabelText('Amount (¥)'), { target: { value: '0' } });
    const button = within(sheet).getByRole('button', { name: 'Record these buys' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('explains which underweight assets this account cannot buy', () => {
    render(<PlanPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Invest new money' }));
    const sheet = dialog('Invest new money');
    fireEvent.click(within(sheet).getByRole('radio', { name: 'USD' }));
    expect(within(sheet).getByText(/underweight, but this account has no USD instruments to buy\. Try Across accounts\.$/)).toBeTruthy();
  });
});

describe('PlanPage — withdraw', () => {
  it('suggests sales for $20,000 and records them', () => {
    render(<PlanPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const sheet = dialog('Withdraw');
    expect((within(sheet).getByLabelText('Amount ($)') as HTMLInputElement).value).toBe('20000');
    const before = txCount();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Record these sales' }));
    expect(txCount()).toBeGreaterThan(before);
    expect(useAppStore.getState().toast).toMatch(/^(1 sale|\d+ sales) recorded$/);
  });

  it('refuses to take out more than the holdings in that currency', () => {
    render(<PlanPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    const sheet = dialog('Withdraw');
    fireEvent.change(within(sheet).getByLabelText('Amount ($)'), { target: { value: '10000000' } });
    expect(within(sheet).getByText(/^Your USD holdings come to only \$[\d,]+, not enough to withdraw\.$/)).toBeTruthy();
    expect((within(sheet).getByRole('button', { name: 'Record these sales' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

// Phase 5 acceptance: after recording, the holdings, each account's cash and net invested (the source of the
// principal line on Returns) agree. The expectation is worked out with the domain functions from the sheet's
// default input; after recording, everything is derived again from the ledger and compared item by item.
describe('PlanPage — after recording', () => {
  const ledgerNow = () => deriveLedger(useAppStore.getState().transactions, currencyLookup(mock.instrumentByCode));
  const cashChange = (after: Ledger, accountId: string, currency: 'CNY' | 'USD') =>
    cashBalance(after, accountId, currency) - cashBalance(ledger, accountId, currency);
  /** Share changes of non-cash holdings; unchanged ones are left out */
  const holdingChanges = (after: Ledger) => {
    const qty = (l: Ledger) => new Map(l.holdings.filter((h) => !isCashCode(h.code)).map((h) => [`${h.accountId} ${h.code}`, h.qty]));
    const [b, a] = [qty(ledger), qty(after)];
    return Object.fromEntries(
      [...new Set([...b.keys(), ...a.keys()])]
        .map((k) => [k, (a.get(k) ?? 0) - (b.get(k) ?? 0)] as const)
        .filter(([, d]) => Math.abs(d) > 1e-9),
    );
  };
  const expectQty = (actual: Record<string, number>, lines: readonly AllocationLine[], sign: 1 | -1) => {
    const expected = Object.fromEntries(lines.filter((l) => !l.isCash).map((l) => [`${l.accountId} ${l.code}`, (sign * l.amount) / mock.prices[l.code]!]));
    expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
    for (const [k, d] of Object.entries(expected)) expect(actual[k], k).toBeCloseTo(d, 6);
  };
  const keptAsCash = (lines: readonly AllocationLine[], accountId: string, currency: string) =>
    lines.filter((l) => l.isCash && l.accountId === accountId && l.code === currency).reduce((s, l) => s + l.amount, 0);

  it('investing ¥100,000 adds ¥100,000 of principal, cash grows only by what is kept as cash, and the buys match the suggestion', () => {
    const plan = planContribution({
      amount: 100000,
      currency: 'CNY',
      mode: 'account',
      account: mock.accounts.find((a) => a.currency === 'CNY'),
      slots,
      totalCny: total,
      rows,
      candidates: mock.instruments,
      exposures: mock.exposureById,
      ownStock: {},
      accounts: mock.accounts,
      prices: mock.prices,
      fx: mock.fx,
    });
    expect(plan.lines.filter((l) => !l.isCash).length).toBeGreaterThan(0);
    render(<PlanPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Invest new money' }));
    fireEvent.click(within(dialog('Invest new money')).getByRole('button', { name: 'Record these buys' }));

    const after = ledgerNow();
    expect(after.netInvestedCny - ledger.netInvestedCny).toBeCloseTo(100000, 6);
    for (const a of mock.accounts) {
      for (const c of ['CNY', 'USD'] as const) expect(cashChange(after, a.id, c), `${a.id} ${c}`).toBeCloseTo(keptAsCash(plan.lines, a.id, c), 6);
    }
    expectQty(holdingChanges(after), plan.lines, 1);
    expect(after.anomalies).toEqual(ledger.anomalies);
  });

  it('withdrawing $20,000 lowers principal by the same amount, sells only USD holdings as suggested, and takes only the cash shown', () => {
    const result = planWithdrawal({ amount: 20000, currency: 'USD', slots, totalCny: total, rows, ownStock: {}, fx: mock.fx });
    if (!result.ok) throw new Error('The sample should cover $20,000');
    expect(result.lines.filter((l) => !l.isCash).length).toBeGreaterThan(0);
    render(<PlanPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(within(dialog('Withdraw')).getByRole('button', { name: 'Record these sales' }));

    const after = ledgerNow();
    expect(ledger.netInvestedCny - after.netInvestedCny).toBeCloseTo(20000 * mock.fx.USD, 6);
    for (const a of mock.accounts) {
      for (const c of ['CNY', 'USD'] as const) expect(-cashChange(after, a.id, c), `${a.id} ${c}`).toBeCloseTo(keptAsCash(result.lines, a.id, c), 6);
    }
    const changes = holdingChanges(after);
    expect(Object.keys(changes).every((k) => mock.instrumentByCode[k.split(' ')[1]!]!.currency === 'USD')).toBe(true);
    expectQty(changes, result.lines, -1);
    expect(after.anomalies).toEqual(ledger.anomalies);
  });
});

describe('PlanPage — rebalance', () => {
  it('lists sales before buys and can be marked done', () => {
    render(<PlanPage />);
    fireEvent.click(screen.getByRole('button', { name: 'See the steps' }));
    const sheet = dialog('Rebalancing steps');
    const actions = within(sheet).getAllByText(/^(Sell|Buy)$/).map((el) => el.textContent);
    expect(actions[0]).toBe('Sell');
    expect(actions.lastIndexOf('Sell')).toBeLessThan(actions.indexOf('Buy'));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Mark as done' }));
    expect(useAppStore.getState().toast).toBe('Rebalance recorded');
  });

  // Rebalance reminder (BUILD_PLAN phase 5, item 4): remind while this quarter is unchecked and something is off; not again this quarter once marked
  it('reminds when this quarter has not been checked, until marked done', () => {
    expect(offCount).toBeGreaterThan(0);
    render(<PlanPage />);
    expect(screen.getByText(`Not checked this quarter: ${assets(offCount)} off by more than ±3%`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'See the steps' }));
    fireEvent.click(within(dialog('Rebalancing steps')).getByRole('button', { name: 'Mark as done' }));
    expect(useAppStore.getState().plan.lastRebalancedOn).toBe(mock.today);
    expect(screen.queryByText(/Not checked this quarter/)).toBeNull();
    expect(screen.getByText(`Checked this quarter (${monthDay(mock.today)})`)).toBeTruthy();
  });

  it('reminds again once a new quarter has started', () => {
    useAppStore.setState((s) => ({ plan: { ...s.plan, lastRebalancedOn: '2026-06-30' } }));
    render(<PlanPage />);
    expect(screen.getByText(`Not checked this quarter: ${assets(offCount)} off by more than ±3%`)).toBeTruthy();
  });
});

describe('PlanPage — calibration', () => {
  const openList = () => {
    fireEvent.click(screen.getByRole('button', { name: 'Start calibrating' }));
    return dialog('To check this period');
  };

  it('saves a new share count and removes the item from the list', () => {
    render(<PlanPage />);
    const items = within(openList()).getAllByRole('button', { name: /shares/ });
    expect(items).toHaveLength(dueCount);
    fireEvent.click(items[0]!);
    const sheet = dialog('Calibrate holding');
    const input = within(sheet).getByLabelText('Shares shown by your broker') as HTMLInputElement;
    fireEvent.change(input, { target: { value: String(Number(input.value) + 1) } });
    expect(within(sheet).getByText(/^Difference \+1 shares · value \+/)).toBeTruthy();
    const before = txCount();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save calibration' }));
    expect(txCount()).toBe(before + 1);
    expect(within(dialog('To check this period')).getAllByRole('button', { name: /shares/ })).toHaveLength(dueCount - 1);
  });

  // The reasons are short enough to fit side by side on a phone; the remark is stored as before
  it('names the reasons briefly and records the one chosen', () => {
    render(<PlanPage />);
    fireEvent.click(within(openList()).getAllByRole('button', { name: /shares/ })[0]!);
    const sheet = dialog('Calibrate holding');
    expect(within(sheet).getAllByRole('radio').map((r) => r.closest('label')!.textContent)).toEqual(['Dividends', 'Split', 'Correction']);
    const input = within(sheet).getByLabelText('Shares shown by your broker') as HTMLInputElement;
    fireEvent.change(input, { target: { value: String(Number(input.value) + 1) } });
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Split' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save calibration' }));
    expect(useAppStore.getState().transactions.at(-1)!.reason).toBe(CALIBRATION_REASON.split);
  });

  it('records an unchanged count as checked', () => {
    render(<PlanPage />);
    fireEvent.click(within(openList()).getAllByRole('button', { name: /shares/ })[0]!);
    fireEvent.click(within(dialog('Calibrate holding')).getByRole('button', { name: 'Save calibration' }));
    expect(useAppStore.getState().transactions.at(-1)!.reason).toBe(REASON.checked);
    expect(useAppStore.getState().toast).toBe('Shares match. Marked as checked.');
  });

  it('rejects a negative share count', () => {
    render(<PlanPage />);
    fireEvent.click(within(openList()).getAllByRole('button', { name: /shares/ })[0]!);
    const sheet = dialog('Calibrate holding');
    fireEvent.change(within(sheet).getByLabelText('Shares shown by your broker'), { target: { value: '-3' } });
    const before = txCount();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save calibration' }));
    expect(txCount()).toBe(before);
    expect(within(sheet).getByText('Enter a valid share count')).toBeTruthy();
  });

  it('marks everything as checked in one go', () => {
    render(<PlanPage />);
    fireEvent.click(within(openList()).getByRole('button', { name: 'Mark all as checked' }));
    expect(useAppStore.getState().toast).toBe(dueCount === 1 ? '1 marked as checked' : `${dueCount} marked as checked`);
    expect(screen.getByText('Large and dividend-reinvesting holdings have all been checked this period.')).toBeTruthy();
  });
});
