import 'server-only';
import { recordAudit } from '@/server/audit';
import { requirePermission, type AuthzContext } from '@/server/authz';
import { withUserTransaction } from '@/server/db/server';
import { failure, ok, type Outcome } from '@/server/errors';

/**
 * Consent reads. Evidence (typed name, IP, user agent) is never part of any DTO here.
 * Care team: status of one patient (audited `consent.status_viewed`). Portal: published versions
 * the caller may sign + the caller's own decisions (RLS: a guardian only sees records she signed).
 */

export type ConsentRecordStatus = 'accepted' | 'declined' | 'withdrawn';

export type ConsentStatusEntry = {
  consentRecordId: string;
  templateId: string;
  templateKey: string;
  title: string;
  consentType: string;
  versionId: string;
  signerType: 'patient' | 'guardian' | 'professional_recorded';
  method: string;
  status: ConsentRecordStatus;
  acceptedAt: string;
  withdrawnAt: string | null;
};

export type PatientConsentStatus = {
  /** Latest decision per (template, signer type). */
  records: ConsentStatusEntry[];
  /** Activation blockers (`app.patient_activation_missing` machine keys). */
  activationMissing: string[];
};

export async function getPatientConsentStatus(
  ctx: AuthzContext,
  patientId: string,
): Promise<Outcome<PatientConsentStatus>> {
  const permitted = await requirePermission(ctx, 'consent.record.read');
  if (!permitted.ok) return permitted;
  const result = await withUserTransaction(ctx.claims, async (tx) => {
    const [visible] = await tx`
      select 1 from public.patients where organization_id = ${ctx.organizationId} and id = ${patientId}`;
    if (!visible) return null;
    const rows = await tx<
      {
        id: string;
        template_id: string;
        key: string;
        title: string;
        consent_type: string;
        version_id: string;
        signer_type: ConsentStatusEntry['signerType'];
        method: string;
        status: ConsentRecordStatus;
        accepted_at: Date;
        withdrawn_at: Date | null;
      }[]
    >`select distinct on (r.consent_template_id, r.signer_type)
             r.id, r.consent_template_id as template_id, t.key, t.title, r.consent_type::text as consent_type,
             r.consent_template_version_id as version_id, r.signer_type::text as signer_type,
             r.method::text as method, r.status::text as status, r.accepted_at, r.withdrawn_at
      from public.consent_records r
      join public.consent_templates t on t.organization_id = r.organization_id and t.id = r.consent_template_id
      where r.organization_id = ${ctx.organizationId} and r.patient_id = ${patientId}
      order by r.consent_template_id, r.signer_type, r.accepted_at desc, r.created_at desc`;
    const [m] = await tx<{ m: string[] | null }[]>`
      select app.patient_activation_missing(${ctx.organizationId}::uuid, ${patientId}::uuid) as m`;
    await recordAudit(
      tx,
      'consent.status_viewed',
      { patient_id: patientId },
      {
        organizationId: ctx.organizationId as string,
        resourceType: 'patient',
        resourceId: patientId,
        requestId: ctx.requestId,
      },
    );
    return { rows, missing: m?.m ?? [] };
  });
  if (!result) return failure('NOT_FOUND');
  return ok({
    records: result.rows.map((r) => ({
      consentRecordId: r.id,
      templateId: r.template_id,
      templateKey: r.key,
      title: r.title,
      consentType: r.consent_type,
      versionId: r.version_id,
      signerType: r.signer_type,
      method: r.method,
      status: r.status,
      acceptedAt: r.accepted_at.toISOString(),
      withdrawnAt: r.withdrawn_at ? r.withdrawn_at.toISOString() : null,
    })),
    activationMissing: result.missing,
  });
}

export type SignableConsent = {
  patientId: string;
  templateId: string;
  templateKey: string;
  consentType: string;
  signerRequirement: string;
  versionId: string;
  locale: 'es' | 'en';
  title: string;
  /** Restricted rich-text AST (src/modules/consents/schemas). Rendered by the UI, never as HTML. */
  body: unknown;
  /** Hex sha256 shown to the signer and sent back with the decision. */
  bodyHash: string;
  /** The caller's own latest decision for this template, if any. */
  myStatus: ConsentRecordStatus | null;
  myConsentRecordId: string | null;
};

/**
 * Portal: published versions the active capacity may decide on. patient -> self; guardian ->
 * a patient she has `sign_consents` for (effective relationship). Prefers the caller's locale,
 * falls back to `es`. Audience (minors/adults) is filtered with `app.patient_is_minor`.
 */
export async function listSignableConsents(
  ctx: AuthzContext,
  patientId?: string,
): Promise<Outcome<SignableConsent[]>> {
  const permission = ctx.actingAs === 'guardian' ? 'consent.sign.guardian' : 'consent.sign.self';
  const allowed = await requirePermission(ctx, permission);
  if (!allowed.ok) return allowed;
  let target: string | undefined;
  if (ctx.actingAs === 'patient') {
    target = ctx.patientId;
    if (patientId && patientId !== target) return failure('NOT_FOUND');
  } else {
    const rel = ctx.guardian?.relationships.find(
      (r) => r.patientId === patientId && r.permissions.includes('sign_consents'),
    );
    target = rel?.patientId;
  }
  if (!target) return failure('NOT_FOUND');
  const signer = ctx.actingAs === 'guardian' ? 'guardian' : 'patient';
  const rows = await withUserTransaction(
    ctx.claims,
    (tx) => tx<
      {
        template_id: string;
        key: string;
        consent_type: string;
        signer_requirement: string;
        version_id: string;
        locale: 'es' | 'en';
        title: string;
        body: unknown;
        body_hash: Buffer;
        my_status: ConsentRecordStatus | null;
        my_record: string | null;
      }[]
    >`with minor as (select app.patient_is_minor(${ctx.organizationId}::uuid, ${target}::uuid) as v)
      select distinct on (t.id)
             t.id as template_id, t.key, t.consent_type::text as consent_type,
             t.signer_requirement::text as signer_requirement, v.id as version_id, v.locale, v.title, v.body,
             v.body_hash,
             (select r.status::text from public.consent_records r
               where r.organization_id = t.organization_id and r.patient_id = ${target}
                 and r.consent_template_id = t.id and r.signer_type = ${signer}::public.signer_type
               order by r.accepted_at desc, r.created_at desc limit 1) as my_status,
             (select r.id from public.consent_records r
               where r.organization_id = t.organization_id and r.patient_id = ${target}
                 and r.consent_template_id = t.id and r.signer_type = ${signer}::public.signer_type
               order by r.accepted_at desc, r.created_at desc limit 1) as my_record
      from public.consent_templates t
      join public.consent_template_versions v
        on v.organization_id = t.organization_id and v.consent_template_id = t.id and v.status = 'published'
      cross join minor
      where t.organization_id = ${ctx.organizationId} and t.status = 'published'
        and minor.v is not null
        and ((minor.v and t.applies_to_minors) or (not minor.v and t.applies_to_adults))
        and (case when ${signer} = 'patient'
                  then t.signer_requirement in ('patient', 'patient_and_guardian')
                       and (t.consent_type <> 'minor_assent' or minor.v)
                  else t.signer_requirement in ('guardian', 'patient_and_guardian')
                       and t.consent_type <> 'minor_assent' end)
        and v.locale in (${ctx.locale}, 'es')
      order by t.id, (v.locale = ${ctx.locale}) desc, v.version_number desc`,
  );
  return ok(
    rows.map((r) => ({
      patientId: target,
      templateId: r.template_id,
      templateKey: r.key,
      consentType: r.consent_type,
      signerRequirement: r.signer_requirement,
      versionId: r.version_id,
      locale: r.locale,
      title: r.title,
      body: r.body,
      bodyHash: Buffer.from(r.body_hash).toString('hex'),
      myStatus: r.my_status,
      myConsentRecordId: r.my_record,
    })),
  );
}

// --- Owner: template library --------------------------------------------------------------

export type ConsentVersionSummary = {
  versionId: string;
  versionNumber: number;
  locale: 'es' | 'en';
  title: string;
  status: 'draft' | 'published' | 'retired';
  publishedAt: string | null;
  /** Hex sha256, fixed at publish time. */
  bodyHash: string | null;
  legalReviewReference: string | null;
  /** Draft only (so the owner can keep editing); published text is read through the portal DTO. */
  draftBody: unknown;
};

export type ConsentTemplateSummary = {
  templateId: string;
  key: string;
  title: string;
  consentType: string;
  signerRequirement: string;
  appliesToMinors: boolean;
  appliesToAdults: boolean;
  requiredForActivation: boolean;
  status: 'draft' | 'published' | 'archived';
  versions: ConsentVersionSummary[];
};

/** Owner-only (`consent.template.manage`). RLS: staff of the organization; the DAL scopes explicitly. */
export async function listConsentTemplates(
  ctx: AuthzContext,
): Promise<Outcome<ConsentTemplateSummary[]>> {
  const permitted = await requirePermission(ctx, 'consent.template.manage');
  if (!permitted.ok) return permitted;
  const { templates, versions } = await withUserTransaction(ctx.claims, async (tx) => {
    const templates = await tx<
      {
        id: string;
        key: string;
        title: string;
        consent_type: string;
        signer_requirement: string;
        applies_to_minors: boolean;
        applies_to_adults: boolean;
        required_for_activation: boolean;
        status: ConsentTemplateSummary['status'];
      }[]
    >`select id, key, title, consent_type::text as consent_type, signer_requirement::text as signer_requirement,
             applies_to_minors, applies_to_adults, required_for_activation, status::text as status
      from public.consent_templates
      where organization_id = ${ctx.organizationId}
      order by created_at desc, key`;
    const versions = await tx<
      {
        id: string;
        consent_template_id: string;
        version_number: number;
        locale: 'es' | 'en';
        title: string;
        status: ConsentVersionSummary['status'];
        published_at: Date | null;
        body_hash: Buffer | null;
        legal_review_reference: string | null;
        draft_body: unknown;
      }[]
    >`select id, consent_template_id, version_number, locale, title, status::text as status, published_at,
             body_hash, legal_review_reference,
             case when status = 'draft' then body end as draft_body
      from public.consent_template_versions
      where organization_id = ${ctx.organizationId}
      order by consent_template_id, locale, version_number desc`;
    return { templates, versions };
  });
  return ok(
    templates.map((t) => ({
      templateId: t.id,
      key: t.key,
      title: t.title,
      consentType: t.consent_type,
      signerRequirement: t.signer_requirement,
      appliesToMinors: t.applies_to_minors,
      appliesToAdults: t.applies_to_adults,
      requiredForActivation: t.required_for_activation,
      status: t.status,
      versions: versions
        .filter((v) => v.consent_template_id === t.id)
        .map((v) => ({
          versionId: v.id,
          versionNumber: v.version_number,
          locale: v.locale,
          title: v.title,
          status: v.status,
          publishedAt: v.published_at ? v.published_at.toISOString() : null,
          bodyHash: v.body_hash ? Buffer.from(v.body_hash).toString('hex') : null,
          legalReviewReference: v.legal_review_reference,
          draftBody: v.draft_body ?? null,
        })),
    })),
  );
}

// --- Care team: documents a decision can be recorded for ---------------------------------

export type RecordableConsent = {
  templateId: string;
  versionId: string;
  title: string;
  consentType: string;
  signerRequirement: string;
  requiredForActivation: boolean;
  locale: 'es' | 'en';
};

/**
 * Published versions the care team may record a verbal decision for, independent of existing
 * records (so a new patient can be activated). One version per template (caller locale, else
 * `es`), filtered by the patient's audience. The DB re-checks everything in `app.record_consent`.
 */
export async function listRecordableConsents(
  ctx: AuthzContext,
  patientId: string,
): Promise<Outcome<RecordableConsent[]>> {
  const permitted = await requirePermission(ctx, 'consent.request');
  if (!permitted.ok) return permitted;
  const result = await withUserTransaction(ctx.claims, async (tx) => {
    const [visible] = await tx`
      select 1 from public.patients where organization_id = ${ctx.organizationId} and id = ${patientId}`;
    if (!visible) return null;
    return tx<
      {
        template_id: string;
        version_id: string;
        title: string;
        consent_type: string;
        signer_requirement: string;
        required: boolean;
        locale: 'es' | 'en';
      }[]
    >`with minor as (select app.patient_is_minor(${ctx.organizationId}::uuid, ${patientId}::uuid) as v)
      select * from (
        select distinct on (t.id)
               t.id as template_id, v.id as version_id, v.title, t.consent_type::text as consent_type,
               t.signer_requirement::text as signer_requirement, t.required_for_activation as required, v.locale
        from public.consent_templates t
        join public.consent_template_versions v
          on v.organization_id = t.organization_id and v.consent_template_id = t.id and v.status = 'published'
        cross join minor
        where t.organization_id = ${ctx.organizationId} and t.status = 'published'
          and minor.v is not null
          and ((minor.v and t.applies_to_minors) or (not minor.v and t.applies_to_adults))
          and v.locale in (${ctx.locale}, 'es')
        order by t.id, (v.locale = ${ctx.locale}) desc, v.version_number desc
      ) x
      order by required desc, title`;
  });
  if (!result) return failure('NOT_FOUND');
  return ok(
    result.map((r) => ({
      templateId: r.template_id,
      versionId: r.version_id,
      title: r.title,
      consentType: r.consent_type,
      signerRequirement: r.signer_requirement,
      requiredForActivation: r.required,
      locale: r.locale,
    })),
  );
}
