import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../i18n';
import { syncNoteText, syncStatusText } from './syncText';

const s = (state: 'idle' | 'syncing' | 'offline' | 'error' | 'signedOut', pending: number, lastSyncedAt: string | null = null) => ({
  state,
  pending,
  lastSyncedAt,
  pulledOnce: true,
});
const hm = () => '21:05';
const en = MESSAGES.en;

describe('sync wording', () => {
  it('shows nothing on the records page when everything is uploaded', () => {
    expect(syncNoteText(s('idle', 0), en)).toBeNull();
    expect(syncNoteText(s('offline', 0), en)).toBeNull();
  });

  it('says how many records are waiting and why', () => {
    expect(syncNoteText(s('offline', 2), en)).toBe('2 records waiting to sync · uploads when online');
    expect(syncNoteText(s('syncing', 2), en)).toBe('2 records waiting to sync · uploading…');
    expect(syncNoteText(s('error', 2), en)).toBe('2 records waiting to sync · upload failed, will retry shortly');
    expect(syncNoteText(s('signedOut', 2), en)).toBe('2 records waiting to sync · login expired, sign in again to keep uploading');
    expect(syncNoteText(s('idle', 1), en)).toBe('1 record waiting to sync');
  });

  it('sums up the sync in the backup section', () => {
    expect(syncStatusText(s('idle', 0, '2026-09-30T13:05:00.000Z'), hm, en)).toBe('Synced · 21:05');
    expect(syncStatusText(s('idle', 0), hm, en)).toBe('Synced');
    expect(syncStatusText(s('syncing', 0), hm, en)).toBe('Syncing…');
    expect(syncStatusText(s('offline', 0), hm, en)).toBe('Offline, syncs when online');
    expect(syncStatusText(s('error', 0), hm, en)).toBe('Sync failed, will retry shortly');
    expect(syncStatusText(s('offline', 3), hm, en)).toBe('3 records waiting to sync · uploads when online');
    expect(syncStatusText(s('signedOut', 0), hm, en)).toBe('Login expired, sign in again to keep syncing');
  });

  it('says the same in Chinese', () => {
    expect(syncNoteText(s('offline', 2), MESSAGES.zh)).toBe('2 笔待同步 · 联网后自动上传');
    expect(syncStatusText(s('idle', 0, '2026-09-30T13:05:00.000Z'), hm, MESSAGES.zh)).toBe('已同步 · 21:05');
  });
});
