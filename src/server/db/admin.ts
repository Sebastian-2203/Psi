import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type postgres from 'postgres';
import { env } from '@/server/env';
import { getSql } from './pool';

/**
 * Restricted system path (ARCHITECTURE §6.4). Importable only from the allowlist in
 * eslint.config.mjs. Exposes NARROW functions, never a raw client or transaction.
 *
 * Each function runs in a transaction as the `app_server` login role itself (no
 * `set role authenticated`, no claims): it holds no table privileges and can only execute
 * the `app.*` system functions granted to it in
 * supabase/migrations/20261108120500_app_server_role.sql. Those functions refuse to run when
 * user claims are present, and they write their own audit rows where relevant.
 *
 * Supabase Auth admin operations (create invited user, revoke sessions, MFA reset — ADR-021)
 * use the service-role key against the Auth API (bottom of this file). The key never leaves
 * this module; callers get narrow functions only.
 */

async function withSystemTransaction<T>(
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const result = await getSql().begin(async (tx) => {
    // Pooled-connection hygiene: guarantee no user identity is visible to system functions.
    await tx`
      select
        set_config('request.jwt.claims', '', true),
        set_config('request.jwt.claim.sub', '', true),
        set_config('request.jwt.claim', '', true),
        set_config('statement_timeout', '10s', true)
    `;
    return fn(tx);
  });
  return result as T;
}

/** ADR-017: verified host -> organization id (a hint; never authority). */
export async function systemResolveOrganizationIdByHost(host: string): Promise<string | null> {
  return withSystemTransaction(async (tx) => {
    const [row] = await tx<{ id: string | null }[]>`
      select app.resolve_organization_by_host(${host}) as id
    `;
    return row?.id ?? null;
  });
}

export type PublicBrandingRow = {
  organization_id: string;
  slug: string;
  display_name: string;
  default_locale: 'es' | 'en';
  brand_color: string;
  functional_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  child_mode_enabled: boolean;
  logo_file_id: string | null;
  favicon_file_id: string | null;
  portal_welcome_es: string | null;
  portal_welcome_en: string | null;
};

/** ADR-010: non-PHI branding tokens for pre-auth rendering. */
export async function systemGetPublicBranding(
  organizationId: string,
): Promise<PublicBrandingRow | null> {
  return withSystemTransaction(async (tx) => {
    const [row] = await tx<PublicBrandingRow[]>`
      select * from app.get_public_branding(${organizationId}::uuid)
    `;
    return row ?? null;
  });
}

export type SystemAuditRow = {
  eventType: string;
  actorProfileId: string | null;
  organizationId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, postgres.JSONValue>;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
};

/** System/denied-attempt audit writer (`app.write_system_audit`, actor_type = system). */
export async function systemWriteAudit(row: SystemAuditRow): Promise<string> {
  return withSystemTransaction(async (tx) => {
    const [result] = await tx<{ id: string }[]>`
      select app.write_system_audit(
        ${row.eventType},
        ${row.actorProfileId}::uuid,
        ${row.organizationId}::uuid,
        ${row.resourceType},
        ${row.resourceId}::uuid,
        ${tx.json(row.metadata)},
        ${row.requestId},
        ${row.ip}::inet,
        ${row.userAgent}
      ) as id
    `;
    if (!result) throw new Error('write_system_audit returned no row');
    return result.id;
  });
}

/**
 * ADR-020 pre-auth limiter: `bucketKey` = sha256("<action>:<ip-hash>") computed by the caller.
 * Returns true when allowed.
 */
export async function systemConsumeRateLimit(
  bucketKey: Uint8Array,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  return withSystemTransaction(async (tx) => {
    const [row] = await tx<{ allowed: boolean }[]>`
      select app.consume_rate_limit_key(
        ${Buffer.from(bucketKey)}, ${limit}::int, make_interval(secs => ${windowSeconds})
      ) as allowed
    `;
    return row?.allowed ?? false;
  });
}

export type AcceptStaffInvitationInput = {
  /** sha256 of the raw invitation token (32 bytes). */
  tokenHash: Uint8Array;
  /** Auth user id whose verified email must match the invitation. */
  profileId: string;
  professional?: { title: string; licenseNumber: string; licenseIssuer: string };
  requestId: string | null;
};

/** SECURITY.md §3.8: single-use, email-bound acceptance; writes its own audit rows. */
export async function systemAcceptStaffInvitation(
  input: AcceptStaffInvitationInput,
): Promise<{ organizationId: string; membershipId: string }> {
  return withSystemTransaction(async (tx) => {
    const [row] = await tx<{ organization_id: string; membership_id: string }[]>`
      select * from app.accept_staff_invitation(
        ${Buffer.from(input.tokenHash)},
        ${input.profileId}::uuid,
        ${input.professional?.title ?? null},
        ${input.professional?.licenseNumber ?? null},
        ${input.professional?.licenseIssuer ?? null},
        ${input.requestId}
      )
    `;
    if (!row) throw new Error('accept_staff_invitation returned no row');
    return { organizationId: row.organization_id, membershipId: row.membership_id };
  });
}

export type StaffInvitationPreviewRow = {
  invitationId: string;
  organizationId: string;
  organizationDisplayName: string;
  email: string;
  roles: Array<'organization_owner' | 'psychologist'>;
  expiresAt: string;
  /** Server-internal: never returned to the browser (SECURITY.md §3.7). */
  existingProfileId: string | null;
};

/** SECURITY.md §3.8: pending + unexpired staff invitation for sha256(token), or null. */
export async function systemPeekStaffInvitation(
  tokenHash: Uint8Array,
): Promise<StaffInvitationPreviewRow | null> {
  return withSystemTransaction(async (tx) => {
    const [row] = await tx<
      {
        invitation_id: string;
        organization_id: string;
        organization_display_name: string;
        email: string;
        roles: Array<'organization_owner' | 'psychologist'>;
        expires_at: Date;
        existing_profile_id: string | null;
      }[]
    >`select * from app.peek_staff_invitation(${Buffer.from(tokenHash)})`;
    if (!row) return null;
    return {
      invitationId: row.invitation_id,
      organizationId: row.organization_id,
      organizationDisplayName: row.organization_display_name,
      email: row.email,
      roles: row.roles,
      expiresAt: row.expires_at.toISOString(),
      existingProfileId: row.existing_profile_id,
    };
  });
}

// -----------------------------------------------------------------------------
// Supabase Auth admin API (service role). Workstream 1.3 — every caller audits the action.
// -----------------------------------------------------------------------------

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

/**
 * ADR-021 factor reset after a recovery code was consumed in the user's own transaction:
 * removes every MFA factor of the user. Supabase Auth also ends ALL sessions of the user when
 * a verified factor is deleted, so the user signs in again and enrolls a new factor.
 * Returns the number of factors removed.
 */
export async function adminDeleteAllMfaFactors(userId: string): Promise<number> {
  const admin = getAuthAdmin();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw new Error('mfa_list_factors_failed');
  let removed = 0;
  for (const factor of data.factors) {
    const result = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (result.error) throw new Error('mfa_delete_factor_failed');
    removed += 1;
  }
  return removed;
}
