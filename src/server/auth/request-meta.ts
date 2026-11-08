import 'server-only';
import { headers } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { env } from '@/server/env';

export type RequestMeta = {
  requestId: string;
  /** Client IP for rate limiting/audit. Trusted only as far as the hosting edge sets it. */
  ip: string | null;
  userAgent: string | null;
  /** Request host (x-forwarded-host, else Host), lowercase, may include port. */
  host: string | null;
  /** Origin used to build links in emails. Its host must be allowlisted by Supabase Auth. */
  origin: string | null;
};

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const HOST = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/;

export type TrustedProxyMode = 'vercel' | 'xff' | 'none';
export type TrustedProxyConfig = { mode: TrustedProxyMode; hops: number };

/**
 * Trusted-proxy assumption (SECURITY.md §14 P1-03). VERIFY PER DEPLOYMENT: the chosen mode must
 * match what the edge in front of the app actually does, or per-IP pre-auth limits become
 * bypassable and audit IPs forgeable (per-subject limits still hold).
 * Default: `vercel` when running on Vercel (`VERCEL=1`), else `xff` with 1 hop.
 */
export function trustedProxyFromEnv(
  source: { TRUSTED_PROXY?: TrustedProxyMode; TRUSTED_PROXY_HOPS?: number; VERCEL?: string } = env,
): TrustedProxyConfig {
  const mode = source.TRUSTED_PROXY ?? (source.VERCEL === '1' ? 'vercel' : 'xff');
  return { mode, hops: source.TRUSTED_PROXY_HOPS ?? 1 };
}

function validIp(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  return candidate && isIP(candidate) ? candidate : null;
}

/**
 * Pure: the client IP under the trusted-proxy config (unit tested).
 * - `vercel`: `x-vercel-forwarded-for` (first entry), else `x-real-ip`. Both are set by the
 *   Vercel edge (per Vercel docs at the time of writing — verify per deployment).
 * - `xff`: "rightmost untrusted hop". Each of the `hops` trusted proxies APPENDS the address it
 *   received the connection from, so the client is the entry at `length - hops`; entries to its
 *   left are client-supplied and ignored. Fewer entries than hops -> null (misconfiguration).
 *   With no proxy at all (plain `next start`), Next fills X-Forwarded-For with the socket address
 *   only when absent, so a direct client can choose it — acceptable for local development only.
 * - `none`: null.
 */
export function clientIpFromHeaders(h: Headers, config: TrustedProxyConfig): string | null {
  if (config.mode === 'none') return null;
  if (config.mode === 'vercel') {
    return validIp(h.get('x-vercel-forwarded-for')?.split(',')[0]) ?? validIp(h.get('x-real-ip'));
  }
  const hops = (h.get('x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (hops.length < config.hops) return null;
  return validIp(hops[hops.length - config.hops]);
}

/**
 * Pure: derives request metadata from headers.
 * Link scheme (P1-13): always `https` in production, except loopback hosts (local
 * `next start` / E2E); `x-forwarded-proto` is only honoured outside production.
 */
export function requestMetaFromHeaders(
  h: Headers,
  nodeEnv: string = env.NODE_ENV,
  proxy: TrustedProxyConfig = trustedProxyFromEnv(),
): RequestMeta {
  const rawId = h.get('x-request-id');
  // Same precedence as Next.js' own Server Action Origin check (x-forwarded-host, then Host).
  const rawHost =
    (h.get('x-forwarded-host')?.split(',')[0] || h.get('host'))?.trim().toLowerCase() ?? null;
  const host = rawHost && HOST.test(rawHost) ? rawHost : null;
  const forwardedProto = h.get('x-forwarded-proto')?.split(',')[0]?.trim();
  let scheme: 'http' | 'https';
  if (nodeEnv === 'production') {
    scheme = host && LOOPBACK_HOST.test(host) && forwardedProto === 'http' ? 'http' : 'https';
  } else {
    scheme = forwardedProto === 'https' ? 'https' : 'http';
  }
  return {
    requestId: rawId && REQUEST_ID.test(rawId) ? rawId : randomUUID(),
    ip: clientIpFromHeaders(h, proxy),
    userAgent: h.get('user-agent')?.slice(0, 512) ?? null,
    host,
    origin: host ? `${scheme}://${host}` : null,
  };
}

export async function getRequestMeta(): Promise<RequestMeta> {
  return requestMetaFromHeaders(await headers());
}
