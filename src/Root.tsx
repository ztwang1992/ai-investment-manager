import type { ReactNode } from 'react';
import App from './App';
import { enter, signOut, useBootStore } from './app/boot';
import type { Session } from './app/session';
import { useAppStore } from './app/store';
import { useSyncStore } from './app/sync';
import { LoginPage } from './pages/login/LoginPage';
import { OnboardingPage } from './pages/onboarding/OnboardingPage';
import { useT } from './i18n';
import './app/shell.css';
import './app/ui.css';
import './pages/login/login.css';

/** Shows by start-up state: loading, can't store data, the sign-in page; once signed in, the app or onboarding; with no cloud configured, the app straight away (sample data). */
export function Root() {
  const t = useT();
  const state = useBootStore();
  switch (state.kind) {
    case 'loading':
      return <Frame />;
    case 'noCloud':
      return <App />;
    case 'unavailable':
      return (
        <Frame title={t.shell.cannotStoreTitle}>
          <span className="text-hint">{t.shell.cannotStoreHint}</span>
        </Frame>
      );
    case 'signedOut':
      return <LoginPage auth={state.auth} onSignedIn={(user) => void enter(user)} />;
    case 'ready':
      return <Ready session={state.session} />;
  }
}

/**
 * Once signed in: an account with accounts goes to the app; one without needs onboarding.
 * Until a new device has read the cloud once, an empty account and data not yet downloaded look the same, so wait for that read rather than repeat onboarding on an account that has data.
 */
function Ready({ session }: { session: Session }) {
  const t = useT();
  const hasAccounts = useAppStore((s) => s.accounts.length > 0);
  const demo = useAppStore((s) => s.demo);
  const onboardingStep = useAppStore((s) => s.onboardingStep);
  const pulledOnce = useSyncStore((s) => s.pulledOnce);
  const sync = useSyncStore((s) => s.state);
  if (hasAccounts || demo) return <App />;
  if (!pulledOnce) {
    if (sync === 'offline') {
      return (
        <Frame title={t.shell.offlineTitle}>
          <span className="text-hint">{t.shell.offlineHint}</span>
        </Frame>
      );
    }
    if (sync === 'signedOut') {
      return (
        <Frame title={t.shell.expiredTitle}>
          <span className="text-hint">{t.shell.expiredHint}</span>
          <button type="button" className="btn btn-primary align-start" onClick={() => void signOut()}>
            {t.shell.signInAgain}
          </button>
        </Frame>
      );
    }
    if (sync === 'error') {
      return (
        <Frame title={t.shell.readFailedTitle}>
          <span className="text-hint">{t.shell.readFailedHint}</span>
        </Frame>
      );
    }
    return <Frame title={t.shell.reading} />;
  }
  return (
    <OnboardingPage
      key={onboardingStep}
      initialStep={onboardingStep}
      onFinish={(result) => void session.completeOnboarding(result)}
      onDemo={() => void session.startDemo()}
    />
  );
}

function Frame({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div className="app-backdrop">
      <div className="app-frame">
        <main className="app-main login-main">
          {title && (
            <section className="page">
              <h1 className="page-title">{title}</h1>
              {children}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
