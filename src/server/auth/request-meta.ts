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

/**
 * Pure: derives request metadata from headers. `x-forwarded-for` is taken from its FIRST hop
 * because the hosting edge (Vercel) overwrites it; behind any other proxy this must be revisited.
 */
export function requestMetaFromHeaders(h: Headers, nodeEnv: string = env.NODE_ENV): RequestMeta {
  const rawId = h.get('x-request-id');
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const realIp = h.get('x-real-ip')?.trim() ?? null;
  const ipCandidate = forwarded || realIp;
  const ip = ipCandidate && isIP(ipCandidate) ? ipCandidate : null;
  // Same precedence as Next.js' own Server Action Origin check (x-forwarded-host, then Host).
  const rawHost =
    (h.get('x-forwarded-host')?.split(',')[0] || h.get('host'))?.trim().toLowerCase() ?? null;
  const host = rawHost && HOST.test(rawHost) ? rawHost : null;
  const proto = nodeEnv === 'production' ? 'https' : 'http';
  const forwardedProto = h.get('x-forwarded-proto');
  const scheme = forwardedProto === 'https' || forwardedProto === 'http' ? forwardedProto : proto;
  return {
    requestId: rawId && REQUEST_ID.test(rawId) ? rawId : randomUUID(),
    ip,
    userAgent: h.get('user-agent')?.slice(0, 512) ?? null,
    host,
    origin: host ? `${scheme}://${host}` : null,
  };
}

export async function getRequestMeta(): Promise<RequestMeta> {
  return requestMetaFromHeaders(await headers());
}
