import 'server-only';
import { recordSystemAudit } from '@/server/audit';
import { requirePermission, type AuthzContext, type Permission } from '@/server/authz';
import { withUserTransaction, type UserTransaction } from '@/server/db/server';
import { AppError, dbFailure, ok, type Outcome } from '@/server/errors';

/**
 * Shared clinical use-case runner (Phase 3). Every clinical use case:
 *   requirePermission (capacity / role / aal2 / org status)
 *   -> ONE user transaction (RLS app.can_read_clinical / can_write_clinical + DB triggers)
 *   -> audit in the same transaction (reads included: API_CONTRACTS §9).
 * A row the caller cannot see is NOT_FOUND (anti-enumeration) and is audited as
 * `access.denied` through the system writer (SECURITY.md §4.5).
 */
export async function runClinical<T>(
  ctx: AuthzContext,
  permission: Permission,
  work: (tx: UserTransaction, org: string) => Promise<T>,
  preconditionKeys: Readonly<Record<string, string>> = {},
): Promise<Outcome<T>> {
  const permitted = await requirePermission(ctx, permission);
  if (!permitted.ok) return permitted;
  const org = ctx.organizationId as string;
  try {
    return ok(await withUserTransaction(ctx.claims, (tx) => work(tx, org)));
  } catch (error) {
    const failed = dbFailure(error, { ...CLINICAL_PRECONDITION_KEYS, ...preconditionKeys });
    if (failed.error.code === 'NOT_FOUND') {
      try {
        await recordSystemAudit(
          'access.denied',
          { permission, code: 'NOT_FOUND', acting_as: ctx.actingAs },
          { actorProfileId: ctx.profileId, organizationId: org, requestId: ctx.requestId },
        );
      } catch {
        // The denial stands even if the audit write fails.
      }
    }
    return failed;
  }
}

export const notFound = (): never => {
  throw new AppError('NOT_FOUND');
};

export const auditTarget = (
  ctx: AuthzContext,
  resourceType: string,
  resourceId: string | null,
) => ({
  organizationId: ctx.organizationId as string,
  resourceType,
  resourceId,
  requestId: ctx.requestId,
});

/** `PRECONDITION:<key>` raised by the clinical DB layer -> i18n key (clinical.errors.*). */
export const CLINICAL_PRECONDITION_KEYS = {
  record_closed: 'clinical.errors.recordClosed',
  closure_summary_required: 'clinical.errors.closureSummaryRequired',
  stale_revision: 'clinical.errors.staleRevision',
  finalize: 'clinical.errors.finalizeRejected',
  note_empty: 'clinical.errors.noteEmpty',
  note_type_inactive: 'clinical.errors.noteTypeInactive',
  note_not_finalized: 'clinical.errors.noteNotFinalized',
  addendum_empty: 'clinical.errors.addendumEmpty',
  discard_changes_content: 'clinical.errors.discardChangesContent',
  assessment_empty: 'clinical.errors.assessmentEmpty',
  attachment_not_ready: 'clinical.errors.attachmentNotReady',
  corrects_must_be_finalized: 'clinical.errors.correctsMustBeFinalized',
  plan_not_draft: 'clinical.errors.planNotDraft',
  plan_is_draft: 'clinical.errors.planIsDraft',
  plan_not_active: 'clinical.errors.planNotActive',
  plan_without_goals: 'clinical.errors.planWithoutGoals',
  plan_summary_empty: 'clinical.errors.planSummaryEmpty',
  invalid_plan_transition: 'clinical.errors.invalidPlanTransition',
  file_not_ready: 'clinical.errors.fileNotReady',
  file_must_start_pending: 'clinical.errors.fileNotReady',
  invalid_file_transition: 'clinical.errors.fileNotReady',
  document_archived: 'clinical.errors.documentArchived',
  archive_reason_required: 'clinical.errors.archiveReasonRequired',
} as const;

/** Row timestamps arrive as Date from postgres.js; DTOs carry ISO strings. */
export const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

/**
 * Portal projections (patient self / guardian of a minor). The target patient comes from the
 * context: a patient reads herself; a guardian names one of HER relationships. The SECURITY
 * DEFINER projection re-checks everything (status, permission, minor, caveats) in the DB.
 */
export async function runPortal<T>(
  ctx: AuthzContext,
  permission: Permission,
  patientId: string | undefined,
  work: (tx: UserTransaction, org: string, patientId: string) => Promise<T>,
): Promise<Outcome<T>> {
  const permitted = await requirePermission(ctx, permission);
  if (!permitted.ok) return permitted;
  let target: string | undefined;
  if (ctx.actingAs === 'patient') {
    target = ctx.patientId;
    if (patientId && patientId !== target) target = undefined;
  } else if (ctx.actingAs === 'guardian') {
    target = ctx.guardian?.relationships.find((r) => r.patientId === patientId)?.patientId;
  }
  if (!target) return { ok: false, error: new AppError('NOT_FOUND') };
  const org = ctx.organizationId as string;
  const patient = target;
  try {
    return ok(await withUserTransaction(ctx.claims, (tx) => work(tx, org, patient)));
  } catch (error) {
    return dbFailure(error, CLINICAL_PRECONDITION_KEYS);
  }
}
