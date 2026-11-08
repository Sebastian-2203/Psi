import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { FICTIONAL_PASSWORD, FICTIONAL_TOTP_SECRET, type Persona } from './personas';
import { totp } from './totp';

/**
 * Local Supabase stack helpers for integration tests. Tests SKIP (with the reason printed)
 * when the stack or DATABASE_URL is unavailable, so plain `pnpm test` stays green.
 * Only ever talks to LOCAL hosts: the fixtures sign in fictional personas.
 */

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const ADMIN_URL_DEFAULT = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const TOKEN_CACHE = path.resolve('node_modules/.cache/psi-integration/tokens.json');

export function loadLocalEnv(): void {
  if (
    !process.env.DATABASE_URL &&
    existsSync('.env.local') &&
    typeof process.loadEnvFile === 'function'
  ) {
    process.loadEnvFile('.env.local');
  }
}

function isLocal(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export type StackStatus = { available: true } | { available: false; reason: string };

let status: Promise<StackStatus> | undefined;

export function detectLocalStack(): Promise<StackStatus> {
  status ??= (async (): Promise<StackStatus> => {
    loadLocalEnv();
    const required = [
      'DATABASE_URL',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ];
    const missing = required.filter((name) => !process.env[name]);
    if (missing.length > 0)
      return { available: false, reason: `missing env: ${missing.join(', ')}` };
    process.env.APP_BASE_DOMAIN ??= 'localhost';
    if (!isLocal(process.env.DATABASE_URL) || !isLocal(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
      return {
        available: false,
        reason: 'integration tests only run against a LOCAL Supabase stack',
      };
    }
    const sql = postgres(process.env.DATABASE_URL as string, {
      max: 1,
      connect_timeout: 3,
      onnotice: () => {},
    });
    try {
      await sql`select 1`;
    } catch (error) {
      return {
        available: false,
        reason: `database unreachable as app_server (${(error as Error).message})`,
      };
    } finally {
      await sql.end({ timeout: 1 });
    }
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string },
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return { available: false, reason: `auth health returned ${res.status}` };
    } catch (error) {
      return { available: false, reason: `auth unreachable (${(error as Error).message})` };
    }
    return { available: true };
  })();
  return status;
}

export function skipMessage(suite: string, s: StackStatus): void {
  if (!s.available && process.env.REQUIRE_LOCAL_STACK === '1') {
    // CI's Supabase job sets this: a missing stack must fail, never silently skip.
    throw new Error(`[integration] ${suite}: local stack required but unavailable (${s.reason})`);
  }
  if (!s.available) {
    console.warn(
      `[integration] SKIPPED ${suite}: ${s.reason}. Run \`pnpm db:start && pnpm db:reset\` (see README "Local database").`,
    );
  }
}

/** Superuser connection for assertions on catalogs/fixtures. Local only. */
export function adminSql(): postgres.Sql {
  const url = process.env.SUPABASE_DB_ADMIN_URL ?? ADMIN_URL_DEFAULT;
  if (!isLocal(url)) throw new Error('adminSql is local-only');
  return postgres(url, { max: 2, onnotice: () => {} });
}

export function anonClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}

export function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}

type CachedTokens = Record<string, { token: string; exp: number }>;

function readCache(): CachedTokens {
  try {
    return JSON.parse(readFileSync(TOKEN_CACHE, 'utf8')) as CachedTokens;
  } catch {
    return {};
  }
}

function writeCache(cache: CachedTokens): void {
  mkdirSync(path.dirname(TOKEN_CACHE), { recursive: true });
  writeFileSync(TOKEN_CACHE, JSON.stringify(cache));
}

function expOf(token: string): number {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { exp: number };
  return payload.exp;
}

/**
 * Real access token for a fictional persona at aal1 or aal2 (password + seeded TOTP).
 * Tokens are cached on disk (fictional, local, short-lived) to stay under Auth rate limits,
 * and re-validated against Auth before reuse. `fresh: true` always creates a new session.
 */
export async function signIn(
  persona: Persona,
  aal: 'aal1' | 'aal2',
  options: { fresh?: boolean } = {},
): Promise<string> {
  const cacheKey = `${persona.key}:${aal}`;
  const client = anonClient();
  if (!options.fresh) {
    const cached = readCache()[cacheKey];
    if (cached && cached.exp * 1000 - Date.now() > 120_000) {
      const { error } = await client.auth.getUser(cached.token);
      if (!error) return cached.token;
    }
  }
  const { data, error } = await client.auth.signInWithPassword({
    email: persona.email,
    password: FICTIONAL_PASSWORD,
  });
  if (error || !data.session)
    throw new Error(`sign-in failed for ${persona.key}: ${error?.message}`);
  const aal1Token = data.session.access_token;
  const cache = readCache();
  if (!options.fresh) cache[`${persona.key}:aal1`] = { token: aal1Token, exp: expOf(aal1Token) };

  let result = aal1Token;
  if (aal === 'aal2') {
    if (!persona.hasTotp) throw new Error(`${persona.key} has no TOTP factor`);
    const factors = await client.auth.mfa.listFactors();
    const factor = factors.data?.totp[0];
    if (!factor) throw new Error(`no verified TOTP factor for ${persona.key}`);
    const verified = await client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: totp(FICTIONAL_TOTP_SECRET),
    });
    if (verified.error) throw new Error(`MFA failed for ${persona.key}: ${verified.error.message}`);
    const session = await client.auth.getSession();
    result = session.data.session?.access_token ?? '';
    if (!options.fresh) cache[`${persona.key}:aal2`] = { token: result, exp: expOf(result) };
  }
  if (!options.fresh) writeCache(cache);
  return result;
}
