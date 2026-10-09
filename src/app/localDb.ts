import Dexie from 'dexie';
import type { EntityTable, Table } from 'dexie';
import type { Account, AiConversation, AiMessage, Exposure, Instrument, Snapshot, SnapshotItem, Transaction } from '../domain/types';
import type { SettingsKind } from './remote';

// The local database (IndexedDB, through Dexie), one per account. To change the tables, add a new version with an upgrade step; never change an existing version.

export interface KvRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

/**
 * Settings stored locally carry a few extra fields:
 * - updatedAt: when last changed, for "last change wins" when syncing;
 * - order: the position in the list (IndexedDB returns rows by primary key; without it the order is lost on reload);
 * - own: whether an asset or instrument was created by the user (to upload) or is a global preset.
 */
export type Stamped<T> = T & { updatedAt: string; order: number; own?: boolean };

/** tx: transactions; snapshot: the first snapshot, taken on the day of onboarding (keyed by date); aiConversation / aiMessage: AI conversations; the rest are settings */
export type OutboxKind = 'tx' | 'snapshot' | SettingsKind | 'aiConversation' | 'aiMessage';

/**
 * Vault: the AI settings on this device (a single row, name 'ai'). The key is stored only as ciphertext, under a non-extractable encryption key.
 * Not synced, not backed up.
 */
export interface VaultRow {
  name: string;
  base: string;
  model: string;
  consent: boolean;
  web: boolean;
  cryptoKey?: CryptoKey;
  iv?: Uint8Array<ArrayBuffer>;
  cipher?: ArrayBuffer;
}

/** An item of the sync queue: uploaded in seq order, reading the item's latest content from the local database */
export interface OutboxRow {
  seq?: number;
  kind: OutboxKind;
  key: string;
  /** The transaction's exchange rate wasn't fetched online that day: before upload it becomes the recording day's rate */
  fxPending?: boolean;
}

export type LocalDb = Dexie & {
  transactions: EntityTable<Transaction, 'id'>;
  accounts: EntityTable<Stamped<Account>, 'id'>;
  exposures: EntityTable<Stamped<Exposure>, 'id'>;
  instruments: EntityTable<Stamped<Instrument>, 'code'>;
  kv: EntityTable<KvRow, 'key'>;
  outbox: EntityTable<OutboxRow, 'seq'>;
  /** The daily snapshots the Worker writes, pulled from the cloud and kept locally so the chart works offline */
  snapshots: EntityTable<Snapshot, 'date'>;
  snapshotItems: Table<SnapshotItem, [string, string]>;
  /** AI conversations and messages (phase 6) */
  aiConversations: EntityTable<AiConversation, 'id'>;
  aiMessages: EntityTable<AiMessage, 'id'>;
  vault: EntityTable<VaultRow, 'name'>;
};

export const userDbName = (userId: string) => `invest-manager-${userId}`;

export function openLocalDb(name = 'invest-manager'): LocalDb {
  const db = new Dexie(name) as LocalDb;
  db.version(1).stores({
    transactions: 'id, date, createdAt',
    accounts: 'id',
    exposures: 'id',
    instruments: 'code',
    kv: 'key',
  });
  // Version 2: the sync queue
  db.version(2).stores({ outbox: '++seq, kind' });
  // Version 3: daily snapshots (phase 4b)
  db.version(3).stores({ snapshots: 'date', snapshotItems: '[date+exposureId], date' });
  // Version 4: AI conversations, messages and the vault (phase 6)
  db.version(4).stores({ aiConversations: 'id', aiMessages: 'id, conversationId', vault: 'name' });
  return db;
}
