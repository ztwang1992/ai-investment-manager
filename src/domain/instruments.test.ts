import { describe, expect, it } from 'vitest';
import * as mock from '../mock';
import { findInstrument, guessCurrency, newInstrument, normalizeCode } from './instruments';

describe('code lookup', () => {
  it('normalizes codes and finds them in the catalog', () => {
    expect(normalizeCode('  brk.b ')).toBe('BRK.B');
    expect(findInstrument('voo', mock.instruments)?.name).toBe('Vanguard 标普500');
    expect(findInstrument('513100', mock.instruments)?.exposureId).toBe('ndx');
    expect(findInstrument('ABCD', mock.instruments)).toBeNull();
    expect(findInstrument('   ', mock.instruments)).toBeNull();
  });

  it('guesses the currency and market of an unknown code from its digits', () => {
    expect(guessCurrency('600036')).toBe('CNY');
    expect(guessCurrency('tsla')).toBe('USD');
    expect(newInstrument(' abcd ', 'ndx')).toEqual({
      code: 'ABCD',
      name: '',
      market: '美股',
      currency: 'USD',
      exposureId: 'ndx',
      paysDividend: false,
    });
    expect(newInstrument('600036', 'csi300')).toMatchObject({ market: 'A股', currency: 'CNY' });
    expect(newInstrument('161125', 'sp500', '场外基金')).toMatchObject({ market: '场外基金', currency: 'CNY' });
    // Letter codes are always US stocks; the chosen market only matters for all-digit codes
    expect(newInstrument('MSFT', 'stock-MSFT', '场外基金')).toMatchObject({ market: '美股', currency: 'USD' });
  });
});
