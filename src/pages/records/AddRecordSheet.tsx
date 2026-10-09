import { useId, useState } from 'react';
import { CURRENCY_SYMBOL } from '../../app/format';
import { recordCtx } from '../../app/ids';
import { Seg } from '../../app/Seg';
import { Sheet } from '../../app/Sheet';
import { useAppStore } from '../../app/store';
import { usePortfolio } from '../../app/usePortfolio';
import { findInstrument, newInstrument, normalizeCode, OWN_STOCK, ownStockExposure } from '../../domain/instruments';
import { cashBalance } from '../../domain/ledger';
import { recordBuy, recordDeposit, recordSell, recordWithdraw } from '../../domain/record';
import type { RecordResult } from '../../domain/record';
import { MARKET } from '../../domain/types';
import type { DigitMarket } from '../../domain/types';
import { useT } from '../../i18n';
import { cashHint, entryCurrency, formErrorText, recognizedText, savedMessage, tradeHint } from './recordForm';
import type { EntryType, FormError } from './recordForm';

/** A six-digit code can be an A-share or a mutual fund; when it isn't recognized, the user picks */
const MARKETS: readonly DigitMarket[] = [MARKET.cn, MARKET.fund];
const TYPES: readonly EntryType[] = ['buy', 'sell', 'deposit', 'withdraw'];

/** Add record: buy, sell, deposit or withdraw (prototype v5 lines 446–469; how cash follows, README「记一笔」). */
export function AddRecordSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const portfolio = usePortfolio();
  const accounts = useAppStore((s) => s.accounts);
  const instruments = useAppStore((s) => s.instruments);
  const exposures = useAppStore((s) => s.exposures);
  const groups = useAppStore((s) => s.groups);
  const fx = useAppStore((s) => s.fx);
  const today = useAppStore((s) => s.today);
  const hide = useAppStore((s) => s.hideAmounts);
  const addInstrument = useAppStore((s) => s.addInstrument);
  const addExposure = useAppStore((s) => s.addExposure);
  const appendTransactions = useAppStore((s) => s.appendTransactions);
  const flash = useAppStore((s) => s.flash);

  const [type, setType] = useState<EntryType>('buy');
  const [accountId, setAccountId] = useState(accounts[0]!.id);
  const [code, setCode] = useState('');
  const [exposureId, setExposureId] = useState('');
  const [market, setMarket] = useState<DigitMarket>(MARKET.cn);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [fee, setFee] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<FormError | null>(null);
  const id = useId();

  const account = accounts.find((a) => a.id === accountId)!;
  const found = findInstrument(code, instruments);
  const exposure = found ? portfolio.exposureById[found.exposureId] : undefined;
  const group = exposure ? groups.find((g) => g.id === exposure.groupId) : undefined;
  const isTrade = type === 'buy' || type === 'sell';
  const currency = isTrade ? entryCurrency(code, found, account) : account.currency;
  const cash = cashBalance(portfolio.ledger, account.id, currency);
  const groupName = (groupId: string) => {
    const g = groups.find((x) => x.id === groupId);
    return g ? t.names.group(g) : groupId;
  };
  // Any edit clears the error (as the prototype's setForm does)
  const edit = (set: (value: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setError(null);
  };

  const save = () => {
    let result: RecordResult;
    let instrument = found;
    if (type === 'buy' || type === 'sell') {
      const c = normalizeCode(code);
      if (!c) return setError({ kind: 'missing_code' });
      if (!found && !exposureId) return setError({ kind: 'missing_exposure' });
      instrument = found ?? newInstrument(c, exposureId === OWN_STOCK ? ownStockExposure(c).id : exposureId, market);
      const trade = {
        ledger: portfolio.ledger,
        account,
        instrument,
        date: today,
        qty: Number.parseFloat(qty),
        price: Number.parseFloat(price),
        fee: fee.trim() ? Number.parseFloat(fee) : 0,
        fx,
        ctx: recordCtx,
      };
      result = type === 'buy' ? recordBuy(trade) : recordSell(trade);
    } else {
      const input = { ledger: portfolio.ledger, account, date: today, amount: Number.parseFloat(amount), fx, ctx: recordCtx };
      result = type === 'deposit' ? recordDeposit(input) : recordWithdraw(input);
    }
    if (!result.ok) return setError(result.error);
    if (instrument && !found) {
      if (exposureId === OWN_STOCK) addExposure(ownStockExposure(instrument.code));
      addInstrument(instrument);
    }
    appendTransactions(result.transactions);
    flash(
      savedMessage({ type, code: instrument?.code ?? '', account, currency, cashBefore: cash, transactions: result.transactions, hide }, t),
    );
    onClose();
  };

  return (
    <Sheet title={t.records.add} onClose={onClose}>
      <Seg
        label={t.records.kindLabel}
        className="align-start"
        options={TYPES.map((x) => [x, t.common.txTypes[x]] as const)}
        value={type}
        onChange={(next) => {
          setType(next);
          setError(null);
        }}
      />
      <div className="field">
        <label htmlFor={`${id}-account`}>{t.records.sheet.account}</label>
        <select id={`${id}-account`} className="input" value={accountId} onChange={edit(setAccountId)}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      {type === 'buy' || type === 'sell' ? (
        <>
          <div className="field">
            <label htmlFor={`${id}-code`}>{t.records.sheet.code}</label>
            <input id={`${id}-code`} className="input" placeholder={t.records.sheet.codePlaceholder} value={code} onChange={edit(setCode)} />
          </div>
          {found && exposure && group && (
            <span className="tag tag-accent-2 align-start">{recognizedText(found, exposure, group, t)}</span>
          )}
          {!found && code.trim() && (
            <div className="field">
              <label htmlFor={`${id}-exposure`}>{t.records.sheet.unrecognized}</label>
              <select id={`${id}-exposure`} className="input" value={exposureId} onChange={edit(setExposureId)}>
                <option value="">{t.records.sheet.choose}</option>
                {exposures.map((x) => (
                  <option key={x.id} value={x.id}>
                    {t.names.exposure(x)} ({groupName(x.groupId)})
                  </option>
                ))}
                <option value={OWN_STOCK}>{t.records.sheet.ownStock}</option>
              </select>
            </div>
          )}
          {!found && /^\d+$/.test(normalizeCode(code)) && (
            <Seg
              label={t.records.sheet.market}
              className="align-start"
              options={MARKETS.map((m) => [m, t.common.markets[m]] as const)}
              value={market}
              onChange={(m) => {
                setMarket(m);
                setError(null);
              }}
            />
          )}
          <div className="rec-trade-grid">
            <div className="field">
              <label htmlFor={`${id}-qty`}>{t.records.sheet.quantity}</label>
              <input id={`${id}-qty`} className="input" type="number" inputMode="decimal" value={qty} onChange={edit(setQty)} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-price`}>{t.records.sheet.price(currency)}</label>
              <input id={`${id}-price`} className="input" type="number" inputMode="decimal" value={price} onChange={edit(setPrice)} />
            </div>
            <div className="field">
              <label htmlFor={`${id}-fee`}>{t.records.sheet.fee}</label>
              <input
                id={`${id}-fee`}
                className="input"
                type="number"
                inputMode="decimal"
                placeholder={t.records.sheet.optional}
                value={fee}
                onChange={edit(setFee)}
              />
            </div>
          </div>
          <span className="text-note">{tradeHint({ type, account, currency, cash, hide }, t)}</span>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor={`${id}-amount`}>{t.common.amountIn(CURRENCY_SYMBOL[account.currency])}</label>
            <input id={`${id}-amount`} className="input" type="number" inputMode="decimal" value={amount} onChange={edit(setAmount)} />
          </div>
          <span className="text-note">{cashHint({ type, account, cash, hide }, t)}</span>
        </>
      )}
      {error && <span className="text-error">{formErrorText(error, hide, t)}</span>}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={save}>
          {t.common.save}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t.common.cancel}
        </button>
      </div>
    </Sheet>
  );
}
