import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/server/env';

/**
 * Supabase Auth admin API with the SERVICE-ROLE key (ARCHITECTURE §4 rule 4, ADR-021). The key
 * never leaves this module; callers get narrow functions only, and every caller audits the
 * action. Importable only from the per-file allowlist SERVICE_ROLE_IMPORTERS in
 * eslint.config.mjs (P1-04). No database access here: Postgres system functions are in
 * ./system.ts (app_server role, no service role).
 */

let authAdmin: SupabaseClient | undefined;

function getAuthAdmin(): SupabaseClient {
  authAdmin ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return authAdmin;
}

export type AdminCreateUserResult =
  { ok: true; userId: string } | { ok: false; reason: 'weak_password' | 'exists' | 'error' };

/**
 * Invitation acceptance only: creates an auth user with a CONFIRMED email. Possession of the
 * emailed single-use invitation token is the proof of mailbox control (SECURITY.md §3.8).
 */
export async function adminCreateInvitedUser(input: {
  email: string;
  password: string;
  displayName: string;
  locale: 'es' | 'en';
}): Promise<AdminCreateUserResult> {
  const { data, error } = await getAuthAdmin().auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.displayName, locale: input.locale },
  });
  if (error || !data.user) {
    if (error?.code === 'weak_password') return { ok: false, reason: 'weak_password' };
    if (error?.code === 'email_exists' || error?.code === 'user_already_exists') {
      return { ok: false, reason: 'exists' };
    }
    return { ok: false, reason: 'error' };
  }
  return { ok: true, userId: data.user.id };
}

/** Compensation for a failed acceptance right after adminCreateInvitedUser. */
export async function adminDeleteUnacceptedUser(userId: string): Promise<void> {
  await getAuthAdmin().auth.admin.deleteUser(userId);
}

export type MfaFactorResetResult =
  | { ok: true; removed: number }
  | { ok: false; removed: number; stage: 'list' | 'delete' };

/**
 * ADR-021 factor reset after a recovery code was consumed (state `reset_pending` in the DB).
 * Removes every MFA factor of the user: unverified factors first, verified ones LAST, so a
 * failure part-way leaves the user's working TOTP factor in place whenever possible. Never
 * throws: reports how far it got so the caller can audit the outcome (`ok`/`partial`/`failed`)
 * and the user can retry with the same code. Idempotent: a retry lists the remaining factors.
 *
 * Deleting a factor does NOT end sessions (OBSERVED 2026-11-08, local Supabase CLI 2.122 stack:
 * the access token still passes getUser and the refresh token keeps working at aal1), so the
 * caller MUST revoke every session afterwards (`signOut({ scope: 'global' })`).
 */
export async function adminDeleteAllMfaFactors(userId: string): Promise<MfaFactorResetResult> {
  const admin = getAuthAdmin();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error || !data) return { ok: false, removed: 0, stage: 'list' };
  const ordered = [...data.factors].sort(
    (a, b) => Number(a.status === 'verified') - Number(b.status === 'verified'),
  );
  let removed = 0;
  for (const factor of ordered) {
    let deleted = false;
    for (let attempt = 0; attempt < 2 && !deleted; attempt += 1) {
      const result = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
      deleted = !result.error;
    }
    if (!deleted) return { ok: false, removed, stage: 'delete' };
    removed += 1;
  }
  return { ok: true, removed };
}
