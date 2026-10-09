import { CALIBRATION_REASON, REASON } from '../domain/record';
import type { Transaction, TxType } from '../domain/types';
import { instrumentByCode } from './catalog';

// The sample transactions of prototype v5. The prototype gives only the current holdings (POS) and 12 past transactions,
// so the holdings are worked back to openings on 2025-01-02, followed in time by those 12 and the deposits / withdrawals that make the cash add up;
// what they derive equals the prototype's holdings exactly.

const USD_CNY_2025 = 7.2;
const USD_CNY_2026 = 7.1;
const OPENING = '2025-01-02';

let seq = 0;

function t(
  date: string,
  type: TxType,
  accountId: string,
  instrumentCode: string,
  qty: number,
  price = 1,
  extra: { fee?: number; reason?: string } = {},
): Transaction {
  seq += 1;
  const currency = instrumentByCode[instrumentCode]!.currency;
  const usdCny = date < '2026' ? USD_CNY_2025 : USD_CNY_2026;
  return {
    id: `mock-${String(seq).padStart(3, '0')}`,
    date,
    createdAt: `${date}T01:00:00.${String(seq).padStart(3, '0')}Z`,
    type,
    accountId,
    instrumentCode,
    qty,
    price,
    fee: extra.fee ?? 0,
    ...(extra.reason ? { reason: extra.reason } : {}),
    fxToCny: currency === 'USD' ? usdCny : 1,
  };
}

export const transactions: Transaction[] = [
  // Openings: the prototype's holdings minus the later trades and calibrations
  t(OPENING, 'opening', 'futu', 'VOO', 109.16, 450),
  t(OPENING, 'opening', 'ibkr', 'VOO', 80, 480),
  t(OPENING, 'opening', 'schwab', 'VOO', 40, 500),
  t(OPENING, 'opening', 'cms', '513500', 50000, 1.8),
  t(OPENING, 'opening', 'cmb', '050025', 25000, 4.3),
  t(OPENING, 'opening', 'ibkr', 'QQQ', 40, 400),
  t(OPENING, 'opening', 'ft', 'AAPL', 80, 180),
  t(OPENING, 'opening', 'ft', 'BRK.B', 40, 350),
  t(OPENING, 'opening', 'schwab', 'VXUS', 300, 60),
  t(OPENING, 'opening', 'cms', '510300', 30000, 3.8),
  t(OPENING, 'opening', 'cms', '600519', 40, 1650),
  t(OPENING, 'opening', 'ibkr', 'IEF', 600, 96),
  t(OPENING, 'opening', 'schwab', 'IEF', 300, 94),
  t(OPENING, 'opening', 'cms', '518880', 10000, 4.8),
  t(OPENING, 'opening', 'futu', 'USD', 13280),
  t(OPENING, 'opening', 'ibkr', 'USD', 32440),
  t(OPENING, 'opening', 'schwab', 'USD', 3900),
  t(OPENING, 'opening', 'cmb', 'CNY', 73000),
  // The prototype's 12 transactions, plus the deposits / withdrawals that make the cash add up
  t('2025-03-03', 'buy', 'ibkr', 'IEF', 200, 93),
  t('2025-06-16', 'deposit', 'cms', 'CNY', 31600, 1, { reason: REASON.autoDeposit }),
  t('2025-06-16', 'buy', 'cms', '600519', 20, 1580),
  t('2025-07-01', 'deposit', 'cmb', 'CNY', 50000, 1, { reason: '工资' }),
  t('2025-09-08', 'buy', 'ibkr', 'QQQ', 10, 430),
  t('2025-11-20', 'sell', 'schwab', 'VXUS', 100, 62),
  t('2026-01-01', 'deposit', 'cmb', 'CNY', 50000, 1, { reason: '年终奖' }),
  t('2026-01-12', 'buy', 'cmb', '050025', 5000, 4.6),
  t('2026-03-05', 'buy', 'schwab', 'VOO', 20, 505),
  t('2026-06-20', 'calibrate', 'futu', 'VOO', 110, 0, { reason: CALIBRATION_REASON.dividend }),
  t('2026-07-10', 'deposit', 'cms', 'CNY', 28000, 1, { reason: REASON.autoDeposit }),
  t('2026-07-10', 'buy', 'cms', '518880', 5000, 5.6),
  t('2026-08-01', 'buy', 'ibkr', 'IEF', 100, 95.4),
  t('2026-08-15', 'sell', 'ft', 'AAPL', 20, 225),
  t('2026-08-20', 'withdraw', 'ft', 'USD', 4500),
  t('2026-09-02', 'buy', 'futu', 'VOO', 10, 528),
  t('2026-09-18', 'deposit', 'cms', 'CNY', 20500, 1, { reason: REASON.autoDeposit }),
  t('2026-09-18', 'buy', 'cms', '513500', 10000, 2.05),
];
