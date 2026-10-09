import { describe, expect, it } from 'vitest';
import { addTarget, addableTargets, checkDraft, mergeStock, parseDraft, removeTarget, targetSum, toDraft } from './targets';
import type { TargetDraft } from './targets';
import type { Exposure } from './types';

const draft = (targets: Record<string, string>, ownStock: Record<string, boolean> = {}): TargetDraft => ({ targets, ownStock });

describe('toDraft / parseDraft', () => {
  it('turns targets into editable strings and back, keeping one decimal', () => {
    const d = toDraft({ sp500: 40, ndx: 60 }, { aapl: true });
    expect(d).toEqual({ targets: { sp500: '40', ndx: '60' }, ownStock: { aapl: true } });
    expect(parseDraft(draft({ sp500: '40.04', ndx: '59.96' }))).toEqual({ sp500: 40, ndx: 60 });
  });
});

describe('checkDraft', () => {
  it('accepts exactly 100%, even with decimals that do not add up exactly in binary', () => {
    expect(checkDraft(draft({ a: '40.1', b: '59.9' }))).toEqual({ sum: 100, badKeys: [], problem: null });
    expect(checkDraft(draft({ a: '33.3', b: '33.3', c: '33.4' })).problem).toBeNull();
  });

  it('reports how much is over or missing', () => {
    expect(checkDraft(draft({ a: '60', b: '50' })).problem).toEqual({ kind: 'over', by: 10 });
    expect(checkDraft(draft({ a: '60', b: '25' })).problem).toEqual({ kind: 'under', by: 15 });
    expect(checkDraft(draft({})).problem).toEqual({ kind: 'under', by: 100 });
  });

  it('flags empty, non-numeric and out-of-range entries', () => {
    const r = checkDraft(draft({ a: '', b: 'abc', c: '-1', d: '101', e: '50' }));
    expect(r.badKeys).toEqual(['a', 'b', 'c', 'd']);
    expect(r.problem).toEqual({ kind: 'invalid' });
    expect(r.sum).toBe(50);
  });
});

describe('targetSum', () => {
  it('adds up the saved targets to one decimal', () => {
    expect(targetSum({ sp500: 40.1, ndx: 59.9 })).toBe(100);
    expect(targetSum({ a: 33.3, b: 33.3, c: 33.3 })).toBe(99.9);
    expect(targetSum({})).toBe(0);
  });
});

describe('adding, removing, splitting and merging', () => {
  it('adds a target at 0%, marking an individual stock as having its own target', () => {
    expect(addTarget(draft({ sp500: '100' }), 'gold', false)).toEqual(draft({ sp500: '100', gold: '0' }));
    expect(addTarget(draft({ stocks: '10' }), 'aapl', true)).toEqual(draft({ stocks: '10', aapl: '0' }, { aapl: true }));
  });

  it('removes a target, putting a stock back into the bucket', () => {
    expect(removeTarget(draft({ stocks: '10', aapl: '5' }, { aapl: true }), 'aapl', true)).toEqual(draft({ stocks: '10' }, { aapl: false }));
    expect(removeTarget(draft({ sp500: '60', gold: '40' }), 'gold', false)).toEqual(draft({ sp500: '60' }));
  });

  it('merges a stock’s share back into Individual stocks', () => {
    expect(mergeStock(draft({ stocks: '5', aapl: '5.5' }, { aapl: true }), 'aapl')).toEqual(draft({ stocks: '10.5' }, { aapl: false }));
    expect(mergeStock(draft({ aapl: '5' }, { aapl: true }), 'aapl')).toEqual(draft({ stocks: '5' }, { aapl: false }));
  });
});

describe('addableTargets', () => {
  const exposures: Exposure[] = [
    { id: 'sp500', name: '标普 500', groupId: 'us', isStock: false },
    { id: 'aapl', name: '苹果', groupId: 'stk', isStock: true },
    { id: 'gold', name: '黄金', groupId: 'gold', isStock: false },
  ];

  it('offers Individual stocks first, then every exposure not yet targeted', () => {
    expect(addableTargets(['sp500'], exposures)).toEqual(['stocks', 'aapl', 'gold']);
    expect(addableTargets(['stocks', 'sp500', 'gold'], exposures)).toEqual(['aapl']);
  });
});
