import { formatMoney } from '../../app/format';
import { accountColor, groupColor } from '../../app/palette';
import { useAppStore } from '../../app/store';
import { useT } from '../../i18n';
import { usePortfolio } from '../../app/usePortfolio';
import { groupByAccount } from '../../domain/holdingsView';

/** By account: the account share bar, a card per account (with a mini bar of its category mix), the group legend (prototype v5 lines 184–203). */
export function AccountView({ onOpen }: { onOpen: (accountId: string) => void }) {
  const portfolio = usePortfolio();
  const accounts = useAppStore((s) => s.accounts);
  const groups = useAppStore((s) => s.groups);
  const fx = useAppStore((s) => s.fx);
  const t = useT();
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const hide = useAppStore((s) => s.hideAmounts);
  const money = (cny: number) => formatMoney(cny, displayCurrency, fx, t.locale, hide);

  const lines = groupByAccount({ rows: portfolio.rows, accounts, groups });
  const colorOf = (accountId: string) => {
    const index = accounts.findIndex((a) => a.id === accountId);
    return accountColor(accounts[index]!, index);
  };

  return (
    <div className="accounts">
      <div className="accounts-dist">
        <span className="accounts-count">{t.holdings.spreadOver(accounts.length)}</span>
        <div className="accounts-bar">
          {lines
            .filter((a) => a.valueCny > 0)
            .map((a) => (
              <div key={a.accountId} style={{ flex: a.valueCny, background: colorOf(a.accountId) }} />
            ))}
        </div>
      </div>
      <div className="accounts-list">
        {lines.map((line) => {
          const account = accounts.find((a) => a.id === line.accountId)!;
          return (
            <button key={line.accountId} type="button" className="account-card" onClick={() => onOpen(line.accountId)}>
              <span className="account-card-head">
                <span className="account-card-left">
                  <span className="dot" style={{ background: colorOf(line.accountId) }} />
                  <span className="account-names">
                    <span className="account-name">{account.name}</span>
                    <span className="account-meta">
                      {t.holdings.accountLine(t.common.accountTypes[account.type], account.currency, line.itemCount)}
                    </span>
                  </span>
                </span>
                <span className="account-card-right">
                  <span className="account-value">{money(line.valueCny)}</span>
                  <span className="account-share">{line.sharePct.toFixed(1)}%</span>
                </span>
              </span>
              <span className="account-mini-bar">
                {line.composition.map((c) => (
                  <span key={c.groupId} style={{ flex: c.valueCny, background: groupColor(c.groupId) }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="group-legend">
        {groups.map((g) => (
          <span key={g.id}>
            <span className="dot" style={{ background: groupColor(g.id) }} />
            {t.names.group(g)}
          </span>
        ))}
      </div>
    </div>
  );
}
