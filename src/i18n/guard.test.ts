import { describe, expect, it } from 'vitest';

// English is the source language: interface copy lives in src/i18n/messages, never inline. Chinese may appear in
// code only where it is data: the Chinese messages, stored values, the preset and sample catalogs, and test
// fixtures. Comments may quote the Chinese spec (README「…」) and are not checked.

const sources = {
  ...import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('/worker/src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

const ALLOWED = [
  /^\/src\/i18n\/messages\//, // the Chinese messages
  /^\/src\/i18n\/catalog\.ts$/, // the stored Chinese names of the presets
  /^\/src\/i18n\/sample\.ts$/, // the sample's own Chinese remarks
  /^\/src\/mock\//, // the sample data, stored in Chinese like real data
  /^\/src\/domain\/types\.ts$/, // MARKET: market values as stored
  /^\/src\/domain\/record\.ts$/, // REASON, CALIBRATION_REASON: remarks as stored
  /^\/src\/app\/format\.ts$/, // 万, the ten-thousand unit of Chinese number formatting
  /^\/worker\/src\/testdata\.ts$/, // responses from Chinese quote providers
];

const CJK = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

/** The code of a file with its comments taken out ("//" after a colon is a URL, not a comment) */
function code(text: string): string[] {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ''))
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'));
}

describe('interface copy', () => {
  it('reads the source files', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it('keeps Chinese out of the code, except where it is data', () => {
    const found: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      if (/\.test\.tsx?$/.test(path) || ALLOWED.some((re) => re.test(path))) continue;
      code(text).forEach((line, i) => {
        if (CJK.test(line)) found.push(`${path}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(found).toEqual([]);
  });
});
