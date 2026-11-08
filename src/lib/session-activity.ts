/**
 * Signed session-activity cookie (SECURITY.md §3.5, §14 P1-02). Web Crypto only, so the same
 * code runs in src/proxy.ts and on the server (src/server/auth/claims.ts). No secrets here:
 * callers pass the HMAC key (SESSION_ACTIVITY_SECRET, validated in src/server/env.ts).
 *
 * Value: `v1.<session_id>.<unix seconds>.<base64url HMAC-SHA256("psi-activity|v1|sid|ts")>`.
 * Bound to the Supabase `session_id` claim, so a cookie from another session never applies.
 *
 * Fail closed: a missing, malformed, forged or other-session cookie on an authenticated session
 * counts as IDLE, except right after an authentication event (`amr` timestamp within
 * FRESH_AUTH_GRACE_SECONDS): the first request after sign-in / MFA / recovery link has no
 * cookie yet. That grace never extends a session — it only applies while the latest
 * authentication itself is that recent.
 */
import {
  ACTIVITY_COOKIE,
  evaluateSessionExpiry,
  SESSION_POLICY,
  sessionStartedAt,
  type SessionExpiry,
} from './session-policy';

export { ACTIVITY_COOKIE };

export const FRESH_AUTH_GRACE_SECONDS = 120;
/** Accepted clock skew for a cookie timestamp in the future. */
const MAX_FUTURE_SKEW_SECONDS = 60;
const MIN_SECRET_LENGTH = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const encoder = new TextEncoder();
const keyCache = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    keyCache.clear(); // one live key per process (rotation replaces it)
    keyCache.set(secret, key);
  }
  return key;
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null; // 32-byte MAC
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '=');
  const out = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function payload(sessionId: string, timestamp: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(`psi-activity|v1|${sessionId.toLowerCase()}|${timestamp}`);
}

/** Returns the secret when usable, else null (callers then fail closed). */
export function usableActivitySecret(secret: string | undefined | null): string | null {
  return typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export async function signActivity(
  secret: string,
  sessionId: string,
  timestamp: number,
): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), payload(sessionId, timestamp));
  return `v1.${sessionId.toLowerCase()}.${timestamp}.${toBase64Url(mac)}`;
}

/**
 * Last-activity time (unix s) from a cookie value, or null when missing, malformed, forged,
 * bound to another session, or too far in the future. Constant-time MAC check (subtle.verify).
 */
export async function verifyActivity(
  secret: string | null,
  value: string | undefined | null,
  sessionId: string,
  now: number,
): Promise<number | null> {
  if (!secret || typeof value !== 'string' || value.length > 200) return null;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, sid, rawTs, rawMac] = parts as [string, string, string, string];
  if (!UUID.test(sid) || sid.toLowerCase() !== sessionId.toLowerCase()) return null;
  if (!/^\d{1,12}$/.test(rawTs)) return null;
  const timestamp = Number(rawTs);
  if (timestamp <= 0 || timestamp > now + MAX_FUTURE_SKEW_SECONDS) return null;
  const mac = fromBase64Url(rawMac);
  if (!mac) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), mac, payload(sid, timestamp));
  return ok ? timestamp : null;
}

type AmrEntry = { method?: unknown; timestamp?: unknown };

/** Most recent authentication event (unix s) in the verified `amr` claim, or null. */
export function latestAuthenticationAt(claims: { amr?: unknown }): number | null {
  const amr = Array.isArray(claims.amr) ? (claims.amr as AmrEntry[]) : [];
  const stamps = amr
    .map((entry) => entry.timestamp)
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  return stamps.length > 0 ? Math.max(...stamps) : null;
}

/**
 * Pure decision (unit tested), shared by the proxy and getVerifiedClaims():
 * absolute limit from the earliest `amr`, idle limit from the VERIFIED activity timestamp;
 * no verified timestamp -> active only within the fresh-authentication grace, else `idle`.
 */
export function decideSessionExpiry(
  claims: { amr?: unknown; iat?: unknown },
  verifiedLastActivity: number | null,
  now: number,
  policy: { idleSeconds: number; absoluteSeconds: number } = SESSION_POLICY.staff,
): SessionExpiry {
  const started = sessionStartedAt(claims);
  if (started === null) return 'absolute'; // no authentication time at all: refuse
  const base = evaluateSessionExpiry(started, verifiedLastActivity, now, policy);
  if (base !== 'active' || verifiedLastActivity !== null) return base;
  const latest = latestAuthenticationAt(claims);
  return latest !== null && now - latest >= -MAX_FUTURE_SKEW_SECONDS &&
    now - latest <= FRESH_AUTH_GRACE_SECONDS
    ? 'active'
    : 'idle';
}

/** Verifies the cookie and decides in one step. */
export async function evaluateActivityCookie(input: {
  secret: string | null;
  cookieValue: string | undefined | null;
  claims: { amr?: unknown; iat?: unknown; session_id?: unknown };
  now: number;
}): Promise<SessionExpiry> {
  const sessionId = typeof input.claims.session_id === 'string' ? input.claims.session_id : '';
  const last = await verifyActivity(input.secret, input.cookieValue, sessionId, input.now);
  return decideSessionExpiry(input.claims, last, input.now);
}
