import 'server-only';
import { encodeContrastIssue, evaluateBrandColors } from '@/modules/branding/lib/contrast-guard';
import type { UpdateBrandingOutput } from '@/modules/branding/schemas';
import { recordAudit } from '@/server/audit';
import { requirePermission, type AuthzContext } from '@/server/authz';
import { withUserTransaction } from '@/server/db/server';
import { env } from '@/server/env';
import { AppError, failure, ok, toAppError, type Outcome } from '@/server/errors';
import { LogoError, logoObjectPath, sanitizeLogo, type SanitizedLogo } from './logo';
import { logoPublicUrl } from './queries';

/**
 * Branding use cases, framework-free so integration tests can call them with a real AuthzContext.
 * Each one: requirePermission('org.branding.manage': owner + aal2 + active org) -> work inside ONE
 * user transaction (RLS re-checks owner + aal2 in SQL) -> audit in the same transaction.
 */

export type Saved = { updatedAt: string; logoUrl: string | null };

type Row = {
  display_name: string;
  brand_color: string;
  functional_color: string | null;
  secondary_color: string | null;
  logo_path: string | null;
  updated_at: string;
};

function auditTarget(ctx: AuthzContext) {
  const organizationId = ctx.organizationId as string;
  return {
    organizationId,
    resourceType: 'organization_branding',
    resourceId: organizationId,
    requestId: ctx.requestId,
  };
}

export async function saveBranding(
  ctx: AuthzContext,
  data: UpdateBrandingOutput,
): Promise<Outcome<Saved>> {
  const permitted = await requirePermission(ctx, 'org.branding.manage');
  if (!permitted.ok) return permitted;
  const organizationId = ctx.organizationId as string;

  // Contrast guard (BRD-03): an explicit functional colour below 4.5:1 is rejected with the
  // nearest passing shade. Brand/secondary colours are auto-adjusted for text use.
  const guard = evaluateBrandColors(data);
  if (!guard.ok) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of guard.issues) fieldErrors[issue.field] = [encodeContrastIssue(issue)];
    return failure('VALIDATION_FAILED', { fieldErrors });
  }

  try {
    const saved = await withUserTransaction(ctx.claims, async (tx) => {
      const [current] = await tx<Row[]>`
        select display_name, brand_color, functional_color, secondary_color, logo_path,
               updated_at::text as updated_at
        from public.organization_branding
        where organization_id = ${organizationId}
        for update
      `;
      if (!current) throw new AppError('NOT_FOUND');
      // Optimistic concurrency: full-precision updated_at token from when the form was loaded.
      if (current.updated_at !== data.expectedUpdatedAt) throw new AppError('CONFLICT');

      const changed: string[] = [];
      if (current.display_name !== data.displayName) changed.push('display_name');
      if (current.brand_color !== data.brandColor) changed.push('brand_color');
      if (current.functional_color !== data.functionalColor) changed.push('functional_color');
      if (current.secondary_color !== data.secondaryColor) changed.push('secondary_color');
      if (changed.length === 0) {
        return { updatedAt: current.updated_at, logoPath: current.logo_path };
      }

      const [row] = await tx<{ updated_at: string }[]>`
        update public.organization_branding set
          display_name = ${data.displayName},
          brand_color = ${data.brandColor},
          functional_color = ${data.functionalColor},
          secondary_color = ${data.secondaryColor}
        where organization_id = ${organizationId}
        returning updated_at::text as updated_at
      `;
      if (!row) throw new AppError('FORBIDDEN'); // RLS filtered the row
      await recordAudit(
        tx,
        'organization_branding.updated',
        { changed_fields: changed },
        auditTarget(ctx),
      );
      return { updatedAt: row.updated_at, logoPath: current.logo_path };
    });
    return ok({ updatedAt: saved.updatedAt, logoUrl: logoPublicUrl(saved.logoPath) });
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
}

/**
 * Uploads the sanitised bytes with the CALLER'S OWN JWT; the storage INSERT policy
 * (branding_logos_insert_owner) decides: owner of the path's organization, aal2, org active.
 */
async function uploadToBucket(accessToken: string, path: string, logo: SanitizedLogo) {
  const response = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/branding/${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        'content-type': logo.contentType,
        'cache-control': 'max-age=31536000',
        'x-upsert': 'false',
      },
      body: new Uint8Array(logo.bytes),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.ok) return;
  const body = (await response.json().catch(() => ({}))) as { statusCode?: string | number };
  const status = String(body.statusCode ?? response.status);
  // Content-addressed name: an existing object with this name has these exact bytes.
  if (status === '409') return;
  if (status === '401' || status === '403') throw new AppError('FORBIDDEN');
  throw new AppError('INTERNAL', { detail: `storage_upload_${status}` });
}

const LOGO_ERROR = {
  too_large: ['PAYLOAD_TOO_LARGE', 'branding.errors.logoTooLarge'],
  unsupported_type: ['UNSUPPORTED_MEDIA', 'branding.errors.logoUnsupported'],
  corrupt: ['UNSUPPORTED_MEDIA', 'branding.errors.logoCorrupt'],
  dimensions: ['VALIDATION_FAILED', 'branding.errors.logoDimensions'],
} as const;

export async function saveLogo(
  ctx: AuthzContext,
  accessToken: string,
  bytes: Uint8Array,
): Promise<Outcome<Saved>> {
  const permitted = await requirePermission(ctx, 'org.branding.manage');
  if (!permitted.ok) return permitted;
  const organizationId = ctx.organizationId as string;

  let logo: SanitizedLogo;
  try {
    logo = sanitizeLogo(bytes);
  } catch (error) {
    if (error instanceof LogoError) {
      const [code, messageKey] = LOGO_ERROR[error.reason];
      return failure(code, { messageKey });
    }
    return { ok: false, error: toAppError(error) };
  }
  const path = logoObjectPath(organizationId, logo);

  try {
    await uploadToBucket(accessToken, path, logo);
    const row = await withUserTransaction(ctx.claims, async (tx) => {
      const [updated] = await tx<{ updated_at: string }[]>`
        update public.organization_branding set logo_path = ${path}
        where organization_id = ${organizationId}
        returning updated_at::text as updated_at
      `;
      if (!updated) throw new AppError('FORBIDDEN');
      await recordAudit(
        tx,
        'organization_branding.logo_uploaded',
        { media_type: logo.contentType, size_bytes: logo.bytes.length },
        auditTarget(ctx),
      );
      return updated;
    });
    return ok({ updatedAt: row.updated_at, logoUrl: logoPublicUrl(path) });
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
}

/** Detaches the logo (objects are immutable; they stay in the bucket until the cleanup job). */
export async function clearLogo(ctx: AuthzContext): Promise<Outcome<Saved>> {
  const permitted = await requirePermission(ctx, 'org.branding.manage');
  if (!permitted.ok) return permitted;
  const organizationId = ctx.organizationId as string;
  try {
    const row = await withUserTransaction(ctx.claims, async (tx) => {
      const [updated] = await tx<{ updated_at: string }[]>`
        update public.organization_branding set logo_path = null
        where organization_id = ${organizationId}
        returning updated_at::text as updated_at
      `;
      if (!updated) throw new AppError('FORBIDDEN');
      await recordAudit(
        tx,
        'organization_branding.updated',
        { changed_fields: ['logo_path'] },
        auditTarget(ctx),
      );
      return updated;
    });
    return ok({ updatedAt: row.updated_at, logoUrl: null });
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
}
