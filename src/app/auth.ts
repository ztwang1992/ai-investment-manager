import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AUTH_STORAGE_KEY } from './supabase';

// Sign-in: a 6-digit code by email (not a magic link: an app added to the home screen keeps its storage apart from Safari, so a link would only sign in Safari).

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthErrorKind = 'bad_email' | 'rate_limited' | 'bad_code' | 'network' | 'send_failed' | 'server' | 'unknown';

export class AuthError extends Error {
  readonly kind: AuthErrorKind;
  constructor(kind: AuthErrorKind, message: string) {
    super(message);
    this.name = 'AuthError';
    this.kind = kind;
  }
}

/** Remembers on this device who signed in last (only the id and email, no tokens), for opening the app offline */
export const LAST_USER_KEY = 'invest-manager-user';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AuthClient {
  /** The user signed in on this device. Offline, or when the session can't be renewed right away, returns the remembered user, so the data can still be viewed and recorded offline */
  currentUser(): Promise<AuthUser | null>;
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<AuthUser>;
  /** Signs out on this device only; needs no network */
  signOut(): Promise<void>;
}

function toAuthError(error: unknown, step: 'send' | 'verify'): AuthError {
  const message = error instanceof Error ? error.message : String(error);
  if (isAuthRetryableFetchError(error)) {
    // supabase-js counts a server 5xx as a retryable network error too; when the server really answered with a 5xx, say the problem is on its side
    // (when sending a code, the usual cause is a failed email, e.g. a sender domain not verified in Resend)
    if (error.status >= 500) return new AuthError(step === 'send' ? 'send_failed' : 'server', message);
    return new AuthError('network', message);
  }
  if (isAuthApiError(error)) {
    if (error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') {
      return new AuthError('rate_limited', message);
    }
    if (error.code === 'otp_expired' || error.code === 'invalid_credentials' || error.status === 403) return new AuthError('bad_code', message);
    if (error.code === 'email_address_invalid' || error.code === 'validation_failed') return new AuthError('bad_email', message);
  }
  return new AuthError('unknown', message);
}

export function createSupabaseAuth(client: SupabaseClient, storage: KeyValueStorage, options: { sessionTimeoutMs?: number } = {}): AuthClient {
  const timeoutMs = options.sessionTimeoutMs ?? 3000;
  const remember = (u: AuthUser) => {
    try {
      storage.setItem(LAST_USER_KEY, JSON.stringify(u));
    } catch {
      // Failing to save this doesn't affect this sign-in
    }
  };
  const remembered = (): AuthUser | null => {
    try {
      const v = storage.getItem(LAST_USER_KEY);
      return v ? (JSON.parse(v) as AuthUser) : null;
    } catch {
      return null;
    }
  };
  const toUser = (u: { id: string; email?: string | undefined }): AuthUser => ({ id: u.id, email: u.email ?? '' });

  return {
    async currentUser() {
      // getSession renews an expired session over the network; offline or on a slow network, don't wait for it
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      });
      const result = await Promise.race([client.auth.getSession(), timeout]);
      clearTimeout(timer);
      if (result === 'timeout') return remembered();
      const { data, error } = result;
      if (data.session) {
        const user = toUser(data.session.user);
        remember(user);
        return user;
      }
      if (error && isAuthRetryableFetchError(error)) return remembered();
      return null;
    },
    async sendCode(email) {
      const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw toAuthError(error, 'send');
    },
    async verifyCode(email, code) {
      const { data, error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error || !data.user) throw toAuthError(error ?? new Error('No user returned'), 'verify');
      const user = toUser(data.user);
      remember(user);
      return user;
    },
    async signOut() {
      try {
        storage.removeItem(LAST_USER_KEY);
      } catch {
        // ignore
      }
      const { error } = await client.auth.signOut({ scope: 'local' });
      // Offline, supabase-js doesn't clear the session on this device; delete it here
      if (error) storage.removeItem(AUTH_STORAGE_KEY);
    },
  };
}
