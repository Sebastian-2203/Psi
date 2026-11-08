import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_OPTIONS } from '@/lib/auth-cookies';
import { env } from '@/server/env';

/**
 * Supabase Auth clients (anon key only; the service role lives in src/server/db/service-role.ts).
 * There is no browser client: sign-in, MFA and recovery all run in server actions / route
 * handlers so the session cookies stay httpOnly (SECURITY.md §3.5).
 */

export type CookieAdapter = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: { name: string; value: string; options: Record<string, unknown> }[]) => void;
};

/** Cookie-bound client over an explicit adapter (used by actions and by integration tests). */
export function createAuthClient(adapter: CookieAdapter): SupabaseClient {
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: adapter.getAll,
      setAll: (toSet) => adapter.setAll(toSet),
    },
  });
}

/**
 * Client bound to the request cookies. In Server Actions and Route Handlers cookie writes
 * succeed; in Server Components they are ignored (the proxy already refreshed the session).
 */
export async function createRequestAuthClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createAuthClient({
    getAll: () => store.getAll(),
    setAll: (toSet) => {
      try {
        for (const { name, value, options } of toSet) store.set(name, value, options);
      } catch {
        // Server Component render: cookies are read-only. The proxy owns refresh.
      }
    },
  });
}

/** Sessionless client for calls that must not touch cookies (e.g. sending a recovery email). */
export function createStatelessAuthClient(): SupabaseClient {
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'implicit',
    },
  });
}
