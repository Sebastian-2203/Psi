'use server';

import { getLocale, getTranslations } from 'next-intl/server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import type { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { ACTIVITY_COOKIE } from '@/lib/session-policy';
import {
  acceptInvitationSchema,
  acceptPortalInvitationSchema,
  selectCapacitySchema,
  confirmRecoveryLinkSchema,
  createInvitationSchema,
  previewInvitationSchema,
  recoveryCodeSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  signInSchema,
  verifyEnrollmentSchema,
  verifyMfaSchema,
  type AcceptInvitationInput,
  type AcceptPortalInvitationInput,
  type SelectCapacityInput,
  type CreateInvitationInput,
  type RecoveryCodeInput,
  type RequestPasswordResetInput,
  type ResetPasswordInput,
  type SignInInput,
  type VerifyEnrollmentInput,
  type VerifyMfaInput,
} from '@/modules/auth/schemas';
import { getVerifiedClaims, type VerifiedClaims } from '@/server/auth/claims';
import { getPreferredLocale } from '@/modules/profiles/server/locale';
import {
  acceptPortalInvitation,
  previewPortalInvitation,
  type PortalInvitationPreview,
  acceptStaffInvitation,
  createStaffInvitation,
  previewStaffInvitation,
  STAFF_INVITATION_TTL_HOURS,
  type CreatedInvitation,
  type InvitationPreview,
} from '@/server/auth/invitations';
import {
  startTotpEnrollment,
  verifyTotpChallenge,
  verifyTotpEnrollment,
  type EnrollmentStart,
} from '@/server/auth/mfa';
import {
  completePasswordReset,
  confirmRecoveryToken,
  recoveryRedirectUrl,
  requestPasswordReset,
} from '@/server/auth/password';
import { redeemRecoveryCode, regenerateRecoveryCodes } from '@/server/auth/recovery-codes';
import { getRequestMeta } from '@/server/auth/request-meta';
import {
  signInWithPassword,
  signOutCurrentSession,
  type PostSignInStep,
} from '@/server/auth/sign-in';
import { requiresMfa } from '@/server/auth/session';
import { createRequestAuthClient } from '@/server/auth/supabase';
import { getAuthzContext, switchCapacity, type ActingAs } from '@/server/authz';
import { fail, toAppError, toErrorPayload, toResult, type Result } from '@/server/errors';
import { getRequestHostScope } from '@/server/tenancy/request';

/**
 * Auth server actions (API_CONTRACTS §8.1). Each: Zod `.strict()` parse -> rate limit (inside
 * the flow) -> Supabase Auth on the server (httpOnly cookies) -> audit -> Result / redirect.
 * Raw errors never reach the client (Result with an i18n messageKey + requestId).
 */

function validationFailure(error: z.ZodError, requestId: string) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fail('VALIDATION_FAILED', requestId, { fieldErrors });
}

function internal(
  error: unknown,
  requestId: string,
): { ok: false; error: ReturnType<typeof toErrorPayload> } {
  return { ok: false, error: toErrorPayload(toAppError(error), requestId) };
}

/**
 * Post-sign-in destination by capacity: anyone who needs aal2 (staff, platform admin) lands on
 * the dashboard; a patient/guardian-only identity lands on the portal. `next` (validated by the
 * schema) wins. The route guards still decide access; this only picks the landing page.
 */
async function stepHref(
  step: PostSignInStep,
  next: string | undefined,
  claims?: VerifiedClaims,
): Promise<string> {
  const query = next ? `?next=${encodeURIComponent(next)}` : '';
  if (step === 'mfa') return `/mfa${query}`;
  if (step === 'mfa_enroll') return '/mfa/enroll';
  if (next) return next;
  return !claims || (await requiresMfa(claims)) ? '/dashboard' : '/portal';
}

async function currentLocale(): Promise<Locale> {
  return (await getLocale()) === 'en' ? 'en' : 'es';
}

// ---------------------------------------------------------------------------
// Sign-in / sign-out
// ---------------------------------------------------------------------------

export async function signInAction(input: SignInInput): Promise<Result<never>> {
  const meta = await getRequestMeta();
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error, meta.requestId);
  let href: string;
  try {
    const client = await createRequestAuthClient();
    const outcome = await signInWithPassword(client, parsed.data, meta);
    if (!outcome.ok) return toResult(outcome, meta.requestId);
    href = await stepHref(outcome.data.step, parsed.data.next, outcome.data.claims);
  } catch (error) {
    return internal(error, meta.requestId);
  }
  return redirect({ href, locale: await currentLocale() });
}

/** Form action (no input). Audits, revokes this session at Supabase Auth, clears cookies. */
export async function signOutAction(): Promise<void> {
  const meta = await getRequestMeta();
  const claims = await getVerifiedClaims();
  const client = await createRequestAuthClient();
  await signOutCurrentSession(client, claims, meta);
  (await cookies()).delete(ACTIVITY_COOKIE);
  return redirect({ href: '/sign-in?signedOut=1', locale: await currentLocale() });
}

// ---------------------------------------------------------------------------
// Password recovery
// ---------------------------------------------------------------------------

export async function requestPasswordResetAction(
  input: RequestPasswordResetInput,
): Promise<Result<{ sent: true }>> {
  const meta = await getRequestMeta();
  const parsed = requestPasswordResetSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error, meta.requestId);
  try {
    const redirectTo = recoveryRedirectUrl(
      meta,
      await getRequestHostScope(),
      await currentLocale(),
    );
    const outcome = await requestPasswordReset(parsed.data.email, redirectTo, meta);
    if (!outcome.ok) return toResult(outcome, meta.requestId);
    return { ok: true, data: { sent: true } };
  } catch (error) {
    return internal(error, meta.requestId);
  }
}

export async function resetPasswordAction(input: ResetPasswordInput): Promise<Result<never>> {
  const meta = await getRequestMeta();
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error, meta.requestId);
  try {
    const claims = await getVerifiedClaims();
    if (!claims) {
      return fail('UNAUTHENTICATED', meta.requestId, {
        messageKey: 'auth.errors.resetLinkExpired',
      });
    }
    const outcome = await completePasswordReset(
      await createRequestAuthClient(),
      claims,
      parsed.data.password,
      meta,
    );
    if (!outcome.ok) return toResult(outcome, meta.requestId);
  } catch (error) {
    return internal(error, meta.requestId);
  }
  return redirect({ href: '/dashboard', locale: await currentLocale() });
}

/**
 * Consumes the emailed recovery token (P1-12). Only reachable by an explicit button press on the
 * interstitial page (POST), never by a GET, so link scanners that prefetch the URL cannot burn the
 * single-use token. Any failure goes to the generic "link invalid" screen.
 */
export async function confirmRecoveryLinkAction(formData: FormData): Promise<void> {
  const locale = await currentLocale();
  const parsed = confirmRecoveryLinkSchema.safeParse({
    token_hash: formData.get('token_hash'),
    type: formData.get('type'),
  });
  let ok = false;
  if (parsed.success) {
    try {
      ok = await confirmRecoveryToken(await createRequestAuthClient(), parsed.data.token_hash);
    } catch {
      ok = false;
    }
  }
  redirect({ href: ok ? '/reset-password' : '/forgot-password?error=link', locale });
}

// ---------------------------------------------------------------------------
// MFA (TOTP) and recovery codes
// ---------------------------------------------------------------------------

export async function startMfaEnrollmentAction(): Promise<Result<EnrollmentStart>> {
  const meta = await getRequestMeta();
  try {
    const claims = await getVerifiedClaims();
    if (!claims) return fail('UNAUTHENTICATED', meta.requestId);
    return toResult(
      await startTotpEnrollment(await createRequestAuthClient(), claims),
      meta.requestId,
    );
  } catch (error) {
    return internal(error, meta.requestId);
  }
}

export async function verifyMfaEnrollmentAction(
  input: VerifyEnrollmentInput,
): Promise<Result<never>> {
  const meta = await getRequestMeta();
  const parsed = verifyEnrollmentSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error, meta.requestId);
  try {
    const claims = await getVerifiedClaims();
    if (!claims) return fail('UNAUTHENTICATED', meta.requestId);
    const outcome = await verifyTotpEnrollment(
      await createRequestAuthClient(),
      claims,
      parsed.data,
      meta,
    );
    if (!outcome.ok) return toResult(outcome, meta.requestId);
  } catch (error) {
    return internal(error, meta.requestId);
  }
  return redirect({ href: '/mfa/recovery-codes?enrolled=1', locale: await currentLocale() });
}

export async function verifyMfaAction(input: VerifyMfaInput): Promise<Result<never>> {
  const meta = await getRequestMeta();
  const parsed = verifyMfaSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error, meta.requestId);
  let preferred: Locale | null = null;
  try {
    const claims = await getVerifiedClaims();
    if (!claims) return fail('UNAUTHENTICATED', meta.requestId);
    const outcome = await verifyTotpChallenge(
      await createRequestAuthClient(),
      claims,
      parsed.data.code,
      meta,
    );
    if (!outcome.ok) return toResult(outcome, meta.requestId);
    preferred = await getPreferredLocale(claims);
  } catch (error) {
    return internal(error, meta.requestId);
  }
  // I18N-02: after the second factor, continue in the user's stored language.
  return redirect({
    href: parsed.data.next ?? '/dashboard',
    locale: preferred ?? (await currentLocale()),
  });
}

export async function generateRecoveryCodesAction(): Promise<Result<{ codes: string[] }>> {
  const meta = await getRequestMeta();
  try {
    const claims = await getVerifiedClaims();
    if (!claims) return fail('UNAUTHENTICATED', meta.requestId);
    return toResult(await regenerateRecoveryCodes(claims), meta.requestId);
  } catch (error) {
    return internal(error, meta.requestId);
  }
}

/** API_CONTRACTS `useRecoveryCodeAction` (renamed: a `use*` name reads as a React hook). */
export async function redeemRecoveryCodeAction(input: RecoveryCodeInput): Promise<Result<never>> {
  const meta = await getRequestMeta();
  const parsed = recoveryCodeSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error, meta.requestId);
  try {
    const claims = await getVerifiedClaims();
    if (!claims) return fail('UNAUTHENTICATED', meta.requestId);
    const t = await getTranslations({ locale: await currentLocale(), namespace: 'auth.emails' });
    // Revokes every session of the user (cookies of this one are cleared by the same client).
    const outcome = await redeemRecoveryCode(
      await createRequestAuthClient(),
      claims,
      parsed.data.code,
      meta,
      { subject: t('mfaResetSubject'), text: t('mfaResetBody') },
    );
    if (!outcome.ok) return toResult(outcome, meta.requestId);
  } catch (error) {
    return internal(error, meta.requestId);
  }
  return redirect({ href: '/sign-in?mfaReset=1', locale: await currentLocale() });
}

// ---------------------------------------------------------------------------
// Staff invitations
// ---------------------------------------------------------------------------

export async function previewInvitationAction(input: {
  token: string;
}): Promise<Result<InvitationPreview>> {
  const meta = await getRequestMeta();
  const parsed = previewInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return fail('PRECONDITION_FAILED', meta.requestId, {
      messageKey: 'auth.errors.invitationInvalid',
    });
  }
  try {
    return toResult(await previewStaffInvitation(parsed.data.token, meta), meta.requestId);
  } catch (error) {
    return internal(error, meta.requestId);
  }
}

export async function acceptInvitationAction(input: AcceptInvitationInput): Promise<Result<never>> {
  const meta = await getRequestMeta();
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error, meta.requestId);
  let href: string;
  try {
    const outcome = await acceptStaffInvitation(
      await createRequestAuthClient(),
      { ...parsed.data, locale: await currentLocale() },
      meta,
    );
    if (!outcome.ok) return toResult(outcome, meta.requestId);
    href = await stepHref(outcome.data.step, undefined);
  } catch (error) {
    return internal(error, meta.requestId);
  }
  return redirect({ href, locale: await currentLocale() });
}

export async function createInvitationAction(
  input: CreateInvitationInput,
): Promise<Result<CreatedInvitation>> {
  const meta = await getRequestMeta();
  const parsed = createInvitationSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error, meta.requestId);
  try {
    const context = await getAuthzContext();
    if (!context.ok) return toResult(context, meta.requestId);
    if (!meta.origin) return fail('PRECONDITION_FAILED', meta.requestId);
    const { emailLocale } = parsed.data;
    const t = await getTranslations({ locale: emailLocale, namespace: 'auth.emails' });
    const outcome = await createStaffInvitation(
      context.data,
      { email: parsed.data.email, roles: parsed.data.roles },
      meta.origin,
      (link) => ({
        to: parsed.data.email,
        subject: t('invitationSubject'),
        text: t('invitationBody', { link, hours: STAFF_INVITATION_TTL_HOURS }),
      }),
      emailLocale,
    );
    if (outcome.ok) revalidatePath('/[locale]/settings', 'page');
    return toResult(outcome, context.data.requestId);
  } catch (error) {
    return internal(error, meta.requestId);
  }
}

// ---------------------------------------------------------------------------
// Portal invitations (patient / guardian) and acting-as selection — Phase 2
// ---------------------------------------------------------------------------

export async function previewPortalInvitationAction(input: {
  token: string;
}): Promise<Result<PortalInvitationPreview>> {
  const meta = await getRequestMeta();
  const parsed = previewInvitationSchema.safeParse(input);
  if (!parsed.success) {
    return fail('PRECONDITION_FAILED', meta.requestId, {
      messageKey: 'auth.errors.invitationInvalid',
    });
  }
  try {
    return toResult(await previewPortalInvitation(parsed.data.token, meta), meta.requestId);
  } catch (error) {
    return internal(error, meta.requestId);
  }
}

export async function acceptPortalInvitationAction(
  input: AcceptPortalInvitationInput,
): Promise<Result<never>> {
  const meta = await getRequestMeta();
  const parsed = acceptPortalInvitationSchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error, meta.requestId);
  try {
    const outcome = await acceptPortalInvitation(
      await createRequestAuthClient(),
      { ...parsed.data, locale: await currentLocale() },
      meta,
    );
    if (!outcome.ok) return toResult(outcome, meta.requestId);
  } catch (error) {
    return internal(error, meta.requestId);
  }
  return redirect({ href: '/portal', locale: await currentLocale() });
}

const CAPACITY_COOKIE = { httpOnly: true, sameSite: 'lax', path: '/' } as const;
const ACTING_AS_VALUES = ['staff', 'patient', 'guardian', 'platform_admin'];

/**
 * F-21: stores the chosen (organization, capacity) as host-only httpOnly HINT cookies after
 * validating that the caller really holds it on this host. getAuthzContext re-validates on every
 * request, so the cookies never grant anything. Audited (`auth.org_switched` /
 * `auth.capacity_switched`). `href` is where the UI should go next.
 */
export async function selectCapacityAction(
  input: SelectCapacityInput,
): Promise<Result<{ organizationId: string | null; actingAs: ActingAs; href: string }>> {
  const meta = await getRequestMeta();
  const parsed = selectCapacitySchema.safeParse(input);
  if (!parsed.success) return validationFailure(parsed.error, meta.requestId);
  try {
    const claims = await getVerifiedClaims();
    if (!claims) return fail('UNAUTHENTICATED', meta.requestId);
    const store = await cookies();
    const fromAct = store.get('acting_as')?.value;
    const outcome = await switchCapacity(
      claims,
      await getRequestHostScope(),
      parsed.data,
      {
        organizationId: store.get('active_org')?.value ?? null,
        actingAs: ACTING_AS_VALUES.includes(fromAct ?? '') ? (fromAct as ActingAs) : null,
      },
      meta.requestId,
    );
    if (!outcome.ok) return toResult(outcome, meta.requestId);
    const secure = process.env.NODE_ENV === 'production';
    store.set('acting_as', outcome.data.actingAs, { ...CAPACITY_COOKIE, secure });
    if (outcome.data.organizationId) {
      store.set('active_org', outcome.data.organizationId, { ...CAPACITY_COOKIE, secure });
    } else {
      store.delete('active_org');
    }
    revalidatePath('/', 'layout');
    return {
      ok: true,
      data: {
        ...outcome.data,
        href:
          outcome.data.actingAs === 'patient' || outcome.data.actingAs === 'guardian'
            ? '/portal'
            : '/dashboard',
      },
    };
  } catch (error) {
    return internal(error, meta.requestId);
  }
}
