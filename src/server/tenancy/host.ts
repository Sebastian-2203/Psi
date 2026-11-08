import 'server-only';
import {
  systemGetPublicBranding,
  systemResolveOrganizationIdByHost,
  type PublicBrandingRow,
} from '@/server/db/system';

/**
 * Host-based tenant resolution (ADR-017), DB side only.
 *
 * Integration (workstream 1.3): the proxy strips inbound `x-org-*` (F-16); the server resolves
 * the host itself in ./request.ts (`getRequestHostScope`), so no org hint header is forwarded.
 * Original proxy contract, kept for reference:
 *   1. delete every inbound `x-org-*` header (F-16);
 *   2. `const orgId = await resolveOrganizationIdByHost(request.headers.get('host'))`;
 *   3. if orgId, set `x-org-hint: <orgId>` on the forwarded request.
 * The hint is UNTRUSTED: getAuthzContext() only uses it to choose among the caller's own
 * capacities loaded from the DB. Requires the Node.js runtime (postgres.js).
 *
 * Only verified hosts of non-closed organizations resolve. The host -> id map (ids only, no
 * PHI) is cached in-process for a short TTL, which ARCHITECTURE §13 (F-17) allows.
 */

const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 1_000;

const cache = new Map<string, { orgId: string | null; expires: number }>();

/** Lowercases, strips the port and a trailing dot; returns null for anything not a hostname. */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.trim().toLowerCase();
  if (host.startsWith('[')) return null; // IPv6 literal: never a tenant host
  const colon = host.indexOf(':');
  if (colon !== -1) {
    const port = host.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port)) return null;
    host = host.slice(0, colon);
  }
  if (host.endsWith('.')) host = host.slice(0, -1);
  if (host.length === 0 || host.length > 253 || !HOST_PATTERN.test(host)) return null;
  return host;
}

export async function resolveOrganizationIdByHost(
  rawHost: string | null | undefined,
): Promise<string | null> {
  const host = normalizeHost(rawHost);
  if (!host) return null;
  const now = Date.now();
  const hit = cache.get(host);
  if (hit && hit.expires > now) return hit.orgId;

  const orgId = await systemResolveOrganizationIdByHost(host);
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(host, { orgId, expires: now + CACHE_TTL_MS });
  return orgId;
}

export type PublicBranding = {
  organizationId: string;
  slug: string;
  displayName: string;
  defaultLocale: 'es' | 'en';
  brandColor: string;
  functionalColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
  childModeEnabled: boolean;
  logoFileId: string | null;
  /** Object path in the public `branding` bucket (workstream 1.7). */
  logoPath: string | null;
  faviconFileId: string | null;
  portalWelcome: { es: string | null; en: string | null };
};

function toPublicBranding(row: PublicBrandingRow): PublicBranding {
  return {
    organizationId: row.organization_id,
    slug: row.slug,
    displayName: row.display_name,
    defaultLocale: row.default_locale,
    brandColor: row.brand_color,
    functionalColor: row.functional_color,
    secondaryColor: row.secondary_color,
    accentColor: row.accent_color,
    childModeEnabled: row.child_mode_enabled,
    logoFileId: row.logo_file_id,
    logoPath: row.logo_path,
    faviconFileId: row.favicon_file_id,
    portalWelcome: { es: row.portal_welcome_es, en: row.portal_welcome_en },
  };
}

/** Non-PHI branding for pre-auth rendering (branding is the only cacheable tenant data). */
export async function getPublicBranding(organizationId: string): Promise<PublicBranding | null> {
  const row = await systemGetPublicBranding(organizationId);
  return row ? toPublicBranding(row) : null;
}

/** Test hook: clears the in-process host cache. */
export function clearHostCache(): void {
  cache.clear();
}
