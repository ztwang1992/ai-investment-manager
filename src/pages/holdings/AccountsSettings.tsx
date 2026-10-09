import { useState } from 'react';
import { backupJson, transactionsCsv } from '../../app/backup';
import { signOut, useBootStore } from '../../app/boot';
import { downloadText } from '../../app/download';
import { formatMoney, formatTimeHM } from '../../app/format';
import { accountColor } from '../../app/palette';
import { Seg } from '../../app/Seg';
import { Sheet } from '../../app/Sheet';
import { useAppStore } from '../../app/store';
import { useSyncStore } from '../../app/sync';
import { syncStatusText } from '../../app/syncText';
import { usePortfolio } from '../../app/usePortfolio';
import { groupByAccount } from '../../domain/holdingsView';
import { useT } from '../../i18n';
import type { Locale } from '../../i18n/locale';

/** The account Settings sub-page: the account list and data backup (prototype v5 lines 368–380); the backup section adds sign-in and sync status. */
export function AccountsSettings({ onOpenAccount }: { onOpenAccount: (accountId: string) => void }) {
  const portfolio = usePortfolio();
  const accounts = useAppStore((s) => s.accounts);
  const groups = useAppStore((s) => s.groups);
  const fx = useAppStore((s) => s.fx);
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const hide = useAppStore((s) => s.hideAmounts);
  const today = useAppStore((s) => s.today);
  const flash = useAppStore((s) => s.flash);
  const t = useT();
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const languages: readonly (readonly [Locale, string])[] = [
    ['en', t.common.languageNames.en],
    ['zh', t.common.languageNames.zh],
  ];
  const boot = useBootStore();
  const session = boot.kind === 'ready' ? boot.session : null;
  const noCloud = boot.kind === 'noCloud';
  const sync = useSyncStore();
  const [leaving, setLeaving] = useState(false);
  const money = (cny: number) => formatMoney(cny, displayCurrency, fx, t.locale, hide);
  const lines = groupByAccount({ rows: portfolio.rows, accounts, groups });
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  // Export reads the latest complete data from the state directly; the page itself subscribes only to the fields it shows
  const exportJson = () => {
    const s = useAppStore.getState();
    const text = backupJson({
      exportedAt: new Date().toISOString(),
      accounts: s.accounts,
      exposures: s.exposures,
      instruments: s.instruments,
      transactions: s.transactions,
      targets: s.targets,
      ownStock: s.ownStock,
      plan: s.plan,
    });
    downloadText(`portfolio-backup-${today}.json`, text, 'application/json');
    flash(t.holdings.settingsPage.exportedJson);
  };
  const exportCsv = () => {
    const text = transactionsCsv(useAppStore.getState().transactions, accountName, t);
    downloadText(`transactions-${today}.csv`, text, 'text/csv', { bom: true });
    flash(t.holdings.settingsPage.exportedCsv);
  };
  // Warn first while records are waiting to upload; they stay on this device and upload after the next sign-in
  const leave = () => {
    if (sync.pending > 0) setLeaving(true);
    else void signOut();
  };

  return (
    <>
      <div className="list-box tight">
        {lines.map((line, index) => {
          const account = accounts.find((a) => a.id === line.accountId)!;
          return (
            <button key={line.accountId} type="button" className="account-row list-row" onClick={() => onOpenAccount(line.accountId)}>
              <span className="account-row-left">
                <span className="dot" style={{ background: accountColor(account, index) }} />
                <span className="account-names">
                  <span className="account-name">{account.name}</span>
                  <span className="account-meta">
                    {t.holdings.accountLine(t.common.accountTypes[account.type], account.currency, line.itemCount)}
                  </span>
                </span>
              </span>
              <span className="account-row-value">{money(line.valueCny)} ›</span>
            </button>
          );
        })}
      </div>
      <div className="backup">
        <span className="panel-title">{t.holdings.settingsPage.backupTitle}</span>
        <span className="text-note">{noCloud ? t.holdings.settingsPage.noCloudNote : t.holdings.settingsPage.localNote}</span>
        {session && (
          <span className="text-note">
            {t.holdings.settingsPage.signedInAs(session.user.email, syncStatusText(sync, (iso) => formatTimeHM(new Date(iso)), t))}
          </span>
        )}
        <div className="backup-actions">
          <button type="button" className="btn btn-secondary" onClick={exportJson}>
            {t.holdings.settingsPage.exportJson}
          </button>
          <button type="button" className="btn btn-secondary" onClick={exportCsv}>
            {t.holdings.settingsPage.exportCsv}
          </button>
          {session && (
            <button type="button" className="btn btn-ghost" onClick={leave}>
              {sync.state === 'signedOut' ? t.shell.signInAgain : t.holdings.settingsPage.signOut}
            </button>
          )}
        </div>
      </div>
      <div className="settings-block">
        <span className="panel-title">{t.common.language}</span>
        <Seg label={t.common.language} className="align-start" options={languages} value={locale} onChange={setLocale} />
      </div>
      {leaving && (
        <Sheet
          title={t.holdings.settingsPage.signOut}
          subtitle={t.holdings.settingsPage.signOutPending(sync.pending)}
          maxHeight="none"
          onClose={() => setLeaving(false)}
        >
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setLeaving(false);
                void signOut();
              }}
            >
              {t.holdings.settingsPage.signOutConfirm}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setLeaving(false)}>
              {t.common.cancel}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
