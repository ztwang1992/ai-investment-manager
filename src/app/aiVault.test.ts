import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiVault } from './aiVault';
import type { AiSaved } from './aiVault';
import { openLocalDb } from './localDb';
import type { LocalDb } from './localDb';

// The AI key is only ever stored encrypted on this device (CLAUDE.md). This uses the real WebCrypto (built into Node) and an in-memory IndexedDB.

let n = 0;
const dbs: LocalDb[] = [];
const freshDb = () => {
  const db = openLocalDb(`vault-${++n}`);
  dbs.push(db);
  return db;
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of dbs.splice(0)) await db.delete();
});

/** A fake key for the tests, not a real one */
const KEY = 'sk-test-0123456789abcdefFAKE';
const saved: AiSaved = { base: 'https://api.deepseek.com', model: 'deepseek-chat', key: KEY, consent: true, web: false };

/** Every row of every table in the database as text (binary decoded as UTF-8), to search for plaintext */
async function everything(db: LocalDb): Promise<string> {
  const text: string[] = [];
  const replacer = (_: string, v: unknown) => {
    if (v instanceof ArrayBuffer) return new TextDecoder().decode(v);
    if (ArrayBuffer.isView(v)) return new TextDecoder().decode(v as Uint8Array);
    return v;
  };
  for (const table of db.tables) for (const row of await table.toArray()) text.push(JSON.stringify(row, replacer));
  return text.join('\n');
}

describe('keeping the AI key on this device', () => {
  it('reads back what was saved', async () => {
    const vault = createAiVault(freshDb());
    await vault.save(saved);
    expect(await vault.load()).toEqual(saved);
  });

  it('keeps only ciphertext, encrypted with a key that cannot be exported', async () => {
    const db = freshDb();
    await createAiVault(db).save(saved);
    expect(await everything(db)).not.toContain(KEY);
    expect((await db.vault.get('ai'))!.cryptoKey!.extractable).toBe(false);
  });

  it('uses a new nonce every time it saves', async () => {
    const db = freshDb();
    const vault = createAiVault(db);
    await vault.save(saved);
    const first = Array.from((await db.vault.get('ai'))!.iv!);
    await vault.save(saved);
    const second = Array.from((await db.vault.get('ai'))!.iv!);
    expect(second).not.toEqual(first);
    expect(await vault.load()).toEqual(saved);
  });

  it('forgets the key but keeps the address and model when saved without a key', async () => {
    const db = freshDb();
    const vault = createAiVault(db);
    await vault.save(saved);
    await vault.save({ ...saved, key: '' });
    expect(await vault.load()).toEqual({ ...saved, key: '' });
    expect((await db.vault.get('ai'))!.cipher).toBeUndefined();
  });

  it('gives back the settings without a key when the stored key cannot be decrypted, quietly', async () => {
    const db = freshDb();
    const vault = createAiVault(db);
    await vault.save(saved);
    const row = (await db.vault.get('ai'))!;
    const broken = new Uint8Array(row.cipher!.slice(0));
    broken[0] = broken[0]! ^ 0xff;
    await db.vault.put({ ...row, cipher: broken.buffer });
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'log')];
    expect(await vault.load()).toEqual({ ...saved, key: '' });
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });

  it('has nothing after it is cleared', async () => {
    const vault = createAiVault(freshDb());
    expect(await vault.load()).toBeNull();
    await vault.save(saved);
    await vault.clear();
    expect(await vault.load()).toBeNull();
  });
});
