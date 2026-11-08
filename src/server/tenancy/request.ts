import 'server-only';
import { headers } from 'next/headers';
import { cache } from 'react';
import { env } from '@/server/env';
import { normalizeHost, resolveOrganizationIdByHost } from './host';

/**
 * Tenant scope of the current request (ADR-017), resolved on the server from the Host header
 * — the server-only mechanism replacing a forwarded `x-org-hint` header (the proxy strips
 * every inbound `x-org-*`). It RESTRICTS, never grants: on a tenant host, getAuthzContext()
 * only considers the caller's capacities in that organization.
 *
 * - `app`: the application's own host (APP_BASE_DOMAIN; plus localhost/127.0.0.1 outside
 *   production) — no tenant restriction.
 * - `tenant`: a verified `organization_domains` host of a non-closed organization.
 * - `unknown`: anything else (unverified/unknown subdomain, malformed host) — no capacity
 *   matches, so staff routes deny.
 */
export type HostScope =
  { kind: 'app' } | { kind: 'tenant'; organizationId: string } | { kind: 'unknown' };

function bareHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw
    .trim()
    .toLowerCase()
    .replace(/:\d{1,5}$/, '')
    .replace(/\.$/, '');
  return host.length > 0 ? host : null;
}

export async function resolveHostScope(
  rawHost: string | null | undefined,
  options: { baseDomain?: string; production?: boolean } = {},
): Promise<HostScope> {
  const baseDomain = (options.baseDomain ?? env.APP_BASE_DOMAIN).toLowerCase();
  const production = options.production ?? env.NODE_ENV === 'production';
  const bare = bareHost(rawHost);
  if (!bare) return { kind: 'unknown' };
  if (bare === baseDomain) return { kind: 'app' };
  if (!production && (bare === 'localhost' || bare === '127.0.0.1')) return { kind: 'app' };
  if (!normalizeHost(rawHost)) return { kind: 'unknown' };
  const organizationId = await resolveOrganizationIdByHost(rawHost);
  return organizationId ? { kind: 'tenant', organizationId } : { kind: 'unknown' };
}

/**
 * Combines the scopes of `x-forwarded-host` and `Host` and keeps the MORE RESTRICTIVE one:
 * both app -> app; one tenant (other app or same tenant) -> that tenant; anything else ->
 * unknown. Next.js itself renders server-action redirects with an internal Host and the real
 * host in x-forwarded-host, and its CSRF Origin check also prefers x-forwarded-host. A forged
 * header can therefore only narrow the caller's own capacities, never widen them.
 */
export function combineHostScopes(scopes: HostScope[]): HostScope {
  const restricted = scopes.filter((s) => s.kind !== 'app');
  if (restricted.length === 0) return { kind: 'app' };
  const [first] = restricted;
  if (
    first?.kind === 'tenant' &&
    restricted.every((s) => s.kind === 'tenant' && s.organizationId === first.organizationId)
  ) {
    return first;
  }
  return { kind: 'unknown' };
}

/** Per-request memoized host scope. */
export const getRequestHostScope = cache(async (): Promise<HostScope> => {
  const h = await headers();
  const forwarded = h.get('x-forwarded-host')?.split(',')[0]?.trim() || null;
  const candidates = [...new Set([forwarded, h.get('host')].filter((v): v is string => !!v))];
  if (candidates.length === 0) return { kind: 'unknown' };
  return combineHostScopes(await Promise.all(candidates.map((c) => resolveHostScope(c))));
});
