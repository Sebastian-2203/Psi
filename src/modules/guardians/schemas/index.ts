import { z } from 'zod';
import {
  documentTypeField,
  isoDateField,
  localeField,
  optionalDocumentNumber,
  optionalEmail,
  optionalPhone,
  optionalText,
  requiredText,
  uuidField,
} from '@/lib/validation';

/** Guardian input schemas (API_CONTRACTS §8.5). `.strict()`, message keys in `validation.*`. */

export const GUARDIAN_RELATIONSHIPS = [
  'mother',
  'father',
  'legal_guardian',
  'grandparent',
  'other_relative',
  'other',
] as const;
export const LEGAL_BASES = [
  'parental_authority',
  'legal_guardianship',
  'court_order',
  'other',
] as const;
export const GUARDIAN_PERMISSIONS = [
  'view_assignments',
  'complete_assignments',
  'view_responses',
  'view_shared_resources',
  'sign_consents',
  'view_session_schedule',
  'manage_portal_preferences',
  'receive_notifications',
  'view_shared_documents',
  'view_patient_facing_goals',
] as const;
/** `age_of_majority` is set only by the system job (reactivation after majority is unsupported). */
export const USER_SUSPENSION_REASONS = ['custody_review', 'safety_concern', 'other'] as const;

const relationshipId = z.object({ patientGuardianId: uuidField });

export const createGuardianSchema = z
  .object({
    patientId: uuidField,
    firstName: requiredText(100),
    lastName: requiredText(100),
    documentType: documentTypeField.optional(),
    documentNumber: optionalDocumentNumber,
    email: optionalEmail,
    phone: optionalPhone,
    relationship: z.enum(GUARDIAN_RELATIONSHIPS, 'choiceInvalid'),
    isLegalRepresentative: z.boolean(),
    legalBasis: z.enum(LEGAL_BASES, 'choiceInvalid').optional(),
    isPrimaryContact: z.boolean().default(false),
  })
  .strict()
  .refine((v) => !v.isLegalRepresentative || v.legalBasis !== undefined, {
    path: ['legalBasis'],
    message: 'fieldRequired',
  })
  .refine((v) => v.documentNumber === undefined || v.documentType !== undefined, {
    path: ['documentType'],
    message: 'dependsOnDocumentType',
  });
export type CreateGuardianInput = z.input<typeof createGuardianSchema>;

export const verifyRelationshipSchema = relationshipId
  .extend({
    verificationNote: optionalText(1000),
    validFrom: isoDateField.optional(),
    validUntil: isoDateField.optional(),
    verifyLegalBasis: z.boolean(),
  })
  .strict()
  .refine((v) => !v.validFrom || !v.validUntil || v.validUntil >= v.validFrom, {
    path: ['validUntil'],
    message: 'dateInvalid',
  });
export type VerifyRelationshipInput = z.input<typeof verifyRelationshipSchema>;

export const suspendRelationshipSchema = relationshipId
  .extend({ reason: z.enum(USER_SUSPENSION_REASONS, 'choiceInvalid') })
  .strict();
export type SuspendRelationshipInput = z.input<typeof suspendRelationshipSchema>;

export const relationshipIdSchema = relationshipId.strict();
export type RelationshipIdInput = z.input<typeof relationshipIdSchema>;

export const setCaveatSchema = relationshipId
  .extend({ caveat: requiredText(1000, 3), restrictSchedule: z.boolean() })
  .strict();
export type SetCaveatInput = z.input<typeof setCaveatSchema>;

export const setPermissionsSchema = relationshipId
  .extend({
    permissions: z
      .array(z.enum(GUARDIAN_PERMISSIONS, 'choiceInvalid'))
      .max(GUARDIAN_PERMISSIONS.length),
  })
  .strict();
export type SetPermissionsInput = z.input<typeof setPermissionsSchema>;

export const revokeRelationshipSchema = relationshipId
  .extend({ reason: requiredText(500, 3) })
  .strict();
export type RevokeRelationshipInput = z.input<typeof revokeRelationshipSchema>;

export const inviteGuardianSchema = relationshipId
  .extend({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, 'emailInvalid')
      .max(254, 'emailInvalid')
      .pipe(z.email('emailInvalid')),
    emailLocale: localeField,
  })
  .strict();
export type InviteGuardianInput = z.input<typeof inviteGuardianSchema>;

export const listGuardiansSchema = z.object({ patientId: uuidField }).strict();
export type ListGuardiansInput = z.input<typeof listGuardiansSchema>;
