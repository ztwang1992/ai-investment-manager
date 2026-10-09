// Shared types of the quotes Worker.

/** Market group: the same 6-digit code can be both an A-share and a mutual fund (e.g. 000001), so the app names the market. */
export type MarketKind = 'us' | 'cn' | 'fund';

export interface Quote {
  code: string;
  price: number;
  currency: 'USD' | 'CNY';
  /** The time of the price (ISO); for mutual funds, the NAV date YYYY-MM-DD */
  asOf: string;
  /** The data source's name, e.g. tencent */
  source: string;
}

/** The minimal KV interface; tests use a Map instead */
export interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
