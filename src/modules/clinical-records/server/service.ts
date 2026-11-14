import 'server-only';
import {
  addDiagnosisSchema,
  closeRecordSchema,
  createAssessmentSchema,
  updateAssessmentDraftSchema,
  updateDiagnosisStatusSchema,
  updateRecordSectionSchema,
  upsertNoteTypeSchema,
  upsertSectionDefinitionSchema,
} from '@/modules/clinical-records/schemas';
import { recordAudit } from '@/server/audit';
import type { AuthzContext } from '@/server/authz';
import { AppError, type Outcome } from '@/server/errors';
import type { z } from 'zod';
import { auditTarget, iso, notFound, runClinical } from './shared';

/**
 * Clinical record use cases (API_CONTRACTS §8.6). Framework-free: integration tests call them
 * with a real AuthzContext. Inputs are the Zod OUTPUT types (actions parse first).
 * Integrity (immutability, author-only drafts, record open, revisions) is enforced by the DB
 * triggers of 20261114200000_clinical_core.sql; this layer adds optimistic concurrency + audit.
 */

type Out<S extends z.ZodType> = z.output<S>;

export type RecordRef = { recordId: string; recordNumber: string; status: 'open' | 'closed' };

/** CLR-01: get-or-create the patient's single record (idempotent). */
export async function openClinicalRecord(
  ctx: AuthzContext,
  input: { patientId: string },
): Promise<Outcome<RecordRef & { created: boolean }>> {
  return runClinical(ctx, 'clinical.record.write', async (tx, org) => {
    const [existing] = await tx<{ id: string; record_number: string; status: 'open' | 'closed' }[]>`
      select id, record_number, status from public.clinical_records
      where organization_id = ${org} and patient_id = ${input.patientId}`;
    if (existing) {
      return {
        recordId: existing.id,
        recordNumber: existing.record_number,
        status: existing.status,
        created: false,
      };
    }
    const [visible] =
      await tx`select app.can_write_clinical(${org}::uuid, ${input.patientId}::uuid) as ok`;
    if (!visible?.ok) notFound();
    const [row] = await tx<{ id: string; record_number: string }[]>`
      insert into public.clinical_records (organization_id, patient_id, opened_by_membership_id)
      values (${org}, ${input.patientId}, app.my_membership_id(${org}::uuid))
      returning id, record_number`;
    if (!row) throw new Error('record insert returned no row');
    await recordAudit(
      tx,
      'clinical_record.opened',
      { patient_id: input.patientId },
      auditTarget(ctx, 'clinical_record', row.id),
    );
    return {
      recordId: row.id,
      recordNumber: row.record_number,
      status: 'open' as const,
      created: true,
    };
  });
}

async function setRecordStatus(
  ctx: AuthzContext,
  recordId: string,
  status: 'open' | 'closed',
  closureSummary: unknown,
): Promise<Outcome<RecordRef>> {
  return runClinical(ctx, 'clinical.record.write', async (tx, org) => {
    const [current] = await tx<{ patient_id: string; status: string }[]>`
      select patient_id, status from public.clinical_records
      where organization_id = ${org} and id = ${recordId} for update`;
    if (!current) return notFound();
    if (current.status === status) {
      throw new AppError('PRECONDITION_FAILED');
    }
    const [row] = await tx<{ record_number: string }[]>`
      update public.clinical_records
         set status = ${status}::public.record_status,
             closure_summary = ${closureSummary === null ? null : tx.json(closureSummary as never)}
       where organization_id = ${org} and id = ${recordId}
      returning record_number`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      status === 'closed' ? 'clinical_record.closed' : 'clinical_record.reopened',
      { patient_id: current.patient_id },
      auditTarget(ctx, 'clinical_record', recordId),
    );
    return { recordId, recordNumber: row.record_number, status };
  });
}

export const closeClinicalRecord = (ctx: AuthzContext, input: Out<typeof closeRecordSchema>) =>
  setRecordStatus(ctx, input.recordId, 'closed', input.closureSummary);

export const reopenClinicalRecord = (ctx: AuthzContext, input: { recordId: string }) =>
  setRecordStatus(ctx, input.recordId, 'open', null);

export type SectionSaved = { sectionId: string; revision: number; updatedAt: string };

/** Saves a section. `expectedRevision` 0 = first save; otherwise must match (CONFLICT). */
export async function updateRecordSection(
  ctx: AuthzContext,
  input: Out<typeof updateRecordSectionSchema>,
): Promise<Outcome<SectionSaved>> {
  return runClinical(ctx, 'clinical.record.write', async (tx, org) => {
    const [record] = await tx<{ patient_id: string }[]>`
      select patient_id from public.clinical_records where organization_id = ${org} and id = ${input.recordId}`;
    if (!record) return notFound();
    const [current] = await tx<{ id: string; revision: number }[]>`
      select id, revision from public.clinical_record_sections
      where organization_id = ${org} and clinical_record_id = ${input.recordId}
        and section_definition_id = ${input.sectionDefinitionId} for update`;
    if ((current?.revision ?? 0) !== input.expectedRevision) throw new AppError('CONFLICT');
    const [row] = current
      ? await tx<{ id: string; revision: number; updated_at: Date }[]>`
          update public.clinical_record_sections
             set content = ${tx.json(input.content as never)}, content_locale = ${input.contentLocale}
           where organization_id = ${org} and id = ${current.id}
          returning id, revision, updated_at`
      : await tx<{ id: string; revision: number; updated_at: Date }[]>`
          insert into public.clinical_record_sections (organization_id, clinical_record_id, patient_id,
            section_definition_id, content, content_locale, last_edited_by_membership_id)
          values (${org}, ${input.recordId}, ${record.patient_id}, ${input.sectionDefinitionId},
            ${tx.json(input.content as never)}, ${input.contentLocale}, app.my_membership_id(${org}::uuid))
          returning id, revision, updated_at`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'clinical_record_section.updated',
      {
        patient_id: record.patient_id,
        section_definition_id: input.sectionDefinitionId,
        revision: row.revision,
      },
      auditTarget(ctx, 'clinical_record_section', row.id),
    );
    return { sectionId: row.id, revision: row.revision, updatedAt: iso(row.updated_at) as string };
  });
}

/* ------------------------------------ assessments ------------------------------------ */

export type AssessmentRef = { assessmentId: string; updatedAt: string };

export async function createAssessment(
  ctx: AuthzContext,
  input: Out<typeof createAssessmentSchema>,
): Promise<Outcome<AssessmentRef>> {
  return runClinical(ctx, 'clinical.assessment.write', async (tx, org) => {
    const [record] = await tx<{ patient_id: string }[]>`
      select patient_id from public.clinical_records where organization_id = ${org} and id = ${input.recordId}`;
    if (!record) return notFound();
    const [row] = await tx<{ id: string; updated_at: Date }[]>`
      insert into public.clinical_assessments (organization_id, clinical_record_id, patient_id, assessed_on,
        instrument_name, instrument_reference, administered_by, results, interpretation, attachment_file_id,
        corrects_assessment_id, author_membership_id)
      values (${org}, ${input.recordId}, ${record.patient_id}, ${input.assessedOn}::date, ${input.instrumentName},
        ${input.instrumentReference ?? null}, ${input.administeredBy ?? null}, ${tx.json(input.results as never)},
        ${input.interpretation ? tx.json(input.interpretation as never) : null}, ${input.attachmentFileId ?? null},
        ${input.correctsAssessmentId ?? null}, app.my_membership_id(${org}::uuid))
      returning id, updated_at`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'clinical_assessment.created',
      { patient_id: record.patient_id },
      auditTarget(ctx, 'clinical_assessment', row.id),
    );
    return { assessmentId: row.id, updatedAt: iso(row.updated_at) as string };
  });
}

const ASSESSMENT_COLUMNS = {
  assessedOn: 'assessed_on',
  instrumentName: 'instrument_name',
  instrumentReference: 'instrument_reference',
  administeredBy: 'administered_by',
  results: 'results',
  interpretation: 'interpretation',
  attachmentFileId: 'attachment_file_id',
} as const;

export async function updateAssessmentDraft(
  ctx: AuthzContext,
  input: Out<typeof updateAssessmentDraftSchema>,
): Promise<Outcome<AssessmentRef>> {
  return runClinical(ctx, 'clinical.assessment.write', async (tx, org) => {
    const [current] = await tx<{ patient_id: string; updated_at: Date; status: string }[]>`
      select patient_id, updated_at, status from public.clinical_assessments
      where organization_id = ${org} and id = ${input.assessmentId} and discarded_at is null for update`;
    if (!current) return notFound();
    if (current.status === 'finalized') throw new AppError('IMMUTABLE_RECORD');
    if (iso(current.updated_at) !== input.expectedUpdatedAt) throw new AppError('CONFLICT');
    const values: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(ASSESSMENT_COLUMNS)) {
      const value = (input as Record<string, unknown>)[key];
      if (value === undefined) continue;
      values[column] =
        column === 'results' || column === 'interpretation' ? tx.json(value as never) : value;
    }
    const changed = Object.keys(values);
    if (changed.length === 0) {
      return { assessmentId: input.assessmentId, updatedAt: input.expectedUpdatedAt };
    }
    const [row] = await tx<{ updated_at: Date }[]>`
      update public.clinical_assessments set ${tx(values as Record<string, never>, ...changed)}
      where organization_id = ${org} and id = ${input.assessmentId}
      returning updated_at`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'clinical_assessment.updated',
      { patient_id: current.patient_id, changed_fields: changed },
      auditTarget(ctx, 'clinical_assessment', input.assessmentId),
    );
    return { assessmentId: input.assessmentId, updatedAt: iso(row.updated_at) as string };
  });
}

export async function finalizeAssessment(
  ctx: AuthzContext,
  input: { assessmentId: string },
): Promise<Outcome<{ finalizedAt: string; contentHash: string }>> {
  return runClinical(ctx, 'clinical.assessment.write', async (tx, org) => {
    const [row] = await tx<{ finalized_at: Date; content_hash: string }[]>`
      select * from app.finalize_clinical_assessment(${org}::uuid, ${input.assessmentId}::uuid, ${ctx.requestId})`;
    if (!row) return notFound();
    return { finalizedAt: iso(row.finalized_at) as string, contentHash: row.content_hash };
  });
}

export async function discardAssessmentDraft(
  ctx: AuthzContext,
  input: { assessmentId: string },
): Promise<Outcome<{ ok: true }>> {
  return runClinical(ctx, 'clinical.assessment.write', async (tx, org) => {
    const [row] = await tx<{ patient_id: string }[]>`
      update public.clinical_assessments set discarded_at = now()
      where organization_id = ${org} and id = ${input.assessmentId} and status = 'draft' and discarded_at is null
      returning patient_id`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'clinical_assessment.discarded',
      { patient_id: row.patient_id },
      auditTarget(ctx, 'clinical_assessment', input.assessmentId),
    );
    return { ok: true as const };
  });
}

/* ------------------------------------- diagnoses ------------------------------------- */

export async function addDiagnosis(
  ctx: AuthzContext,
  input: Out<typeof addDiagnosisSchema>,
): Promise<Outcome<{ diagnosisId: string }>> {
  return runClinical(ctx, 'clinical.diagnosis.write', async (tx, org) => {
    const [record] = await tx<{ patient_id: string }[]>`
      select patient_id from public.clinical_records where organization_id = ${org} and id = ${input.recordId}`;
    if (!record) return notFound();
    const [row] = await tx<{ id: string }[]>`
      insert into public.clinical_diagnoses (organization_id, clinical_record_id, patient_id, code_system, code, label,
        status, diagnosed_on, notes, recorded_by_membership_id)
      values (${org}, ${input.recordId}, ${record.patient_id}, ${input.codeSystem}::public.code_system,
        ${input.code ?? null}, ${input.label}, ${input.status}::public.diagnosis_status, ${input.diagnosedOn}::date,
        ${input.notes ? tx.json(input.notes as never) : null}, app.my_membership_id(${org}::uuid))
      returning id`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'clinical_diagnosis.added',
      { patient_id: record.patient_id, code_system: input.codeSystem, status: input.status },
      auditTarget(ctx, 'clinical_diagnosis', row.id),
    );
    return { diagnosisId: row.id };
  });
}

export async function updateDiagnosisStatus(
  ctx: AuthzContext,
  input: Out<typeof updateDiagnosisStatusSchema>,
): Promise<Outcome<{ diagnosisId: string; status: string }>> {
  return runClinical(ctx, 'clinical.diagnosis.write', async (tx, org) => {
    const [current] = await tx<{ patient_id: string; status: (typeof input)['status'] }[]>`
      select patient_id, status from public.clinical_diagnoses
      where organization_id = ${org} and id = ${input.diagnosisId} for update`;
    if (!current) return notFound();
    const resolvedOn = input.status === 'resolved' ? (input.resolvedOn ?? null) : null;
    const [row] = await tx`
      update public.clinical_diagnoses
         set status = ${input.status}::public.diagnosis_status,
             resolved_on = coalesce(${resolvedOn}::date, case when ${input.status} = 'resolved' then current_date end)
       where organization_id = ${org} and id = ${input.diagnosisId}
      returning id`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'clinical_diagnosis.status_changed',
      { patient_id: current.patient_id, from_status: current.status, to_status: input.status },
      auditTarget(ctx, 'clinical_diagnosis', input.diagnosisId),
    );
    return { diagnosisId: input.diagnosisId, status: input.status };
  });
}

/* ---------------------------------- configuration ---------------------------------- */

export async function upsertSectionDefinition(
  ctx: AuthzContext,
  input: Out<typeof upsertSectionDefinitionSchema>,
): Promise<Outcome<{ id: string }>> {
  return runClinical(ctx, 'clinical.config.manage', async (tx, org) => {
    const fields = {
      title: input.title,
      description: input.description ?? null,
      audience: input.audience,
      is_required: input.isRequired,
      position: input.position,
      is_active: input.isActive,
    };
    const [row] = input.id
      ? await tx<{ id: string }[]>`
          update public.clinical_section_definitions set ${tx(fields)}
          where organization_id = ${org} and id = ${input.id} and key = ${input.key} returning id`
      : await tx<{ id: string }[]>`
          insert into public.clinical_section_definitions ${tx({ ...fields, organization_id: org, key: input.key, created_by: ctx.profileId })}
          returning id`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'clinical_config.updated',
      { config_kind: 'section_definition', changed_fields: Object.keys(fields) },
      auditTarget(ctx, 'clinical_section_definition', row.id),
    );
    return { id: row.id };
  });
}

export async function upsertNoteType(
  ctx: AuthzContext,
  input: Out<typeof upsertNoteTypeSchema>,
): Promise<Outcome<{ id: string }>> {
  return runClinical(ctx, 'clinical.config.manage', async (tx, org) => {
    const fields = {
      label: input.label,
      description: input.description ?? null,
      position: input.position,
      is_active: input.isActive,
    };
    const [row] = input.id
      ? await tx<{ id: string }[]>`
          update public.clinical_note_types set ${tx(fields)}
          where organization_id = ${org} and id = ${input.id} and key = ${input.key} returning id`
      : await tx<{ id: string }[]>`
          insert into public.clinical_note_types ${tx({ ...fields, organization_id: org, key: input.key, created_by: ctx.profileId })}
          returning id`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'clinical_config.updated',
      { config_kind: 'note_type', changed_fields: Object.keys(fields) },
      auditTarget(ctx, 'clinical_note_type', row.id),
    );
    return { id: row.id };
  });
}
