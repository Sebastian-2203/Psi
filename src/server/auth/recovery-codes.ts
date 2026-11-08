import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  RECOVERY_CODE_LENGTH,
} from '@/lib/recovery-codes';
import { recordSystemAudit } from '@/server/audit';
import { adminDeleteAllMfaFactors } from '@/server/db/admin';
import { withUserTransaction } from '@/server/db/server';
import { failure, ok, toAppError, type Outcome } from '@/server/errors';
import type { VerifiedClaims } from './claims';
import { sendEmail } from './mailer';
import type { RequestMeta } from './request-meta';

/**
 * App-managed MFA recovery codes (ADR-021; native GoTrue codes exist behind a flag and are
 * deliberately not used). Generated here with a CSPRNG; hashed with bcrypt and compared in
 * the database (`app.replace_recovery_codes`, `app.consume_recovery_code`); shown once.
 */

const RECENT_MFA_SECONDS = 15 * 60;

/** 10 codes x 16 symbols of a 32-symbol alphabet = 80 bits each (unbiased: 32 divides 256). */
export function generateRecoveryCodeSet(): string[] {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) {
    const bytes = randomBytes(RECOVERY_CODE_LENGTH);
    let code = '';
    for (const byte of bytes) code += RECOVERY_CODE_ALPHABET[byte & 31];
    codes.add(code);
  }
  return [...codes];
}

/** Display format XXXX-XXXX-XXXX-XXXX (input accepts it with or without dashes). */
export function formatRecoveryCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

export type RecoveryCodesStatus = { remaining: number; total: number; createdAt: string } | null;

export async function getRecoveryCodesStatus(claims: VerifiedClaims): Promise<RecoveryCodesStatus> {
  const [row] = await withUserTransaction(
    claims,
    (tx) =>
      tx<{ remaining: number; total: number; created_at: Date }[]>`
      select remaining, total, created_at from app.my_recovery_codes_status()
    `,
  );
  return row
    ? { remaining: row.remaining, total: row.total, createdAt: row.created_at.toISOString() }
    : null;
}

/** aal2 with a TOTP verification within the last 15 minutes (verified `amr` claim). */
export function hasRecentMfa(claims: VerifiedClaims, now: number = Date.now()): boolean {
  return (
    claims.aal === 'aal2' &&
    claims.mfaVerifiedAt !== null &&
    now / 1000 - claims.mfaVerifiedAt <= RECENT_MFA_SECONDS
  );
}

/** Regeneration requires aal2 + MFA within 15 min (checked here AND in the database). */
export async function regenerateRecoveryCodes(
  claims: VerifiedClaims,
  now: number = Date.now(),
): Promise<Outcome<{ codes: string[] }>> {
  if (!hasRecentMfa(claims, now)) {
    return failure('MFA_REQUIRED', { messageKey: 'errors.recentMfaRequired' });
  }
  const codes = generateRecoveryCodeSet();
  try {
    await withUserTransaction(
      claims,
      (tx) => tx`select app.replace_recovery_codes(${codes}::text[])`,
    );
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
  return ok({ codes: codes.map(formatRecoveryCode) });
}

/**
 * ADR-021 "use a code": password already verified (aal1). On success the database marks the
 * code used (audited auth.recovery_code_used), the Auth admin API removes every factor
 * (auth.mfa_reset) and ALL of the user's sessions are revoked with the user's own client
 * (`signOut({ scope: 'global' })`, auth.session_revoked) — deleting a factor alone does not end
 * existing aal2 sessions. The user signs in again and must enroll a new factor; notified by email.
 */
export async function redeemRecoveryCode(
  client: SupabaseClient,
  claims: VerifiedClaims,
  code: string,
  meta: RequestMeta,
  notice?: { subject: string; text: string },
): Promise<Outcome<{ factorsRemoved: number }>> {
  let status: string | undefined;
  try {
    const [row] = await withUserTransaction(
      claims,
      (tx) => tx<{ status: string }[]>`select status from app.consume_recovery_code(${code})`,
    );
    status = row?.status;
  } catch {
    status = 'error';
  }
  if (status === 'rate_limited') {
    return failure('RATE_LIMITED', { messageKey: 'auth.errors.rateLimited' });
  }
  if (status !== 'ok') {
    return failure('VALIDATION_FAILED', {
      messageKey: 'auth.errors.invalidRecoveryCode',
      fieldErrors: { code: ['recoveryCodeInvalid'] },
    });
  }

  const auditTarget = {
    actorProfileId: claims.sub,
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
  let removed: number;
  try {
    removed = await adminDeleteAllMfaFactors(claims.sub);
  } catch {
    // The code is spent; the user may use another one. Nothing was reset.
    return failure('INTERNAL');
  }
  await recordSystemAudit('auth.mfa_reset', { via: 'recovery_code' }, auditTarget);
  const revoked = await client.auth.signOut({ scope: 'global' });
  if (revoked.error) return failure('INTERNAL', { detail: 'revoke_sessions_failed' });
  await recordSystemAudit('auth.session_revoked', { scope: 'global' }, auditTarget).catch(
    () => undefined,
  );

  const email = typeof claims.payload.email === 'string' ? claims.payload.email : null;
  if (email && notice) {
    await sendEmail({ to: email, ...notice }).catch(() => undefined);
  }
  return ok({ factorsRemoved: removed });
}
