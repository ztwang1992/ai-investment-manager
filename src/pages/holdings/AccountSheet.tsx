import { MASK, formatMoney, formatQty } from '../../app/format';
import { groupColor } from '../../app/palette';
import { Sheet } from '../../app/Sheet';
import { useAppStore } from '../../app/store';
import { useT } from '../../i18n';
import { usePortfolio } from '../../app/usePortfolio';
import { groupByAccount } from '../../domain/holdingsView';

/** Account details: donut chart, category shares, instrument list; tap an instrument to calibrate it (prototype v5 lines 472–489). */
export function AccountSheet({
  accountId,
  onCalibrate,
  onClose,
}: {
  accountId: string;
  onCalibrate: (code: string) => void;
  onClose: () => void;
}) {
  const portfolio = usePortfolio();
  const accounts = useAppStore((s) => s.accounts);
  const groups = useAppStore((s) => s.groups);
  const fx = useAppStore((s) => s.fx);
  const t = useT();
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const hide = useAppStore((s) => s.hideAmounts);
  const money = (cny: number) => formatMoney(cny, displayCurrency, fx, t.locale, hide);

  const account = accounts.find((a) => a.id === accountId);
  const line = groupByAccount({ rows: portfolio.rows, accounts, groups }).find((l) => l.accountId === accountId);
  if (!account || !line) return null;

  // The ring: one conic-gradient segment per group
  const stops = line.composition.map((c) => `${groupColor(c.groupId)} ${c.fromPct}% ${c.toPct}%`).join(', ');
  const groupName = (id: string) => {
    const group = groups.find((g) => g.id === id);
    return group ? t.names.group(group) : id;
  };

  return (
    <Sheet
      title={account.name}
      subtitle={t.holdings.accountSheet.subtitle(t.common.accountTypes[account.type], account.currency, line.sharePct.toFixed(1))}
      maxHeight="88%"
      gap={16}
      onClose={onClose}
    >
      <div className="acct-summary">
        <div className="donut" style={{ background: stops ? `conic-gradient(${stops})` : 'var(--color-neutral-200)' }}>
          <div className="donut-hole">
            <span className="donut-label">{t.holdings.accountSheet.value}</span>
            <span className="donut-value">{money(line.valueCny)}</span>
          </div>
        </div>
        <div className="acct-legend">
          {line.composition.map((c) => (
            <div key={c.groupId} className="acct-legend-row">
              <span className="acct-legend-name">
                <span className="dot" style={{ background: groupColor(c.groupId) }} />
                {groupName(c.groupId)}
              </span>
              <span className="acct-legend-pct">{c.pct.toFixed(0)}%</span>
            </div>
          ))}
          {line.composition.length === 0 && <span className="list-empty">{t.holdings.accountSheet.empty}</span>}
        </div>
      </div>
      {line.items.length > 0 && (
        <div className="list-box flat">
          {line.items.map((item) => (
            <button key={item.code} type="button" className="acct-item list-row" onClick={() => onCalibrate(item.code)}>
              <span className="acct-item-name">
                {item.code} <span className="acct-item-under">{t.names.exposure(item.exposure)}</span>
              </span>
              <span className="acct-item-value">{money(item.valueCny)}</span>
              <span className="acct-item-qty">{t.common.shares(hide ? MASK : formatQty(item.qty))}</span>
              <span className="acct-item-calib">{t.holdings.accountSheet.calibrate}</span>
            </button>
          ))}
        </div>
      )}
      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t.common.close}
        </button>
      </div>
    </Sheet>
  );
}
