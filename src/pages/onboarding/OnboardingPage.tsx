import { useId, useMemo, useState } from 'react';
import { CURRENCY_SYMBOL, formatQty } from '../../app/format';
import { newId } from '../../app/ids';
import { ACCOUNT_COLORS, slotColor, slotName } from '../../app/palette';
import { Seg } from '../../app/Seg';
import { useAppStore } from '../../app/store';
import { Toast } from '../../app/Toast';
import { marketFor } from '../../domain/accounts';
import { findInstrument, normalizeCode } from '../../domain/instruments';
import { addPendingRow, openingTransactions, OWN_STOCK, ownStockExposure, targetsFromCost } from '../../domain/onboarding';
import type { OnbAccount, OnbForm, OnbPosition } from '../../domain/onboarding';
import { MARKET, isCashCode } from '../../domain/types';
import type { Account, CashCurrency, Exposure, Instrument, Targets, Transaction } from '../../domain/types';
import { PLATFORMS } from './presets';
import '../../app/shell.css';
import '../../app/ui.css';
import './onboarding.css';
import { useT } from '../../i18n';
import type { OnboardingError } from '../../i18n/messages/onboarding';

/** Everything handed to the account when the entry is finished */
export interface OnboardingResult {
  accounts: Account[];
  /** New individual-stock assets (an unrecognized code listed as a stock of its own) */
  exposures: Exposure[];
  /** New instruments for codes that weren't recognized */
  instruments: Instrument[];
  /** One opening record per holding and per cash balance */
  transactions: Transaction[];
  targets: Targets;
}

type Step = 0 | 1 | 2 | 3;
type TargetMode = 'current' | 'later';

const CURRENCIES = [
  ['USD', 'USD'],
  ['CNY', 'CNY'],
] as const satisfies readonly (readonly [CashCurrency, string])[];
const MARKETS: readonly OnbForm['market'][] = [MARKET.cn, MARKET.fund];
const MODES: readonly TargetMode[] = ['current', 'later'];
const EMPTY_FORM: OnbForm = { code: '', qty: '', cost: '', exposureId: 'sp500', market: MARKET.cn };

/** First-time entry (README「首次录入引导」, prototype v5): welcome → accounts → holdings and cash per account → target. */
export function OnboardingPage({
  onFinish,
  onDemo,
  initialStep = 0,
}: {
  onFinish: (result: OnboardingResult) => void;
  onDemo: () => void;
  /** Coming from the sample-data demo's "Enter my holdings" starts at step 1 */
  initialStep?: 0 | 1;
}) {
  const t = useT();
  const instruments = useAppStore((s) => s.instruments);
  const exposures = useAppStore((s) => s.exposures);
  const groups = useAppStore((s) => s.groups);
  const fx = useAppStore((s) => s.fx);
  const today = useAppStore((s) => s.today);
  const flash = useAppStore((s) => s.flash);
  const id = useId();

  const [step, setStep] = useState<Step>(initialStep);
  const [accounts, setAccounts] = useState<OnbAccount[]>([]);
  const [customName, setCustomName] = useState('');
  const [customCurrency, setCustomCurrency] = useState<CashCurrency>('USD');
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [positions, setPositions] = useState<OnbPosition[]>([]);
  const [cash, setCash] = useState<Record<string, string>>({});
  const [form, setForm] = useState<OnbForm>(EMPTY_FORM);
  const [mode, setMode] = useState<TargetMode>('current');
  const [error, setError] = useState<OnboardingError | null>(null);

  const exposureById = useMemo(() => Object.fromEntries(exposures.map((e) => [e.id, e])), [exposures]);
  const instrumentByCode = useMemo(() => Object.fromEntries(instruments.map((i) => [i.code, i])), [instruments]);
  /** Presets and the user's own instruments first, then ones entered just now (a new code entered twice reuses the first) */
  const find = (code: string): Instrument | null =>
    findInstrument(code, instruments) ?? positions.find((p) => p.code === normalizeCode(code))?.instrument ?? null;
  const exposureName = (exposureId: string) => {
    const exposure = exposureById[exposureId];
    if (exposure) return t.names.exposure(exposure);
    return exposureId.startsWith('stock-') ? exposureId.slice(6) : exposureId;
  };
  const groupName = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    return group ? t.names.group(group) : groupId;
  };
  const platformName = (p: (typeof PLATFORMS)[number]) => t.onboarding.platforms[p.id];

  // Step 1: accounts
  const togglePlatform = (p: (typeof PLATFORMS)[number]) => {
    setError(null);
    const picked = accounts.find((a) => a.name === platformName(p));
    if (picked) {
      setAccounts(accounts.filter((a) => a !== picked));
      setPositions(positions.filter((x) => x.accountId !== picked.id));
      return;
    }
    setAccounts([...accounts, { id: `acct-${newId()}`, name: platformName(p), type: p.type, currency: p.currency }]);
  };
  const addCustom = () => {
    const name = customName.trim();
    if (!name) return setError('nameRequired');
    if (accounts.some((a) => a.name === name)) return setError('alreadyAdded');
    setAccounts([...accounts, { id: `acct-${newId()}`, name, type: 'broker', currency: customCurrency }]);
    setCustomName('');
    setError(null);
  };
  const toHoldings = () => {
    if (accounts.length === 0) return setError('pickOne');
    if (!currentId || !accounts.some((a) => a.id === currentId)) setCurrentId(accounts[0]!.id);
    setError(null);
    setStep(2);
  };

  // Step 2: holdings and cash, account by account
  const current = accounts.find((a) => a.id === currentId) ?? accounts[0];
  /** Adds the row filled in but not added yet; on an error shows it and returns null */
  const takePendingRow = (): OnbPosition[] | null => {
    if (!current) return positions;
    const r = addPendingRow(form, current.id, positions, find);
    if (r.kind === 'error') {
      setError(r.error);
      return null;
    }
    if (r.kind === 'empty') return positions;
    setPositions(r.positions);
    setForm(r.form);
    return r.positions;
  };
  const addRow = () => {
    if (!current) return;
    const r = addPendingRow(form, current.id, positions, find);
    if (r.kind === 'empty') return setError('rowEmpty');
    if (r.kind === 'error') return setError(r.error);
    setPositions(r.positions);
    setForm(r.form);
    setError(null);
    flash(t.onboarding.added);
  };
  const switchAccount = (accountId: string) => {
    if (takePendingRow() === null) return;
    setCurrentId(accountId);
    setError(null);
  };
  const cashAmounts = useMemo(
    () => Object.fromEntries(Object.entries(cash).map(([accountId, v]) => [accountId, Number(v) > 0 ? Number(v) : 0])),
    [cash],
  );
  const toTargets = () => {
    const taken = takePendingRow();
    if (taken === null) return;
    if (taken.length === 0 && !Object.values(cashAmounts).some((v) => v > 0)) return setError('enterSomething');
    setError(null);
    setStep(3);
  };

  // Step 3: the target allocation
  const newStocks = useMemo(() => {
    const seen = new Map<string, Exposure>();
    for (const p of positions) {
      const exposureId = p.instrument.exposureId;
      if (exposureId.startsWith('stock-') && !exposureById[exposureId]) seen.set(exposureId, ownStockExposure(p.code));
    }
    return [...seen.values()];
  }, [positions, exposureById]);
  const allExposures = useMemo(() => ({ ...exposureById, ...Object.fromEntries(newStocks.map((e) => [e.id, e])) }), [exposureById, newStocks]);
  const proposed = useMemo(
    () => targetsFromCost({ positions, cash: cashAmounts, accounts, instruments: instrumentByCode, exposures: allExposures, ownStock: {}, fx }),
    [positions, cashAmounts, accounts, instrumentByCode, allExposures, fx],
  );
  const finish = () => {
    const created = new Map<string, Instrument>();
    for (const p of positions) if (!findInstrument(p.code, instruments) && !created.has(p.code)) created.set(p.code, p.instrument);
    onFinish({
      accounts: accounts.map((a, i) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        market: marketFor(a.type, a.currency),
        color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
      })),
      exposures: newStocks,
      instruments: [...created.values()],
      transactions: openingTransactions({ date: today, createdAt: new Date().toISOString(), accounts, positions, cash: cashAmounts, fx, newId }),
      targets: mode === 'current' ? proposed : {},
    });
  };

  const back = () => {
    setError(null);
    setStep((s) => (s > 0 ? ((s - 1) as Step) : s));
  };
  const code = normalizeCode(form.code);
  const recognized = code && !isCashCode(code) ? find(code) : null;
  const needsExposure = !!code && !recognized && !isCashCode(code);
  const editForm = (patch: Partial<OnbForm>) => {
    setForm({ ...form, ...patch });
    setError(null);
  };
  const errorLine = error && <span className="text-error">{t.onboarding.errors[error]}</span>;
  const nav = (next: () => void, nextLabel = t.common.next) => (
    <div className="onb-nav">
      <button type="button" className="btn btn-secondary" onClick={back}>
        {t.common.back}
      </button>
      <button type="button" className="btn btn-primary" onClick={next}>
        {nextLabel}
      </button>
    </div>
  );

  return (
    <div className="app-backdrop">
      <div className="app-frame">
        <main className="app-main onb-main">
          {step === 0 && (
            <section className="onb onb-welcome">
              <span className="onb-mark" aria-hidden="true" />
              <h1 className="onb-hero">{t.onboarding.hero}</h1>
              <p className="onb-lead">{t.onboarding.lead}</p>
              <ol className="onb-steps">
                {t.onboarding.steps.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ol>
              <div className="onb-welcome-actions">
                <button type="button" className="btn btn-primary onb-big" onClick={() => setStep(1)}>
                  {t.onboarding.startFromScratch}
                </button>
                <button type="button" className="btn btn-secondary onb-big" onClick={onDemo}>
                  {t.onboarding.viewSample}
                </button>
              </div>
            </section>
          )}

          {step === 1 && (
            <section className="onb">
              <span className="onb-step">{t.onboarding.stepOf(1)}</span>
              <h1 className="onb-title">{t.onboarding.whereTitle}</h1>
              <div className="onb-chips">
                {PLATFORMS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="onb-chip"
                    aria-pressed={accounts.some((a) => a.name === platformName(p))}
                    onClick={() => togglePlatform(p)}
                  >
                    {platformName(p)} · {p.currency}
                  </button>
                ))}
              </div>
              <div className="field">
                <label htmlFor={`${id}-custom`}>{t.onboarding.otherAccount}</label>
                <div className="onb-custom">
                  <input
                    id={`${id}-custom`}
                    className="input"
                    placeholder={t.onboarding.accountName}
                    value={customName}
                    onChange={(e) => {
                      setCustomName(e.target.value);
                      setError(null);
                    }}
                  />
                  <Seg label={t.common.currency} options={CURRENCIES} value={customCurrency} onChange={setCustomCurrency} />
                  <button type="button" className="btn btn-secondary" onClick={addCustom}>
                    {t.onboarding.add}
                  </button>
                </div>
              </div>
              <span className="text-hint">
                {accounts.length ? t.onboarding.picked(accounts.map((a) => a.name)) : t.onboarding.pickHint}
              </span>
              {errorLine}
              {nav(toHoldings)}
            </section>
          )}

          {step === 2 && current && (
            <section className="onb">
              <span className="onb-step">{t.onboarding.stepOf(2)}</span>
              <h1 className="onb-title">{t.onboarding.holdingsTitle}</h1>
              <span className="text-hint">{t.onboarding.holdingsHint}</span>
              <div className="onb-chips onb-tabs">
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="onb-chip"
                    aria-pressed={a.id === current.id}
                    onClick={() => (a.id === current.id ? undefined : switchAccount(a.id))}
                  >
                    {a.name} · {positions.filter((p) => p.accountId === a.id).length}
                  </button>
                ))}
              </div>
              <ul className="onb-rows" aria-label={t.onboarding.holdingsOf(current.name)}>
                {positions
                  .filter((p) => p.accountId === current.id)
                  .map((p) => (
                    <li key={p.code} className="onb-row">
                      <span className="onb-row-text">
                        <span className="onb-row-title">{`${p.code} ${t.names.instrument(p.instrument)}`.trim()}</span>
                        <span className="onb-row-sub">
                          {t.onboarding.rowSub(formatQty(p.qty), `${CURRENCY_SYMBOL[p.instrument.currency]}${p.cost}`, exposureName(p.instrument.exposureId))}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon onb-row-del"
                        aria-label={t.onboarding.deleteRow(p.code)}
                        onClick={() => setPositions(positions.filter((x) => x !== p))}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" aria-hidden="true">
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </svg>
                      </button>
                    </li>
                  ))}
                {!positions.some((p) => p.accountId === current.id) && <li className="onb-rows-empty">{t.onboarding.noRows}</li>}
              </ul>
              <div className="onb-add">
                <span className="onb-add-title">{t.onboarding.addTo(current.name)}</span>
                <div className="onb-add-grid">
                  <div className="field">
                    <label htmlFor={`${id}-code`}>{t.onboarding.code}</label>
                    <input id={`${id}-code`} className="input" placeholder="VOO" value={form.code} onChange={(e) => editForm({ code: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`${id}-qty`}>{t.onboarding.shares}</label>
                    <input id={`${id}-qty`} className="input" type="number" inputMode="decimal" value={form.qty} onChange={(e) => editForm({ qty: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`${id}-cost`}>{t.onboarding.cost}</label>
                    <input id={`${id}-cost`} className="input" type="number" inputMode="decimal" value={form.cost} onChange={(e) => editForm({ cost: e.target.value })} />
                  </div>
                </div>
                {recognized && (
                  <span className="tag tag-accent-2 align-start">
                    {t.onboarding.recognized(exposureName(recognized.exposureId), t.common.markets[recognized.market], recognized.currency)}
                  </span>
                )}
                {needsExposure && (
                  <>
                    <div className="field">
                      <label htmlFor={`${id}-exposure`}>{t.records.sheet.unrecognized}</label>
                      <select id={`${id}-exposure`} className="input" value={form.exposureId} onChange={(e) => editForm({ exposureId: e.target.value })}>
                        {exposures
                          .filter((x) => x.groupId !== 'cash')
                          .map((x) => (
                            <option key={x.id} value={x.id}>
                              {t.names.exposure(x)} ({groupName(x.groupId)})
                            </option>
                          ))}
                        <option value={OWN_STOCK}>{t.records.sheet.ownStock}</option>
                      </select>
                    </div>
                    {/^\d+$/.test(code) && (
                      <Seg
                        label={t.records.sheet.market}
                        className="align-start"
                        options={MARKETS.map((m) => [m, t.common.markets[m]] as const)}
                        value={form.market}
                        onChange={(market) => editForm({ market })}
                      />
                    )}
                  </>
                )}
                <button type="button" className="btn btn-primary align-start" onClick={addRow}>
                  {t.onboarding.addToList}
                </button>
                <span className="text-note">{t.onboarding.addNote}</span>
              </div>
              <div className="field">
                <label htmlFor={`${id}-cash`}>{t.onboarding.cashOf(current.name, CURRENCY_SYMBOL[current.currency])}</label>
                <input
                  id={`${id}-cash`}
                  className="input"
                  type="number"
                  inputMode="decimal"
                  placeholder="0"
                  value={cash[current.id] ?? ''}
                  onChange={(e) => {
                    setCash({ ...cash, [current.id]: e.target.value });
                    setError(null);
                  }}
                />
              </div>
              {errorLine}
              {nav(toTargets)}
            </section>
          )}

          {step === 3 && (
            <section className="onb">
              <span className="onb-step">{t.onboarding.stepOf(3)}</span>
              <h1 className="onb-title">{t.onboarding.targetTitle}</h1>
              <span className="onb-explain">{t.onboarding.targetExplain}</span>
              {positions.length === 0 && <div className="onb-warn">{t.onboarding.cashOnly}</div>}
              <div className="onb-modes">
                {MODES.map((key) => (
                  <button key={key} type="button" className="onb-mode" aria-pressed={mode === key} onClick={() => setMode(key)}>
                    <span className="onb-mode-title">{t.onboarding.modes[key].title}</span>
                    <span className="onb-mode-desc">{t.onboarding.modes[key].desc}</span>
                  </button>
                ))}
              </div>
              {mode === 'current' && Object.keys(proposed).length > 0 && (
                <ul className="onb-preview" aria-label={t.onboarding.preview}>
                  {Object.entries(proposed).map(([key, pct], i) => (
                    <li key={key} className="onb-preview-row">
                      <span className="onb-preview-name">
                        <span className="dot" style={{ background: slotColor(key, i) }} />
                        <span>{slotName(key, allExposures, t)}</span>
                      </span>
                      <span className="onb-preview-pct">{pct}%</span>
                    </li>
                  ))}
                </ul>
              )}
              <span className="text-note">{t.onboarding.summary(accounts.length, positions.length)}</span>
              {nav(finish, t.onboarding.finish)}
            </section>
          )}
        </main>
        <Toast />
      </div>
    </div>
  );
}
