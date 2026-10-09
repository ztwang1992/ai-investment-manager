import { describe, expect, it } from 'vitest';
import { marketFor } from './accounts';

describe('marketFor', () => {
  it('maps a new account to the market it can buy in (prototype mktFor)', () => {
    expect(marketFor('broker', 'USD')).toBe('美股');
    expect(marketFor('broker', 'CNY')).toBe('A股');
    expect(marketFor('bank', 'CNY')).toBe('场外基金');
    expect(marketFor('bank', 'USD')).toBe('美股');
  });
});
