import { z } from 'zod';
import {
  clearableDocumentNumber,
  clearableEmail,
  clearablePhone,
  clearableText,
  dateOfBirthField,
  documentTypeField,
  localeField,
  optionalDocumentNumber,
  optionalEmail,
  optionalPhone,
  optionalText,
  requiredText,
  uuidField,
  versionToken,
} from '@/lib/validation';

/**
 * Patient input schemas (isomorphic, `.strict()`, API_CONTRACTS §8.4). Messages are keys of
 * the top-level `validation.*` namespace. Lengths mirror the DB checks.
 */

export const createPatientSchema = z
  .object({
    firstName: requiredText(100),
    lastName: requiredText(100),
    preferredName: optionalText(100),
    dateOfBirth: dateOfBirthField,
    documentType: documentTypeField.optional(),
    documentNumber: optionalDocumentNumber,
    email: optionalEmail,
    phone: optionalPhone,
    preferredLocale: localeField.optional(),
    /** PAT-07: set after the duplicate warning was shown and the professional confirmed. */
    confirmDuplicate: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.documentNumber === undefined || v.documentType !== undefined, {
    path: ['documentType'],
    message: 'dependsOnDocumentType',
  });
export type CreatePatientInput = z.input<typeof createPatientSchema>;

export const UPDATABLE_PATIENT_FIELDS = {
  firstName: 'first_name',
  lastName: 'last_name',
  preferredName: 'preferred_name',
  pronouns: 'pronouns',
  dateOfBirth: 'date_of_birth',
  documentType: 'document_type',
  documentNumber: 'document_number',
  email: 'email',
  phone: 'phone',
  sex: 'sex',
  genderIdentity: 'gender_identity',
  preferredLocale: 'preferred_locale',
  emergencyContactName: 'emergency_contact_name',
  emergencyContactPhone: 'emergency_contact_phone',
} as const;

export const updatePatientSchema = z
  .object({
    patientId: uuidField,
    expectedUpdatedAt: versionToken,
    firstName: requiredText(100).optional(),
    lastName: requiredText(100).optional(),
    preferredName: clearableText(100),
    pronouns: clearableText(40),
    dateOfBirth: dateOfBirthField.optional(),
    documentType: documentTypeField.nullable().optional(),
    documentNumber: clearableDocumentNumber,
    email: clearableEmail,
    phone: clearablePhone,
    sex: clearableText(32),
    genderIdentity: clearableText(64),
    preferredLocale: localeField.nullable().optional(),
    emergencyContactName: clearableText(120),
    emergencyContactPhone: clearablePhone,
  })
  .strict()
  .refine(
    (v) =>
      Object.keys(UPDATABLE_PATIENT_FIELDS).some(
        (k) => (v as Record<string, unknown>)[k] !== undefined,
      ),
    { path: ['patientId'], message: 'nothingToUpdate' },
  );
export type UpdatePatientInput = z.input<typeof updatePatientSchema>;

export const PATIENT_STATUS_TARGETS = ['active', 'paused', 'discharged', 'archived'] as const;
/** `reason` from API_CONTRACTS has no column (audit metadata cannot hold free text): not accepted. */
export const changePatientStatusSchema = z
  .object({ patientId: uuidField, status: z.enum(PATIENT_STATUS_TARGETS, 'choiceInvalid') })
  .strict();
export type ChangePatientStatusInput = z.input<typeof changePatientStatusSchema>;

export const assignCareTeamMemberSchema = z
  .object({
    patientId: uuidField,
    membershipId: uuidField,
    careRole: z.enum(['primary', 'secondary', 'supervisor'], 'choiceInvalid'),
    /** Required (10-500) when self-assigning to a patient with another primary (F-06). */
    reason: optionalText(500, 10),
  })
  .strict();
export type AssignCareTeamMemberInput = z.input<typeof assignCareTeamMemberSchema>;

export const endCareTeamMemberSchema = z
  .object({ careTeamMemberId: uuidField, reason: requiredText(500, 3) })
  .strict();
export type EndCareTeamMemberInput = z.input<typeof endCareTeamMemberSchema>;

export const invitePatientSchema = z
  .object({
    patientId: uuidField,
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
export type InvitePatientInput = z.input<typeof invitePatientSchema>;

export const updatePatientPreferencesSchema = z
  .object({
    patientId: uuidField,
    portalMode: z.enum(['child', 'adolescent', 'adult'], 'choiceInvalid').optional(),
    locale: localeField.nullable().optional(),
    notifyEmail: z.boolean().optional(),
    textSize: z.union([z.literal(100), z.literal(125), z.literal(150)]).optional(),
    reducedMotion: z.boolean().optional(),
    audioInstructions: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      Object.keys(v).some(
        (k) => k !== 'patientId' && (v as Record<string, unknown>)[k] !== undefined,
      ),
    {
      path: ['patientId'],
      message: 'nothingToUpdate',
    },
  );
export type UpdatePatientPreferencesInput = z.input<typeof updatePatientPreferencesSchema>;

export const listMyPatientsSchema = z
  .object({
    status: z
      .enum(['intake', 'active', 'paused', 'discharged', 'archived'], 'choiceInvalid')
      .optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();
export type ListMyPatientsInput = z.input<typeof listMyPatientsSchema>;

export const patientIdSchema = z.object({ patientId: uuidField }).strict();
export type PatientIdInput = z.input<typeof patientIdSchema>;
