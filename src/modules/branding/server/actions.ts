'use server';

import { revalidatePath } from 'next/cache';
import { updateBrandingSchema, type UpdateBrandingInput } from '@/modules/branding/schemas';
import { getRequestMeta } from '@/server/auth/request-meta';
import { getAuthzContext, type AuthzContext } from '@/server/authz';
import {
  fail,
  toAppError,
  toErrorPayload,
  toResult,
  type Outcome,
  type Result,
} from '@/server/errors';
import { LOGO_MAX_BYTES } from './logo';
import { invalidateTenantBranding } from './queries';
import { clearLogo, saveBranding, saveLogo, type Saved } from './service';

/**
 * Branding server actions (API_CONTRACTS §8, workstream 1.7). Thin wrappers: Zod `.strict()` parse
 * -> getAuthzContext -> use case in ./service (permission `org.branding.manage`, one user
 * transaction, audit) -> invalidate the tenant branding cache -> revalidate. Raw errors never reach
 * the client (Result with an i18n messageKey + requestId).
 */

async function run(work: (ctx: AuthzContext) => Promise<Outcome<Saved>>): Promise<Result<Saved>> {
  const meta = await getRequestMeta();
  try {
    const context = await getAuthzContext();
    if (!context.ok) return toResult(context, meta.requestId);
    const outcome = await work(context.data);
    if (outcome.ok) {
      // Cross-instance staleness is bounded by the branding cache TTL (queries.ts).
      invalidateTenantBranding(context.data.organizationId as string);
      revalidatePath('/[locale]', 'layout');
    }
    return toResult(outcome, context.data.requestId);
  } catch (error) {
    return { ok: false, error: toErrorPayload(toAppError(error), meta.requestId) };
  }
}

export async function updateBrandingAction(input: UpdateBrandingInput): Promise<Result<Saved>> {
  const parsed = updateBrandingSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      (fieldErrors[String(issue.path[0] ?? '_')] ??= []).push(issue.message);
    }
    return fail('VALIDATION_FAILED', (await getRequestMeta()).requestId, { fieldErrors });
  }
  return run((ctx) => saveBranding(ctx, parsed.data));
}

/** FormData: exactly one `file` (PNG/JPEG/WebP). Validated by magic bytes, re-written without metadata. */
export async function uploadLogoAction(formData: FormData): Promise<Result<Saved>> {
  const files = formData.getAll('file');
  const file = files[0];
  if (files.length !== 1 || !(file instanceof File)) {
    return fail('VALIDATION_FAILED', (await getRequestMeta()).requestId, {
      messageKey: 'branding.errors.logoMissing',
    });
  }
  if (file.size > LOGO_MAX_BYTES) {
    return fail('PAYLOAD_TOO_LARGE', (await getRequestMeta()).requestId, {
      messageKey: 'branding.errors.logoTooLarge',
    });
  }
  return run(async (ctx) => saveLogo(ctx, new Uint8Array(await file.arrayBuffer())));
}

/** P1-18: clears the logo and deletes its objects from the public bucket (audited). */
export async function removeLogoAction(): Promise<Result<Saved>> {
  return run((ctx) => clearLogo(ctx));
}
