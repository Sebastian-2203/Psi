import 'server-only';
import type { RichText } from '@/lib/rich-text';
import { recordAudit } from '@/server/audit';
import type { AuthzContext } from '@/server/authz';
import type { Outcome } from '@/server/errors';
import { auditTarget, iso, memberNames, notFound, runClinical } from './shared';

/**
 * Clinical record reads (care team only, RLS). Every read is audited in the same transaction
 * (API_CONTRACTS §9). DTOs never include another member's draft (RLS hides them).
 */

export type SectionDefinitionDto = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  audience: 'any' | 'adult' | 'minor';
  isRequired: boolean;
  position: number;
  isActive: boolean;
};
export type NoteTypeDto = {
  id: string;
  key: string;
  label: string;
  description: string | null;
  position: number;
  isActive: boolean;
};

export type RecordSectionDto = {
  definition: SectionDefinitionDto;
  section: {
    id: string;
    content: RichText;
    contentLocale: 'es' | 'en';
    revision: number;
    lastEditedByMembershipId: string;
    updatedAt: string;
  } | null;
};

export type DiagnosisDto = {
  id: string;
  codeSystem: 'cie10' | 'cie11' | 'dsm5tr' | 'other';
  code: string | null;
  label: string;
  status: 'provisional' | 'confirmed' | 'ruled_out' | 'resolved';
  diagnosedOn: string;
  resolvedOn: string | null;
  recordedByMembershipId: string;
};

export type RecordOverview = {
  record: {
    id: string;
    patientId: string;
    recordNumber: string;
    status: 'open' | 'closed';
    openedAt: string;
    closedAt: string | null;
    closureSummary: RichText | null;
    reopenedAt: string | null;
  };
  isMinor: boolean;
  sections: RecordSectionDto[];
  diagnoses: DiagnosisDto[];
  activePlan: { id: string; version: number; activatedAt: string | null; goalCount: number } | null;
  draftPlanId: string | null;
};

type DefRow = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  audience: SectionDefinitionDto['audience'];
  is_required: boolean;
  position: number;
  is_active: boolean;
};
const toDef = (d: DefRow): SectionDefinitionDto => ({
  id: d.id,
  key: d.key,
  title: d.title,
  description: d.description,
  audience: d.audience,
  isRequired: d.is_required,
  position: d.position,
  isActive: d.is_active,
});

/** CLR-01/02/03: record overview. Sections follow the org catalogue + the patient's age band. */
export async function getClinicalRecord(
  ctx: AuthzContext,
  patientId: string,
): Promise<Outcome<RecordOverview>> {
  return runClinical(ctx, 'clinical.record.read', async (tx, org) => {
    const [r] = await tx<
      {
        id: string;
        record_number: string;
        status: 'open' | 'closed';
        opened_at: Date;
        closed_at: Date | null;
        closure_summary: RichText | null;
        reopened_at: Date | null;
        is_minor: boolean;
      }[]
    >`select r.id, r.record_number, r.status, r.opened_at, r.closed_at, r.closure_summary, r.reopened_at,
             coalesce(app.patient_is_minor(r.organization_id, r.patient_id), false) as is_minor
      from public.clinical_records r where r.organization_id = ${org} and r.patient_id = ${patientId}`;
    if (!r) return notFound();
    const defs = await tx<DefRow[]>`
      select id, key, title, description, audience, is_required, position, is_active
      from public.clinical_section_definitions
      where organization_id = ${org}
        and (audience = 'any' or audience = ${r.is_minor ? 'minor' : 'adult'}::public.section_audience)
      order by position, key`;
    const sections = await tx<
      {
        id: string;
        section_definition_id: string;
        content: RichText;
        content_locale: 'es' | 'en';
        revision: number;
        last_edited_by_membership_id: string;
        updated_at: Date;
      }[]
    >`select id, section_definition_id, content, content_locale, revision, last_edited_by_membership_id, updated_at
      from public.clinical_record_sections where organization_id = ${org} and clinical_record_id = ${r.id}`;
    const byDef = new Map(sections.map((s) => [s.section_definition_id, s]));
    const diagnoses = await tx<
      {
        id: string;
        code_system: DiagnosisDto['codeSystem'];
        code: string | null;
        label: string;
        status: DiagnosisDto['status'];
        diagnosed_on: string;
        resolved_on: string | null;
        recorded_by_membership_id: string;
      }[]
    >`select id, code_system, code, label, status, diagnosed_on::text, resolved_on::text, recorded_by_membership_id
      from public.clinical_diagnoses where organization_id = ${org} and clinical_record_id = ${r.id}
      order by diagnosed_on desc, created_at desc`;
    const plans = await tx<
      { id: string; version: number; status: string; activated_at: Date | null; goals: number }[]
    >`
      select p.id, p.version, p.status, p.activated_at,
             (select count(*)::int from public.treatment_goals g where g.organization_id = p.organization_id
                and g.treatment_plan_id = p.id) as goals
      from public.treatment_plans p
      where p.organization_id = ${org} and p.clinical_record_id = ${r.id} and p.status in ('active', 'draft')`;
    const active = plans.find((p) => p.status === 'active');
    await recordAudit(
      tx,
      'clinical_record.viewed',
      { patient_id: patientId },
      auditTarget(ctx, 'clinical_record', r.id),
    );
    return {
      record: {
        id: r.id,
        patientId,
        recordNumber: r.record_number,
        status: r.status,
        openedAt: iso(r.opened_at) as string,
        closedAt: iso(r.closed_at),
        closureSummary: r.closure_summary,
        reopenedAt: iso(r.reopened_at),
      },
      isMinor: r.is_minor,
      sections: defs
        .filter((d) => d.is_active || byDef.has(d.id))
        .map((d) => {
          const s = byDef.get(d.id);
          return {
            definition: toDef(d),
            section: s
              ? {
                  id: s.id,
                  content: s.content,
                  contentLocale: s.content_locale,
                  revision: s.revision,
                  lastEditedByMembershipId: s.last_edited_by_membership_id,
                  updatedAt: iso(s.updated_at) as string,
                }
              : null,
          };
        }),
      diagnoses: diagnoses.map((d) => ({
        id: d.id,
        codeSystem: d.code_system,
        code: d.code,
        label: d.label,
        status: d.status,
        diagnosedOn: d.diagnosed_on,
        resolvedOn: d.resolved_on,
        recordedByMembershipId: d.recorded_by_membership_id,
      })),
      activePlan: active
        ? {
            id: active.id,
            version: active.version,
            activatedAt: iso(active.activated_at),
            goalCount: active.goals,
          }
        : null,
      draftPlanId: plans.find((p) => p.status === 'draft')?.id ?? null,
    };
  });
}

export type SectionRevisionDto = {
  revision: number;
  content: RichText;
  contentLocale: 'es' | 'en';
  editedByMembershipId: string;
  editedAt: string;
};

export async function listSectionRevisions(
  ctx: AuthzContext,
  sectionId: string,
): Promise<Outcome<SectionRevisionDto[]>> {
  return runClinical(ctx, 'clinical.record.read', async (tx, org) => {
    const [section] = await tx<{ patient_id: string }[]>`
      select patient_id from public.clinical_record_sections where organization_id = ${org} and id = ${sectionId}`;
    if (!section) return notFound();
    const rows = await tx<
      {
        revision: number;
        content: RichText;
        content_locale: 'es' | 'en';
        edited_by_membership_id: string;
        edited_at: Date;
      }[]
    >`select revision, content, content_locale, edited_by_membership_id, edited_at
      from public.clinical_record_section_revisions
      where organization_id = ${org} and section_id = ${sectionId} order by revision desc limit 200`;
    await recordAudit(
      tx,
      'clinical_record_section.history_viewed',
      { patient_id: section.patient_id, result_count: rows.length },
      auditTarget(ctx, 'clinical_record_section', sectionId),
    );
    return rows.map((r) => ({
      revision: r.revision,
      content: r.content,
      contentLocale: r.content_locale,
      editedByMembershipId: r.edited_by_membership_id,
      editedAt: iso(r.edited_at) as string,
    }));
  });
}

export type AssessmentDto = {
  id: string;
  assessedOn: string;
  instrumentName: string;
  instrumentReference: string | null;
  administeredBy: string | null;
  results: RichText;
  interpretation: RichText | null;
  attachmentFileId: string | null;
  correctsAssessmentId: string | null;
  status: 'draft' | 'finalized';
  authorMembershipId: string;
  /** Staff display name (org_member_directory); null when no longer listed. */
  authorName: string | null;
  finalizedAt: string | null;
  updatedAt: string;
};

/** Finalized assessments + the caller's own drafts (RLS), newest first. */
export async function listAssessments(
  ctx: AuthzContext,
  patientId: string,
): Promise<Outcome<AssessmentDto[]>> {
  return runClinical(ctx, 'clinical.record.read', async (tx, org) => {
    const [visible] =
      await tx`select app.can_read_clinical(${org}::uuid, ${patientId}::uuid) as ok`;
    if (!visible?.ok) return notFound();
    const rows = await tx<
      {
        id: string;
        assessed_on: string;
        instrument_name: string;
        instrument_reference: string | null;
        administered_by: string | null;
        results: RichText;
        interpretation: RichText | null;
        attachment_file_id: string | null;
        corrects_assessment_id: string | null;
        status: 'draft' | 'finalized';
        author_membership_id: string;
        finalized_at: Date | null;
        updated_at: Date;
      }[]
    >`select id, assessed_on::text, instrument_name, instrument_reference, administered_by, results, interpretation,
             attachment_file_id, corrects_assessment_id, status, author_membership_id, finalized_at, updated_at
      from public.clinical_assessments
      where organization_id = ${org} and patient_id = ${patientId} and discarded_at is null
      order by assessed_on desc, created_at desc limit 200`;
    await recordAudit(
      tx,
      'clinical_assessment.list_viewed',
      { patient_id: patientId, result_count: rows.length },
      auditTarget(ctx, 'patient', patientId),
    );
    const name = await memberNames(tx, org);
    return rows.map((a) => ({
      id: a.id,
      assessedOn: a.assessed_on,
      instrumentName: a.instrument_name,
      instrumentReference: a.instrument_reference,
      administeredBy: a.administered_by,
      results: a.results,
      interpretation: a.interpretation,
      attachmentFileId: a.attachment_file_id,
      correctsAssessmentId: a.corrects_assessment_id,
      status: a.status,
      authorMembershipId: a.author_membership_id,
      authorName: name(a.author_membership_id),
      finalizedAt: iso(a.finalized_at),
      updatedAt: iso(a.updated_at) as string,
    }));
  });
}

/** Org catalogue (section definitions + note types); not clinical data, not audited. */
export async function listClinicalConfig(
  ctx: AuthzContext,
): Promise<Outcome<{ sectionDefinitions: SectionDefinitionDto[]; noteTypes: NoteTypeDto[] }>> {
  return runClinical(ctx, 'clinical.config.read', async (tx, org) => {
    const defs = await tx<DefRow[]>`
      select id, key, title, description, audience, is_required, position, is_active
      from public.clinical_section_definitions where organization_id = ${org} order by position, key`;
    const types = await tx<
      {
        id: string;
        key: string;
        label: string;
        description: string | null;
        position: number;
        is_active: boolean;
      }[]
    >`select id, key, label, description, position, is_active
      from public.clinical_note_types where organization_id = ${org} order by position, key`;
    return {
      sectionDefinitions: defs.map(toDef),
      noteTypes: types.map((t) => ({
        id: t.id,
        key: t.key,
        label: t.label,
        description: t.description,
        position: t.position,
        isActive: t.is_active,
      })),
    };
  });
}
