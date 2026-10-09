import { describe, expect, it } from 'vitest';
import { detectLocale, readLocale, saveLocale } from './locale';

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};
const broken = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
};

describe('interface language', () => {
  it('follows the device: any Chinese variant gives Chinese, everything else English', () => {
    expect(detectLocale(['zh-CN'])).toBe('zh');
    expect(detectLocale(['zh-Hant-TW', 'en-US'])).toBe('zh');
    expect(detectLocale(['zh'])).toBe('zh');
    expect(detectLocale(['en-US', 'zh-CN'])).toBe('en');
    expect(detectLocale(['ja-JP'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });

  it('prefers the language picked in settings over the device language', () => {
    const storage = memory();
    saveLocale(storage, 'zh');
    expect(readLocale(storage, ['en-US'])).toBe('zh');
    saveLocale(storage, 'en');
    expect(readLocale(storage, ['zh-CN'])).toBe('en');
  });

  it('ignores an unknown saved value', () => {
    const storage = memory();
    storage.setItem('locale', 'fr');
    expect(readLocale(storage, ['zh-CN'])).toBe('zh');
  });

  // Private browsing can block storage: the device language still applies, and saving never throws
  it('falls back to the device language when storage is blocked or missing', () => {
    expect(readLocale(broken, ['zh-CN'])).toBe('zh');
    expect(readLocale(null, ['en-GB'])).toBe('en');
    expect(() => saveLocale(broken, 'zh')).not.toThrow();
  });
});
