// The frame around the pages: tabs, the sample-data banner, the screens shown while starting up, toasts.
import type { TabId } from '../../app/tabs';

export const en = {
  tabs: { perf: 'Returns', plan: 'Plan', hold: 'Holdings', rec: 'Records', ai: 'AI advisor' } as Record<TabId, string>,
  mainNav: 'Main navigation',
  /** Between a tab's name and its badge, for screen readers */
  badgeSeparator: ', ',
  /** Read out after a tab's name when it has a dot */
  badges: {
    waitingToSync: (n: number) => `${n} waiting to sync`,
    rebalanceDue: 'Rebalance due',
  },
  demoBanner: 'Viewing sample data. Nothing is saved.',
  demoStart: 'Enter my holdings',
  cannotStoreTitle: "This device can't save data",
  cannotStoreHint: "The browser won't let this page store data, perhaps because of private browsing. Open it in a normal window, or use Safari or Chrome.",
  offlineTitle: 'Connect to the internet',
  offlineHint: "This is the first time on this device, so your account's data has to be read once online. It carries on by itself once you're connected.",
  expiredTitle: 'Login expired',
  expiredHint: "Sign in again to carry on reading your account's data.",
  signInAgain: 'Sign in again',
  readFailedTitle: "Couldn't read your data",
  readFailedHint: "This is the first time on this device, so your account's data has to be read first. It will try again shortly.",
  reading: 'Reading your data from the cloud…',
  saveFailed: "Couldn't save on this device. Export a full backup to be safe.",
  onboardingDone: 'All entered. Fetching the latest quotes.',
};

export const zh: typeof en = {
  tabs: { perf: '收益', plan: '计划', hold: '持仓', rec: '记录', ai: 'AI 投顾' },
  mainNav: '主导航',
  badgeSeparator: '，',
  badges: {
    waitingToSync: (n) => `${n} 笔待同步`,
    rebalanceDue: '需要再平衡',
  },
  demoBanner: '正在看示例数据，不会保存',
  demoStart: '开始录入',
  cannotStoreTitle: '这台设备不能保存数据',
  cannotStoreHint: '浏览器不让这个网页存数据，可能是开了无痕模式。换成普通模式打开，或者改用 Safari、Chrome。',
  offlineTitle: '需要联网',
  offlineHint: '第一次在这台设备上使用，需要联网读取一次账号的数据。联网后会自动继续。',
  expiredTitle: '登录已过期',
  expiredHint: '重新登录后继续读取账号的数据。',
  signInAgain: '重新登录',
  readFailedTitle: '读取没成功',
  readFailedHint: '第一次在这台设备上使用，要先读取账号的数据。稍后会自动重试。',
  reading: '正在读取云端数据…',
  saveFailed: '保存到本机失败，建议先导出一份完整备份',
  onboardingDone: '录入完成，正在拉取最新行情',
};
