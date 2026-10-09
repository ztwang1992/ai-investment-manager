import { formatTimeHM } from '../../app/format';
import type { Messages } from '../../i18n';

/**
 * The refresh status line at the top of Returns (README: "已更新 HH:MM · USD/CNY x.xxxx · 场外基金为 T-1 净值").
 * connected: a quotes Worker address is configured (VITE_API_BASE)
 */
export function quoteStatusText(
  i: { connected: boolean; refreshing: boolean; error: boolean; updatedAt: Date | null; usdCny: number; now: Date },
  t: Messages,
): string {
  const q = t.perf.quotes;
  if (!i.connected) return q.notConnected;
  if (i.refreshing) return q.refreshing;
  if (i.error) return i.updatedAt ? q.unavailableShowing(when(i.updatedAt, i.now, t)) : q.unavailable;
  if (i.updatedAt) return q.updated(formatTimeHM(i.updatedAt), i.usdCny.toFixed(4));
  return q.waiting;
}

/** Today's time alone; an earlier day with its date */
function when(at: Date, now: Date, t: Messages): string {
  const sameDay = at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth() && at.getDate() === now.getDate();
  return sameDay ? formatTimeHM(at) : `${t.common.shortDate(at.getMonth() + 1, at.getDate())} ${formatTimeHM(at)}`;
}
