import type {
  Account,
  AccountType,
  AiConversation,
  AiMessage,
  CashCurrency,
  Exposure,
  Instrument,
  Market,
  OwnStock,
  Period,
  Plan,
  Snapshot,
  SnapshotItem,
  Targets,
  Transaction,
  TxType,
  UndefinedMode,
} from './types';

// Local data <-> a row of a Supabase table. Column names as in supabase/migrations; the phase 4 Worker uses these conversions to read transactions too.

/** Postgres numeric comes back as a number through PostgREST and as a string through PGlite; reads convert both to numbers */
export type Num = number | string;

/** A setting's version: the last change time (ISO) and the position in the list */
export interface RowStamp {
  updatedAt: string;
  order: number;
}

export interface TxRow {
  user_id: string;
  id: string;
  date: string;
  created_at: string;
  type: TxType;
  account_id: string;
  instrument_code: string;
  qty: Num;
  price: Num;
  fee: Num;
  reason: string | null;
  fx_to_cny: Num;
  /** When the server received it; other devices pull incrementally by it */
  inserted_at?: string;
}

export interface AccountRow {
  user_id: string;
  id: string;
  name: string;
  type: AccountType;
  currency: CashCurrency;
  market: Market;
  color: string | null;
  position: number;
  updated_at: string;
  server_updated_at?: string;
}

export interface ExposureRow {
  /** Empty for a global preset */
  user_id: string | null;
  id: string;
  name: string;
  group_id: string;
  is_stock: boolean;
  position: number;
  updated_at: string;
  server_updated_at?: string;
}

export interface InstrumentRow {
  /** Empty for a global preset */
  user_id: string | null;
  code: string;
  name: string;
  market: Market;
  currency: CashCurrency;
  exposure_id: string;
  pays_dividend: boolean;
  position: number;
  updated_at: string;
  server_updated_at?: string;
}

export interface TargetsRow {
  user_id: string;
  slots: Targets;
  own_stock: OwnStock;
  updated_at: string;
  server_updated_at?: string;
}

export interface PlanRow {
  user_id: string;
  threshold: Num;
  rebalance_period: Period;
  calib_period: Period;
  undefined_mode: UndefinedMode;
  annual_spend: Num;
  target_amount: Num;
  expected_return: Num;
  inflation: Num;
  /** The column added by the phase 5 migration: the date rebalancing was last marked done */
  last_rebalanced_on?: string | null;
  updated_at: string;
  server_updated_at?: string;
}

/** One a day, written by the Worker with the service role; read-only for the app */
export interface SnapshotRow {
  user_id: string;
  date: string;
  total_value_cny: Num;
  net_invested_cny: Num;
  usd_cny: Num;
}

/** One per held asset per day */
export interface SnapshotItemRow {
  user_id: string;
  date: string;
  exposure_id: string;
  value_cny: Num;
}

/** An AI conversation: the title follows the last change (like settings) */
export interface AiConversationRow {
  user_id: string;
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** When the server last wrote it; other devices pull incrementally by it */
  server_updated_at?: string;
}

/** A message in an AI conversation: only added, never changed (like transactions) */
export interface AiMessageRow {
  user_id: string;
  id: string;
  conversation_id: string;
  role: AiMessage['role'];
  content: string;
  created_at: string;
  /** When the server received it; other devices pull incrementally by it */
  inserted_at?: string;
}

/** Times in toISOString's format (Postgres returns +00:00); ordering and sorting compare strings, so the format must match */
export const isoTime = (t: string): string => new Date(t).toISOString();

export function txToRow(t: Transaction, userId: string): TxRow {
  return {
    user_id: userId,
    id: t.id,
    date: t.date,
    created_at: t.createdAt,
    type: t.type,
    account_id: t.accountId,
    instrument_code: t.instrumentCode,
    qty: t.qty,
    price: t.price,
    fee: t.fee,
    reason: t.reason ?? null,
    fx_to_cny: t.fxToCny,
  };
}

export function rowToTx(r: TxRow): Transaction {
  return {
    id: r.id,
    date: r.date,
    createdAt: isoTime(r.created_at),
    type: r.type,
    accountId: r.account_id,
    instrumentCode: r.instrument_code,
    qty: Number(r.qty),
    price: Number(r.price),
    fee: Number(r.fee),
    ...(r.reason != null ? { reason: r.reason } : {}),
    fxToCny: Number(r.fx_to_cny),
  };
}

export function accountToRow(a: Account, s: RowStamp, userId: string): AccountRow {
  return {
    user_id: userId,
    id: a.id,
    name: a.name,
    type: a.type,
    currency: a.currency,
    market: a.market,
    color: a.color ?? null,
    position: s.order,
    updated_at: s.updatedAt,
  };
}

export function rowToAccount(r: AccountRow): Account {
  return { id: r.id, name: r.name, type: r.type, currency: r.currency, market: r.market, ...(r.color != null ? { color: r.color } : {}) };
}

export function exposureToRow(e: Exposure, s: RowStamp, userId: string): ExposureRow {
  return { user_id: userId, id: e.id, name: e.name, group_id: e.groupId, is_stock: e.isStock, position: s.order, updated_at: s.updatedAt };
}

export function rowToExposure(r: ExposureRow): Exposure {
  return { id: r.id, name: r.name, groupId: r.group_id, isStock: r.is_stock };
}

export function instrumentToRow(i: Instrument, s: RowStamp, userId: string): InstrumentRow {
  return {
    user_id: userId,
    code: i.code,
    name: i.name,
    market: i.market,
    currency: i.currency,
    exposure_id: i.exposureId,
    pays_dividend: i.paysDividend,
    position: s.order,
    updated_at: s.updatedAt,
  };
}

export function rowToInstrument(r: InstrumentRow): Instrument {
  return { code: r.code, name: r.name, market: r.market, currency: r.currency, exposureId: r.exposure_id, paysDividend: r.pays_dividend };
}

export function targetsToRow(targets: Targets, ownStock: OwnStock, updatedAt: string, userId: string): TargetsRow {
  return { user_id: userId, slots: targets, own_stock: ownStock, updated_at: updatedAt };
}

export function planToRow(p: Plan, updatedAt: string, userId: string): PlanRow {
  return {
    user_id: userId,
    threshold: p.threshold,
    rebalance_period: p.rebalancePeriod,
    calib_period: p.calibPeriod,
    undefined_mode: p.undefinedMode,
    annual_spend: p.annualSpend,
    target_amount: p.targetAmount,
    expected_return: p.expectedReturnPct,
    inflation: p.inflationPct,
    // Left out when nothing has been marked: a cloud that hasn't run the phase 5 migration lacks it, and including it would make the whole plan fail to upload
    ...(p.lastRebalancedOn ? { last_rebalanced_on: p.lastRebalancedOn } : {}),
    updated_at: updatedAt,
  };
}

export function rowToPlan(r: PlanRow): Plan {
  return {
    threshold: Number(r.threshold),
    rebalancePeriod: r.rebalance_period,
    calibPeriod: r.calib_period,
    undefinedMode: r.undefined_mode,
    annualSpend: Number(r.annual_spend),
    targetAmount: Number(r.target_amount),
    expectedReturnPct: Number(r.expected_return),
    inflationPct: Number(r.inflation),
    ...(r.last_rebalanced_on ? { lastRebalancedOn: r.last_rebalanced_on.slice(0, 10) } : {}),
  };
}

export const rowStamp = (r: { updated_at: string; position: number }): RowStamp => ({ updatedAt: isoTime(r.updated_at), order: r.position });

export function snapshotToRow(s: Snapshot, userId: string): SnapshotRow {
  return { user_id: userId, date: s.date, total_value_cny: s.totalValueCny, net_invested_cny: s.netInvestedCny, usd_cny: s.usdCny };
}

export function rowToSnapshot(r: SnapshotRow): Snapshot {
  return { date: r.date, totalValueCny: Number(r.total_value_cny), netInvestedCny: Number(r.net_invested_cny), usdCny: Number(r.usd_cny) };
}

export function snapshotItemToRow(item: SnapshotItem, userId: string): SnapshotItemRow {
  return { user_id: userId, date: item.date, exposure_id: item.exposureId, value_cny: item.valueCny };
}

export function rowToSnapshotItem(r: SnapshotItemRow): SnapshotItem {
  return { date: r.date, exposureId: r.exposure_id, valueCny: Number(r.value_cny) };
}

export function aiConversationToRow(c: AiConversation, userId: string): AiConversationRow {
  return { user_id: userId, id: c.id, title: c.title, created_at: c.createdAt, updated_at: c.updatedAt };
}

export function rowToAiConversation(r: AiConversationRow): AiConversation {
  return { id: r.id, title: r.title, createdAt: isoTime(r.created_at), updatedAt: isoTime(r.updated_at) };
}

export function aiMessageToRow(m: AiMessage, userId: string): AiMessageRow {
  return { user_id: userId, id: m.id, conversation_id: m.conversationId, role: m.role, content: m.content, created_at: m.createdAt };
}

export function rowToAiMessage(r: AiMessageRow): AiMessage {
  return { id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content, createdAt: isoTime(r.created_at) };
}
