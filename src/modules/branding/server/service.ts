import 'server-only';
import { encodeContrastIssue, evaluateBrandColors } from '@/modules/branding/lib/contrast-guard';
import type { UpdateBrandingOutput } from '@/modules/branding/schemas';
import { recordAudit } from '@/server/audit';
import { requirePermission, type AuthzContext } from '@/server/authz';
import { withUserTransaction, type UserTransaction } from '@/server/db/server';
import {
  serviceRoleDeleteBrandingObjects,
  serviceRoleUploadBrandingLogo,
} from '@/server/db/service-role';
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
 * Upload rate limit (P1-18, ADR-020 counters via the user-context `app.consume_rate_limit`,
 * keyed per acting profile). Product constant, not a legal value. Consumed in its own
 * transaction so rejected/failed uploads still count; fails closed.
 */
export const LOGO_UPLOAD_LIMIT = { limit: 10, windowSeconds: 60 * 60 } as const;

async function consumeLogoUploadLimit(ctx: AuthzContext): Promise<boolean> {
  try {
    const [row] = await withUserTransaction(
      ctx.claims,
      (tx) => tx<{ allowed: boolean }[]>`
        select app.consume_rate_limit('branding.logo_upload', ${LOGO_UPLOAD_LIMIT.limit}::int,
                                      make_interval(secs => ${LOGO_UPLOAD_LIMIT.windowSeconds})) as allowed
      `,
    );
    return row?.allowed === true;
  } catch {
    return false;
  }
}

/** Locks the branding row; RLS on the UPDATE re-checks owner + aal2 + active org in SQL. */
async function lockAndSetLogoPath(
  tx: UserTransaction,
  organizationId: string,
  path: string | null,
) {
  const [current] = await tx<{ logo_path: string | null }[]>`
    select logo_path from public.organization_branding
    where organization_id = ${organizationId}
    for update
  `;
  if (!current) throw new AppError('FORBIDDEN');
  const [updated] = await tx<{ updated_at: string }[]>`
    update public.organization_branding set logo_path = ${path}
    where organization_id = ${organizationId}
    returning updated_at::text as updated_at
  `;
  if (!updated) throw new AppError('FORBIDDEN'); // RLS filtered the row: not owner/aal2/active
  return { previousPath: current.logo_path, updatedAt: updated.updated_at };
}

const LOGO_ERROR = {
  too_large: ['PAYLOAD_TOO_LARGE', 'branding.errors.logoTooLarge'],
  unsupported_type: ['UNSUPPORTED_MEDIA', 'branding.errors.logoUnsupported'],
  corrupt: ['UNSUPPORTED_MEDIA', 'branding.errors.logoCorrupt'],
  dimensions: ['VALIDATION_FAILED', 'branding.errors.logoDimensions'],
} as const;

/**
 * P1-16: users have NO write access to the bucket. Order inside ONE user transaction:
 * lock row -> RLS-bound UPDATE (owner + aal2 + active org) -> audit -> service-role upload of the
 * SANITISED bytes (upsert) -> best-effort delete of superseded objects -> commit. Any failure
 * before commit rolls back logo_path and the audit row.
 */
export async function saveLogo(ctx: AuthzContext, bytes: Uint8Array): Promise<Outcome<Saved>> {
  const permitted = await requirePermission(ctx, 'org.branding.manage');
  if (!permitted.ok) return permitted;
  const organizationId = ctx.organizationId as string;
  if (!(await consumeLogoUploadLimit(ctx))) {
    return failure('RATE_LIMITED', { messageKey: 'branding.errors.logoRateLimited' });
  }

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
    const row = await withUserTransaction(ctx.claims, async (tx) => {
      const locked = await lockAndSetLogoPath(tx, organizationId, path);
      await recordAudit(
        tx,
        'organization_branding.logo_uploaded',
        { media_type: logo.contentType, size_bytes: logo.bytes.length },
        auditTarget(ctx),
      );
      await serviceRoleUploadBrandingLogo(path, new Uint8Array(logo.bytes), logo.contentType);
      // P1-18: superseded logos (and orphans of failed attempts) leave the public bucket. Under
      // the row lock, so no concurrent upload for this org is in flight. Best effort: a failure
      // leaves orphans that the next upload/removal deletes; the new logo is still published.
      await serviceRoleDeleteBrandingObjects(organizationId, path).catch(() => 0);
      return locked;
    });
    return ok({ updatedAt: row.updatedAt, logoUrl: logoPublicUrl(path) });
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
}

/**
 * P1-18 takedown: clears logo_path AND deletes every object in the organization's branding folder
 * (service role, after the RLS-bound owner check, under the row lock). If the deletion fails the
 * transaction rolls back, so the owner sees an error and can retry; never "removed" while the
 * object is still public. Audited as `organization_branding.logo_removed`. Not rate limited.
 */
export async function clearLogo(ctx: AuthzContext): Promise<Outcome<Saved>> {
  const permitted = await requirePermission(ctx, 'org.branding.manage');
  if (!permitted.ok) return permitted;
  const organizationId = ctx.organizationId as string;
  try {
    const row = await withUserTransaction(ctx.claims, async (tx) => {
      const locked = await lockAndSetLogoPath(tx, organizationId, null);
      await recordAudit(
        tx,
        'organization_branding.logo_removed',
        { had_logo: locked.previousPath !== null },
        auditTarget(ctx),
      );
      await serviceRoleDeleteBrandingObjects(organizationId, null);
      return locked;
    });
    return ok({ updatedAt: row.updatedAt, logoUrl: null });
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
}
