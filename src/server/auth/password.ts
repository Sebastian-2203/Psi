import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAudit, recordSystemAudit } from '@/server/audit';
import { withUserTransaction } from '@/server/db/server';
import { failure, ok, type Outcome } from '@/server/errors';
import type { HostScope } from '@/server/tenancy/request';
import type { VerifiedClaims } from './claims';
import { consumePreAuthLimit } from './rate-limit';
import type { RequestMeta } from './request-meta';
import { createStatelessAuthClient } from './supabase';

/**
 * Password recovery (AUTH-03, SECURITY.md §3.5).
 *
 * Request: identical response for known and unknown emails; Supabase Auth sends the email
 * (template supabase/templates/recovery.html) with a single-use token_hash link (<= 1 h) to
 * /api/auth/confirm/<locale> on the SAME host, which must be in the Auth redirect allowlist.
 *
 * Completion: Supabase Auth requires aal2 to change the password of an MFA user, so staff
 * pass the TOTP challenge after following the link (a stolen mailbox alone is not enough).
 * On success every other session is revoked and auth.password_reset is audited.
 */

export function recoveryRedirectUrl(
  meta: RequestMeta,
  hostScope: HostScope,
  locale: 'es' | 'en',
): string | null {
  if (!meta.origin || hostScope.kind === 'unknown') return null;
  return `${meta.origin}/api/auth/confirm/${locale}`;
}

export async function requestPasswordReset(
  email: string,
  redirectTo: string | null,
  meta: RequestMeta,
): Promise<Outcome<void>> {
  const allowed = await consumePreAuthLimit({
    action: 'auth.password_reset',
    ip: meta.ip,
    subject: email,
    requestId: meta.requestId,
    userAgent: meta.userAgent,
  });
  if (!allowed) return failure('RATE_LIMITED', { messageKey: 'auth.errors.rateLimited' });
  if (redirectTo) {
    // Errors (unknown email, Auth email quota) are swallowed: the response never differs.
    await createStatelessAuthClient()
      .auth.resetPasswordForEmail(email, { redirectTo })
      .catch(() => undefined);
  }
  return ok(undefined);
}

/** Exchanges the emailed token_hash for a session (cookies written by `client`). */
export async function confirmRecoveryToken(
  client: SupabaseClient,
  tokenHash: string,
): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(tokenHash)) return false;
  const { data, error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
  return !error && data.session !== null;
}

export async function completePasswordReset(
  client: SupabaseClient,
  claims: VerifiedClaims,
  password: string,
  meta: RequestMeta,
): Promise<Outcome<void>> {
  const { error } = await client.auth.updateUser({ password });
  if (error) {
    if (error.code === 'insufficient_aal') return failure('MFA_REQUIRED');
    if (error.code === 'weak_password' || error.code === 'same_password') {
      return failure('VALIDATION_FAILED', {
        messageKey:
          error.code === 'same_password' ? 'auth.errors.samePassword' : 'auth.errors.weakPassword',
        fieldErrors: { password: ['passwordWeak'] },
      });
    }
    if (error.code === 'reauthentication_needed') {
      return failure('PRECONDITION_FAILED', { messageKey: 'auth.errors.resetLinkExpired' });
    }
    return failure('INTERNAL');
  }
  await withUserTransaction(claims, (tx) =>
    recordAudit(tx, 'auth.password_reset', {}, { requestId: meta.requestId }),
  );
  const revoked = await client.auth.signOut({ scope: 'others' });
  if (!revoked.error) {
    await recordSystemAudit(
      'auth.session_revoked',
      { scope: 'others' },
      {
        actorProfileId: claims.sub,
        requestId: meta.requestId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    ).catch(() => undefined);
  }
  return ok(undefined);
}
