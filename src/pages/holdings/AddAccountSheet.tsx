import { useId, useState } from 'react';
import { newId } from '../../app/ids';
import { ACCOUNT_COLORS } from '../../app/palette';
import { Seg } from '../../app/Seg';
import { Sheet } from '../../app/Sheet';
import { useAppStore } from '../../app/store';
import { marketFor } from '../../domain/accounts';
import type { AccountType, CashCurrency } from '../../domain/types';
import { useT } from '../../i18n';

const TYPES: readonly AccountType[] = ['broker', 'bank'];
/** Accounts are USD or CNY only for now (README revision 2); the prototype's HKD is gone. */
const CURRENCIES = [
  ['USD', 'USD'],
  ['CNY', 'CNY'],
] as const satisfies readonly (readonly [CashCurrency, string])[];

/** Add an account: name, type and currency (prototype v5 lines 491–502). */
export function AddAccountSheet({ onClose }: { onClose: () => void }) {
  const t = useT();
  const accounts = useAppStore((s) => s.accounts);
  const addAccount = useAppStore((s) => s.addAccount);
  const flash = useAppStore((s) => s.flash);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('broker');
  const [currency, setCurrency] = useState<CashCurrency>('USD');
  const [error, setError] = useState<'nameRequired' | 'duplicate' | null>(null);
  const nameId = useId();

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return setError('nameRequired');
    if (accounts.some((a) => a.name === trimmed)) return setError('duplicate');
    addAccount({
      id: `acct-${newId()}`,
      name: trimmed,
      type,
      currency,
      market: marketFor(type, currency),
      color: ACCOUNT_COLORS[accounts.length % ACCOUNT_COLORS.length],
    });
    flash(t.holdings.addAccountSheet.added(trimmed));
    onClose();
  };

  return (
    <Sheet title={t.holdings.addAccountSheet.title} maxHeight="none" onClose={onClose}>
      <div className="field">
        <label htmlFor={nameId}>{t.holdings.addAccountSheet.name}</label>
        <input
          id={nameId}
          className="input"
          placeholder={t.holdings.addAccountSheet.placeholder}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="field">
        <label>{t.holdings.addAccountSheet.type}</label>
        <Seg
          label={t.holdings.addAccountSheet.type}
          options={TYPES.map((x) => [x, t.common.accountTypes[x]] as const)}
          value={type}
          onChange={setType}
        />
      </div>
      <div className="field">
        <label>{t.holdings.addAccountSheet.currency}</label>
        <Seg label={t.holdings.addAccountSheet.currency} options={CURRENCIES} value={currency} onChange={setCurrency} />
      </div>
      {error && <span className="text-error">{t.holdings.addAccountSheet[error]}</span>}
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
