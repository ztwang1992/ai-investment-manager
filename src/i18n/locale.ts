// The interface language. It follows the device unless the user picked one in settings;
// the choice is saved on this device only (it is not synced with the account).
// Pure: the storage and the device languages are passed in.

export type Locale = 'en' | 'zh';

export interface LocaleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'locale';

/** The device's first preferred language decides: any Chinese variant gives Chinese, everything else English. */
export function detectLocale(languages: readonly string[]): Locale {
  return languages[0]?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

/** A language picked in settings wins over the device language. */
export function readLocale(storage: LocaleStorage | null, languages: readonly string[]): Locale {
  try {
    const saved = storage?.getItem(KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    // Storage can be blocked (private browsing): use the device language
  }
  return detectLocale(languages);
}

export function saveLocale(storage: LocaleStorage | null, locale: Locale): void {
  try {
    storage?.setItem(KEY, locale);
  } catch {
    // Not saved: the choice still applies until the app is closed
  }
}
