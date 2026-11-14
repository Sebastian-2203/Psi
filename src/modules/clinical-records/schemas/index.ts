import { z } from 'zod';
import { richTextDraftSchema, richTextSchema } from '@/lib/rich-text';
import { isoDateField, localeField, optionalText, requiredText, uuidField } from '@/lib/validation';

/**
 * Clinical record schemas (API_CONTRACTS §8.6). All `.strict()`. The system never proposes,
 * computes or completes diagnoses, interpretations or scores (CLR-04, CLR-06): every clinical
 * field here is typed by the psychologist. Section catalogue and note formats are per-org
 * configuration [NEEDS PSYCHOLOGIST INPUT].
 */

export const configKey = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,47}$/, 'choiceInvalid');
export const SECTION_AUDIENCES = ['any', 'adult', 'minor'] as const;

export const patientIdSchema = z.object({ patientId: uuidField }).strict();
export type PatientIdInput = z.input<typeof patientIdSchema>;

export const upsertSectionDefinitionSchema = z
  .object({
    id: uuidField.optional(),
    key: configKey,
    title: requiredText(120),
    description: optionalText(500),
    audience: z.enum(SECTION_AUDIENCES, 'choiceInvalid').default('any'),
    isRequired: z.boolean().default(false),
    position: z.number().int().min(0).max(999).default(0),
    isActive: z.boolean().default(true),
  })
  .strict();
export type UpsertSectionDefinitionInput = z.input<typeof upsertSectionDefinitionSchema>;

export const upsertNoteTypeSchema = z
  .object({
    id: uuidField.optional(),
    key: configKey,
    label: requiredText(120),
    description: optionalText(500),
    position: z.number().int().min(0).max(999).default(0),
    isActive: z.boolean().default(true),
  })
  .strict();
export type UpsertNoteTypeInput = z.input<typeof upsertNoteTypeSchema>;

export const closeRecordSchema = z
  .object({ recordId: uuidField, closureSummary: richTextSchema })
  .strict();
export type CloseRecordInput = z.input<typeof closeRecordSchema>;

export const recordIdSchema = z.object({ recordId: uuidField }).strict();
export type RecordIdInput = z.input<typeof recordIdSchema>;

/** Save a section: first save (no sectionId) or a new revision (expectedRevision). */
export const updateRecordSectionSchema = z
  .object({
    recordId: uuidField,
    sectionDefinitionId: uuidField,
    content: richTextDraftSchema,
    contentLocale: localeField.default('es'),
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export type UpdateRecordSectionInput = z.input<typeof updateRecordSectionSchema>;

export const sectionIdSchema = z.object({ sectionId: uuidField }).strict();
export type SectionIdInput = z.input<typeof sectionIdSchema>;

const assessmentFields = {
  assessedOn: isoDateField,
  instrumentName: requiredText(200),
  instrumentReference: optionalText(300),
  administeredBy: optionalText(200),
  results: richTextDraftSchema,
  interpretation: richTextDraftSchema.optional(),
  attachmentFileId: uuidField.optional(),
};

export const createAssessmentSchema = z
  .object({ recordId: uuidField, correctsAssessmentId: uuidField.optional(), ...assessmentFields })
  .strict();
export type CreateAssessmentInput = z.input<typeof createAssessmentSchema>;

export const updateAssessmentDraftSchema = z
  .object({
    assessmentId: uuidField,
    expectedUpdatedAt: z.string().min(1).max(64),
    assessedOn: assessmentFields.assessedOn.optional(),
    instrumentName: assessmentFields.instrumentName.optional(),
    instrumentReference: assessmentFields.instrumentReference,
    administeredBy: assessmentFields.administeredBy,
    results: assessmentFields.results.optional(),
    interpretation: assessmentFields.interpretation,
    attachmentFileId: uuidField.nullable().optional(),
  })
  .strict();
export type UpdateAssessmentDraftInput = z.input<typeof updateAssessmentDraftSchema>;

export const assessmentIdSchema = z.object({ assessmentId: uuidField }).strict();
export type AssessmentIdInput = z.input<typeof assessmentIdSchema>;

export const CODE_SYSTEMS = ['cie10', 'cie11', 'dsm5tr', 'other'] as const;
export const DIAGNOSIS_STATUSES = ['provisional', 'confirmed', 'ruled_out', 'resolved'] as const;

export const addDiagnosisSchema = z
  .object({
    recordId: uuidField,
    codeSystem: z.enum(CODE_SYSTEMS, 'choiceInvalid'),
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/, 'choiceInvalid')
      .optional(),
    label: requiredText(300),
    status: z.enum(DIAGNOSIS_STATUSES, 'choiceInvalid').default('provisional'),
    diagnosedOn: isoDateField,
    notes: richTextDraftSchema.optional(),
  })
  .strict()
  .refine((v) => v.codeSystem === 'other' || v.code !== undefined, {
    message: 'fieldRequired',
    path: ['code'],
  });
export type AddDiagnosisInput = z.input<typeof addDiagnosisSchema>;

export const updateDiagnosisStatusSchema = z
  .object({
    diagnosisId: uuidField,
    status: z.enum(DIAGNOSIS_STATUSES, 'choiceInvalid'),
    resolvedOn: isoDateField.optional(),
  })
  .strict();
export type UpdateDiagnosisStatusInput = z.input<typeof updateDiagnosisStatusSchema>;
