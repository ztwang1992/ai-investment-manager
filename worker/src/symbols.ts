import type { MarketKind } from './types';

// How each data source writes codes (docs/phase0-feasibility.md section 5).

/** Shanghai: codes starting with 6, 5, 9; Shenzhen: 0, 1, 2, 3 */
export function cnExchange(code: string): 'sh' | 'sz' {
  return /^[569]/.test(code) ? 'sh' : 'sz';
}

export function tencentSymbol(kind: 'us' | 'cn', code: string): string {
  return kind === 'us' ? `us${code}` : `${cnExchange(code)}${code}`;
}

export function yahooSymbol(kind: 'us' | 'cn', code: string): string {
  if (kind === 'us') return code.replaceAll('.', '-');
  return `${code}.${cnExchange(code) === 'sh' ? 'SS' : 'SZ'}`;
}

/** Sina writes US codes in lowercase, with the dot as $ (BRK.B -> gb_brk$b) */
export function sinaSymbol(kind: MarketKind, code: string): string {
  if (kind === 'us') return `gb_${code.toLowerCase().replaceAll('.', '$')}`;
  if (kind === 'cn') return `${cnExchange(code)}${code}`;
  return `f_${code}`;
}
