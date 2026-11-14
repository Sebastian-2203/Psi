import 'server-only';
import type { z } from 'zod';
import {
  auditTarget,
  iso,
  notFound,
  runClinical,
  runPortal,
} from '@/modules/clinical-records/server/shared';
import type {
  listSessionsSchema,
  recordSessionSchema,
  updateSessionSchema,
} from '@/modules/sessions/schemas';
import { recordAudit } from '@/server/audit';
import type { AuthzContext } from '@/server/authz';
import type { Outcome } from '@/server/errors';

/** Therapy session records (API_CONTRACTS §8.8, SES-01..04). Care team only; no scheduling. */

type Out<S extends z.ZodType> = z.output<S>;
type SessionStatus = Out<typeof recordSessionSchema>['status'];
type Modality = Out<typeof recordSessionSchema>['modality'];

export type SessionDto = {
  id: string;
  patientId: string;
  psychologistMembershipId: string;
  treatmentPlanId: string | null;
  start: string;
  end: string;
  status: SessionStatus;
  modality: Modality;
  cancelledReason: string | null;
  locationOrLink: string | null;
  /** SES-03: none | draft (caller's own) | finalized. */
  noteState: 'none' | 'draft' | 'finalized';
  updatedAt: string;
};

type SessionRow = {
  id: string;
  patient_id: string;
  psychologist_membership_id: string;
  treatment_plan_id: string | null;
  scheduled_start: Date;
  scheduled_end: Date;
  status: SessionStatus;
  modality: Modality;
  cancelled_reason: string | null;
  location_or_link: string | null;
  note_state: SessionDto['noteState'];
  updated_at: Date;
};
const toDto = (s: SessionRow): SessionDto => ({
  id: s.id,
  patientId: s.patient_id,
  psychologistMembershipId: s.psychologist_membership_id,
  treatmentPlanId: s.treatment_plan_id,
  start: iso(s.scheduled_start) as string,
  end: iso(s.scheduled_end) as string,
  status: s.status,
  modality: s.modality,
  cancelledReason: s.cancelled_reason,
  locationOrLink: s.location_or_link,
  noteState: s.note_state,
  updatedAt: iso(s.updated_at) as string,
});

export async function recordSession(
  ctx: AuthzContext,
  input: Out<typeof recordSessionSchema>,
): Promise<Outcome<{ sessionId: string }>> {
  return runClinical(ctx, 'clinical.session.write', async (tx, org) => {
    const [visible] =
      await tx`select app.can_write_clinical(${org}::uuid, ${input.patientId}::uuid) as ok`;
    if (!visible?.ok) return notFound();
    const [row] = await tx<{ id: string }[]>`
      insert into public.therapy_sessions (organization_id, patient_id, psychologist_membership_id, treatment_plan_id,
        scheduled_start, scheduled_end, status, modality, cancelled_reason, location_or_link)
      values (${org}, ${input.patientId}, app.my_membership_id(${org}::uuid), ${input.treatmentPlanId ?? null},
        ${input.start}::timestamptz, ${input.end}::timestamptz, ${input.status}::public.session_status,
        ${input.modality}::public.session_modality, ${input.cancelledReason ?? null}, ${input.locationOrLink ?? null})
      returning id`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'therapy_session.recorded',
      { patient_id: input.patientId, status: input.status, modality: input.modality },
      auditTarget(ctx, 'therapy_session', row.id),
    );
    return { sessionId: row.id };
  });
}

const COLUMNS = {
  status: 'status',
  start: 'scheduled_start',
  end: 'scheduled_end',
  modality: 'modality',
  treatmentPlanId: 'treatment_plan_id',
  locationOrLink: 'location_or_link',
  cancelledReason: 'cancelled_reason',
} as const;

export async function updateSession(
  ctx: AuthzContext,
  input: Out<typeof updateSessionSchema>,
): Promise<Outcome<{ sessionId: string; status: SessionStatus }>> {
  return runClinical(ctx, 'clinical.session.write', async (tx, org) => {
    const [current] = await tx<{ patient_id: string; status: SessionStatus }[]>`
      select patient_id, status from public.therapy_sessions
      where organization_id = ${org} and id = ${input.sessionId} for update`;
    if (!current) return notFound();
    const values: Record<string, unknown> = {};
    for (const [key, column] of Object.entries(COLUMNS)) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) values[column] = value === '' ? null : value;
    }
    const changed = Object.keys(values);
    if (changed.length > 0) {
      const [row] = await tx`
        update public.therapy_sessions set ${tx(values as Record<string, never>, ...changed)}
        where organization_id = ${org} and id = ${input.sessionId} returning id`;
      if (!row) return notFound();
      const statusChanged = input.status !== undefined && input.status !== current.status;
      await recordAudit(
        tx,
        'therapy_session.updated',
        {
          patient_id: current.patient_id,
          changed_fields: changed,
          ...(statusChanged ? { from_status: current.status, to_status: input.status } : {}),
        },
        auditTarget(ctx, 'therapy_session', input.sessionId),
      );
    }
    return { sessionId: input.sessionId, status: input.status ?? current.status };
  });
}

/** SES-03 timeline (patientId) or the caller's own range across patients (care team RLS). */
export async function listSessions(
  ctx: AuthzContext,
  input: Out<typeof listSessionsSchema>,
): Promise<Outcome<SessionDto[]>> {
  return runClinical(ctx, 'clinical.session.read', async (tx, org) => {
    if (input.patientId) {
      const [visible] =
        await tx`select app.can_read_clinical(${org}::uuid, ${input.patientId}::uuid) as ok`;
      if (!visible?.ok) return notFound();
    }
    const rows = await tx<SessionRow[]>`
      select s.id, s.patient_id, s.psychologist_membership_id, s.treatment_plan_id, s.scheduled_start, s.scheduled_end,
             s.status, s.modality, s.cancelled_reason, s.location_or_link, s.updated_at,
             case when exists (select 1 from public.clinical_notes n where n.organization_id = s.organization_id
                                 and n.therapy_session_id = s.id and n.status = 'finalized') then 'finalized'
                  when exists (select 1 from public.clinical_notes n where n.organization_id = s.organization_id
                                 and n.therapy_session_id = s.id and n.discarded_at is null) then 'draft'
                  else 'none' end as note_state
      from public.therapy_sessions s
      where s.organization_id = ${org}
        and (${input.patientId ?? null}::uuid is null or s.patient_id = ${input.patientId ?? null}::uuid)
        and (${input.from ?? null}::timestamptz is null or s.scheduled_start >= ${input.from ?? null}::timestamptz)
        and (${input.to ?? null}::timestamptz is null or s.scheduled_start < ${input.to ?? null}::timestamptz)
      order by s.scheduled_start desc limit ${input.limit}`;
    await recordAudit(
      tx,
      'therapy_session.list_viewed',
      { ...(input.patientId ? { patient_id: input.patientId } : {}), result_count: rows.length },
      auditTarget(ctx, input.patientId ? 'patient' : 'therapy_session', input.patientId ?? null),
    );
    return rows.map(toDto);
  });
}

/** SES-04: held sessions of the caller without a finalized note ("pending notes"). */
export async function listPendingNoteSessions(ctx: AuthzContext): Promise<Outcome<SessionDto[]>> {
  return runClinical(ctx, 'clinical.session.read', async (tx, org) => {
    const rows = await tx<SessionRow[]>`
      select s.id, s.patient_id, s.psychologist_membership_id, s.treatment_plan_id, s.scheduled_start, s.scheduled_end,
             s.status, s.modality, s.cancelled_reason, s.location_or_link, s.updated_at,
             case when exists (select 1 from public.clinical_notes n where n.organization_id = s.organization_id
                                 and n.therapy_session_id = s.id and n.discarded_at is null) then 'draft'
                  else 'none' end as note_state
      from public.therapy_sessions s
      where s.organization_id = ${org} and s.status = 'held'
        and s.psychologist_membership_id = app.my_membership_id(${org}::uuid)
        and not exists (select 1 from public.clinical_notes n where n.organization_id = s.organization_id
                          and n.therapy_session_id = s.id and n.status = 'finalized')
      order by s.scheduled_start desc limit 200`;
    await recordAudit(
      tx,
      'therapy_session.list_viewed',
      { result_count: rows.length },
      auditTarget(ctx, 'therapy_session', null),
    );
    return rows.map(toDto);
  });
}

export type PortalSessionDto = {
  sessionId: string;
  start: string;
  end: string;
  status: SessionStatus;
  modality: Modality;
};

/** Portal: date/time/status/modality only (app.portal_upcoming_sessions; caveats apply). */
export async function listMyUpcomingSessions(
  ctx: AuthzContext,
  patientId?: string,
): Promise<Outcome<PortalSessionDto[]>> {
  return runPortal(ctx, 'portal.sessions.read', patientId, async (tx, org, patient) => {
    const rows = await tx<
      {
        session_id: string;
        scheduled_start: Date;
        scheduled_end: Date;
        status: SessionStatus;
        modality: Modality;
      }[]
    >`select * from app.portal_upcoming_sessions(${org}::uuid, ${patient}::uuid)`;
    return rows.map((r) => ({
      sessionId: r.session_id,
      start: iso(r.scheduled_start) as string,
      end: iso(r.scheduled_end) as string,
      status: r.status,
      modality: r.modality,
    }));
  });
}
