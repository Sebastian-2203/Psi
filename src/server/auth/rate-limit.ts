import 'server-only';
import { createHash } from 'node:crypto';
import { recordSystemAudit } from '@/server/audit';
import { systemConsumeRateLimit } from '@/server/db/system';

/**
 * Pre-authentication limiter (ADR-020) over the Postgres fixed-window counters
 * (`app.consume_rate_limit_key`). Keys are sha256("<action>:<kind>:<subject>") — no raw IPs
 * or emails are stored. Auth-adjacent limits FAIL CLOSED: a limiter error denies.
 * Supabase Auth's own per-IP limits (config.toml [auth.rate_limit]) apply in addition.
 *
 * Thresholds are product constants (configurable), not legal values.
 */
export const AUTH_LIMITS = {
  'auth.sign_in': {
    perIp: { limit: 50, windowSeconds: 15 * 60 },
    perSubject: { limit: 10, windowSeconds: 15 * 60 },
  },
  'auth.password_reset': {
    perIp: { limit: 20, windowSeconds: 60 * 60 },
    perSubject: { limit: 5, windowSeconds: 60 * 60 },
  },
  'auth.invitation': {
    perIp: { limit: 30, windowSeconds: 15 * 60 },
    perSubject: { limit: 10, windowSeconds: 15 * 60 },
  },
} as const;

export type AuthLimitedAction = keyof typeof AUTH_LIMITS;

export function bucketKey(action: string, kind: 'ip' | 'subject', subject: string): Uint8Array {
  return createHash('sha256').update(`${action}:${kind}:${subject}`).digest();
}

export type PreAuthLimitInput = {
  action: AuthLimitedAction;
  ip: string | null;
  /** Normalized subject (lowercased email, token hash hex, ...). */
  subject: string | null;
  requestId?: string | null;
  userAgent?: string | null;
};

/** Consumes one unit from each applicable bucket. Returns false when limited or on error. */
export async function consumePreAuthLimit(input: PreAuthLimitInput): Promise<boolean> {
  const spec = AUTH_LIMITS[input.action];
  let allowed = true;
  try {
    // Both buckets are always consumed (no short-circuit), so attempts keep counting.
    const checks: Promise<boolean>[] = [];
    if (input.ip) {
      checks.push(
        systemConsumeRateLimit(
          bucketKey(input.action, 'ip', input.ip),
          spec.perIp.limit,
          spec.perIp.windowSeconds,
        ),
      );
    }
    if (input.subject) {
      checks.push(
        systemConsumeRateLimit(
          bucketKey(input.action, 'subject', input.subject),
          spec.perSubject.limit,
          spec.perSubject.windowSeconds,
        ),
      );
    }
    const results = await Promise.all(checks);
    allowed = results.every(Boolean);
  } catch {
    allowed = false; // fail closed
  }
  if (!allowed) {
    try {
      await recordSystemAudit(
        'auth.rate_limited',
        { action: input.action },
        { requestId: input.requestId ?? null, ip: input.ip, userAgent: input.userAgent ?? null },
      );
    } catch {
      // The denial stands even if the audit write fails.
    }
  }
  return allowed;
}
