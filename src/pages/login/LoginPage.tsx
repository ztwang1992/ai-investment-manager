import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { AuthError } from '../../app/auth';
import type { AuthClient, AuthErrorKind, AuthUser } from '../../app/auth';
import { useT } from '../../i18n';
import '../../app/shell.css';
import '../../app/ui.css';
import './login.css';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Seconds to wait before a code can be sent again */
export const RESEND_SECONDS = 60;
/** Supabase codes can be set to 6–10 digits (Authentication → Email → Email OTP Length); all are accepted here */
const CODE = /^\d{6,10}$/;
const CODE_MAX = 10;

/** The login page: a code sent by email (6 digits by design). Same frame as the app (a phone frame on wide screens), no tab bar. */
export function LoginPage({ auth, onSignedIn }: { auth: AuthClient; onSignedIn: (user: AuthUser) => void }) {
  const t = useT();
  const id = useId();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  // Kept as a kind, not a sentence, so it reads in the current language
  const [error, setError] = useState<AuthErrorKind | 'incomplete_code' | null>(null);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const fail = (e: unknown) => setError(e instanceof AuthError ? e.kind : 'unknown');

  const send = async () => {
    const address = email.trim();
    if (!EMAIL.test(address)) return setError('bad_email');
    setBusy(true);
    setError(null);
    try {
      await auth.sendCode(address);
      setEmail(address);
      setCode('');
      setStep('code');
      setWait(RESEND_SECONDS);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!CODE.test(code)) return setError('incomplete_code');
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await auth.verifyCode(email, code));
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };

  const errorText = error === 'incomplete_code' ? t.login.incompleteCode : error ? t.login.errors[error] : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void (step === 'email' ? send() : verify());
  };

  return (
    <div className="app-backdrop">
      <div className="app-frame">
        <main className="app-main login-main">
          <form className="page login" onSubmit={submit} noValidate>
            <h1 className="page-title">{t.common.appName}</h1>
            {step === 'email' ? (
              <>
                <span className="text-hint">{t.login.intro}</span>
                <div className="field">
                  <label htmlFor={`${id}-email`}>{t.login.email}</label>
                  <input
                    id={`${id}-email`}
                    className="input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError(null);
                    }}
                  />
                </div>
                {errorText && <span className="text-error">{errorText}</span>}
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? t.login.sending : t.login.sendCode}
                </button>
              </>
            ) : (
              <>
                <span className="text-hint">{t.login.codeSentTo(email)}</span>
                <div className="field">
                  <label htmlFor={`${id}-code`}>{t.login.code}</label>
                  <input
                    id={`${id}-code`}
                    className="input login-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={CODE_MAX}
                    value={code}
                    onChange={(e) => {
                      setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_MAX));
                      setError(null);
                    }}
                  />
                </div>
                {errorText && <span className="text-error">{errorText}</span>}
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? t.login.signingIn : t.login.signIn}
                </button>
                <div className="login-links">
                  <button type="button" className="btn btn-ghost" disabled={busy || wait > 0} onClick={() => void send()}>
                    {wait > 0 ? t.login.resendIn(wait) : t.login.resend}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => {
                      setStep('email');
                      setError(null);
                    }}
                  >
                    {t.login.otherEmail}
                  </button>
                </div>
              </>
            )}
          </form>
        </main>
      </div>
    </div>
  );
}
