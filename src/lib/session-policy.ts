/**
 * Session lifetime policy (SECURITY.md §3.5). Configurable product constants, not legal values.
 * Enforced app-side in src/proxy.ts AND src/server/auth/claims.ts (getVerifiedClaims) through the
 * signed activity cookie (src/lib/session-activity.ts); Supabase Auth `[auth.sessions]` is a backstop.
 *
 * Phase 1 only has staff/platform identities, so the staff limits apply to every session.
 * Portal limits (idle 30 min / absolute 7 days, [NEEDS PSYCHOLOGIST INPUT]) need a
 * per-capacity policy when portal identities arrive (Phase 2).
 */
export const SESSION_POLICY = {
  staff: { idleSeconds: 15 * 60, absoluteSeconds: 12 * 60 * 60 },
} as const;

/** Host-only, httpOnly, HMAC-signed cookie with the last request time of a session (P1-02). */
export const ACTIVITY_COOKIE = 'psi_activity';

type AmrEntry = { method?: unknown; timestamp?: unknown };

/** Start of the session = earliest authentication method timestamp in the verified `amr` claim. */
export function sessionStartedAt(claims: { amr?: unknown; iat?: unknown }): number | null {
  const amr = Array.isArray(claims.amr) ? (claims.amr as AmrEntry[]) : [];
  const stamps = amr
    .map((entry) => entry.timestamp)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  if (stamps.length > 0) return Math.min(...stamps);
  return typeof claims.iat === 'number' ? claims.iat : null;
}

export type SessionExpiry = 'active' | 'idle' | 'absolute';

/**
 * Pure limit check (unit tested). `lastActivity` null = no idle check here; callers must use
 * decideSessionExpiry() (session-activity.ts), which treats a missing/invalid cookie as idle.
 */
export function evaluateSessionExpiry(
  startedAt: number | null,
  lastActivity: number | null,
  now: number,
  policy: { idleSeconds: number; absoluteSeconds: number } = SESSION_POLICY.staff,
): SessionExpiry {
  if (startedAt !== null && now - startedAt > policy.absoluteSeconds) return 'absolute';
  if (lastActivity !== null && now - lastActivity > policy.idleSeconds) return 'idle';
  return 'active';
}
