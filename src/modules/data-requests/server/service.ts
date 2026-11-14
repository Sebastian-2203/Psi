import 'server-only';
import type {
  SubmitDataRequestInput,
  UpdateDataRequestInput,
} from '@/modules/data-requests/schemas';
import { requirePermission, type AuthzContext } from '@/server/authz';
import { withUserTransaction } from '@/server/db/server';
import { dbFailure, failure, ok, type Outcome } from '@/server/errors';
import { DSR_PRECONDITION_KEYS } from './errors';

/**
 * Data-subject request use cases (PAT-09). Both writes go through definer functions that
 * re-derive the caller's real capacity and write the audit row atomically:
 * `app.submit_data_subject_request` (portal) and `app.update_data_subject_request` (care team /
 * owner). Resolving a request never touches clinical rows: rectification of clinical content is
 * an addendum made by the professional elsewhere. [NEEDS LEGAL VERIFICATION]
 */

export async function submitDataRequest(
  ctx: AuthzContext,
  input: SubmitDataRequestInput & { requestType: 'access' | 'rectification' },
): Promise<Outcome<{ requestId: string }>> {
  if (ctx.actingAs !== 'patient' && ctx.actingAs !== 'guardian') return failure('FORBIDDEN');
  const permitted = await requirePermission(
    ctx,
    ctx.actingAs === 'patient' ? 'dsr.submit.self' : 'dsr.submit.guardian',
  );
  if (!permitted.ok) return permitted;
  // A patient is always herself; a guardian's subject is her own guardian record.
  const patientId = ctx.actingAs === 'patient' ? ctx.patientId : null;
  if (ctx.actingAs === 'patient' && !patientId) return failure('FORBIDDEN');
  try {
    const id = await withUserTransaction(ctx.claims, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        select app.submit_data_subject_request(
          ${ctx.organizationId}::uuid, ${ctx.actingAs}, ${patientId ?? null}::uuid,
          ${input.requestType}::public.dsr_type, ${input.note ?? null}, ${ctx.requestId}) as id`;
      if (!row) throw new Error('submit_data_subject_request returned no row');
      return row.id;
    });
    return ok({ requestId: id });
  } catch (error) {
    return dbFailure(error, DSR_PRECONDITION_KEYS);
  }
}

export async function updateDataRequest(
  ctx: AuthzContext,
  input: UpdateDataRequestInput & { requestId: string; status: string },
): Promise<Outcome<{ requestId: string }>> {
  const permitted = await requirePermission(ctx, 'dsr.manage');
  if (!permitted.ok) return permitted;
  const dueAt = input.dueDate ? `${input.dueDate}T23:59:59Z` : null;
  try {
    await withUserTransaction(ctx.claims, async (tx) => {
      await tx`
        select app.update_data_subject_request(
          ${ctx.organizationId}::uuid, ${input.requestId}::uuid, ${input.status}::public.dsr_status,
          ${input.resolutionSummary ?? null}, ${dueAt}::timestamptz, ${ctx.requestId})`;
    });
    return ok({ requestId: input.requestId });
  } catch (error) {
    return dbFailure(error, DSR_PRECONDITION_KEYS);
  }
}
