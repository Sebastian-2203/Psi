import { z } from 'zod';
import { localeField, optionalText, requiredText, uuidField } from '@/lib/validation';

/**
 * Consent schemas (API_CONTRACTS §8.11). The version body is a RESTRICTED rich-text AST: no
 * HTML, no links, no scripts (non-negotiable rule 8). The DB stores it as jsonb and fixes
 * sha256 of its canonical text at publish time. Consent TEXT is clinical/legal content authored
 * per locale; it is never auto-translated. [NEEDS LEGAL VERIFICATION] for all starter texts.
 */

const inline = z
  .object({
    type: z.literal('text'),
    text: z.string().min(1).max(2000),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
  })
  .strict();
const inlines = z.array(inline).min(1).max(50);

const block = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('heading'),
      level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      children: inlines,
    })
    .strict(),
  z.object({ type: z.literal('paragraph'), children: inlines }).strict(),
  z
    .object({
      type: z.literal('list'),
      ordered: z.boolean(),
      items: z.array(inlines).min(1).max(50),
    })
    .strict(),
]);

export const consentBodySchema = z
  .object({ version: z.literal(1), blocks: z.array(block).min(1).max(200) })
  .strict()
  .refine((body) => JSON.stringify(body).length <= 60_000, 'fieldTooLong');
export type ConsentBody = z.output<typeof consentBodySchema>;

export const CONSENT_TYPES = [
  'treatment_informed_consent',
  'personal_data_processing',
  'minor_assent',
  'guardian_authorization',
  'portal_use',
  'other',
] as const;
export const SIGNER_REQUIREMENTS = ['patient', 'guardian', 'patient_and_guardian'] as const;

export const createConsentTemplateSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,47}$/, 'choiceInvalid'),
    consentType: z.enum(CONSENT_TYPES, 'choiceInvalid'),
    title: requiredText(200),
    signerRequirement: z.enum(SIGNER_REQUIREMENTS, 'choiceInvalid'),
    appliesToMinors: z.boolean(),
    appliesToAdults: z.boolean(),
    requiredForActivation: z.boolean().default(false),
  })
  .strict()
  .refine((v) => v.appliesToMinors || v.appliesToAdults, {
    path: ['appliesToMinors'],
    message: 'choiceInvalid',
  });
export type CreateConsentTemplateInput = z.input<typeof createConsentTemplateSchema>;

export const saveConsentVersionDraftSchema = z
  .object({
    templateId: uuidField,
    locale: localeField,
    title: requiredText(200),
    body: consentBodySchema,
    legalReviewReference: optionalText(200),
  })
  .strict();
export type SaveConsentVersionDraftInput = z.input<typeof saveConsentVersionDraftSchema>;

export const publishConsentVersionSchema = z.object({ versionId: uuidField }).strict();
export type PublishConsentVersionInput = z.input<typeof publishConsentVersionSchema>;

/** Hex sha256 of the body the signer was shown (from the signable DTO). */
const hashHex = z.string().regex(/^[0-9a-f]{64}$/, 'choiceInvalid');

export const signConsentSchema = z
  .object({
    patientId: uuidField,
    versionId: uuidField,
    decision: z.enum(['accepted', 'declined'], 'choiceInvalid'),
    typedName: requiredText(200, 2),
    checkboxConfirmed: z.literal(true, 'fieldRequired'),
    textHash: hashHex,
  })
  .strict();
export type SignConsentInput = z.input<typeof signConsentSchema>;

export const recordConsentSchema = z
  .object({
    patientId: uuidField,
    versionId: uuidField,
    signerType: z.enum(['patient', 'guardian'], 'choiceInvalid'),
    patientGuardianId: uuidField.optional(),
    /** paper_scan needs file storage (Phase 3): rejected by the DB until then. */
    method: z.literal('verbal_recorded'),
    decision: z.enum(['accepted', 'declined'], 'choiceInvalid'),
    decidedAt: z.iso.datetime({ offset: true, message: 'dateInvalid' }),
  })
  .strict()
  .refine((v) => (v.signerType === 'guardian') === (v.patientGuardianId !== undefined), {
    path: ['patientGuardianId'],
    message: 'fieldRequired',
  });
export type RecordConsentInput = z.input<typeof recordConsentSchema>;

export const withdrawConsentSchema = z
  .object({ consentRecordId: uuidField, reason: requiredText(1000, 3) })
  .strict();
export type WithdrawConsentInput = z.input<typeof withdrawConsentSchema>;

export const patientConsentStatusSchema = z.object({ patientId: uuidField }).strict();
export type PatientConsentStatusInput = z.input<typeof patientConsentStatusSchema>;

export const signableConsentsSchema = z.object({ patientId: uuidField.optional() }).strict();
export type SignableConsentsInput = z.input<typeof signableConsentsSchema>;
