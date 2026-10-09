// Calibration: the sheet that corrects one holding's share count, and the list of holdings to check this period.
import type { CALIBRATION_REASON } from '../../domain/record';
import { en as commonEn } from './common';

/** "Sep 18" from "2026-09-18" */
const dayEn = (date: string) => commonEn.shortDate(Number(date.slice(5, 7)), Number(date.slice(8, 10)));

export const en = {
  title: 'Calibrate holding',
  appShares: 'Shares in the app',
  currentValue: 'Current value',
  brokerShares: 'Shares shown by your broker',
  reason: 'Reason for the difference',
  /** Short, so the three fit side by side on a phone; the record keeps the full remark */
  reasonOptions: { dividend: 'Dividends', split: 'Split', manual: 'Correction' } as Record<keyof typeof CALIBRATION_REASON, string>,
  /** Both parts already carry their sign */
  difference: (shares: string, value: string) => `Difference ${shares} shares · value ${value}`,
  note: 'Calibration only corrects the share count. It is not a trade and does not change net invested. Total cost stays the same, so the average cost per share adjusts. Quotes and values refresh after saving.',
  invalidQty: 'Enter a valid share count',
  calibrated: (code: string, change: string) => `${code} calibrated ${change} shares. Refreshing values.`,
  unchanged: 'Shares match. Marked as checked.',
  saveCalibration: 'Save calibration',

  listTitle: 'To check this period',
  listSubtitle: "Check each share count against your broker's app. If a count hasn't changed, open it and save once to mark it as checked.",
  allDone: 'Everything is checked for this period',
  big: 'Large',
  dividend: 'Dividends reinvested',
  lastOn: (date: string) => `last ${dayEn(date)}`,
  never: 'never checked',
  markAll: 'Mark all as checked',
  markedAll: (n: number) => (n === 1 ? '1 marked as checked' : `${n} marked as checked`),
};

export const zh: typeof en = {
  title: '校准持仓',
  appShares: 'App 记录份额',
  currentValue: '当前市值',
  brokerShares: '券商显示的实际份额',
  reason: '差异原因',
  reasonOptions: { dividend: '红利再投', split: '拆股合股', manual: '手动修正' },
  difference: (shares, value) => `差异 ${shares} 份 · 市值 ${value}`,
  note: '校准只修正份额，不算买卖，也不改变净投入本金。总成本不变，平均成本会相应摊薄。保存后会自动刷新行情和市值。',
  invalidQty: '请输入有效的份额',
  calibrated: (code, change) => `已校准 ${code} ${change} 份，正在刷新市值`,
  unchanged: '份额一致，已标记为已核对',
  saveCalibration: '保存校准',

  listTitle: '本期待校准',
  listSubtitle: '对照券商 App 里的份额逐个核对。份额没变也点进去保存一次，就会标记为已核对。',
  allDone: '本期全部核对完成',
  big: '大额',
  dividend: '红利再投',
  lastOn: (date) => `上次 ${date.slice(5)}`,
  never: '从未校准',
  markAll: '全部标记已核对',
  markedAll: (n) => `已标记 ${n} 项为已核对`,
};
