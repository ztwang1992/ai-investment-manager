import type { Messages } from '../i18n';
import type { SyncStatus } from './sync';

/** The line under the Records title; nothing when every record is uploaded */
export function syncNoteText(s: SyncStatus, t: Messages): string | null {
  if (s.pending === 0) return null;
  const head = t.sync.waiting(s.pending);
  switch (s.state) {
    case 'offline':
      return `${head} · ${t.sync.uploadsWhenOnline}`;
    case 'syncing':
      return `${head} · ${t.sync.uploading}`;
    case 'error':
      return `${head} · ${t.sync.uploadFailed}`;
    case 'signedOut':
      return `${head} · ${t.sync.expiredUpload}`;
    default:
      return head;
  }
}

/** The sync status in Settings → Backup */
export function syncStatusText(s: SyncStatus, formatTime: (iso: string) => string, t: Messages): string {
  if (s.state === 'signedOut') return s.pending > 0 ? syncNoteText(s, t)! : t.sync.expired;
  if (s.pending > 0) return syncNoteText(s, t)!;
  if (s.state === 'syncing') return t.sync.syncing;
  if (s.state === 'error') return t.sync.failed;
  if (s.state === 'offline') return t.sync.offline;
  return s.lastSyncedAt ? t.sync.syncedAt(formatTime(s.lastSyncedAt)) : t.sync.synced;
}
