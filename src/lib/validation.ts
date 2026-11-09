import { z } from 'zod';

/**
 * Shared Zod primitives for Phase 2 input schemas (isomorphic: forms + server actions). Error
 * messages are KEYS of the top-level `validation.*` namespace in messages/{es,en}.json, never
 * text. Free-text lengths mirror the DB check constraints (defence in depth, DATABASE.md §5.3).
 */

export const SHARED_VALIDATION_KEYS = [
  'fieldRequired',
  'fieldTooShort',
  'fieldTooLong',
  'emailInvalid',
  'phoneInvalid',
  'dateInvalid',
  'dateInFuture',
  'documentInvalid',
  'choiceInvalid',
  'versionRequired',
  'nothingToUpdate',
  'dependsOnDocumentType',
] as const;
export type SharedValidationKey = (typeof SHARED_VALIDATION_KEYS)[number];

export const uuidField = z.uuid('choiceInvalid');

/** Trimmed, required text bounded to the DB column. */
export const requiredText = (max: number, min = 1) =>
  z.string().trim().min(min, min <= 1 ? 'fieldRequired' : 'fieldTooShort').max(max, 'fieldTooLong');

/** Optional trimmed text: '' means "not provided". */
export const optionalText = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .max(max, 'fieldTooLong')
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value))
    .pipe(z.string().min(min, 'fieldTooShort').optional());

/** Nullable variant for PATCH-style updates: '' / null clear the value, undefined leaves it. */
export const clearableText = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .max(max, 'fieldTooLong')
    .nullable()
    .optional()
    .transform((value) => (value === '' ? null : value))
    .pipe(z.string().min(min, 'fieldTooShort').nullable().optional());

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'emailInvalid')
  .max(254, 'emailInvalid')
  .pipe(z.email('emailInvalid'));

const PHONE = /^[0-9 +()-]{5,32}$/;
export const phoneField = z.string().trim().regex(PHONE, 'phoneInvalid');
export const optionalPhone = z
  .union([z.literal(''), phoneField])
  .optional()
  .transform((v) => (v === '' ? undefined : v));
export const clearablePhone = z
  .union([z.literal(''), phoneField, z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

export const optionalEmail = z
  .union([z.literal(''), emailField])
  .optional()
  .transform((v) => (v === '' ? undefined : v));
export const clearableEmail = z
  .union([z.literal(''), emailField, z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

export const DOCUMENT_TYPES = ['cc', 'ti', 'rc', 'ce', 'pa', 'ppt', 'nit', 'other'] as const;
export const documentTypeField = z.enum(DOCUMENT_TYPES, 'choiceInvalid');
const DOCUMENT_NUMBER = /^[A-Za-z0-9-]{3,32}$/;
export const documentNumberField = z.string().trim().regex(DOCUMENT_NUMBER, 'documentInvalid');
export const optionalDocumentNumber = z
  .union([z.literal(''), documentNumberField])
  .optional()
  .transform((v) => (v === '' ? undefined : v));
export const clearableDocumentNumber = z
  .union([z.literal(''), documentNumberField, z.null()])
  .optional()
  .transform((v) => (v === '' ? null : v));

/** `YYYY-MM-DD`, a real calendar date. */
export const isoDateField = z.iso.date('dateInvalid');

export function isFutureDate(value: string, today: Date = new Date()): boolean {
  return value > today.toISOString().slice(0, 10);
}

/** Date of birth: real date, 1900-01-01 or later (DB check), not in the future. */
export const dateOfBirthField = isoDateField
  .refine((v) => v >= '1900-01-01', 'dateInvalid')
  .refine((v) => !isFutureDate(v), 'dateInFuture');

export const localeField = z.enum(['es', 'en'], 'choiceInvalid');

/** `updated_at::text` of the loaded row: the optimistic-concurrency token. */
export const versionToken = z.string().min(1, 'versionRequired').max(64, 'versionRequired');

/** Collects Zod issues as `field -> [message keys]` (first path segment). */
export function zodFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? '_');
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}
