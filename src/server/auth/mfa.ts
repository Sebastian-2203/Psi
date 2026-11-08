import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAudit } from '@/server/audit';
import { withUserTransaction } from '@/server/db/server';
import { failure, ok, type Outcome } from '@/server/errors';
import { verifyAccessToken, type VerifiedClaims } from './claims';
import type { RequestMeta } from './request-meta';
import { getTotpFactors } from './session';

/**
 * TOTP enrollment and challenge (AUTH-04, SECURITY.md §3.2, F-03). All calls run on the server
 * with the cookie-bound client, so the upgraded aal2 session is written to httpOnly cookies.
 * Per-profile limits use the user-context `app.consume_rate_limit` (fail closed).
 */

const MFA_LIMITS = {
  'auth.mfa_enroll': { limit: 10, windowSeconds: 15 * 60 },
  'auth.mfa_verify': { limit: 10, windowSeconds: 15 * 60 },
} as const;

async function consumeUserLimit(
  claims: VerifiedClaims,
  action: keyof typeof MFA_LIMITS,
): Promise<boolean> {
  const spec = MFA_LIMITS[action];
  try {
    const [row] = await withUserTransaction(
      claims,
      (tx) =>
        tx<{ allowed: boolean }[]>`
        select app.consume_rate_limit(${action}, ${spec.limit}::int,
                                      make_interval(secs => ${spec.windowSeconds})) as allowed
      `,
    );
    return row?.allowed === true;
  } catch {
    return false;
  }
}

export type EnrollmentStart = {
  factorId: string;
  /** SVG data URI produced by Supabase Auth (rendered in an <img>, never inlined as markup). */
  qrCode: string;
  /** Base32 secret for manual entry. */
  secret: string;
};

export async function startTotpEnrollment(
  client: SupabaseClient,
  claims: VerifiedClaims,
): Promise<Outcome<EnrollmentStart>> {
  if (!(await consumeUserLimit(claims, 'auth.mfa_enroll'))) {
    return failure('RATE_LIMITED', { messageKey: 'auth.errors.rateLimited' });
  }
  const factors = await getTotpFactors(client);
  // A verified factor exists: adding another needs aal2 (Supabase Auth enforces it as well).
  if (factors.verifiedFactorId && claims.aal !== 'aal2') {
    return failure('MFA_REQUIRED', { messageKey: 'auth.errors.mfaAlreadyEnrolled' });
  }
  for (const id of factors.unverifiedFactorIds) {
    await client.auth.mfa.unenroll({ factorId: id }).catch(() => undefined);
  }
  const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp' });
  if (error || !data || data.type !== 'totp') return failure('INTERNAL');
  return ok({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
}

async function challengeAndVerify(
  client: SupabaseClient,
  claims: VerifiedClaims,
  factorId: string,
  code: string,
  meta: RequestMeta,
  successEvent: 'auth.mfa_enrolled' | 'auth.mfa_verified',
): Promise<Outcome<{ claims: VerifiedClaims }>> {
  if (!(await consumeUserLimit(claims, 'auth.mfa_verify'))) {
    return failure('RATE_LIMITED', { messageKey: 'auth.errors.rateLimited' });
  }
  const { data, error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
  const upgraded = !error && data ? await verifyAccessToken(data.access_token) : null;
  if (!upgraded || upgraded.aal !== 'aal2') {
    await withUserTransaction(claims, (tx) =>
      recordAudit(tx, 'auth.mfa_failed', { factor_id: factorId }, { requestId: meta.requestId }),
    ).catch(() => undefined);
    return failure('VALIDATION_FAILED', {
      messageKey: 'auth.errors.invalidCode',
      fieldErrors: { code: ['codeInvalid'] },
    });
  }
  await withUserTransaction(upgraded, (tx) =>
    recordAudit(tx, successEvent, { factor_id: factorId }, { requestId: meta.requestId }),
  );
  return ok({ claims: upgraded });
}

/** Completes enrollment: the first successful verification also upgrades the session to aal2. */
export async function verifyTotpEnrollment(
  client: SupabaseClient,
  claims: VerifiedClaims,
  input: { factorId: string; code: string },
  meta: RequestMeta,
): Promise<Outcome<{ claims: VerifiedClaims }>> {
  const factors = await getTotpFactors(client);
  if (!factors.unverifiedFactorIds.includes(input.factorId)) {
    return failure('PRECONDITION_FAILED', { messageKey: 'auth.errors.enrollmentExpired' });
  }
  return challengeAndVerify(client, claims, input.factorId, input.code, meta, 'auth.mfa_enrolled');
}

/** aal1 -> aal2 step-up with the user's verified TOTP factor. */
export async function verifyTotpChallenge(
  client: SupabaseClient,
  claims: VerifiedClaims,
  code: string,
  meta: RequestMeta,
): Promise<Outcome<{ claims: VerifiedClaims }>> {
  const factors = await getTotpFactors(client);
  if (!factors.verifiedFactorId) {
    return failure('PRECONDITION_FAILED', { messageKey: 'auth.errors.noFactor' });
  }
  return challengeAndVerify(
    client,
    claims,
    factors.verifiedFactorId,
    code,
    meta,
    'auth.mfa_verified',
  );
}
