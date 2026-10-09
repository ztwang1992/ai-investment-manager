import { useState } from 'react';
import { CalibrationSheet } from '../../app/CalibrationSheet';
import { formatMoney } from '../../app/format';
import { Seg } from '../../app/Seg';
import { useAppStore } from '../../app/store';
import { useT } from '../../i18n';
import { SubPage } from '../../app/SubPage';
import { usePortfolio } from '../../app/usePortfolio';
import { AccountSheet } from './AccountSheet';
import { AccountsSettings } from './AccountsSettings';
import { AccountView } from './AccountView';
import { AddAccountSheet } from './AddAccountSheet';
import { AnomalyCard } from './AnomalyCard';
import { AssetView } from './AssetView';
import './holdings.css';

type View = 'asset' | 'account';
const VIEWS: readonly View[] = ['asset', 'account'];

type SheetState =
  | null
  | { kind: 'account'; accountId: string }
  | { kind: 'calibration'; accountId: string; code: string; backToAccount: boolean }
  | { kind: 'addAccount' };

/** Holdings: by underlying asset or by account; Settings at the top right (prototype v5 lines 143–206). */
export function HoldingsPage() {
  const [view, setView] = useState<View>('asset');
  // The prototype opens with S&P 500 expanded
  const [open, setOpen] = useState<Record<string, boolean>>({ 'u:sp500': true });
  const [sheet, setSheet] = useState<SheetState>(null);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const portfolio = usePortfolio();
  const fx = useAppStore((s) => s.fx);
  const t = useT();
  const displayCurrency = useAppStore((s) => s.displayCurrency);
  const hide = useAppStore((s) => s.hideAmounts);

  const openAccount = (accountId: string) => setSheet({ kind: 'account', accountId });
  const calibrate = (accountId: string, code: string, backToAccount: boolean) =>
    setSheet({ kind: 'calibration', accountId, code, backToAccount });

  return (
    <section className="page holdings">
      <div className="holdings-header">
        <h1 className="page-title">{t.holdings.title}</h1>
        <button type="button" className="btn btn-secondary" onClick={() => setAccountsOpen(true)}>
          {t.holdings.settings}
        </button>
      </div>
      <div className="holdings-bar">
        <Seg label={t.holdings.viewLabel} options={VIEWS.map((v) => [v, t.holdings.views[v]] as const)} value={view} onChange={setView} />
        <span className="holdings-total">{formatMoney(portfolio.totalCny, displayCurrency, fx, t.locale, hide)}</span>
      </div>
      <AnomalyCard onCalibrate={(accountId, code) => calibrate(accountId, code, false)} />

      {view === 'asset' ? (
        <AssetView
          open={open}
          onToggle={(key) => setOpen((o) => ({ ...o, [key]: !o[key] }))}
          onCalibrate={(accountId, code) => calibrate(accountId, code, false)}
        />
      ) : (
        <AccountView onOpen={openAccount} />
      )}

      {accountsOpen && (
        <SubPage
          title={t.holdings.settings}
          backLabel={t.holdings.title}
          gap={18}
          onBack={() => setAccountsOpen(false)}
          action={
            <button type="button" className="btn btn-primary" onClick={() => setSheet({ kind: 'addAccount' })}>
              {t.holdings.addAccount}
            </button>
          }
        >
          <AccountsSettings onOpenAccount={openAccount} />
        </SubPage>
      )}

      {sheet?.kind === 'account' && (
        <AccountSheet
          accountId={sheet.accountId}
          onCalibrate={(code) => calibrate(sheet.accountId, code, true)}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'calibration' && (
        <CalibrationSheet
          accountId={sheet.accountId}
          code={sheet.code}
          onDone={() => setSheet(sheet.backToAccount ? { kind: 'account', accountId: sheet.accountId } : null)}
        />
      )}
      {sheet?.kind === 'addAccount' && <AddAccountSheet onClose={() => setSheet(null)} />}
    </section>
  );
}
