// The Holdings page (by asset, by account), the account sheet, adding an account, and Settings.
import { en as commonEn } from './common';

/** "Sep 28" from "2026-09-28" */
const dayEn = (date: string) => commonEn.shortDate(Number(date.slice(5, 7)), Number(date.slice(8, 10)));
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const en = {
  title: 'Holdings',
  settings: 'Settings',
  viewLabel: 'View',
  views: { asset: 'By asset', account: 'By account' },
  addAccount: '+ Add account',
  assetLine: (instruments: number, accounts: number, pct: string) =>
    `${count(instruments, 'instrument', 'instruments')} · ${count(accounts, 'account', 'accounts')} · ${pct}% of total`,
  instrumentLine: (market: string, currency: string, accounts: number, navDate: string | undefined) =>
    `${market} · ${currency} · ${count(accounts, 'account', 'accounts')}${navDate ? ` · NAV ${dayEn(navDate)}` : ''}`,
  spreadOver: (accounts: number) => `Spread over ${count(accounts, 'account', 'accounts')}`,
  accountLine: (type: string, currency: string, instruments: number) => `${type} · ${currency} · ${count(instruments, 'instrument', 'instruments')}`,

  accountSheet: {
    subtitle: (type: string, currency: string, pct: string) => `${type} · ${currency} · ${pct}% of total assets`,
    value: 'Value',
    empty: 'No holdings yet. Record a trade in Records.',
    calibrate: 'Calibrate ›',
  },

  addAccountSheet: {
    title: 'Add account',
    name: 'Name',
    placeholder: 'For example Longbridge or Huatai Securities',
    type: 'Type',
    currency: 'Account currency',
    nameRequired: 'Enter an account name',
    duplicate: 'An account with this name already exists',
    added: (name: string) => `Account added · ${name}`,
  },

  anomaly: {
    title: (n: number) => (n === 1 ? '1 negative share count or cash balance' : `${n} negative share counts or cash balances`),
    note: 'This can happen when several devices record offline at the same time. Calibrate a holding to the share count your broker shows; for cash, record a deposit or withdrawal.',
    calibrate: 'Calibrate',
    calibrateAria: (code: string) => `Calibrate ${code}`,
  },

  settingsPage: {
    backupTitle: 'Backup',
    localNote: 'Your data is kept on this device and syncs to the cloud when online. You can also export a copy.',
    noCloudNote:
      'Not connected to a cloud: this is sample data only, and changes are not saved. To keep your own records, fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local and restart; see the README.',
    signedInAs: (email: string, status: string) => `Signed in as ${email} · ${status}`,
    exportJson: 'Export full backup (JSON)',
    exportCsv: 'Export transactions (CSV)',
    exportedJson: 'Full backup exported',
    exportedCsv: 'Transactions exported',
    signOut: 'Sign out',
    signOutPending: (n: number) =>
      `${count(n, 'record is', 'records are')} not synced yet. They stay on this device and upload when you sign in again with the same email.`,
    signOutConfirm: 'Sign out',
  },
};

export const zh: typeof en = {
  title: '持仓',
  settings: '设置账户',
  viewLabel: '查看方式',
  views: { asset: '按底层资产', account: '按账户' },
  addAccount: '+ 添加账户',
  assetLine: (instruments, accounts, pct) => `${instruments} 个品种 · ${accounts} 个账户 · 占 ${pct}%`,
  instrumentLine: (market, currency, accounts, navDate) => `${market} · ${currency} · ${accounts} 个账户${navDate ? ` · 净值 ${navDate.slice(5)}` : ''}`,
  spreadOver: (accounts) => `资产分布在 ${accounts} 个账户`,
  accountLine: (type, currency, instruments) => `${type} · ${currency} · ${instruments} 个品种`,

  accountSheet: {
    subtitle: (type, currency, pct) => `${type} · ${currency} · 占总资产 ${pct}%`,
    value: '市值',
    empty: '暂无持仓，去「记录」记一笔',
    calibrate: '校准 ›',
  },

  addAccountSheet: {
    title: '添加账户',
    name: '名称',
    placeholder: '如 长桥、华泰证券',
    type: '类型',
    currency: '账户币种',
    nameRequired: '请填写账户名称',
    duplicate: '已有同名账户',
    added: (name) => `已添加账户 · ${name}`,
  },

  anomaly: {
    title: (n) => `有 ${n} 处份额或现金为负`,
    note: '可能是多台设备同时离线记账造成的。持仓用「校准」改成券商显示的份额；现金补记一笔入金或出金。',
    calibrate: '校准',
    calibrateAria: (code) => `校准 ${code}`,
  },

  settingsPage: {
    backupTitle: '数据备份',
    localNote: '数据保存在这台设备上，联网时自动同步到云端。也可以导出一份到本地留存。',
    noCloudNote: '没有连接云端：只能看示例数据，改动不会保存。要自己记账，在 .env.local 里填好 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY 后重新启动，详见 README。',
    signedInAs: (email, status) => `已登录 ${email} · ${status}`,
    exportJson: '导出完整备份（JSON）',
    exportCsv: '导出流水（CSV）',
    exportedJson: '已导出完整备份',
    exportedCsv: '已导出流水',
    signOut: '退出登录',
    signOutPending: (n) => `还有 ${n} 笔没同步。退出后记录留在这台设备上，下次用同一个邮箱登录时继续上传。`,
    signOutConfirm: '退出',
  },
};
