import { useId, useMemo, useState } from 'react';
import { CURRENCY_SYMBOL, formatFull } from '../../app/format';
import { recordCtx } from '../../app/ids';
import { Seg } from '../../app/Seg';
import { Sheet } from '../../app/Sheet';
import { useAppStore } from '../../app/store';
import { usePortfolio } from '../../app/usePortfolio';
import type { CashCurrency } from '../../domain/types';
import { planWithdrawal, withdrawalTransactions } from '../../domain/withdrawal';
import { useT } from '../../i18n';
import { AllocationRow } from './AllocationRow';

/** "Withdraw": sells the most overweight first, only holdings in the same currency. See README「取钱算法」. */
export function WithdrawalSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const currencies: readonly (readonly [CashCurrency, string])[] = [
    ['CNY', t.common.currencyNames.CNY],
    ['USD', t.common.currencyNames.USD],
  ];
  const portfolio = usePortfolio();
  const accounts = useAppStore((s) => s.accounts);
  const ownStock = useAppStore((s) => s.ownStock);
  const prices = useAppStore((s) => s.prices);
  const fx = useAppStore((s) => s.fx);
  const today = useAppStore((s) => s.today);
  const hide = useAppStore((s) => s.hideAmounts);
  const appendTransactions = useAppStore((s) => s.appendTransactions);
  const flash = useAppStore((s) => s.flash);

  const [currency, setCurrency] = useState<CashCurrency>('USD');
  const [amountText, setAmountText] = useState('20000');
  const amountId = useId();
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  const result = useMemo(
    () =>
      planWithdrawal({
        amount: Number.parseFloat(amountText),
        currency,
        slots: portfolio.slots,
        totalCny: portfolio.totalCny,
        rows: portfolio.rows,
        ownStock,
        fx,
      }),
    [amountText, currency, portfolio, ownStock, fx],
  );
  const lines = result.ok ? result.lines : [];

  const record = () => {
    if (lines.length === 0) return;
    const transactions = withdrawalTransactions({ lines, currency, date: today, prices, fx, ctx: recordCtx });
    appendTransactions(transactions);
    const sells = transactions.filter((tx) => tx.type === 'sell').length;
    flash(sells > 0 ? t.plan.withdrawSheet.recordedSells(sells) : t.plan.withdrawSheet.recordedWithdrawal);
    onClose();
  };

  return (
    <Sheet title={t.plan.withdraw} subtitle={t.plan.withdrawSheet.subtitle} onClose={onClose}>
      <div className="sheet-inline">
        <Seg label={t.common.currency} options={currencies} value={currency} onChange={setCurrency} />
        <div className="field grow">
          <label htmlFor={amountId}>{t.common.amountIn(CURRENCY_SYMBOL[currency])}</label>
          <input
            id={amountId}
            className="input"
            type="number"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
          />
        </div>
      </div>
      {lines.length > 0 && (
        <div className="list-box">
          {lines.map((line) => {
            const inst = portfolio.instrumentByCode[line.code];
            const sub = line.isCash
              ? t.plan.withdrawSheet.takeCash(accountName(line.accountId))
              : `${line.code} ${inst ? t.names.instrument(inst) : ''} · ${accountName(line.accountId)}`;
            return (
              <AllocationRow
                key={`${line.accountId}|${line.code}`}
                line={line}
                currency={currency}
                exposures={portfolio.exposureById}
                sub={sub}
                hide={hide}
                tone="loss"
              />
            );
          })}
        </div>
      )}
      {!result.ok && (
        <span className="text-error">
          {t.plan.withdrawSheet.notEnough(t.common.currencyNames[currency], formatFull(result.error.available, currency))}
        </span>
      )}
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={lines.length === 0} onClick={record}>
          {t.plan.withdrawSheet.recordSells}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t.common.close}
        </button>
      </div>
    </Sheet>
  );
}
