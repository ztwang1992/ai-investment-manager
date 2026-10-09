import { useEffect, useState } from 'react';
import { AppShell } from './app/AppShell';
import { useAppStore } from './app/store';
import { useSyncStore } from './app/sync';
import type { TabId } from './app/tabs';
import { AiPage } from './pages/ai/AiPage';
import { HoldingsPage } from './pages/holdings/HoldingsPage';
import { PerfPage } from './pages/perf/PerfPage';
import { PlanPage } from './pages/plan/PlanPage';
import { useRebalanceDue } from './pages/plan/usePlanData';
import { RecordsPage } from './pages/records/RecordsPage';
import { useT } from './i18n';

export default function App() {
  const t = useT();
  const [tab, setTab] = useState<TabId>('perf');
  const refreshQuotes = useAppStore((s) => s.refreshQuotes);
  const pending = useSyncStore((s) => s.pending);
  const rebalanceDue = useRebalanceDue();
  const badges = {
    ...(pending > 0 ? { rec: t.shell.badges.waitingToSync(pending) } : {}),
    ...(rebalanceDue ? { plan: t.shell.badges.rebalanceDue } : {}),
  };

  // Refresh prices and exchange rates on a cold start
  useEffect(() => {
    void refreshQuotes();
  }, [refreshQuotes]);

  return (
    <AppShell tab={tab} onSelectTab={setTab} badges={badges}>
      {tab === 'perf' ? (
        <PerfPage />
      ) : tab === 'plan' ? (
        <PlanPage />
      ) : tab === 'hold' ? (
        <HoldingsPage />
      ) : tab === 'rec' ? (
        <RecordsPage />
      ) : (
        <AiPage />
      )}
    </AppShell>
  );
}
