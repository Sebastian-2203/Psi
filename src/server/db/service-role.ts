import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/server/env';

/**
 * Supabase Auth admin API and the `branding` Storage bucket with the SERVICE-ROLE key
 * (ARCHITECTURE §4 rule 4, §6.4, ADR-021). The key never leaves this module: it is the only file
 * allowed to read `SUPABASE_SERVICE_ROLE_KEY` (lint rule, P1-20). Callers get narrow functions
 * only, and every caller authorizes in the user's RLS-bound transaction first and audits the
 * action. Importable only from the per-file allowlist SERVICE_ROLE_IMPORTERS in
 * eslint.config.mjs (P1-04). No database access here: Postgres system functions are in
 * ./system.ts (app_server role, no service role).
 */

let serviceClient: SupabaseClient | undefined;

function getServiceClient(): SupabaseClient {
  serviceClient ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return serviceClient;
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
  const { data, error } = await getServiceClient().auth.admin.createUser({
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
  await getServiceClient().auth.admin.deleteUser(userId);
}

export type MfaFactorResetResult =
  { ok: true; removed: number } | { ok: false; removed: number; stage: 'list' | 'delete' };

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
  const admin = getServiceClient();
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

/* ------------------------------ Branding bucket (P1-16, P1-18) ------------------------------ */

const BRANDING_BUCKET = 'branding';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BRANDING_OBJECT = /^logo-[0-9a-f]{32}\.(png|jpg|webp)$/;
const BRANDING_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

function assertBrandingPath(path: string): void {
  const [org, name, ...rest] = path.split('/');
  if (rest.length > 0 || !org || !UUID.test(org) || !name || !BRANDING_OBJECT.test(name)) {
    throw new Error('Invalid branding object path.');
  }
}

/**
 * Writes SANITISED logo bytes (src/modules/branding/server/logo.ts). `authenticated` has no write
 * policy on the bucket (migration 20261108160000), so this is the only writer. Call it ONLY after
 * the caller's owner + aal2 check succeeded in their RLS-bound transaction. `upsert`: an object
 * already under this content-addressed name is overwritten with these bytes, never trusted.
 */
export async function serviceRoleUploadBrandingLogo(
  path: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  assertBrandingPath(path);
  if (!BRANDING_TYPES.has(contentType)) throw new Error('Invalid branding content type.');
  const { error } = await getServiceClient()
    .storage.from(BRANDING_BUCKET)
    .upload(path, bytes, { contentType, upsert: true, cacheControl: '31536000' });
  if (error) throw new Error('storage_upload_failed');
}

/**
 * Deletes every object in the organization's branding folder except `keepPath` (null = all).
 * Callers hold the organization_branding row lock (SELECT ... FOR UPDATE) so no concurrent
 * upload can be in flight for this organization. Returns the number of objects deleted.
 */
export async function serviceRoleDeleteBrandingObjects(
  organizationId: string,
  keepPath: string | null,
): Promise<number> {
  if (!UUID.test(organizationId)) throw new Error('Invalid organization id.');
  if (keepPath !== null) assertBrandingPath(keepPath);
  const bucket = getServiceClient().storage.from(BRANDING_BUCKET);
  let deleted = 0;
  // Bounded loop: a folder holds the current logo plus rare orphans.
  for (let page = 0; page < 10; page += 1) {
    const { data, error } = await bucket.list(organizationId, { limit: 100 });
    if (error || !data) throw new Error('storage_list_failed');
    const targets = data
      .filter((object) => BRANDING_OBJECT.test(object.name))
      .map((object) => `${organizationId}/${object.name}`)
      .filter((path) => path !== keepPath);
    if (targets.length === 0) return deleted;
    const removed = await bucket.remove(targets);
    if (removed.error) throw new Error('storage_delete_failed');
    deleted += removed.data?.length ?? 0;
    if ((removed.data?.length ?? 0) === 0) throw new Error('storage_delete_failed');
  }
  throw new Error('storage_delete_incomplete');
}
