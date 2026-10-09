import { MARKET } from './types';
import type { Account, Exposure, ExposureGroup } from './types';
import type { ValuedHolding } from './valuation';

// The two summaries on the Holdings page: by asset (group -> asset -> instrument -> platform) and by account.

export interface PlatformLine {
  accountId: string;
  qty: number;
  /** Average cost in the original currency */
  avgCost: number;
  valueCny: number;
}

export interface InstrumentLine {
  code: string;
  valueCny: number;
  accountCount: number;
  platforms: PlatformLine[];
}

export interface ExposureLine {
  exposureId: string;
  valueCny: number;
  costCny: number;
  /** Unrealized gain %, null for cash */
  pnlPct: number | null;
  pct: number;
  instrumentCount: number;
  accountCount: number;
  instruments: InstrumentLine[];
}

export interface GroupLine {
  groupId: string;
  valueCny: number;
  pct: number;
  exposures: ExposureLine[];
}

export interface CompositionLine {
  groupId: string;
  valueCny: number;
  /** Percentage of the account's value */
  pct: number;
  /** Start and end on the donut chart (percentages, accumulated in group order) */
  fromPct: number;
  toPct: number;
}

export interface AccountLine {
  accountId: string;
  valueCny: number;
  sharePct: number;
  itemCount: number;
  /** Value by group, only groups above 0 */
  composition: CompositionLine[];
  items: ValuedHolding[];
}

const sumValue = (rows: readonly ValuedHolding[]) => rows.reduce((s, r) => s + r.valueCny, 0);
const sumCost = (rows: readonly ValuedHolding[]) => rows.reduce((s, r) => s + r.costCny, 0);
const share = (value: number, total: number) => (total > 0 ? (value * 100) / total : 0);
const unique = (items: readonly string[]) => [...new Set(items)];

export function groupByExposure(i: {
  rows: readonly ValuedHolding[];
  groups: readonly ExposureGroup[];
  exposures: readonly Exposure[];
}): GroupLine[] {
  const total = sumValue(i.rows);
  const lines: GroupLine[] = [];
  for (const group of i.groups) {
    const exposureLines: ExposureLine[] = [];
    for (const exposure of i.exposures) {
      if (exposure.groupId !== group.id) continue;
      const rs = i.rows.filter((r) => r.exposure.id === exposure.id);
      if (rs.length === 0) continue;
      const valueCny = sumValue(rs);
      const costCny = sumCost(rs);
      const isCash = rs.every((r) => r.instrument.market === MARKET.cash);
      const codes = unique(rs.map((r) => r.code));
      exposureLines.push({
        exposureId: exposure.id,
        valueCny,
        costCny,
        pnlPct: isCash || costCny <= 0 ? null : ((valueCny - costCny) / costCny) * 100,
        pct: share(valueCny, total),
        instrumentCount: codes.length,
        accountCount: unique(rs.map((r) => r.accountId)).length,
        instruments: codes.map((code) => {
          const ir = rs.filter((r) => r.code === code);
          return {
            code,
            valueCny: sumValue(ir),
            accountCount: ir.length,
            platforms: ir.map((r) => ({
              accountId: r.accountId,
              qty: r.qty,
              avgCost: r.qty !== 0 ? r.cost / r.qty : 0,
              valueCny: r.valueCny,
            })),
          };
        }),
      });
    }
    if (exposureLines.length === 0) continue;
    const valueCny = exposureLines.reduce((s, e) => s + e.valueCny, 0);
    lines.push({ groupId: group.id, valueCny, pct: share(valueCny, total), exposures: exposureLines });
  }
  return lines;
}

export function groupByAccount(i: {
  rows: readonly ValuedHolding[];
  accounts: readonly Account[];
  groups: readonly ExposureGroup[];
}): AccountLine[] {
  const total = sumValue(i.rows);
  return i.accounts.map((account) => {
    const items = i.rows.filter((r) => r.accountId === account.id);
    const valueCny = sumValue(items);
    let fromPct = 0;
    const composition = i.groups
      .map((g) => ({ groupId: g.id, valueCny: sumValue(items.filter((r) => r.exposure.groupId === g.id)) }))
      .filter((c) => c.valueCny > 0)
      .map((c) => {
        const pct = share(c.valueCny, valueCny);
        const line = { ...c, pct, fromPct, toPct: fromPct + pct };
        fromPct = line.toPct;
        return line;
      });
    return { accountId: account.id, valueCny, sharePct: share(valueCny, total), itemCount: items.length, composition, items };
  });
}
