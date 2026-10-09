import { Fragment } from 'react';
import { CURRENCY_SYMBOL, MASK, formatMoney, formatQty, formatSignedPct } from '../../app/format';
import { groupColor } from '../../app/palette';
import { useAppStore } from '../../app/store';
import { useT } from '../../i18n';
import { usePortfolio } from '../../app/usePortfolio';
import { groupByExposure } from '../../domain/holdingsView';
import { MARKET } from '../../domain/types';

/**
 * By asset: group -> asset -> instrument -> per-platform detail (prototype v5 lines 150–182).
 * Tap an asset to show its instruments, an instrument to show its platforms, a platform to open the calibration sheet.
 */
export function AssetView({
  open,
  onToggle,
  onCalibrate,
}: {
  open: Record<string, boolean>;
  onToggle: (key: string) => void;
  onCalibrate: (accountId: string, code: string) => void;
}) {
  const portfolio = usePortfolio();
  const groups = useAppStore((s) => s.groups);
  const exposures = useAppStore((s) => s.exposures);
  const accounts = useAppStore((s) => s.accounts);
  const navDates = useAppStore((s) => s.navDates);
  const fx = useAppStore((s) => s.fx);
  const t = useT();
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const hide = useAppStore((s) => s.hideAmounts);

  const money = (cny: number) => formatMoney(cny, displayCurrency, fx, t.locale, hide);
  const groupName = (id: string) => {
    const group = groups.find((g) => g.id === id);
    return group ? t.names.group(group) : id;
  };
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;
  const exposureName = (id: string) => {
    const exposure = portfolio.exposureById[id];
    return exposure ? t.names.exposure(exposure) : id;
  };
  const view = groupByExposure({ rows: portfolio.rows, groups, exposures });

  return (
    <div className="asset-groups">
      {view.map((g) => (
        <div key={g.groupId} className="asset-group">
          <div className="asset-group-head">
            <span className="asset-group-name">
              <span className="dot" style={{ background: groupColor(g.groupId) }} />
              {groupName(g.groupId)}
            </span>
            <span className="asset-group-value">
              {money(g.valueCny)} · {g.pct.toFixed(1)}%
            </span>
          </div>
          <div className="asset-box">
            {g.exposures.map((e) => {
              const exposureKey = `u:${e.exposureId}`;
              const expanded = Boolean(open[exposureKey]);
              return (
                <Fragment key={e.exposureId}>
                  <button type="button" className="asset-row" aria-expanded={expanded} onClick={() => onToggle(exposureKey)}>
                    <span className="asset-row-left">
                      <span className="asset-row-name">{exposureName(e.exposureId)}</span>
                      <span className="asset-row-sub">{t.holdings.assetLine(e.instrumentCount, e.accountCount, e.pct.toFixed(1))}</span>
                    </span>
                    <span className="asset-row-right">
                      <span className="asset-row-value">{money(e.valueCny)}</span>
                      {e.pnlPct !== null && (
                        <span className={`asset-row-pnl ${e.pnlPct >= 0 ? 'is-gain' : 'is-loss'}`}>{formatSignedPct(e.pnlPct, 1)}</span>
                      )}
                    </span>
                  </button>
                  {expanded && (
                    <div className="asset-insts">
                      {e.instruments.map((i) => {
                        const inst = portfolio.instrumentByCode[i.code];
                        const instKey = `i:${i.code}`;
                        const instExpanded = Boolean(open[instKey]);
                        const navDate = inst?.market === MARKET.fund ? navDates[i.code] : undefined;
                        const symbol = CURRENCY_SYMBOL[inst?.currency ?? 'CNY'];
                        return (
                          <div key={i.code} className="inst-card">
                            <button type="button" className="inst-row" aria-expanded={instExpanded} onClick={() => onToggle(instKey)}>
                              <span className="inst-left">
                                <span className="inst-title">
                                  {i.code} <span className="inst-name">{inst ? t.names.instrument(inst) : ''}</span>
                                </span>
                                <span className="inst-sub">
                                  {t.holdings.instrumentLine(inst ? t.common.markets[inst.market] : '', inst?.currency ?? '', i.accountCount, navDate)}
                                </span>
                              </span>
                              <span className="inst-value">{money(i.valueCny)}</span>
                            </button>
                            {instExpanded && (
                              <div className="plats">
                                {i.platforms.map((p) => (
                                  <button
                                    key={p.accountId}
                                    type="button"
                                    className="plat-row"
                                    onClick={() => onCalibrate(p.accountId, i.code)}
                                  >
                                    <span>{accountName(p.accountId)}</span>
                                    <span className="plat-qty">
                                      {hide ? MASK : formatQty(p.qty)} @ {symbol}
                                      {Number(p.avgCost.toFixed(2))}
                                    </span>
                                    <span>{money(p.valueCny)}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
