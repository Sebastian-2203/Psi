import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAudit, recordSystemAudit } from '@/server/audit';
import { withUserTransaction } from '@/server/db/server';
import { failure, ok, type Outcome } from '@/server/errors';
import { verifyAccessToken, type VerifiedClaims } from './claims';
import { consumePreAuthLimit } from './rate-limit';
import type { RequestMeta } from './request-meta';
import { getTotpFactors, requiresMfa } from './session';

export type PostSignInStep = 'mfa' | 'mfa_enroll' | 'app';

/** Where an authenticated aal1 session goes next (single place for the rule). */
export async function nextStepAfterPassword(
  client: SupabaseClient,
  claims: VerifiedClaims,
): Promise<PostSignInStep> {
  const factors = await getTotpFactors(client);
  if (factors.verifiedFactorId) return claims.aal === 'aal2' ? 'app' : 'mfa';
  return (await requiresMfa(claims)) ? 'mfa_enroll' : 'app';
}

/**
 * Email + password sign-in (AUTH-01). Generic failure for unknown email, wrong password and
 * unconfirmed email alike (SECURITY.md §3.7). Rate limited per IP and per email (ADR-020,
 * fail closed) on top of Supabase Auth limits. Audited: auth.signed_in (user path, after the
 * token is verified) / auth.sign_in_failed (system path, no actor).
 */
export async function signInWithPassword(
  client: SupabaseClient,
  input: { email: string; password: string },
  meta: RequestMeta,
): Promise<Outcome<{ claims: VerifiedClaims; step: PostSignInStep }>> {
  const allowed = await consumePreAuthLimit({
    action: 'auth.sign_in',
    ip: meta.ip,
    subject: input.email,
    requestId: meta.requestId,
    userAgent: meta.userAgent,
  });
  if (!allowed) return failure('RATE_LIMITED', { messageKey: 'auth.errors.rateLimited' });

  const { data, error } = await client.auth.signInWithPassword(input);
  // Supabase Auth's own per-IP limit: same response class as ours (not a credential error).
  if (error?.status === 429 || error?.code === 'over_request_rate_limit') {
    return failure('RATE_LIMITED', { messageKey: 'auth.errors.rateLimited' });
  }
  const claims = !error && data.session ? await verifyAccessToken(data.session.access_token) : null;
  if (!claims) {
    await recordSystemAudit(
      'auth.sign_in_failed',
      { method: 'password' },
      { requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent },
    ).catch(() => undefined);
    if (data.session) await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return failure('UNAUTHENTICATED', { messageKey: 'auth.errors.invalidCredentials' });
  }

  await withUserTransaction(claims, (tx) =>
    recordAudit(tx, 'auth.signed_in', { method: 'password' }, { requestId: meta.requestId }),
  );
  return ok({ claims, step: await nextStepAfterPassword(client, claims) });
}

/** Sign-out (revokes THIS session's refresh token at Supabase Auth). Audited first. */
export async function signOutCurrentSession(
  client: SupabaseClient,
  claims: VerifiedClaims | null,
  meta: RequestMeta,
): Promise<void> {
  if (claims) {
    await withUserTransaction(claims, (tx) =>
      recordAudit(tx, 'auth.signed_out', {}, { requestId: meta.requestId }),
    ).catch(() => undefined);
  }
  await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
}
