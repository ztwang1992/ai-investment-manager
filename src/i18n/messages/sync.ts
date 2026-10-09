// Sync status: the line under the Records title, and the status in Settings.

export const en = {
  waiting: (n: number) => (n === 1 ? '1 record waiting to sync' : `${n} records waiting to sync`),
  uploadsWhenOnline: 'uploads when online',
  uploading: 'uploading…',
  uploadFailed: 'upload failed, will retry shortly',
  expiredUpload: 'login expired, sign in again to keep uploading',
  expired: 'Login expired, sign in again to keep syncing',
  syncing: 'Syncing…',
  failed: 'Sync failed, will retry shortly',
  offline: 'Offline, syncs when online',
  synced: 'Synced',
  syncedAt: (time: string) => `Synced · ${time}`,
};

export const zh: typeof en = {
  waiting: (n) => `${n} 笔待同步`,
  uploadsWhenOnline: '联网后自动上传',
  uploading: '正在上传…',
  uploadFailed: '上传没成功，稍后自动重试',
  expiredUpload: '登录已过期，重新登录后继续上传',
  expired: '登录已过期，重新登录后继续同步',
  syncing: '正在同步…',
  failed: '同步没成功，稍后自动重试',
  offline: '离线，联网后自动同步',
  synced: '已同步',
  syncedAt: (time) => `已同步 · ${time}`,
};
