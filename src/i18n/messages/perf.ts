// The Returns page.
import type { RangeKey } from '../../domain/performance';
import { en as commonEn } from './common';

/** A date as "Sep 18", from "2026-09-18" */
const dayEn = (date: string) => commonEn.shortDate(Number(date.slice(5, 7)), Number(date.slice(8, 10)));

export const en = {
  title: 'Returns',
  pullToRefresh: 'Pull to refresh',
  releaseToRefresh: 'Release to refresh quotes and exchange rates',
  showHideAmounts: 'Show or hide amounts',
  period: 'Period',
  displayCurrency: 'Display currency',
  currencies: { CNY: 'CNY', USD: 'USD' },
  ranges: {
    '1w': '1 week',
    '1m': '1 month',
    '3m': '3 months',
    '1y': '1 year',
    '3y': '3 years',
    '5y': '5 years',
    all: 'All time',
  } as Record<RangeKey, string>,
  /** The gain over the chosen period */
  rangeGain: {
    '1w': '1-week gain',
    '1m': '1-month gain',
    '3m': '3-month gain',
    '1y': '1-year gain',
    '3y': '3-year gain',
    '5y': '5-year gain',
    all: 'Total gain',
  } as Record<RangeKey, string>,
  /** The gain up to the day under the finger on the chart */
  cumulativeGain: 'Cumulative gain',
  totalNow: 'Total assets · now',
  totalOn: (date: string, withYear: boolean) => `Total assets · ${dayEn(date)}${withYear ? `, ${date.slice(0, 4)}` : ''}`,
  netInvested: (amount: string) => `Net invested ${amount}`,
  freshNote:
    'Your returns chart starts today. Total assets are recorded after each market close, so a trend shows within a few days. Deposits and withdrawals are marked on the principal line.',
  legendTotal: 'Total assets',
  legendPrincipal: 'Net invested',
  swipeForEarlier: '← Swipe for earlier dates',
  periodReturn: 'Return for the period',
  periodNetInflow: 'Net invested in the period',
  flowsTitle: 'Money in and out',
  principalNote:
    'The principal line moves only with deposits and withdrawals. Trades inside the portfolio, such as rebalancing or switching funds, leave it alone; a sale lowers it only when the money leaves the portfolio.',
  byAsset: (range: string) => `Performance by asset · ${range}`,
  quotes: {
    notConnected: 'No quotes service',
    refreshing: 'Updating prices and exchange rates…',
    unavailable: 'Quotes unavailable',
    unavailableShowing: (when: string) => `Quotes unavailable · showing prices from ${when}`,
    updated: (time: string, usdCny: string) => `Updated ${time} · USD/CNY ${usdCny} · mutual funds at T-1 NAV`,
    waiting: 'Waiting for update',
  },
};

const RANGES_ZH: Record<RangeKey, string> = { '1w': '1周', '1m': '1个月', '3m': '3个月', '1y': '1年', '3y': '3年', '5y': '5年', all: '全部' };

export const zh: typeof en = {
  title: '收益',
  pullToRefresh: '下拉刷新',
  releaseToRefresh: '松开刷新行情与汇率',
  showHideAmounts: '显示或隐藏金额',
  period: '区间',
  displayCurrency: '显示币种',
  currencies: { CNY: '人民币', USD: '美元' },
  ranges: RANGES_ZH,
  rangeGain: Object.fromEntries(Object.entries(RANGES_ZH).map(([k, label]) => [k, `${label}收益`])) as Record<RangeKey, string>,
  cumulativeGain: '累计收益',
  totalNow: '总资产 · 当前',
  totalOn: (date, withYear) => `总资产 · ${date.slice(5)}${withYear ? ` ${date.slice(0, 4)}` : ''}`,
  netInvested: (amount) => `净投入本金 ${amount}`,
  freshNote: '收益曲线从今天开始积累。每天收盘后记录一次总资产，几天后就能看到走势；入金和出金会在本金线上标出。',
  legendTotal: '总资产',
  legendPrincipal: '净投入本金',
  swipeForEarlier: '← 左右滑动查看更早',
  periodReturn: '区间收益率',
  periodNetInflow: '区间净投入',
  flowsTitle: '区间资金进出',
  principalNote: '本金线只随「入金 / 出金」变化。组合内部的买卖（再平衡、换仓）不改变本金，卖出只有把钱转出组合时，本金线才会下降。',
  byAsset: (range) => `各资产表现 · ${range}`,
  quotes: {
    notConnected: '未连接行情服务',
    refreshing: '正在更新实时价格与汇率…',
    unavailable: '行情暂不可用',
    unavailableShowing: (when) => `行情暂不可用 · 显示的是 ${when} 的价格`,
    updated: (time, usdCny) => `已更新 ${time} · USD/CNY ${usdCny} · 场外基金为 T-1 净值`,
    waiting: '等待更新',
  },
};
