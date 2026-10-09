import type { LocalDb, VaultRow } from './localDb';

// The AI advisor's key is only ever stored encrypted on this device (CLAUDE.md), in this account's local database:
// - the first save creates a non-extractable AES-GCM key (the CryptoKey object goes straight into IndexedDB) that encrypts the AI key; the database holds only ciphertext;
// - this protects against browser data or a backup being copied and the key read from it, not against a malicious script running on this site (it can decrypt with the key directly);
// - the API address, model, consent and web search switch are stored here too: only on this device, never synced or backed up.
// Errors are not logged: a log could carry the key.

export interface AiSaved {
  base: string;
  model: string;
  /** An empty string means no key is saved */
  key: string;
  consent: boolean;
  web: boolean;
}

export interface AiVault {
  /** null before anything is saved; the settings without the key when the key can't be decrypted */
  load(): Promise<AiSaved | null>;
  save(s: AiSaved): Promise<void>;
  /** Deletes everything saved on this device (on sign-out) */
  clear(): Promise<void>;
}

const NAME = 'ai';

export function createAiVault(db: LocalDb, subtle: SubtleCrypto = globalThis.crypto.subtle): AiVault {
  return {
    async load() {
      const row = await db.vault.get(NAME);
      if (!row) return null;
      const settings = { base: row.base, model: row.model, consent: row.consent, web: row.web };
      if (!row.cryptoKey || !row.iv || !row.cipher) return { ...settings, key: '' };
      try {
        const plain = await subtle.decrypt({ name: 'AES-GCM', iv: row.iv }, row.cryptoKey, row.cipher);
        return { ...settings, key: new TextDecoder().decode(plain) };
      } catch {
        return { ...settings, key: '' };
      }
    },
    async save(s) {
      const settings: VaultRow = { name: NAME, base: s.base, model: s.model, consent: s.consent, web: s.web };
      if (!s.key) {
        await db.vault.put(settings);
        return;
      }
      const cryptoKey =
        (await db.vault.get(NAME))?.cryptoKey ?? (await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      const cipher = await subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(s.key));
      await db.vault.put({ ...settings, cryptoKey, iv, cipher });
    },
    async clear() {
      await db.vault.delete(NAME);
    },
  };
}
