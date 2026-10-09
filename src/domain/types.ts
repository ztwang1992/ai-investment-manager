// Domain types. Rules in design_handoff_investment_manager/README.md「数据模型」.

/** The currency of accounts and instruments. The first version supports CNY and USD only. */
export type CashCurrency = 'CNY' | 'USD';
/** The display currency: account currencies plus HKD. */
export type Currency = CashCurrency | 'HKD';
/**
 * Markets, as stored in the database and on the device. The values stay Chinese so existing data keeps working;
 * the UI translates them. Code refers to them only through these names.
 */
export const MARKET = { us: '美股', cn: 'A股', fund: '场外基金', cash: '现金' } as const;
export type Market = (typeof MARKET)[keyof typeof MARKET];
/** Markets whose codes are six digits: an A-share and a mutual fund can share a code */
export type DigitMarket = typeof MARKET.cn | typeof MARKET.fund;
export type AccountType = 'broker' | 'bank';
export type Period = 'month' | 'quarter' | 'year';
/** Whether an asset not in the target is suggested for selling when rebalancing, or left out. */
export type UndefinedMode = 'sell' | 'ignore';
export type TxType = 'opening' | 'buy' | 'sell' | 'deposit' | 'withdraw' | 'calibrate';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: CashCurrency;
  market: Market;
  /** Display color (a tokens.css variable), for the interface; README data model accounts.color */
  color?: string;
}

export interface ExposureGroup {
  id: string;
  name: string;
}

/** An asset, e.g. S&P 500. */
export interface Exposure {
  id: string;
  name: string;
  groupId: string;
  isStock: boolean;
}

export interface Instrument {
  code: string;
  name: string;
  market: Market;
  currency: CashCurrency;
  exposureId: string;
  paysDividend: boolean;
}

/**
 * A transaction. Transactions are the single source of truth; holdings, cash and principal are all derived from them.
 * - deposit / withdraw: instrumentCode is the currency code, qty the amount, price 1
 * - calibrate: qty is the actual share count the broker shows, not the difference
 */
export interface Transaction {
  id: string;
  /** Recording date YYYY-MM-DD */
  date: string;
  /** Creation time (ISO); transactions on the same day sort by it */
  createdAt: string;
  type: TxType;
  accountId: string;
  instrumentCode: string;
  qty: number;
  price: number;
  fee: number;
  reason?: string;
  /** This transaction's currency rate to CNY; 1 for CNY */
  fxToCny: number;
}

/** How many CNY one unit of foreign currency is worth. */
export type FxRates = Record<Currency, number>;
/** An instrument's price in its own currency. */
export type Prices = Record<string, number>;
/** Slot -> target percentage (0–100). */
export type Targets = Record<string, number>;
/** Whether a single stock has a target of its own (true: not folded into Individual stocks). */
export type OwnStock = Record<string, boolean>;

export interface Plan {
  /** Deviation threshold, in percentage points */
  threshold: number;
  rebalancePeriod: Period;
  calibPeriod: Period;
  undefinedMode: UndefinedMode;
  annualSpend: number;
  targetAmount: number;
  expectedReturnPct: number;
  inflationPct: number;
  /** The date rebalancing was last marked done; once marked this period, no more reminders */
  lastRebalancedOn?: string | null;
}

/** The total-assets snapshot, one per day, for the returns curve. */
export interface Snapshot {
  date: string;
  totalValueCny: number;
  netInvestedCny: number;
  /** CNY per 1 USD that day */
  usdCny: number;
}

/** Each asset's value per day, for "Performance by asset". */
export interface SnapshotItem {
  date: string;
  exposureId: string;
  valueCny: number;
}

/** A conversation with the AI advisor. updatedAt is the time of the last message: sync goes by it, and so does the history list's order. */
export interface AiConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** A message in a conversation: your question or the AI's full reply. Only added, never changed. */
export interface AiMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/** A line in an "Invest new money" or "Withdraw" suggestion. */
export interface AllocationLine {
  slotKey: string;
  code: string;
  accountId: string;
  amountCny: number;
  /** Amount in the currency invested / withdrawn */
  amount: number;
  isCash: boolean;
  isNewInstrument: boolean;
  beforePct: number;
  afterPct: number;
}

export function isCashCode(code: string): code is CashCurrency {
  return code === 'CNY' || code === 'USD';
}
