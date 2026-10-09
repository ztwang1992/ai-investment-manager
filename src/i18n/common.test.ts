import { describe, expect, it } from 'vitest';
import { CALIBRATION_REASON, REASON } from '../domain/record';
import { MARKET } from '../domain/types';
import { MESSAGES } from './index';

const en = MESSAGES.en;
const zh = MESSAGES.zh;

describe('shared words', () => {
  // Remarks the app wrote are stored in Chinese; what the user typed is theirs and stays as typed
  it('translates the remarks the app writes, and only those', () => {
    expect(en.common.reason(REASON.autoDeposit)).toBe('Auto deposit to cover a buy');
    expect(en.common.reason(REASON.checked)).toBe('Checked');
    expect(en.common.reason(CALIBRATION_REASON.dividend)).toBe('Dividends reinvested');
    expect(en.common.reason('给孩子的学费')).toBe('给孩子的学费');
    expect(zh.common.reason(REASON.autoDeposit)).toBe(REASON.autoDeposit);
  });

  it('names markets by their stored value', () => {
    expect(en.common.markets[MARKET.cn]).toBe('A-share');
    expect(zh.common.markets[MARKET.cn]).toBe('A股');
  });

  it('includes the preset names for the language', () => {
    expect(en.names.exposure({ id: 'sp500', name: '标普 500' })).toBe('S&P 500');
    expect(zh.names.exposure({ id: 'sp500', name: '标普 500' })).toBe('标普 500');
  });
});
