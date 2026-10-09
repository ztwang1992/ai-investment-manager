import { useId, useMemo, useState } from 'react';
import { formatMoney } from '../../app/format';
import { XIcon } from '../../app/icons';
import { newId } from '../../app/ids';
import { SLOT_ORDER, bySlotOrder, slotColor, slotName } from '../../app/palette';
import { Seg } from '../../app/Seg';
import { useAppStore } from '../../app/store';
import { useT } from '../../i18n';
import type { Messages } from '../../i18n';
import { usePortfolio } from '../../app/usePortfolio';
import { STOCK_BUCKET } from '../../domain/slots';
import { addTarget, addableTargets, checkDraft, mergeStock, parseDraft, removeTarget, targetSum, toDraft } from '../../domain/targets';
import type { TargetDraft } from '../../domain/targets';
import type { Currency, Period, Plan, UndefinedMode } from '../../domain/types';
import { AddTargetSheet } from './AddTargetSheet';
import './settings.css';

const CURRENCIES = [
  ['CNY', 'CNY'],
  ['USD', 'USD'],
  ['HKD', 'HKD'],
] as const satisfies readonly (readonly [Currency, string])[];
const PERIODS: readonly Period[] = ['month', 'quarter', 'year'];
const UNDEFINED_MODES: readonly UndefinedMode[] = ['sell', 'ignore'];
const GOAL_FIELDS = ['annualSpend', 'targetAmount', 'expectedReturnPct', 'inflationPct'] as const;
const MIN_THRESHOLD = 1;
const MAX_THRESHOLD = 20;

function draftMessage(problem: ReturnType<typeof checkDraft>['problem'], sum: number, t: Messages): string {
  if (!problem) return '';
  if (problem.kind === 'invalid') return t.plan.settings.invalid;
  if (problem.kind === 'over') return t.plan.settings.over(sum, problem.by);
  return t.plan.settings.under(problem.by);
}

/** Portfolio settings: display currency, target allocation, assets not in the target, rebalancing rules, long-term goal. */
export function PortfolioSettings() {
  const portfolio = usePortfolio();
  const targets = useAppStore((s) => s.targets);
  const ownStock = useAppStore((s) => s.ownStock);
  const plan = useAppStore((s) => s.plan);
  const exposureList = useAppStore((s) => s.exposures);
  const groups = useAppStore((s) => s.groups);
  const fx = useAppStore((s) => s.fx);
  const t = useT();
  const periods = PERIODS.map((p) => [p, t.plan.periods[p]] as const);
  const undefinedModes = UNDEFINED_MODES.map((m) => [m, t.plan.settings.undefinedModes[m]] as const);
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const hide = useAppStore((s) => s.hideAmounts);
  const setDisplayCurrency = useAppStore((s) => s.setDisplayCurrency);
  const saveTargets = useAppStore((s) => s.saveTargets);
  const updatePlan = useAppStore((s) => s.updatePlan);
  const addExposure = useAppStore((s) => s.addExposure);
  const flash = useAppStore((s) => s.flash);

  const [draft, setDraft] = useState<TargetDraft | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const goalIdPrefix = useId();
  const exposures = portfolio.exposureById;
  const isStock = (key: string) => exposures[key]?.isStock ?? false;
  const name = (key: string) => slotName(key, exposures, t);
  const heldKeys = useMemo(() => new Set(portfolio.rows.map((r) => r.exposure.id)), [portfolio.rows]);

  const editing = draft !== null;
  const currentKeys = Object.keys(draft ? draft.targets : targets);
  const customKeys = [...new Set([...currentKeys, ...portfolio.slots.map((s) => s.key)])].filter((k) => !SLOT_ORDER.includes(k));
  const color = (key: string) => slotColor(key, customKeys.indexOf(key));
  const withDraft = (change: (d: TargetDraft) => TargetDraft) => setDraft((d) => change(d ?? toDraft(targets, ownStock)));
  const check = draft ? checkDraft(draft) : null;
  const message = check ? draftMessage(check.problem, check.sum, t) : '';
  const bad = new Set(check?.badKeys ?? []);
  const draftError = check?.problem?.kind === 'invalid' || check?.problem?.kind === 'over';

  const viewSum = targetSum(targets);
  const undefinedSlots = portfolio.slots.filter((s) => s.untargeted && s.valueCny > 0);
  const bucketChips = draft
    ? exposureList.filter((e) => e.isStock && heldKeys.has(e.id) && !draft.ownStock[e.id] && !(e.id in draft.targets))
    : [];

  const addFromSheet = (key: string) => {
    withDraft((d) => addTarget(d, key, isStock(key)));
    setAddOpen(false);
    flash(t.plan.settings.addedFromSheet(name(key)));
  };
  const createCustom = (assetName: string, groupId: string) => {
    const id = `custom-${newId()}`;
    addExposure({ id, name: assetName, groupId, isStock: false });
    withDraft((d) => addTarget(d, id, false));
    setAddOpen(false);
    flash(t.plan.settings.customAdded(assetName));
  };
  const save = () => {
    if (!draft || checkDraft(draft).problem) return;
    saveTargets(parseDraft(draft), draft.ownStock);
    setDraft(null);
    flash(t.plan.settings.saved);
  };
  const setGoal = (key: (typeof GOAL_FIELDS)[number], text: string) => {
    const value = Number.parseFloat(text);
    updatePlan({ [key]: Number.isFinite(value) ? value : 0 } as Partial<Plan>);
  };

  return (
    <div className="settings">
      <section className="settings-section">
        <span className="panel-title">{t.common.displayCurrency}</span>
        <Seg label={t.common.displayCurrency} className="align-start" options={CURRENCIES} value={displayCurrency} onChange={setDisplayCurrency} />
        <span className="text-note">{t.plan.settings.fxNote(fx.USD.toFixed(4), fx.HKD)}</span>
      </section>

      <section className="settings-section">
        <div className="settings-head">
          <span className="panel-title">{t.plan.settings.targetTitle}</span>
          {editing ? (
            <span className="tag tag-accent">{t.plan.settings.editing}</span>
          ) : (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => setDraft(toDraft(targets, ownStock))}>
              {t.common.edit}
            </button>
          )}
        </div>
        <span className="text-note">{t.plan.settings.targetNote}</span>

        {!editing && (
          <div className="list-box">
            {bySlotOrder(Object.keys(targets), (k) => k).map((key) => (
              <div key={key} className="target-view list-row">
                <div className="target-view-row">
                  <span className="target-name">
                    <span className="dot" style={{ background: color(key) }} />
                    {name(key)}
                  </span>
                  <span className="target-pct">{targets[key]}%</span>
                </div>
                <div className="target-bar">
                  <div style={{ width: `${Math.min(100, targets[key] ?? 0)}%`, background: color(key) }} />
                </div>
              </div>
            ))}
            <div className="target-sum">
              <span>{t.plan.settings.total}</span>
              <span data-testid="targets-sum" className={viewSum === 100 ? 'is-gain' : 'is-loss'}>
                {viewSum}%
              </span>
            </div>
          </div>
        )}

        {draft && (
          <>
            <div className="list-box tight">
              {bySlotOrder(Object.keys(draft.targets), (k) => k).map((key) => (
                <div key={key} className="target-edit list-row">
                  <div className="target-edit-row">
                    <span className="target-name">
                      <span className="dot" style={{ background: color(key) }} />
                      {name(key)}
                    </span>
                    <div className="target-edit-controls">
                      <input
                        className={`input target-input${bad.has(key) ? ' is-bad' : ''}`}
                        type="number"
                        inputMode="decimal"
                        aria-label={t.plan.settings.shareAria(name(key))}
                        value={draft.targets[key]}
                        onChange={(e) => {
                          const value = e.target.value;
                          setDraft((d) => (d ? { ...d, targets: { ...d.targets, [key]: value } } : d));
                        }}
                      />
                      <span className="target-unit">%</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon target-remove"
                        aria-label={t.plan.settings.removeAria(name(key))}
                        onClick={() => withDraft((d) => removeTarget(d, key, isStock(key)))}
                      >
                        <XIcon />
                      </button>
                    </div>
                  </div>
                  {key === STOCK_BUCKET && bucketChips.length > 0 && (
                    <div className="chip-row">
                      {bucketChips.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          className="btn btn-secondary chip-btn-small"
                          onClick={() => withDraft((d) => addTarget(d, e.id, true))}
                        >
                          {t.plan.settings.setApart(t.names.exposure(e))}
                        </button>
                      ))}
                    </div>
                  )}
                  {isStock(key) && (
                    <button
                      type="button"
                      className="btn btn-ghost merge-btn"
                      aria-label={t.plan.settings.mergeAria(name(key))}
                      onClick={() => withDraft((d) => mergeStock(d, key))}
                    >
                      {t.plan.settings.merge}
                    </button>
                  )}
                </div>
              ))}
              {Object.keys(draft.targets).length === 0 && (
                <span className="list-empty draft-empty">{t.plan.settings.noTargets}</span>
              )}
              <div className="target-sum">
                <span>{t.plan.settings.total}</span>
                <span className={draftError ? 'is-loss' : check?.sum === 100 ? 'is-gain' : ''}>{check?.sum}%</span>
              </div>
            </div>
            {message && <span className={`draft-msg ${draftError ? 'text-error' : 'text-hint'}`}>{message}</span>}
            <button type="button" className="btn btn-secondary align-start" onClick={() => setAddOpen(true)}>
              {t.plan.settings.addTarget}
            </button>
          </>
        )}
        {editing && (
          <div className="actions">
            <button type="button" className="btn btn-primary" disabled={Boolean(message)} onClick={save}>
              {t.common.save}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setDraft(null)}>
              {t.common.cancel}
            </button>
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-head baseline">
          <span className="panel-title">{t.plan.settings.undefinedTitle}</span>
          <span className="text-note">{t.plan.settings.undefinedCount(undefinedSlots.length)}</span>
        </div>
        <span className="text-note">{t.plan.settings.undefinedNote}</span>
        {undefinedSlots.length > 0 ? (
          <>
            <Seg
              label={t.plan.settings.undefinedModeLabel}
              className="align-start"
              options={undefinedModes}
              value={plan.undefinedMode}
              onChange={(mode) => updatePlan({ undefinedMode: mode })}
            />
            <div className="list-box tight">
              {undefinedSlots.map((s) => (
                <div key={s.key} className="undefined-row list-row">
                  <span className="undefined-info">
                    <span className="target-name">
                      <span className="dot" style={{ background: color(s.key) }} />
                      {name(s.key)}
                    </span>
                    <span className="undefined-sub">
                      {t.plan.settings.currentShare(s.curPct.toFixed(1), formatMoney(s.valueCny, displayCurrency, fx, t.locale, hide))}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary btn-small"
                    aria-label={t.plan.settings.addToTargetAria(name(s.key))}
                    onClick={() => {
                      withDraft((d) => addTarget(d, s.key, isStock(s.key)));
                      flash(t.plan.settings.addedToEdit(name(s.key)));
                    }}
                  >
                    {t.plan.settings.addToTarget}
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <span className="text-hint">{t.plan.settings.allInTarget}</span>
        )}
      </section>

      <section className="settings-section">
        <span className="panel-title">{t.plan.settings.rulesTitle}</span>
        <div className="settings-rule">
          <span>{t.plan.settings.threshold}</span>
          <div className="stepper">
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              aria-label={t.plan.settings.lowerThreshold}
              onClick={() => updatePlan({ threshold: Math.max(MIN_THRESHOLD, plan.threshold - 1) })}
            >
              −
            </button>
            <span className="stepper-value">±{plan.threshold}%</span>
            <button
              type="button"
              className="btn btn-secondary btn-icon"
              aria-label={t.plan.settings.raiseThreshold}
              onClick={() => updatePlan({ threshold: Math.min(MAX_THRESHOLD, plan.threshold + 1) })}
            >
              +
            </button>
          </div>
        </div>
        <div className="settings-rule">
          <span>{t.plan.settings.checkEvery}</span>
          <Seg label={t.plan.settings.checkEvery} options={periods} value={plan.rebalancePeriod} onChange={(p) => updatePlan({ rebalancePeriod: p })} />
        </div>
        <div className="settings-rule">
          <span>{t.plan.settings.calibReminder}</span>
          <Seg label={t.plan.settings.calibReminder} options={periods} value={plan.calibPeriod} onChange={(p) => updatePlan({ calibPeriod: p })} />
        </div>
        <span className="text-note">{t.plan.settings.calibNote}</span>
      </section>

      <section className="settings-section">
        <span className="panel-title">{t.plan.settings.goalTitle}</span>
        <div className="goal-grid">
          {GOAL_FIELDS.map((field) => (
            <div key={field} className="field">
              <label htmlFor={`${goalIdPrefix}-${field}`}>{t.plan.settings.goalFields[field]}</label>
              <input
                id={`${goalIdPrefix}-${field}`}
                className="input"
                type="number"
                inputMode="decimal"
                value={plan[field]}
                onChange={(e) => setGoal(field, e.target.value)}
              />
            </div>
          ))}
        </div>
      </section>

      {addOpen && (
        <AddTargetSheet
          addable={addableTargets(currentKeys, exposureList)}
          heldKeys={heldKeys}
          exposures={exposures}
          exposureList={exposureList}
          groups={groups}
          onAdd={addFromSheet}
          onCreate={createCustom}
          onClose={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}
