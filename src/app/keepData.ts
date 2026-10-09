// Real data lives on this device (IndexedDB). Ask the browser to keep this site's data as "persistent", not cleared when space runs low.
// Safari and Chrome don't prompt; Firefox may ask once. If it's unsupported or refused, carry on as usual (the cloud has a copy).

interface StorageLike {
  persisted?: () => Promise<boolean>;
  persist?: () => Promise<boolean>;
}

export async function keepDeviceData(nav: { storage?: StorageLike } = globalThis.navigator ?? {}): Promise<void> {
  try {
    const storage = nav.storage;
    if (!storage?.persist) return;
    if (await storage.persisted?.()) return;
    await storage.persist();
  } catch {
    // carry on as usual
  }
}
