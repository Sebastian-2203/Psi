import 'server-only';
import type {
  CreateConsentTemplateInput,
  PublishConsentVersionInput,
  RecordConsentInput,
  SaveConsentVersionDraftInput,
  SignConsentInput,
  WithdrawConsentInput,
} from '@/modules/consents/schemas';
import { recordAudit } from '@/server/audit';
import { requirePermission, type AuthzContext, type Permission } from '@/server/authz';
import { withUserTransaction } from '@/server/db/server';
import { AppError, dbFailure, failure, ok, type Outcome } from '@/server/errors';
import { CONSENT_PRECONDITION_KEYS } from './errors';

/**
 * Consent use cases. Signing, recording and withdrawing go through the definer functions
 * (`app.sign_consent`, `app.record_consent`, `app.withdraw_consent`): they re-derive the
 * caller's real capacity, verify the text hash against the published body, write the record,
 * the evidence and the audit row atomically. Evidence (typed name, IP, user agent) is never
 * returned by these functions. Records are never updated except the one-time withdrawal.
 */

const IP = /^[0-9a-fA-F:.]{2,45}$/;

// --- Templates (owner) ---------------------------------------------------------------

export async function createConsentTemplate(
  ctx: AuthzContext,
  input: CreateConsentTemplateInput & { key: string; requiredForActivation: boolean },
): Promise<Outcome<{ templateId: string }>> {
  const permitted = await requirePermission(ctx, 'consent.template.manage');
  if (!permitted.ok) return permitted;
  try {
    const id = await withUserTransaction(ctx.claims, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        insert into public.consent_templates
          (organization_id, key, consent_type, title, signer_requirement, applies_to_minors, applies_to_adults,
           required_for_activation)
        values (${ctx.organizationId}, ${input.key}, ${input.consentType}::public.consent_type, ${input.title},
                ${input.signerRequirement}::public.consent_signer_requirement, ${input.appliesToMinors},
                ${input.appliesToAdults}, ${input.requiredForActivation})
        returning id`;
      if (!row) throw new AppError('FORBIDDEN');
      await recordAudit(
        tx,
        'consent_template.created',
        { consent_template_id: row.id, consent_type: input.consentType },
        {
          organizationId: ctx.organizationId as string,
          resourceType: 'consent_template',
          resourceId: row.id,
          requestId: ctx.requestId,
        },
      );
      return row.id;
    });
    return ok({ templateId: id });
  } catch (error) {
    return dbFailure(error, CONSENT_PRECONDITION_KEYS);
  }
}

export async function saveConsentVersionDraft(
  ctx: AuthzContext,
  input: SaveConsentVersionDraftInput & { templateId: string; locale: 'es' | 'en' },
): Promise<Outcome<{ versionId: string }>> {
  const permitted = await requirePermission(ctx, 'consent.template.manage');
  if (!permitted.ok) return permitted;
  try {
    const id = await withUserTransaction(ctx.claims, async (tx) => {
      const body = tx.json(input.body as never);
      const [draft] = await tx<{ id: string }[]>`
        select id from public.consent_template_versions
        where organization_id = ${ctx.organizationId} and consent_template_id = ${input.templateId}
          and locale = ${input.locale} and status = 'draft' for update`;
      let versionId: string;
      if (draft) {
        await tx`update public.consent_template_versions
                 set title = ${input.title}, body = ${body}, legal_review_reference = ${input.legalReviewReference ?? null}
                 where organization_id = ${ctx.organizationId} and id = ${draft.id}`;
        versionId = draft.id;
      } else {
        const [row] = await tx<{ id: string }[]>`
          insert into public.consent_template_versions
            (organization_id, consent_template_id, locale, title, body, legal_review_reference)
          values (${ctx.organizationId}, ${input.templateId}, ${input.locale}, ${input.title}, ${body},
                  ${input.legalReviewReference ?? null})
          returning id`;
        if (!row) throw new AppError('FORBIDDEN');
        versionId = row.id;
      }
      await recordAudit(
        tx,
        'consent_template_version.draft_saved',
        { consent_template_id: input.templateId, consent_template_version_id: versionId },
        {
          organizationId: ctx.organizationId as string,
          resourceType: 'consent_template_version',
          resourceId: versionId,
          requestId: ctx.requestId,
        },
      );
      return versionId;
    });
    return ok({ versionId: id });
  } catch (error) {
    return dbFailure(error, CONSENT_PRECONDITION_KEYS);
  }
}

/** Publishing fixes the body hash in the DB; the text is immutable afterwards (CON-01). */
export async function publishConsentVersion(
  ctx: AuthzContext,
  input: PublishConsentVersionInput & { versionId: string },
): Promise<Outcome<{ bodyHash: string; publishedAt: string }>> {
  const permitted = await requirePermission(ctx, 'consent.template.manage');
  if (!permitted.ok) return permitted;
  try {
    const row = await withUserTransaction(ctx.claims, async (tx) => {
      const [v] = await tx<
        { consent_template_id: string; body_hash: Buffer; published_at: Date }[]
      >`
        update public.consent_template_versions set status = 'published'
        where organization_id = ${ctx.organizationId} and id = ${input.versionId} and status = 'draft'
        returning consent_template_id, body_hash, published_at`;
      if (!v) throw new AppError('NOT_FOUND');
      await tx`update public.consent_templates set status = 'published'
               where organization_id = ${ctx.organizationId} and id = ${v.consent_template_id} and status = 'draft'`;
      await recordAudit(
        tx,
        'consent_template_version.published',
        {
          consent_template_id: v.consent_template_id,
          consent_template_version_id: input.versionId,
        },
        {
          organizationId: ctx.organizationId as string,
          resourceType: 'consent_template_version',
          resourceId: input.versionId,
          requestId: ctx.requestId,
        },
      );
      return v;
    });
    return ok({
      bodyHash: Buffer.from(row.body_hash).toString('hex'),
      publishedAt: row.published_at.toISOString(),
    });
  } catch (error) {
    return dbFailure(error, CONSENT_PRECONDITION_KEYS);
  }
}

// --- Decisions -------------------------------------------------------------------------

/** Portal signature. Capacity -> permission; the DB re-checks self / `sign_consents` + hash. */
export async function signConsent(
  ctx: AuthzContext,
  input: SignConsentInput & { patientId: string; textHash: string; checkboxConfirmed: true },
  evidence: { ip: string | null; userAgent: string | null },
): Promise<Outcome<{ consentRecordId: string }>> {
  const permission: Permission | null =
    ctx.actingAs === 'patient'
      ? 'consent.sign.self'
      : ctx.actingAs === 'guardian'
        ? 'consent.sign.guardian'
        : null;
  if (!permission) return failure('FORBIDDEN');
  const permitted = await requirePermission(ctx, permission);
  if (!permitted.ok) return permitted;
  // A patient may only sign for herself: a different id is indistinguishable from a missing one.
  if (ctx.actingAs === 'patient' && ctx.patientId !== input.patientId) return failure('NOT_FOUND');
  const ip = evidence.ip && IP.test(evidence.ip) ? evidence.ip : null;
  try {
    const id = await withUserTransaction(ctx.claims, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        select app.sign_consent(
          ${ctx.organizationId}::uuid, ${ctx.actingAs}, ${input.patientId}::uuid, ${input.versionId}::uuid,
          ${input.decision}::public.consent_decision, ${input.typedName}, ${input.checkboxConfirmed},
          ${Buffer.from(input.textHash, 'hex')}, ${ip}::inet, ${evidence.userAgent}, ${ctx.requestId}) as id`;
      if (!row) throw new Error('sign_consent returned no row');
      return row.id;
    });
    return ok({ consentRecordId: id });
  } catch (error) {
    return dbFailure(error, CONSENT_PRECONDITION_KEYS);
  }
}

/** Care-team record of a verbal decision (CON-02). */
export async function recordConsent(
  ctx: AuthzContext,
  input: RecordConsentInput & { patientId: string; versionId: string },
): Promise<Outcome<{ consentRecordId: string }>> {
  const permitted = await requirePermission(ctx, 'consent.request');
  if (!permitted.ok) return permitted;
  try {
    const id = await withUserTransaction(ctx.claims, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        select app.record_consent(
          ${ctx.organizationId}::uuid, ${input.patientId}::uuid, ${input.versionId}::uuid,
          ${input.signerType}::public.signer_type, ${input.patientGuardianId ?? null}::uuid,
          ${input.method}::public.consent_method, ${input.decision}::public.consent_decision,
          ${input.decidedAt}::timestamptz, ${ctx.requestId}) as id`;
      if (!row) throw new Error('record_consent returned no row');
      return row.id;
    });
    return ok({ consentRecordId: id });
  } catch (error) {
    return dbFailure(error, CONSENT_PRECONDITION_KEYS);
  }
}

export async function withdrawConsent(
  ctx: AuthzContext,
  input: WithdrawConsentInput & { consentRecordId: string },
): Promise<Outcome<{ ok: true }>> {
  const permission: Permission =
    ctx.actingAs === 'staff' ? 'consent.withdraw' : 'consent.withdraw.own';
  const permitted = await requirePermission(ctx, permission);
  if (!permitted.ok) return permitted;
  try {
    await withUserTransaction(ctx.claims, async (tx) => {
      await tx`
        select app.withdraw_consent(${ctx.organizationId}::uuid, ${ctx.actingAs}, ${input.consentRecordId}::uuid,
                                    ${input.reason}, ${ctx.requestId})`;
    });
    return ok({ ok: true });
  } catch (error) {
    return dbFailure(error, CONSENT_PRECONDITION_KEYS);
  }
}
