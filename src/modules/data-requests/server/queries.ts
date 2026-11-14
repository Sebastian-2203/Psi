import 'server-only';
import { recordAudit } from '@/server/audit';
import { requirePermission, type AuthzContext } from '@/server/authz';
import { withUserTransaction } from '@/server/db/server';
import { ok, type Outcome } from '@/server/errors';

export type DataRequestStatus =
  'received' | 'in_review' | 'fulfilled' | 'partially_fulfilled' | 'rejected';

export type MyDataRequest = {
  requestId: string;
  requestType:
    'access' | 'rectification' | 'update' | 'suppression' | 'revoke_authorization' | 'other';
  status: DataRequestStatus;
  receivedAt: string;
  dueAt: string | null;
  resolvedAt: string | null;
  resolutionSummary: string | null;
};

/** Portal: the caller's own requests (RLS: patient self / own guardian record). */
export async function listMyDataRequests(ctx: AuthzContext): Promise<Outcome<MyDataRequest[]>> {
  const permitted = await requirePermission(ctx, 'dsr.read.own');
  if (!permitted.ok) return permitted;
  const rows = await withUserTransaction(
    ctx.claims,
    (tx) => tx<
      {
        id: string;
        request_type: MyDataRequest['requestType'];
        status: DataRequestStatus;
        received_at: Date;
        due_at: Date | null;
        resolved_at: Date | null;
        resolution_summary: string | null;
      }[]
    >`select id, request_type::text as request_type, status::text as status, received_at, due_at, resolved_at,
             resolution_summary
      from public.data_subject_requests
      where organization_id = ${ctx.organizationId}
      order by received_at desc
      limit 50`,
  );
  return ok(
    rows.map((r) => ({
      requestId: r.id,
      requestType: r.request_type,
      status: r.status,
      receivedAt: r.received_at.toISOString(),
      dueAt: r.due_at?.toISOString() ?? null,
      resolvedAt: r.resolved_at?.toISOString() ?? null,
      resolutionSummary: r.resolution_summary,
    })),
  );
}

export type StaffDataRequest = MyDataRequest & {
  subjectType: 'patient' | 'guardian';
  subjectPatientId: string | null;
  /** Patient: directory name. Guardian: the guardian's name when the viewer may read it, else null. */
  subjectName: string | null;
  requesterNote: string | null;
};

/** Staff (owner / care team): open requests first. Audited with the result count only. */
export async function listDataRequests(ctx: AuthzContext): Promise<Outcome<StaffDataRequest[]>> {
  const permitted = await requirePermission(ctx, 'dsr.read');
  if (!permitted.ok) return permitted;
  const rows = await withUserTransaction(ctx.claims, async (tx) => {
    const found = await tx<
      {
        id: string;
        request_type: MyDataRequest['requestType'];
        status: DataRequestStatus;
        received_at: Date;
        due_at: Date | null;
        resolved_at: Date | null;
        resolution_summary: string | null;
        requester_note: string | null;
        subject_patient_id: string | null;
        patient_name: string | null;
        guardian_name: string | null;
      }[]
    >`select r.id, r.request_type::text as request_type, r.status::text as status, r.received_at, r.due_at,
             r.resolved_at, r.resolution_summary, r.requester_note, r.subject_patient_id,
             (d.first_name || ' ' || d.last_name) as patient_name,
             (g.first_name || ' ' || g.last_name) as guardian_name
      from public.data_subject_requests r
      left join app.patient_directory(${ctx.organizationId}::uuid) d on d.patient_id = r.subject_patient_id
      left join public.guardians g on g.organization_id = r.organization_id and g.id = r.subject_guardian_id
      where r.organization_id = ${ctx.organizationId}
      order by (r.status in ('received', 'in_review')) desc, r.received_at desc
      limit 100`;
    await recordAudit(
      tx,
      'data_subject_request.list_viewed',
      { result_count: found.length },
      { organizationId: ctx.organizationId as string, requestId: ctx.requestId },
    );
    return found;
  });
  return ok(
    rows.map((r) => ({
      requestId: r.id,
      requestType: r.request_type,
      status: r.status,
      receivedAt: r.received_at.toISOString(),
      dueAt: r.due_at?.toISOString() ?? null,
      resolvedAt: r.resolved_at?.toISOString() ?? null,
      resolutionSummary: r.resolution_summary,
      requesterNote: r.requester_note,
      subjectType: r.subject_patient_id ? 'patient' : 'guardian',
      subjectPatientId: r.subject_patient_id,
      subjectName: r.patient_name ?? r.guardian_name,
    })),
  );
}
