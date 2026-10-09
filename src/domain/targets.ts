import { STOCK_BUCKET } from './slots';
import type { Exposure, OwnStock, Targets } from './types';

// The draft of the targets edited in "Portfolio settings": each item is the text in its input; before saving, the total must equal 100%.

export interface TargetDraft {
  targets: Record<string, string>;
  ownStock: OwnStock;
}

export type DraftProblem = { kind: 'invalid' } | { kind: 'over'; by: number } | { kind: 'under'; by: number };

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Only numbers from 0 to 100 are valid; blank, non-numeric or out of range is invalid. */
function percentOf(text: string): number | null {
  if (text.trim() === '') return null;
  const value = Number(text.trim());
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function toDraft(targets: Targets, ownStock: OwnStock): TargetDraft {
  return {
    targets: Object.fromEntries(Object.entries(targets).map(([key, pct]) => [key, String(pct)])),
    ownStock: { ...ownStock },
  };
}

/** The total is computed to one decimal place, so float error like 40.1 + 59.9 doesn't block saving. */
export function checkDraft(draft: TargetDraft): { sum: number; badKeys: string[]; problem: DraftProblem | null } {
  const badKeys: string[] = [];
  let total = 0;
  for (const [key, text] of Object.entries(draft.targets)) {
    const value = percentOf(text);
    if (value === null) badKeys.push(key);
    else total += value;
  }
  const sum = round1(total);
  const problem: DraftProblem | null =
    badKeys.length > 0
      ? { kind: 'invalid' }
      : sum > 100
        ? { kind: 'over', by: round1(sum - 100) }
        : sum < 100
          ? { kind: 'under', by: round1(100 - sum) }
          : null;
  return { sum, badKeys, problem };
}

/** The total of the saved targets, to one decimal place like checkDraft. */
export function targetSum(targets: Targets): number {
  return round1(Object.values(targets).reduce((s, pct) => s + pct, 0));
}

/** For saving: each item to one decimal place. Check with checkDraft first. */
export function parseDraft(draft: TargetDraft): Targets {
  return Object.fromEntries(Object.entries(draft.targets).map(([key, text]) => [key, round1(Number(text.trim()))]));
}

/** Adds an item at 0%; a single stock added this way gets a target of its own. */
export function addTarget(draft: TargetDraft, key: string, isStock: boolean): TargetDraft {
  return {
    targets: { ...draft.targets, [key]: '0' },
    ownStock: isStock ? { ...draft.ownStock, [key]: true } : draft.ownStock,
  };
}

/** Removes an item; a removed stock goes back into Individual stocks. */
export function removeTarget(draft: TargetDraft, key: string, isStock: boolean): TargetDraft {
  const targets = { ...draft.targets };
  delete targets[key];
  return { targets, ownStock: isStock ? { ...draft.ownStock, [key]: false } : draft.ownStock };
}

/** Folds stocks with targets of their own back into Individual stocks, adding their shares to it. */
export function mergeStock(draft: TargetDraft, key: string): TargetDraft {
  const targets = { ...draft.targets };
  const moved = Number(targets[key]) || 0;
  delete targets[key];
  targets[STOCK_BUCKET] = String(round1((Number(targets[STOCK_BUCKET]) || 0) + moved));
  return { targets, ownStock: { ...draft.ownStock, [key]: false } };
}

/** What can still be added to the targets: Individual stocks first, then the untargeted assets in catalog order. */
export function addableTargets(keys: readonly string[], exposures: readonly Exposure[]): string[] {
  return [
    ...(keys.includes(STOCK_BUCKET) ? [] : [STOCK_BUCKET]),
    ...exposures.filter((e) => !keys.includes(e.id)).map((e) => e.id),
  ];
}
