import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n';
import { useBootStore } from './boot';
import { useAppStore } from './store';
import { TabBar } from './TabBar';
import { Toast } from './Toast';
import type { TabId } from './tabs';
import './shell.css';
import './ui.css';

/** Full screen on a phone; on a wide screen, a phone frame as in the prototype. Bottom sheets and sub-pages render in #app-overlay. */
export function AppShell({
  tab,
  onSelectTab,
  badges,
  children,
}: {
  tab: TabId;
  onSelectTab: (id: TabId) => void;
  badges?: Partial<Record<TabId, string>>;
  children: ReactNode;
}) {
  const mainRef = useRef<HTMLElement>(null);
  const demo = useAppStore((s) => s.demo);
  const t = useT();
  const boot = useBootStore();
  const endDemo = boot.kind === 'ready' ? boot.session.endDemo : null;
  // Start each page at the top (the prototype kept the previous page's scroll position)
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [tab]);

  return (
    <div className="app-backdrop">
      <div className="app-frame">
        <main ref={mainRef} className={`app-main${demo ? ' with-demo' : ''}`}>
          {children}
        </main>
        {demo && (
          <div className="demo-banner" role="status">
            <span>{t.shell.demoBanner}</span>
            {endDemo && (
              <button type="button" className="btn btn-primary demo-start" onClick={() => void endDemo({ startOnboarding: true })}>
                {t.shell.demoStart}
              </button>
            )}
          </div>
        )}
        <TabBar active={tab} onSelect={onSelectTab} {...(badges ? { badges } : {})} />
        <div id="app-overlay" className="app-overlay" />
        <Toast />
      </div>
    </div>
  );
}
