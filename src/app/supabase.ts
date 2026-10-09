import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient, SupportedStorage } from '@supabase/supabase-js';

// The cloud connection. The project URL and anon key live in .env.local (not in git) and are only read here; the service role key never goes in the front end.

export interface SupabaseEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
}

/** The key under which the session is stored on this device; sign-in should last, and be readable offline */
export const AUTH_STORAGE_KEY = 'invest-manager-auth';

export function createSupabase(env: SupabaseEnv, options: { fetch?: typeof fetch; storage?: SupportedStorage } = {}): SupabaseClient | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  // supabase-js throws on a malformed URL, leaving start-up stuck on a blank page; treat it as not configured, which opens the sample data
  if (!/^https?:\/\/\S+$/.test(url)) return null;
  return createClient(url, key, {
    auth: {
      storageKey: AUTH_STORAGE_KEY,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      ...(options.storage ? { storage: options.storage } : {}),
    },
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
  });
}
