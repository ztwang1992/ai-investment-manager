// The Records page, the record lines, and the Add record sheet (hints, errors, toasts).
import type { RecordTime } from '../../domain/records';
import { en as commonEn } from './common';

const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "Sep 18" from "2026-09-18" */
const dayEn = (date: string) => commonEn.shortDate(Number(date.slice(5, 7)), Number(date.slice(8, 10)));

export const en = {
  title: 'Records',
  add: 'Add record',
  timeLabel: 'Period',
  kindLabel: 'Type',
  times: { all: 'All', '7d': '7 days', '30d': '30 days', lastMonth: 'Last month', thisYear: 'This year', lastYear: 'Last year' } as Record<RecordTime, string>,
  allKinds: 'All',
  count: (n: number) => (n === 1 ? '1 record' : `${n} records`),
  newestFirst: 'Newest first ↓',
  oldestFirst: 'Oldest first ↑',
  empty: 'No matching records in this period',
  /** "September 2026" from "2026-09" */
  month: (month: string) => `${MONTHS_EN[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`,

  line: {
    moneyIn: 'Money in',
    moneyOut: 'Money out',
    opening: 'Opening entry',
    noChange: 'No change in shares',
    fee: (fee: number) => ` · fee ${fee}`,
    /** The day of a record in its line */
    date: dayEn,
  },

  sheet: {
    account: 'Account',
    code: 'Code',
    codePlaceholder: 'For example VOO, 513500, 050025',
    unrecognized: 'Not recognized. Choose its underlying asset',
    choose: 'Choose…',
    ownStock: 'List as an individual stock',
    market: 'Market',
    quantity: 'Quantity',
    price: (currency: string) => `Price ${currency}`,
    fee: 'Fee',
    optional: 'Optional',
  },

  hints: {
    sellSameCurrency: "Proceeds after fees go to the account's cash and leave the principal line alone.",
    sellOtherCurrency: 'The proceeds are recorded as a withdrawal.',
    buyFromCash: (account: string, currency: string, cash: string) =>
      `Paid from ${account}'s ${currency} cash (now ${cash}); any shortfall is recorded as a deposit.`,
    buyAsNewMoney: "The instrument's currency differs from the account's, so this buy is recorded as new money in. Fees count toward cost.",
    deposit: 'Money coming in from outside the portfolio, such as salary or savings, raises the principal line on Returns.',
    withdraw: (cash: string) => `Money leaving the portfolio lowers the principal line. Account cash now ${cash}.`,
    recognized: (exposure: string, group: string, market: string) => `Recognized as ${exposure} · ${group} · ${market}`,
  },

  errors: {
    codeRequired: 'Enter a code',
    qtyPriceRequired: 'Enter the quantity and price',
    badFee: "The fee isn't valid",
    exposureRequired: 'Choose an underlying asset',
    cashTrade: 'Record cash with Deposit or Withdrawal',
    notEnoughShares: (shares: string) => `This account holds only ${shares} shares, not enough to sell`,
    amountRequired: 'Enter an amount',
    notEnoughCash: (amount: string) => `Account cash is only ${amount}, not enough to withdraw`,
  },

  saved: {
    cash: (deposit: boolean, amount: string) => `${deposit ? 'Deposit' : 'Withdrawal'} of ${amount} recorded · principal line updated`,
    buyFromCash: (code: string) => `${code} recorded, paid from account cash`,
    buyAsNewMoney: (code: string) => `${code} recorded as new money in`,
    buyWithTopUp: (code: string, amount: string) => `${code} recorded; the ${amount} shortfall was recorded as a deposit`,
    sellWithdrawn: (code: string) => `${code} recorded; the proceeds were recorded as a withdrawal`,
    sellToCash: (code: string) => `${code} recorded; the proceeds went to account cash`,
  },
};

export const zh: typeof en = {
  title: '记录',
  add: '记一笔',
  timeLabel: '时间',
  kindLabel: '类型',
  times: { all: '全部', '7d': '近 7 天', '30d': '近 30 天', lastMonth: '上个月', thisYear: '今年', lastYear: '去年' },
  allKinds: '全部',
  count: (n) => `共 ${n} 条记录`,
  newestFirst: '最新在前 ↓',
  oldestFirst: '最早在前 ↑',
  empty: '这个时间段没有符合条件的记录',
  month: (month) => `${month.slice(0, 4)} 年 ${Number(month.slice(5, 7))} 月`,

  line: {
    moneyIn: '转入资金',
    moneyOut: '转出资金',
    opening: '期初录入',
    noChange: '份额无变化',
    fee: (fee) => ` · 费 ${fee}`,
    date: (date) => date.slice(5),
  },

  sheet: {
    account: '账户',
    code: '代码',
    codePlaceholder: '如 VOO、513500、050025',
    unrecognized: '未识别，选择底层资产',
    choose: '请选择',
    ownStock: '作为个股单独列出',
    market: '市场',
    quantity: '数量',
    price: (currency) => `成交价 ${currency}`,
    fee: '手续费',
    optional: '可选',
  },

  hints: {
    sellSameCurrency: '卖出所得（扣除手续费）计入账户现金，不影响本金线。',
    sellOtherCurrency: '卖出所得记为出金。',
    buyFromCash: (account, currency, cash) => `从${account}的${currency}现金扣款（当前 ${cash}），不足部分自动记为入金。`,
    buyAsNewMoney: '品种币种和账户不同，这笔买入会记为新入金。手续费计入成本。',
    deposit: '从组合外转入的钱（工资、存款等），会让收益页的本金线上升。',
    withdraw: (cash) => `转出组合的钱，会让本金线下降。当前账户现金 ${cash}。`,
    recognized: (exposure, group, market) => `识别为：${exposure} · ${group} · ${market}`,
  },

  errors: {
    codeRequired: '请填写代码',
    qtyPriceRequired: '请填写数量和成交价',
    badFee: '手续费填写有误',
    exposureRequired: '请选择底层资产',
    cashTrade: '现金请用「入金」或「出金」记录',
    notEnoughShares: (shares) => `该账户只有 ${shares} 份，不够卖出`,
    amountRequired: '请填写金额',
    notEnoughCash: (amount) => `账户现金只有 ${amount}，不够转出`,
  },

  saved: {
    cash: (deposit, amount) => `已记录${deposit ? '入金' : '出金'} ${amount} · 本金线已更新`,
    buyFromCash: (code) => `已记录 ${code}，已从账户现金扣款`,
    buyAsNewMoney: (code) => `已记录 ${code}，记为新入金`,
    buyWithTopUp: (code, amount) => `已记录 ${code}，现金不足的 ${amount} 已记为入金`,
    sellWithdrawn: (code) => `已记录 ${code}，所得记为出金`,
    sellToCash: (code) => `已记录 ${code}，所得已计入账户现金`,
  },
};
