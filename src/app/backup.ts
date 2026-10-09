import { sortTransactions } from '../domain/ledger';
import type { Account, Exposure, Instrument, OwnStock, Plan, Targets, Transaction } from '../domain/types';
import type { Messages } from '../i18n';

// What Settings → Backup exports: a full backup (JSON) and the transactions (CSV). Only builds the text; download.ts saves it.

export interface BackupData {
  exportedAt: string;
  accounts: readonly Account[];
  exposures: readonly Exposure[];
  instruments: readonly Instrument[];
  transactions: readonly Transaction[];
  targets: Targets;
  ownStock: OwnStock;
  plan: Plan;
}

/** The ledger is the single source of truth: with the accounts, the asset catalog and the settings it rebuilds everything. */
export function backupJson(data: BackupData): string {
  return JSON.stringify({ app: 'invest-manager', version: 1, ...data }, null, 2);
}

/** Drops floating-point noise (such as 7.000000000000001): at most 8 decimals. */
function numberText(value: number): string {
  return String(Number(value.toFixed(8)));
}

/** A CSV cell: quoted when it holds a comma, quote or line break, with quotes doubled (RFC 4180). */
export function csvCell(value: string | number): string {
  const text = typeof value === 'number' ? numberText(value) : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The transactions as CSV, oldest first, in the interface language (Chinese has the prototype's header); a zero fee is left empty. */
export function transactionsCsv(transactions: readonly Transaction[], accountName: (id: string) => string, t: Messages): string {
  const header = t.backup.csvHeader.join(',');
  const rows = sortTransactions(transactions).map((tx) =>
    [
      csvCell(tx.date),
      csvCell(t.common.txTypes[tx.type]),
      csvCell(accountName(tx.accountId)),
      csvCell(tx.instrumentCode),
      csvCell(tx.qty),
      csvCell(tx.price),
      tx.fee ? csvCell(tx.fee) : '',
      csvCell(tx.reason ? t.common.reason(tx.reason) : ''),
    ].join(','),
  );
  return [header, ...rows].join('\r\n');
}
