'use server';

import { emptyInput } from '@/lib/validation';
import {
  addDiagnosisSchema,
  assessmentIdSchema,
  closeRecordSchema,
  createAssessmentSchema,
  patientIdSchema,
  recordIdSchema,
  sectionIdSchema,
  updateAssessmentDraftSchema,
  updateDiagnosisStatusSchema,
  updateRecordSectionSchema,
  upsertNoteTypeSchema,
  upsertSectionDefinitionSchema,
  type AddDiagnosisInput,
  type AssessmentIdInput,
  type CloseRecordInput,
  type CreateAssessmentInput,
  type PatientIdInput,
  type RecordIdInput,
  type SectionIdInput,
  type UpdateAssessmentDraftInput,
  type UpdateDiagnosisStatusInput,
  type UpdateRecordSectionInput,
  type UpsertNoteTypeInput,
  type UpsertSectionDefinitionInput,
} from '@/modules/clinical-records/schemas';
import { runAction } from '@/server/actions/run';
import {
  getClinicalRecord,
  listAssessments,
  listClinicalConfig,
  listSectionRevisions,
} from './queries';
import {
  addDiagnosis,
  closeClinicalRecord,
  createAssessment,
  discardAssessmentDraft,
  finalizeAssessment,
  openClinicalRecord,
  reopenClinicalRecord,
  updateAssessmentDraft,
  updateDiagnosisStatus,
  updateRecordSection,
  upsertNoteType,
  upsertSectionDefinition,
} from './service';

/** Clinical record actions (API_CONTRACTS §8.6). Thin: Zod `.strict()` -> context -> use case. */

export async function getClinicalRecordAction(input: PatientIdInput) {
  return runAction(patientIdSchema, input, (ctx, d) => getClinicalRecord(ctx, d.patientId));
}
export async function openClinicalRecordAction(input: PatientIdInput) {
  return runAction(patientIdSchema, input, (ctx, d) => openClinicalRecord(ctx, d));
}
export async function closeClinicalRecordAction(input: CloseRecordInput) {
  return runAction(closeRecordSchema, input, (ctx, d) => closeClinicalRecord(ctx, d));
}
export async function reopenClinicalRecordAction(input: RecordIdInput) {
  return runAction(recordIdSchema, input, (ctx, d) => reopenClinicalRecord(ctx, d));
}
export async function updateRecordSectionAction(input: UpdateRecordSectionInput) {
  return runAction(updateRecordSectionSchema, input, (ctx, d) => updateRecordSection(ctx, d));
}
export async function listSectionRevisionsAction(input: SectionIdInput) {
  return runAction(sectionIdSchema, input, (ctx, d) => listSectionRevisions(ctx, d.sectionId));
}
export async function listAssessmentsAction(input: PatientIdInput) {
  return runAction(patientIdSchema, input, (ctx, d) => listAssessments(ctx, d.patientId));
}
export async function createAssessmentAction(input: CreateAssessmentInput) {
  return runAction(createAssessmentSchema, input, (ctx, d) => createAssessment(ctx, d));
}
export async function updateAssessmentDraftAction(input: UpdateAssessmentDraftInput) {
  return runAction(updateAssessmentDraftSchema, input, (ctx, d) => updateAssessmentDraft(ctx, d));
}
export async function finalizeAssessmentAction(input: AssessmentIdInput) {
  return runAction(assessmentIdSchema, input, (ctx, d) => finalizeAssessment(ctx, d));
}
export async function discardAssessmentDraftAction(input: AssessmentIdInput) {
  return runAction(assessmentIdSchema, input, (ctx, d) => discardAssessmentDraft(ctx, d));
}
export async function addDiagnosisAction(input: AddDiagnosisInput) {
  return runAction(addDiagnosisSchema, input, (ctx, d) => addDiagnosis(ctx, d));
}
export async function updateDiagnosisStatusAction(input: UpdateDiagnosisStatusInput) {
  return runAction(updateDiagnosisStatusSchema, input, (ctx, d) => updateDiagnosisStatus(ctx, d));
}
export async function listClinicalConfigAction() {
  return runAction(emptyInput, {}, (ctx) => listClinicalConfig(ctx));
}
export async function upsertSectionDefinitionAction(input: UpsertSectionDefinitionInput) {
  return runAction(upsertSectionDefinitionSchema, input, (ctx, d) =>
    upsertSectionDefinition(ctx, d),
  );
}
export async function upsertNoteTypeAction(input: UpsertNoteTypeInput) {
  return runAction(upsertNoteTypeSchema, input, (ctx, d) => upsertNoteType(ctx, d));
}
