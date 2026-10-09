import { useId } from 'react';
import { useT } from '../../i18n';
import { useAiStore } from './aiStore';
import { PROVIDER } from './aiText';

/** Only the first provider (DeepSeek) is available for now; the rest are listed as coming soon */
const AVAILABLE = [true, false, false];

/** Connect a model: provider, key, connection test and consent (prototype v5 lines 236–255). */
export function AiOnboarding() {
  const t = useT();
  const { base, model, key, consent, test, setBase, setModel, setKey, toggleConsent, runTest, connect } = useAiStore();
  const id = useId();
  const testing = test?.status === 'testing';

  return (
    <section className="page ai-onboarding">
      <h1 className="page-title">{t.ai.title}</h1>
      <div className="ai-intro">
        <span className="ai-avatar-lg">AI</span>
        <span className="ai-intro-title">{t.ai.setup.title}</span>
        <span className="ai-intro-text">{t.ai.setup.text}</span>
        <div className="ai-intro-points">
          {t.ai.setup.promises.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </div>
      </div>
      <div className="ai-providers">
        <span className="ai-label">{t.ai.setup.provider}</span>
        {t.ai.setup.providers.map((p, i) => {
          const available = AVAILABLE[i] ?? false;
          return (
            <button key={p.name} type="button" className="ai-provider" aria-pressed={available} disabled={!available}>
              <span className="ai-provider-names">
                <span className="ai-provider-name">{p.name}</span>
                <span className="ai-provider-desc">{p.desc}</span>
              </span>
              <span className={`tag ${available ? 'tag-accent' : 'tag-neutral'}`}>{p.tag}</span>
            </button>
          );
        })}
      </div>
      <div className="field">
        <label htmlFor={`${id}-base`}>{t.ai.setup.base}</label>
        <input id={`${id}-base`} className="input" value={base} onChange={(e) => setBase(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-model`}>{t.ai.setup.model}</label>
        <input id={`${id}-model`} className="input" value={model} onChange={(e) => setModel(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${id}-key`}>API Key</label>
        <input
          id={`${id}-key`}
          className="input"
          type="password"
          placeholder="sk-…"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
      </div>
      {test && (
        <div className={`ai-status is-${test.status}`} role="status">
          <span className="ai-status-title">{test.title}</span>
          <span className="ai-status-text">{test.message}</span>
        </div>
      )}
      <label className="ai-consent">
        <input type="checkbox" checked={consent} onChange={toggleConsent} />
        <span>{t.ai.setup.consent(PROVIDER)}</span>
      </label>
      <div className="actions">
        <button type="button" className="btn btn-secondary" disabled={testing} onClick={() => void runTest()}>
          {testing ? t.ai.setup.testing : t.ai.setup.test}
        </button>
        <button type="button" className="btn btn-primary" disabled={test?.status !== 'ok' || !consent} onClick={() => void connect()}>
          {t.ai.setup.start}
        </button>
      </div>
    </section>
  );
}
