import { AuthRetryableFetchError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '../i18n';
import { AuthError, LAST_USER_KEY, createSupabaseAuth } from './auth';
import { AUTH_STORAGE_KEY, createSupabase } from './supabase';

const U = { id: '11111111-1111-1111-1111-111111111111', email: 'me@example.com' };
const memory = (init: Record<string, string> = {}) => {
  const map = new Map(Object.entries(init));
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};
const session = (expiresInSec: number) =>
  JSON.stringify({
    access_token: 'token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSec,
    refresh_token: 'refresh',
    user: { ...U, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
  });

type Reply = { status: number; body?: unknown } | 'offline' | 'hang';
function setup(reply: (url: URL, body: unknown) => Reply, storage = memory()) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const r = reply(url, init.body ? JSON.parse(String(init.body)) : undefined);
    if (r === 'offline') throw new TypeError('fetch failed');
    if (r === 'hang') return new Promise<Response>(() => {});
    return new Response(r.body === undefined ? '{}' : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
  const client = createSupabase(
    { VITE_SUPABASE_URL: 'https://proj.supabase.co', VITE_SUPABASE_ANON_KEY: 'anon' },
    { fetch: fetch as unknown as typeof globalThis.fetch, storage },
  )!;
  return { auth: createSupabaseAuth(client, storage, { sessionTimeoutMs: 50 }), fetch, storage };
}

describe('signing in with an email code', () => {
  it('asks the cloud to email a code, creating the account the first time', async () => {
    let sent: unknown;
    const { auth } = setup((url, body) => {
      if (url.pathname === '/auth/v1/otp') sent = body;
      return { status: 200 };
    });
    await auth.sendCode('me@example.com');
    expect(sent).toMatchObject({ email: 'me@example.com', create_user: true });
  });

  it('explains why a code could not be sent or used', async () => {
    const limited = setup(() => ({ status: 429, body: { code: 'over_email_send_rate_limit', msg: 'rate limit' } }));
    await expect(limited.auth.sendCode('me@example.com')).rejects.toMatchObject({ kind: 'rate_limited' });
    const wrong = setup(() => ({ status: 403, body: { code: 'otp_expired', msg: 'Token has expired or is invalid' } }));
    await expect(wrong.auth.verifyCode('me@example.com', '123456')).rejects.toMatchObject({ kind: 'bad_code' });
    const offline = setup(() => 'offline');
    await expect(offline.auth.sendCode('me@example.com')).rejects.toBeInstanceOf(AuthError);
    await expect(offline.auth.sendCode('me@example.com')).rejects.toMatchObject({ kind: 'network' });
  });

  // supabase-js counts a 5xx as a network error too; when sending fails (e.g. an unverified sender domain), say plainly that the email wasn't sent
  it('says the code email was not sent when the cloud fails to send it', async () => {
    const failing = setup((url) =>
      url.pathname === '/auth/v1/otp' ? { status: 500, body: { code: 'unexpected_failure', msg: 'Error sending confirmation email' } } : { status: 200 },
    );
    await expect(failing.auth.sendCode('me@example.com')).rejects.toMatchObject({ kind: 'send_failed' });
    const broken = setup((url) => (url.pathname === '/auth/v1/verify' ? { status: 500, body: { code: 'unexpected_failure', msg: 'boom' } } : { status: 200 }));
    await expect(broken.auth.verifyCode('me@example.com', '123456')).rejects.toMatchObject({ kind: 'server' });
    expect(MESSAGES.en.login.errors.send_failed).toBe("The code email wasn't sent. Try again later.");
  });

  it('signs in with the code and remembers who signed in', async () => {
    const { auth, storage } = setup((url) =>
      url.pathname === '/auth/v1/verify'
        ? {
            status: 200,
            body: {
              access_token: 't',
              refresh_token: 'r',
              expires_in: 3600,
              token_type: 'bearer',
              user: { ...U, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
            },
          }
        : { status: 200 },
    );
    expect(await auth.verifyCode('me@example.com', '123456')).toEqual(U);
    expect(JSON.parse(storage.getItem(LAST_USER_KEY)!)).toEqual(U);
  });

  it('knows who is signed in on this device', async () => {
    const { auth } = setup(() => ({ status: 200 }), memory({ [AUTH_STORAGE_KEY]: session(3600) }));
    expect(await auth.currentUser()).toEqual(U);
  });

  it('still opens offline after the login has expired', async () => {
    const stored = memory({ [AUTH_STORAGE_KEY]: session(-60), [LAST_USER_KEY]: JSON.stringify(U) });
    const offline = setup(() => 'offline', stored);
    expect(await offline.auth.currentUser()).toEqual(U);
    const slow = setup(() => 'hang', memory({ [AUTH_STORAGE_KEY]: session(-60), [LAST_USER_KEY]: JSON.stringify(U) }));
    expect(await slow.auth.currentUser()).toEqual(U);
  });

  it('opens with the remembered user when the login cannot be renewed right away', async () => {
    const client = { auth: { getSession: async () => ({ data: { session: null }, error: new AuthRetryableFetchError('fetch failed', 0) }) } };
    const auth = createSupabaseAuth(client as unknown as SupabaseClient, memory({ [LAST_USER_KEY]: JSON.stringify(U) }), { sessionTimeoutMs: 5000 });
    expect(await auth.currentUser()).toEqual(U);
  });

  it('has nobody signed in on a new device', async () => {
    const { auth } = setup(() => ({ status: 200 }));
    expect(await auth.currentUser()).toBeNull();
  });

  it('signs out on this device even without a network', async () => {
    const stored = memory({ [AUTH_STORAGE_KEY]: session(3600), [LAST_USER_KEY]: JSON.stringify(U) });
    const { auth, storage } = setup(() => 'offline', stored);
    await auth.signOut();
    expect(storage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LAST_USER_KEY)).toBeNull();
    expect(await auth.currentUser()).toBeNull();
  });
});
