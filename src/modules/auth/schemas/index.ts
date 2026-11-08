import { z } from 'zod';
import { normalizeRecoveryCode, RECOVERY_CODE_PATTERN } from '@/lib/recovery-codes';

/**
 * Auth input schemas (isomorphic: the same schema backs React Hook Form and the server
 * action). Messages are keys of `auth.validation.*` in messages/{es,en}.json, never text.
 * Every object is `.strict()` (API_CONTRACTS §2). Passwords follow SECURITY.md §3.5.
 */

export const PASSWORD_MIN_LENGTH = 12;
/** bcrypt limit: longer passwords are REJECTED, never silently truncated (SECURITY.md §3.5). */
export const PASSWORD_MAX_BYTES = 72;

export const VALIDATION_KEYS = [
  'emailInvalid',
  'passwordRequired',
  'passwordTooShort',
  'passwordTooLong',
  'passwordMismatch',
  'passwordWeak',
  'codeInvalid',
  'recoveryCodeInvalid',
  'displayNameRequired',
  'fieldRequired',
  'rolesRequired',
] as const;
export type ValidationKey = (typeof VALIDATION_KEYS)[number];

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'emailInvalid')
  .max(254, 'emailInvalid')
  .pipe(z.email('emailInvalid'));

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, 'passwordTooShort')
  .refine((value) => utf8Length(value) <= PASSWORD_MAX_BYTES, 'passwordTooLong');

/** Internal return paths after sign-in/MFA. Anything else is dropped (no open redirects). */
const NEXT_PATH =
  /^\/(dashboard|settings(\/[a-z0-9-]{1,64}){0,3}|mfa\/recovery-codes|reset-password)$/;

export function safeNextPath(raw: unknown): string | null {
  return typeof raw === 'string' && NEXT_PATH.test(raw) ? raw : null;
}

const nextField = z
  .string()
  .max(256)
  .optional()
  .transform((value) => safeNextPath(value) ?? undefined);

export const signInSchema = z
  .object({
    email: emailSchema,
    // Existing passwords are not re-validated against the policy at sign-in.
    password: z.string().min(1, 'passwordRequired').max(1024, 'passwordRequired'),
    next: nextField,
  })
  .strict();
export type SignInInput = z.input<typeof signInSchema>;

export const requestPasswordResetSchema = z.object({ email: emailSchema }).strict();
export type RequestPasswordResetInput = z.input<typeof requestPasswordResetSchema>;

export const resetPasswordSchema = z
  .object({ password: newPasswordSchema, confirmPassword: z.string() })
  .strict()
  .refine((v) => v.password === v.confirmPassword, {
    message: 'passwordMismatch',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'codeInvalid');

export const verifyMfaSchema = z.object({ code: totpCodeSchema, next: nextField }).strict();
export type VerifyMfaInput = z.input<typeof verifyMfaSchema>;

export const verifyEnrollmentSchema = z
  .object({ factorId: z.uuid('codeInvalid'), code: totpCodeSchema })
  .strict();
export type VerifyEnrollmentInput = z.input<typeof verifyEnrollmentSchema>;

export const recoveryCodeSchema = z
  .object({
    code: z
      .string()
      .max(64, 'recoveryCodeInvalid')
      .transform(normalizeRecoveryCode)
      .pipe(z.string().regex(RECOVERY_CODE_PATTERN, 'recoveryCodeInvalid')),
  })
  .strict();
export type RecoveryCodeInput = z.input<typeof recoveryCodeSchema>;

/** 32 random bytes, base64url without padding (SECURITY.md §3.8). */
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'fieldRequired');

export const previewInvitationSchema = z.object({ token: invitationTokenSchema }).strict();

const shortText = z.string().trim().min(1, 'fieldRequired').max(120, 'fieldRequired');

export const professionalFieldsSchema = z
  .object({ title: shortText, licenseNumber: shortText, licenseIssuer: shortText })
  .strict();

export const acceptInvitationSchema = z
  .object({
    token: invitationTokenSchema,
    displayName: z.string().trim().min(1, 'displayNameRequired').max(120, 'displayNameRequired'),
    password: newPasswordSchema,
    professional: professionalFieldsSchema.optional(),
  })
  .strict();
export type AcceptInvitationInput = z.input<typeof acceptInvitationSchema>;

export const STAFF_ROLES = ['organization_owner', 'psychologist'] as const;

export const createInvitationSchema = z
  .object({
    email: emailSchema,
    roles: z
      .array(z.enum(STAFF_ROLES))
      .min(1, 'rolesRequired')
      .max(2, 'rolesRequired')
      .refine((roles) => new Set(roles).size === roles.length, 'rolesRequired'),
    emailLocale: z.enum(['es', 'en']),
  })
  .strict();
export type CreateInvitationInput = z.input<typeof createInvitationSchema>;

/** Staff invitation lifetime (SECURITY.md §3.8): product constant, configurable. */
export const STAFF_INVITATION_TTL_HOURS = 72;

/** Recovery-link interstitial form (P1-12): the token is only consumed by this POST. */
export const confirmRecoveryLinkSchema = z
  .object({
    token_hash: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    type: z.literal('recovery'),
  })
  .strict();
