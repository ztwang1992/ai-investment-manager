import { useId, useState } from 'react';
import { slotName } from '../../app/palette';
import { Sheet } from '../../app/Sheet';
import type { Exposure, ExposureGroup } from '../../domain/types';
import { useT } from '../../i18n';

/** Add a target asset: pick a preset underlying asset, or create a custom one (name + group). */
export function AddTargetSheet({
  addable,
  heldKeys,
  exposures,
  exposureList,
  groups,
  onAdd,
  onCreate,
  onClose,
}: {
  addable: readonly string[];
  heldKeys: ReadonlySet<string>;
  exposures: Record<string, Exposure>;
  exposureList: readonly Exposure[];
  groups: readonly ExposureGroup[];
  onAdd: (key: string) => void;
  onCreate: (name: string, groupId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const choices = groups.filter((g) => g.id !== 'cash');
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState(choices.find((g) => g.id === 'other')?.id ?? choices[0]?.id ?? '');
  const [error, setError] = useState<'nameRequired' | 'duplicate' | null>(null);
  const nameId = useId();
  const groupFieldId = useId();

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return setError('nameRequired');
    // A preset shown under its English name counts as taken too
    if (exposureList.some((e) => e.name === trimmed || t.names.exposure(e) === trimmed)) return setError('duplicate');
    onCreate(trimmed, groupId);
  };

  return (
    <Sheet maxHeight="88%" title={t.plan.addTarget.title} subtitle={t.plan.addTarget.subtitle} onClose={onClose}>
      <div className="chip-row">
        {addable.map((key) => (
          <button key={key} type="button" className="btn btn-secondary chip-btn" onClick={() => onAdd(key)}>
            {slotName(key, exposures, t)}
            {heldKeys.has(key) ? t.plan.addTarget.held : ''}
          </button>
        ))}
      </div>
      {addable.length === 0 && <span className="text-hint">{t.plan.addTarget.allIn}</span>}
      <div className="settings-custom-head">
        <span className="panel-title">{t.plan.addTarget.customTitle}</span>
        <span className="text-note">{t.plan.addTarget.customNote}</span>
      </div>
      <div className="settings-custom-row">
        <label className="visually-hidden" htmlFor={nameId}>
          {t.plan.addTarget.assetName}
        </label>
        <input
          id={nameId}
          className="input grow"
          placeholder={t.plan.addTarget.assetName}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
        />
        <label className="visually-hidden" htmlFor={groupFieldId}>
          {t.plan.addTarget.group}
        </label>
        <select id={groupFieldId} className="input settings-group-select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {choices.map((g) => (
            <option key={g.id} value={g.id}>
              {t.names.group(g)}
            </option>
          ))}
        </select>
      </div>
      {error && <span className="text-error">{t.plan.addTarget[error]}</span>}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={create}>
          {t.plan.addTarget.addCustom}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t.common.close}
        </button>
      </div>
    </Sheet>
  );
}
