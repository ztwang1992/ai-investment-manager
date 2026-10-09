// Words shared across the app. English is the source; Chinese must have the same keys (checked by TypeScript).
import { CALIBRATION_REASON, REASON } from '../../domain/record';
import { MARKET } from '../../domain/types';
import type { AccountType, Currency, Market, TxType } from '../../domain/types';

/** Remarks the app writes into records (stored in Chinese), in English. A remark the user typed is shown as typed */
const REASONS_EN: Readonly<Record<string, string>> = {
  [REASON.autoDeposit]: 'Auto deposit to cover a buy',
  [REASON.autoWithdraw]: 'Auto withdrawal after a cross-currency sale',
  [REASON.checked]: 'Checked',
  [REASON.invest]: 'Invest new money',
  [REASON.withdraw]: 'Withdraw',
  [CALIBRATION_REASON.dividend]: 'Dividends reinvested',
  [CALIBRATION_REASON.split]: 'Stock split',
  [CALIBRATION_REASON.manual]: 'Manual correction',
};

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const en = {
  appName: 'AI Investment Manager',
  save: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  edit: 'Edit',
  next: 'Next',
  back: 'Back',
  currency: 'Currency',
  displayCurrency: 'Display currency',
  currencyNames: { CNY: 'CNY', USD: 'USD', HKD: 'HKD' } as Record<Currency, string>,
  /** "Amount (¥)" */
  amountIn: (symbol: string) => `Amount (${symbol})`,
  /** A share count with its unit; the count is already formatted (or masked) */
  shares: (count: string) => `${count} shares`,
  language: 'Language',
  /** Each language is named in its own language, in both locales */
  languageNames: { en: 'English', zh: '中文' },
  markets: { [MARKET.us]: 'US', [MARKET.cn]: 'A-share', [MARKET.fund]: 'Mutual fund', [MARKET.cash]: 'Cash' } as Record<Market, string>,
  accountTypes: { broker: 'Broker', bank: 'Bank' } as Record<AccountType, string>,
  txTypes: {
    opening: 'Opening balance',
    buy: 'Buy',
    sell: 'Sell',
    deposit: 'Deposit',
    withdraw: 'Withdrawal',
    calibrate: 'Calibration',
  } as Record<TxType, string>,
  /** The slot that holds every individual stock not set apart in the target */
  stocksTotal: 'Individual stocks',
  /** A record's remark for display */
  reason: (stored: string): string => REASONS_EN[stored] ?? stored,
  /** A day without the year; month is 1–12 */
  shortDate: (month: number, day: number) => `${MONTHS_EN[month - 1]} ${day}`,
};

export const zh: typeof en = {
  appName: 'AI 投资管理器',
  save: '保存',
  cancel: '取消',
  close: '关闭',
  edit: '编辑',
  next: '下一步',
  back: '上一步',
  currency: '币种',
  displayCurrency: '显示币种',
  currencyNames: { CNY: '人民币', USD: '美元', HKD: '港币' },
  amountIn: (symbol) => `金额（${symbol}）`,
  shares: (count) => `${count} 份`,
  language: '语言',
  languageNames: { en: 'English', zh: '中文' },
  markets: { [MARKET.us]: '美股', [MARKET.cn]: 'A股', [MARKET.fund]: '场外基金', [MARKET.cash]: '现金' },
  accountTypes: { broker: '券商', bank: '银行' },
  txTypes: { opening: '期初', buy: '买入', sell: '卖出', deposit: '入金', withdraw: '出金', calibrate: '校准' },
  stocksTotal: '个股合计',
  reason: (stored) => stored,
  shortDate: (month, day) => `${month}月${day}日`,
};
