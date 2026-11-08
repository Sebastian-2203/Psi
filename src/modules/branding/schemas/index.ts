import { z } from 'zod';

/**
 * Branding input schemas (isomorphic: React Hook Form + server action). Messages are keys of
 * `branding.validation.*`, never text. `.strict()` everywhere (API_CONTRACTS §2).
 */

export const VALIDATION_KEYS = [
  'displayNameRequired',
  'displayNameTooLong',
  'colorInvalid',
  'versionRequired',
] as const;
export type ValidationKey = (typeof VALIDATION_KEYS)[number];

export const DISPLAY_NAME_MAX = 80;

const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'colorInvalid')
  .transform((v) => v.toLowerCase());

/** Empty string = "not set". */
const optionalHexColor = z.union([z.literal(''), hexColor]).transform((v) => (v === '' ? null : v));

export const updateBrandingSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, 'displayNameRequired')
      .max(DISPLAY_NAME_MAX, 'displayNameTooLong'),
    brandColor: hexColor,
    functionalColor: optionalHexColor,
    secondaryColor: optionalHexColor,
    /** `updated_at` (full precision, as text) of the row the form was loaded from. */
    expectedUpdatedAt: z.string().min(1, 'versionRequired').max(64),
  })
  .strict();

export type UpdateBrandingInput = z.input<typeof updateBrandingSchema>;
export type UpdateBrandingOutput = z.output<typeof updateBrandingSchema>;

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/webp';

export const removeLogoSchema = z.object({}).strict();
