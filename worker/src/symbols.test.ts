import { describe, expect, it } from 'vitest';
import { cnExchange, sinaSymbol, tencentSymbol, yahooSymbol } from './symbols';

describe('symbols for each source', () => {
  it('puts 6, 5 and 9 on Shanghai and 0, 1, 2 and 3 on Shenzhen', () => {
    expect(['600519', '513500', '900901'].map(cnExchange)).toEqual(['sh', 'sh', 'sh']);
    expect(['000001', '159915', '200002', '300750'].map(cnExchange)).toEqual(['sz', 'sz', 'sz', 'sz']);
  });

  it('writes Tencent symbols', () => {
    expect(tencentSymbol('us', 'VOO')).toBe('usVOO');
    expect(tencentSymbol('us', 'BRK.B')).toBe('usBRK.B');
    expect(tencentSymbol('cn', '513500')).toBe('sh513500');
    expect(tencentSymbol('cn', '159915')).toBe('sz159915');
  });

  it('writes Yahoo symbols', () => {
    expect(yahooSymbol('us', 'VOO')).toBe('VOO');
    expect(yahooSymbol('us', 'BRK.B')).toBe('BRK-B');
    expect(yahooSymbol('cn', '600519')).toBe('600519.SS');
    expect(yahooSymbol('cn', '300750')).toBe('300750.SZ');
  });

  // Sina writes US codes in lowercase with the dot as $: gb_brk.b returns nothing, gb_brk$b has data (tested 2026-10-01)
  it('writes Sina symbols', () => {
    expect(sinaSymbol('us', 'VOO')).toBe('gb_voo');
    expect(sinaSymbol('us', 'BRK.B')).toBe('gb_brk$b');
    expect(sinaSymbol('cn', '513500')).toBe('sh513500');
    expect(sinaSymbol('cn', '000001')).toBe('sz000001');
    expect(sinaSymbol('fund', '050025')).toBe('f_050025');
  });
});
