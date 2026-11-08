import 'server-only';
import { cache } from 'react';
import { brandingSchema, resolveBrandTokens, type Branding } from '@/styles/branding';
import { DEFAULT_BRAND } from '@/styles/default-brand';
import { requirePermission, type AuthzContext } from '@/server/authz';
import { withUserTransaction } from '@/server/db/server';
import { failure, ok, type Outcome } from '@/server/errors';
import { env } from '@/server/env';
import { getPublicBranding, getRequestHostScope, type PublicBranding } from '@/server/tenancy';

/**
 * Branding reads. Two audiences:
 * - `getTenantBrand()` — pre-auth theming of the host's organization (non-PHI, ADR-010).
 * - `getBrandingSettings()` — the owner's editable row, read as the user (RLS).
 */

export type TenantBrand = {
  /** Validated branding fed to <ThemeVariables>. */
  brand: Branding;
  /** Public URL of the uploaded logo, or null. */
  logoUrl: string | null;
  /** True when no tenant branding applies (app host / unknown host): Daniela default tokens. */
  isDefault: boolean;
};

const LOGO_PATH = /^[0-9a-f-]{36}\/logo-[0-9a-f]{32}\.(png|jpg|webp)$/;

export function logoPublicUrl(path: string | null | undefined): string | null {
  if (!path || !LOGO_PATH.test(path)) return null;
  return `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${path}`;
}

/**
 * In-process cache of NON-PHI branding per organization id (ARCHITECTURE §13 F-17 allows
 * branding only). Short TTL bounds staleness across instances; the saving instance invalidates
 * immediately. The key is the organization id resolved from the host, never a user value, and no
 * user/patient data ever enters this map.
 */
const BRANDING_TTL_MS = 30_000;
const BRANDING_CACHE_MAX = 500;
const brandingCache = new Map<string, { value: PublicBranding | null; expires: number }>();

export function invalidateTenantBranding(organizationId: string): void {
  brandingCache.delete(organizationId);
}

async function loadPublicBranding(organizationId: string): Promise<PublicBranding | null> {
  const now = Date.now();
  const hit = brandingCache.get(organizationId);
  if (hit && hit.expires > now) return hit.value;
  const value = await getPublicBranding(organizationId);
  if (brandingCache.size >= BRANDING_CACHE_MAX) brandingCache.clear();
  brandingCache.set(organizationId, { value, expires: now + BRANDING_TTL_MS });
  return value;
}

const DEFAULT_TENANT_BRAND: TenantBrand = { brand: DEFAULT_BRAND, logoUrl: null, isDefault: true };

export function toTenantBrand(row: PublicBranding): TenantBrand {
  const parsed = brandingSchema.safeParse({
    slug: row.slug,
    displayName: row.displayName,
    brandColor: row.brandColor,
    functionalColor: row.functionalColor ?? undefined,
    secondaryColor: row.secondaryColor ?? undefined,
    accentColor: row.accentColor ?? undefined,
    childModeEnabled: row.childModeEnabled,
  });
  // Stored branding was validated on save; if it no longer passes the guard, never render it.
  if (!parsed.success || !resolveBrandTokens(parsed.data).ok) return DEFAULT_TENANT_BRAND;
  return { brand: parsed.data, logoUrl: logoPublicUrl(row.logoPath), isDefault: false };
}

/** Branding of the organization the request host resolves to; Daniela default otherwise. */
export const getTenantBrand = cache(async (): Promise<TenantBrand> => {
  const scope = await getRequestHostScope();
  if (scope.kind !== 'tenant') return DEFAULT_TENANT_BRAND;
  const row = await loadPublicBranding(scope.organizationId);
  return row ? toTenantBrand(row) : DEFAULT_TENANT_BRAND;
});

export type BrandingSettings = {
  organizationId: string;
  displayName: string;
  brandColor: string;
  functionalColor: string | null;
  secondaryColor: string | null;
  childModeEnabled: boolean;
  logoUrl: string | null;
  /** Full-precision `updated_at` text: the optimistic-concurrency token. */
  updatedAt: string;
};

export async function getBrandingSettings(ctx: AuthzContext): Promise<Outcome<BrandingSettings>> {
  const permitted = await requirePermission(ctx, 'org.branding.manage');
  if (!permitted.ok) return permitted;
  const organizationId = ctx.organizationId as string;
  const [row] = await withUserTransaction(
    ctx.claims,
    (tx) => tx<
      {
        display_name: string;
        brand_color: string;
        functional_color: string | null;
        secondary_color: string | null;
        child_mode_enabled: boolean;
        logo_path: string | null;
        updated_at: string;
      }[]
    >`
      select display_name, brand_color, functional_color, secondary_color, child_mode_enabled,
             logo_path, updated_at::text as updated_at
      from public.organization_branding
      where organization_id = ${organizationId}
    `,
  );
  if (!row) return failure('NOT_FOUND');
  return ok({
    organizationId,
    displayName: row.display_name,
    brandColor: row.brand_color,
    functionalColor: row.functional_color,
    secondaryColor: row.secondary_color,
    childModeEnabled: row.child_mode_enabled,
    logoUrl: logoPublicUrl(row.logo_path),
    updatedAt: row.updated_at,
  });
}
