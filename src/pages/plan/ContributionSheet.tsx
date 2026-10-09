import { useId, useMemo, useState } from 'react';
import { CURRENCY_SYMBOL } from '../../app/format';
import { recordCtx } from '../../app/ids';
import { slotName } from '../../app/palette';
import { Seg } from '../../app/Seg';
import { Sheet } from '../../app/Sheet';
import { useAppStore } from '../../app/store';
import { usePortfolio } from '../../app/usePortfolio';
import { contributionTransactions, planContribution } from '../../domain/contribution';
import type { CashCurrency } from '../../domain/types';
import { AllocationRow } from './AllocationRow';
import { useT } from '../../i18n';

type Mode = 'account' | 'any';

/** "Invest new money": buy only, topping up what is underweight by water-filling. See README「增量投入算法」. */
export function ContributionSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const currencies: readonly (readonly [CashCurrency, string])[] = [
    ['CNY', t.common.currencyNames.CNY],
    ['USD', t.common.currencyNames.USD],
  ];
  const modes: readonly (readonly [Mode, string])[] = [
    ['account', t.plan.investSheet.modes.account],
    ['any', t.plan.investSheet.modes.any],
  ];
  const portfolio = usePortfolio();
  const accounts = useAppStore((s) => s.accounts);
  const instruments = useAppStore((s) => s.instruments);
  const ownStock = useAppStore((s) => s.ownStock);
  const prices = useAppStore((s) => s.prices);
  const fx = useAppStore((s) => s.fx);
  const today = useAppStore((s) => s.today);
  const hide = useAppStore((s) => s.hideAmounts);
  const appendTransactions = useAppStore((s) => s.appendTransactions);
  const flash = useAppStore((s) => s.flash);

  const firstAccountIn = (currency: CashCurrency) => accounts.find((a) => a.currency === currency)?.id ?? '';
  const [currency, setCurrency] = useState<CashCurrency>('CNY');
  const [amountText, setAmountText] = useState('100000');
  const [mode, setMode] = useState<Mode>('account');
  const [accountId, setAccountId] = useState(() => firstAccountIn('CNY'));
  const amountId = useId();
  const accountFieldId = useId();

  const accountOptions = accounts.filter((a) => a.currency === currency);
  const account = accountOptions.find((a) => a.id === accountId);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  const plan = useMemo(
    () =>
      planContribution({
        amount: Number.parseFloat(amountText),
        currency,
        mode,
        account,
        slots: portfolio.slots,
        totalCny: portfolio.totalCny,
        rows: portfolio.rows,
        candidates: instruments,
        exposures: portfolio.exposureById,
        ownStock,
        accounts,
        prices,
        fx,
      }),
    [amountText, currency, mode, account, portfolio, instruments, ownStock, accounts, prices, fx],
  );

  const missing = plan.missingSlots.map((k) => slotName(k, portfolio.exposureById, t));
  const note = missing.length > 0 ? t.plan.investSheet.nothingToBuy(missing, t.common.currencyNames[currency], mode === 'account') : null;

  const record = () => {
    if (plan.lines.length === 0) return;
    const transactions = contributionTransactions({ lines: plan.lines, currency, date: today, prices, fx, ctx: recordCtx });
    appendTransactions(transactions);
    const buys = transactions.filter((tx) => tx.type === 'buy').length;
    flash(buys > 0 ? t.plan.investSheet.recordedBuys(buys) : t.plan.investSheet.recordedDeposit);
    onClose();
  };

  return (
    <Sheet title={t.plan.investNew} subtitle={t.plan.investSheet.subtitle} onClose={onClose}>
      <div className="sheet-inline">
        <Seg
          label={t.common.currency}
          options={currencies}
          value={currency}
          onChange={(c) => {
            setCurrency(c);
            setAccountId(firstAccountIn(c));
          }}
        />
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
      <Seg label={t.plan.investSheet.scope} className="align-start" options={modes} value={mode} onChange={setMode} />
      {mode === 'account' && (
        <div className="field">
          <label htmlFor={accountFieldId}>{t.plan.investSheet.whichAccount}</label>
          <select id={accountFieldId} className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accountOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {plan.lines.length > 0 && (
        <>
          <div className="list-box">
            {plan.lines.map((line) => {
              const inst = portfolio.instrumentByCode[line.code];
              const sub = line.isCash
                ? t.plan.investSheet.keepAsCash(accountName(line.accountId))
                : `${line.code} ${inst ? t.names.instrument(inst) : ''} · ${accountName(line.accountId)}${line.isNewInstrument ? t.plan.investSheet.newInstrument : ''}`;
              return (
                <AllocationRow
                  key={`${line.accountId}|${line.code}`}
                  line={line}
                  currency={currency}
                  exposures={portfolio.exposureById}
                  sub={sub}
                  hide={hide}
                  tone="gain"
                />
              );
            })}
          </div>
          <span className="alloc-summary">
            {t.plan.investSheet.maxDeviation(plan.maxDeviationBefore.toFixed(1), plan.maxDeviationAfter.toFixed(1))}
          </span>
        </>
      )}
      {note && <span className="text-warn">{note}</span>}
      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={plan.lines.length === 0} onClick={record}>
          {t.plan.investSheet.recordBuys}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t.common.close}
        </button>
      </div>
    </Sheet>
  );
}
