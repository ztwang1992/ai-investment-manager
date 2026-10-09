import { describe, expect, it } from 'vitest';
import { isCashCode } from './types';

describe('isCashCode', () => {
  it('recognises the cash instrument codes', () => {
    expect(isCashCode('CNY')).toBe(true);
    expect(isCashCode('USD')).toBe(true);
  });

  it('rejects security codes and HKD (display-only currency)', () => {
    expect(isCashCode('VOO')).toBe(false);
    expect(isCashCode('513500')).toBe(false);
    expect(isCashCode('HKD')).toBe(false);
  });
});
