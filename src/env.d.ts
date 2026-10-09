// Settings from .env.local or the build variables (not in git); format in .env.example. Without Supabase, only the sample data can be viewed
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** The quotes Worker's address; without it there are no quotes. For debugging the Worker locally, use http://localhost:8787 */
  readonly VITE_API_BASE?: string;
}
