import { describe, expect, it } from 'vitest';
import { MARKET } from '../domain/types';
import { exposures, groups, instruments } from '../mock/catalog';
import { EXPOSURE_NAMES, GROUP_NAMES, INSTRUMENT_NAMES, namesFor } from './catalog';

const en = namesFor('en');
const zh = namesFor('zh');

describe('preset names', () => {
  it('shows the English name in English while the stored name is still the original', () => {
    expect(en.group({ id: 'us', name: '美股指数' })).toBe('US stock indexes');
    expect(en.exposure({ id: 'sp500', name: '标普 500' })).toBe('S&P 500');
    expect(en.instrument({ code: 'VOO', name: 'Vanguard 标普500' })).toBe('Vanguard S&P 500');
    expect(en.instrument({ code: 'USD', name: '美元现金' })).toBe('USD cash');
  });

  it('shows the stored name in Chinese', () => {
    expect(zh.exposure({ id: 'sp500', name: '标普 500' })).toBe('标普 500');
    expect(zh.instrument({ code: 'VOO', name: 'Vanguard 标普500' })).toBe('Vanguard 标普500');
  });

  // The user's own words are never replaced
  it('shows a renamed preset and a user-created name as typed', () => {
    expect(en.exposure({ id: 'sp500', name: '我的标普' })).toBe('我的标普');
    expect(en.exposure({ id: 'stock-tsla', name: 'Tesla' })).toBe('Tesla');
    expect(en.instrument({ code: 'TSLA', name: '特斯拉' })).toBe('特斯拉');
  });

  // Decision 3: A-share and Chinese fund names are product names
  it('keeps A-share and Chinese fund names in Chinese', () => {
    expect(en.exposure({ id: 'moutai', name: '贵州茅台' })).toBe('贵州茅台');
    expect(en.instrument({ code: '600519', name: '贵州茅台' })).toBe('贵州茅台');
    expect(en.instrument({ code: '050025', name: '博时标普500 QDII' })).toBe('博时标普500 QDII');
  });

  it('agrees with the sample catalog', () => {
    for (const g of groups) expect(GROUP_NAMES[g.id]?.zh, g.id).toBe(g.name);
    for (const e of exposures) if (e.id !== 'moutai') expect(EXPOSURE_NAMES[e.id]?.zh, e.id).toBe(e.name);
    for (const i of instruments) {
      if (i.market === MARKET.us || i.market === MARKET.cash) expect(INSTRUMENT_NAMES[i.code]?.zh, i.code).toBe(i.name);
      else expect(INSTRUMENT_NAMES[i.code], i.code).toBeUndefined();
    }
  });
});
