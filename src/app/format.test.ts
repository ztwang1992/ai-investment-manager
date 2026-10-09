import { describe, expect, it } from 'vitest';
import {
  MASK,
  formatAmount,
  formatFull,
  formatMoney,
  formatSignedAmount,
  formatSignedPct,
  formatQty,
  formatTimeHM,
  sign,
} from './format';

const fx = { CNY: 1, USD: 7.1, HKD: 0.91 };

describe('formatAmount (compact, like the prototype)', () => {
  it('uses 万 for CNY and HKD from ten thousand up in Chinese', () => {
    expect(formatAmount(3105000, 'CNY', 'zh')).toBe('¥310.5万');
    expect(formatAmount(9999, 'CNY', 'zh')).toBe('¥9999');
    expect(formatAmount(12000, 'HKD', 'zh')).toBe('HK$1.2万');
  });

  it('uses K and M for every currency in English', () => {
    expect(formatAmount(3096000, 'CNY', 'en')).toBe('¥3.10M');
    expect(formatAmount(255000, 'CNY', 'en')).toBe('¥255.0K');
    expect(formatAmount(12000, 'HKD', 'en')).toBe('HK$12.0K');
    expect(formatAmount(999, 'CNY', 'en')).toBe('¥999');
  });

  it('uses K and M for USD in both languages', () => {
    for (const locale of ['en', 'zh'] as const) {
      expect(formatAmount(437338, 'USD', locale)).toBe('$437.3K');
      expect(formatAmount(4370000, 'USD', locale)).toBe('$4.37M');
      expect(formatAmount(999, 'USD', locale)).toBe('$999');
    }
  });

  it('puts a minus sign in front of the currency symbol', () => {
    expect(formatAmount(-12345, 'CNY', 'zh')).toBe('−¥1.2万');
    expect(formatAmount(-12345, 'CNY', 'en')).toBe('−¥12.3K');
    expect(formatAmount(-0.4, 'CNY', 'en')).toBe('¥0');
  });

  it('masks amounts when hidden', () => {
    expect(formatAmount(3105000, 'CNY', 'en', true)).toBe(MASK);
  });
});

describe('formatMoney', () => {
  it('converts a CNY amount into the display currency first', () => {
    expect(formatMoney(710000, 'USD', fx, 'en')).toBe('$100.0K');
    expect(formatMoney(710000, 'CNY', fx, 'zh')).toBe('¥71.0万');
    expect(formatMoney(710000, 'CNY', fx, 'en')).toBe('¥710.0K');
  });
});

describe('signed formats', () => {
  it('uses + for zero and positives, U+2212 for negatives', () => {
    expect(sign(0)).toBe('+');
    expect(sign(-1)).toBe('−');
    expect(formatSignedAmount(14000, 'CNY', 'zh')).toBe('+¥1.4万');
    expect(formatSignedAmount(14000, 'CNY', 'en')).toBe('+¥14.0K');
    expect(formatSignedAmount(-500, 'CNY', 'en')).toBe('−¥500');
    expect(formatSignedAmount(-500, 'CNY', 'en', true)).toBe(MASK);
  });

  it('formats percentages with a sign and fixed decimals', () => {
    expect(formatSignedPct(5.1923)).toBe('+5.19%');
    expect(formatSignedPct(-3.2)).toBe('−3.20%');
    expect(formatSignedPct(5.1923, 1)).toBe('+5.2%');
  });
});

describe('formatFull', () => {
  it('rounds and groups thousands', () => {
    expect(formatFull(100000, 'CNY')).toBe('¥100,000');
    expect(formatFull(20000.4, 'USD')).toBe('$20,000');
  });
});

describe('formatTimeHM', () => {
  it('shows hours and minutes', () => {
    expect(formatTimeHM(new Date(2026, 8, 29, 7, 5))).toBe('07:05');
  });
});

describe('formatQty', () => {
  it('shows up to two decimals with thousands separators', () => {
    expect(formatQty(1234.5678)).toBe('1,234.57');
    expect(formatQty(0.84)).toBe('0.84');
    expect(formatQty(120)).toBe('120');
  });
});
