import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { cache } from 'react';
import { z } from 'zod';
import { ACTIVITY_COOKIE, evaluateActivityCookie } from '@/lib/session-activity';
import type { SessionExpiry } from '@/lib/session-policy';
import { env } from '@/server/env';
import { createRequestAuthClient } from './supabase';

/**
 * The ONLY producer of verified JWT claims (ADR-019 Option A). The DB layer accepts claims
 * exclusively as `VerifiedClaims` and re-checks at runtime that the object was produced here
 * (`assertVerifiedClaims`), so a hand-built object — even one cast to the type — is refused.
 *
 * Verification of an access token (both steps must pass):
 * 1. `auth.getClaims(token)` — verifies the signature locally against the project JWKS for
 *    asymmetric keys (ES256/RS256; the local stack uses ES256) and checks `exp`. For legacy
 *    symmetric (HS256) projects supabase-js falls back to `getUser()`.
 * 2. `auth.getUser(token)` — round-trip to Supabase Auth, which rejects deleted/banned users
 *    and revoked sessions (sign-out, admin revocation); the returned user id must equal `sub`.
 *    ARCHITECTURE §7 rule 1: never trust `getSession()` alone.
 */

declare const verifiedClaimsBrand: unique symbol;

const claimsSchema = z
  .object({
    sub: z.uuid(),
    role: z.literal('authenticated'),
    aal: z.enum(['aal1', 'aal2']),
    session_id: z.uuid(),
    exp: z.number().int().positive(),
    iat: z.number().int().positive(),
    is_anonymous: z.boolean().optional(),
    amr: z
      .array(z.object({ method: z.string().max(64), timestamp: z.number().int() }))
      .max(16)
      .optional(),
  })
  .loose();

export type VerifiedClaims = {
  readonly sub: string;
  readonly aal: 'aal1' | 'aal2';
  readonly sessionId: string;
  readonly expiresAt: number;
  /** Most recent MFA verification (unix seconds), for "recent MFA" checks on high-risk actions. */
  readonly mfaVerifiedAt: number | null;
  /** The full verified payload, set as `request.jwt.claims` (same as PostgREST would). */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly [verifiedClaimsBrand]: true;
};

const issued = new WeakSet<object>();

/** Throws unless `claims` was produced by this module in this process. */
export function assertVerifiedClaims(claims: unknown): asserts claims is VerifiedClaims {
  if (typeof claims !== 'object' || claims === null || !issued.has(claims)) {
    throw new Error('Unverified claims passed to the database layer.');
  }
  const { expiresAt } = claims as VerifiedClaims;
  if (expiresAt * 1000 <= Date.now()) {
    throw new Error('Expired claims passed to the database layer.');
  }
}

let verifierClient: SupabaseClient | undefined;

/** Stateless client (no session storage) reused so the JWKS cache survives across requests. */
function getVerifierClient(): SupabaseClient {
  verifierClient ??= createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return verifierClient;
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * Verifies an access token and returns branded claims, or null when it is invalid, expired,
 * anonymous, revoked or not an `authenticated` user token. Never throws on bad input.
 */
export async function verifyAccessToken(accessToken: string): Promise<VerifiedClaims | null> {
  if (
    typeof accessToken !== 'string' ||
    accessToken.length > 8192 ||
    !JWT_SHAPE.test(accessToken)
  ) {
    return null;
  }
  const client = getVerifierClient();

  const { data: claimsData, error: claimsError } = await client.auth.getClaims(accessToken);
  if (claimsError || !claimsData) return null;

  const { data: userData, error: userError } = await client.auth.getUser(accessToken);
  if (userError || !userData.user) return null;

  const parsed = claimsSchema.safeParse(claimsData.claims);
  if (!parsed.success) return null;
  const payload = parsed.data;
  if (payload.is_anonymous === true) return null;
  if (userData.user.id !== payload.sub) return null;
  if (payload.exp * 1000 <= Date.now()) return null;

  const mfaTimestamps = (payload.amr ?? [])
    .filter((entry) => entry.method === 'totp' || entry.method.startsWith('mfa/'))
    .map((entry) => entry.timestamp);

  const claims = Object.freeze({
    sub: payload.sub,
    aal: payload.aal,
    sessionId: payload.session_id,
    expiresAt: payload.exp,
    mfaVerifiedAt: mfaTimestamps.length > 0 ? Math.max(...mfaTimestamps) : null,
    payload: Object.freeze({ ...payload }),
  }) as unknown as VerifiedClaims;
  issued.add(claims);
  return claims;
}

/**
 * Session lifetime check for a verified token (SECURITY.md §3.5, P1-02): absolute limit from
 * `amr`, idle limit from the HMAC-signed activity cookie bound to `session_id`. Same decision as
 * src/proxy.ts, re-applied server-side so EVERY entry point (pages, Server Actions, route
 * handlers, also if the proxy is bypassed or misconfigured) fails closed.
 */
export async function sessionExpiryFor(
  claims: VerifiedClaims,
  activityCookieValue: string | undefined | null,
  now: number = Math.floor(Date.now() / 1000),
): Promise<SessionExpiry> {
  return evaluateActivityCookie({
    secret: env.SESSION_ACTIVITY_SECRET,
    cookieValue: activityCookieValue,
    claims: claims.payload,
    now,
  });
}

/**
 * Verified claims for the current request, from the Supabase SSR cookie session.
 * Memoized per request with React `cache()`. Returns null when signed out, invalid, or past the
 * idle/absolute limits (the proxy has already revoked such sessions at Supabase Auth; here
 * the session is simply not honoured). Session refresh is done by src/proxy.ts before
 * rendering; the cookie client uses the shared httpOnly cookie options.
 */
export const getVerifiedClaims = cache(async (): Promise<VerifiedClaims | null> => {
  const supabase = await createRequestAuthClient();
  // getSession() only reads (and may refresh) the cookie; the token is then verified above.
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const claims = token ? await verifyAccessToken(token) : null;
  if (!claims) return null;
  const activity = (await cookies()).get(ACTIVITY_COOKIE)?.value;
  return (await sessionExpiryFor(claims, activity)) === 'active' ? claims : null;
});
