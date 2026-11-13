import 'server-only';
import {
  UPDATABLE_PATIENT_FIELDS,
  type AssignCareTeamMemberInput,
  type ChangePatientStatusInput,
  type CreatePatientInput,
  type EndCareTeamMemberInput,
  type UpdatePatientInput,
  type UpdatePatientPreferencesInput,
} from '@/modules/patients/schemas';
import { recordAudit } from '@/server/audit';
import { requirePermission, type AuthzContext } from '@/server/authz';
import { withUserTransaction } from '@/server/db/server';
import { AppError, dbFailure, failure, ok, type Outcome } from '@/server/errors';
import { PATIENT_PRECONDITION_KEYS } from './errors';

/**
 * Patient use cases (framework-free; integration tests call them with a real AuthzContext).
 * Each: requirePermission (capacity/role/aal/org status) -> ONE user transaction (RLS +
 * definer functions decide care-team scope) -> audit in the same transaction. A row the caller
 * cannot see is NOT_FOUND (anti-enumeration), never FORBIDDEN.
 */

const target = (ctx: AuthzContext, patientId: string) => ({
  organizationId: ctx.organizationId as string,
  resourceType: 'patient',
  resourceId: patientId,
  requestId: ctx.requestId,
});

/** PAT-07: duplicate warning keys ('document' | 'name_dob'); null for non-psychologists. */
export async function findDuplicates(
  ctx: AuthzContext,
  input: Pick<
    CreatePatientInput,
    'firstName' | 'lastName' | 'dateOfBirth' | 'documentType' | 'documentNumber'
  >,
): Promise<string[]> {
  const rows = await withUserTransaction(
    ctx.claims,
    (tx) => tx<{ d: string[] | null }[]>`
      select app.find_patient_duplicates(
        ${ctx.organizationId}::uuid, ${input.firstName}, ${input.lastName}, ${input.dateOfBirth}::date,
        ${input.documentType ?? null}::public.document_type, ${input.documentNumber ?? null}) as d`,
  );
  return rows[0]?.d ?? [];
}

export async function createPatient(
  ctx: AuthzContext,
  input: CreatePatientInput,
): Promise<Outcome<{ patientId: string }>> {
  const permitted = await requirePermission(ctx, 'patient.create');
  if (!permitted.ok) return permitted;
  try {
    if (!input.confirmDuplicate) {
      const duplicates = await findDuplicates(ctx, input);
      if (duplicates.length > 0) {
        return failure('CONFLICT', {
          messageKey: 'patients.errors.possibleDuplicate',
          fieldErrors: { duplicate: duplicates },
        });
      }
    }
    const patientId = await withUserTransaction(ctx.claims, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        select app.create_patient(
          ${ctx.organizationId}::uuid, ${input.firstName}, ${input.lastName}, ${input.preferredName ?? null},
          ${input.dateOfBirth}::date, ${input.documentType ?? null}::public.document_type,
          ${input.documentNumber ?? null}, ${input.email ?? null}, ${input.phone ?? null},
          ${input.preferredLocale ?? null}, ${ctx.requestId}) as id`;
      if (!row) throw new Error('create_patient returned no row');
      return row.id;
    });
    return ok({ patientId });
  } catch (error) {
    return dbFailure(error, PATIENT_PRECONDITION_KEYS);
  }
}

export async function updatePatient(
  ctx: AuthzContext,
  input: UpdatePatientInput & { patientId: string; expectedUpdatedAt: string },
): Promise<Outcome<{ updatedAt: string }>> {
  const permitted = await requirePermission(ctx, 'patient.update');
  if (!permitted.ok) return permitted;
  const values: Record<string, string | null> = {};
  const changed: string[] = [];
  for (const [key, column] of Object.entries(UPDATABLE_PATIENT_FIELDS)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) {
      values[column] = value as string | null;
      changed.push(column);
    }
  }
  try {
    const updatedAt = await withUserTransaction(ctx.claims, async (tx) => {
      const [current] = await tx<{ updated_at: string }[]>`
        select updated_at::text as updated_at from public.patients
        where organization_id = ${ctx.organizationId} and id = ${input.patientId} for update`;
      if (!current) throw new AppError('NOT_FOUND');
      if (current.updated_at !== input.expectedUpdatedAt) throw new AppError('CONFLICT');
      const [row] = await tx<{ updated_at: string }[]>`
        update public.patients set ${tx(values, ...changed)}
        where organization_id = ${ctx.organizationId} and id = ${input.patientId}
        returning updated_at::text as updated_at`;
      if (!row) throw new AppError('NOT_FOUND');
      await recordAudit(
        tx,
        'patient.updated',
        { patient_id: input.patientId, changed_fields: changed },
        target(ctx, input.patientId),
      );
      return row.updated_at;
    });
    return ok({ updatedAt });
  } catch (error) {
    return dbFailure(error, PATIENT_PRECONDITION_KEYS);
  }
}

/** Activation is gated in SQL (`app.patient_activation_missing`); the missing keys are returned. */
export async function changePatientStatus(
  ctx: AuthzContext,
  input: ChangePatientStatusInput & { patientId: string },
): Promise<Outcome<{ status: string }>> {
  const permitted = await requirePermission(ctx, 'patient.status.manage');
  if (!permitted.ok) return permitted;
  try {
    return await withUserTransaction(ctx.claims, async (tx) => {
      const [current] = await tx<{ status: string }[]>`
        select status::text as status from public.patients
        where organization_id = ${ctx.organizationId} and id = ${input.patientId} for update`;
      if (!current) throw new AppError('NOT_FOUND');
      try {
        await tx.savepoint(async (sp) => {
          await sp`update public.patients set status = ${input.status}::public.patient_status
                   where organization_id = ${ctx.organizationId} and id = ${input.patientId}`;
        });
      } catch (error) {
        const mapped = dbFailure(error, PATIENT_PRECONDITION_KEYS);
        if (mapped.error.detail?.endsWith('activation_requirements_missing')) {
          const [m] = await tx<{ missing: string[] | null }[]>`
            select app.patient_activation_missing(${ctx.organizationId}::uuid, ${input.patientId}::uuid) as missing`;
          return {
            ok: false as const,
            error: new AppError('PRECONDITION_FAILED', {
              messageKey: 'patients.errors.activationRequirementsMissing',
              fieldErrors: { missing: m?.missing ?? [] },
              detail: mapped.error.detail,
            }),
          };
        }
        throw error;
      }
      await recordAudit(
        tx,
        'patient.status_changed',
        {
          patient_id: input.patientId,
          from_status: current.status as 'intake',
          to_status: input.status,
        },
        target(ctx, input.patientId),
      );
      return ok({ status: input.status });
    });
  } catch (error) {
    return dbFailure(error, PATIENT_PRECONDITION_KEYS);
  }
}

export async function assignCareTeamMember(
  ctx: AuthzContext,
  input: AssignCareTeamMemberInput & { patientId: string; membershipId: string },
): Promise<Outcome<{ careTeamMemberId: string; selfAssigned: boolean }>> {
  const permitted = await requirePermission(ctx, 'patient.care_team.manage');
  if (!permitted.ok) return permitted;
  try {
    const row = await withUserTransaction(ctx.claims, async (tx) => {
      const [visible] = await tx`
        select 1 from public.care_team_members
        where organization_id = ${ctx.organizationId} and patient_id = ${input.patientId} limit 1`;
      if (!visible) throw new AppError('NOT_FOUND');
      const [inserted] = await tx<{ id: string }[]>`
        insert into public.care_team_members (organization_id, patient_id, membership_id, care_role, assignment_reason)
        values (${ctx.organizationId}, ${input.patientId}, ${input.membershipId},
                ${input.careRole}::public.care_role, ${input.reason ?? null})
        returning id`;
      if (!inserted) throw new AppError('FORBIDDEN');
      // F-06: the DB trigger audits `care_team.self_assigned` (same transaction) when a member
      // assigns themselves to a patient with ANOTHER active primary; everything else is audited here.
      const [other] = await tx`
        select 1 from public.care_team_members
        where organization_id = ${ctx.organizationId} and patient_id = ${input.patientId}
          and care_role = 'primary' and ends_at is null and membership_id <> ${input.membershipId}`;
      const selfAssigned = ctx.membership?.id === input.membershipId && other !== undefined;
      if (!selfAssigned) {
        await recordAudit(
          tx,
          'care_team.assigned',
          {
            patient_id: input.patientId,
            membership_id: input.membershipId,
            care_role: input.careRole,
          },
          {
            ...target(ctx, input.patientId),
            resourceType: 'care_team_member',
            resourceId: inserted.id,
          },
        );
      }
      return { careTeamMemberId: inserted.id, selfAssigned };
    });
    return ok(row);
  } catch (error) {
    return dbFailure(error, PATIENT_PRECONDITION_KEYS);
  }
}

export async function endCareTeamMember(
  ctx: AuthzContext,
  input: EndCareTeamMemberInput & { careTeamMemberId: string },
): Promise<Outcome<{ ok: true }>> {
  const permitted = await requirePermission(ctx, 'patient.care_team.manage');
  if (!permitted.ok) return permitted;
  try {
    await withUserTransaction(ctx.claims, async (tx) => {
      const [row] = await tx<{ patient_id: string; membership_id: string }[]>`
        update public.care_team_members set ends_at = now(), end_reason = ${input.reason}
        where organization_id = ${ctx.organizationId} and id = ${input.careTeamMemberId} and ends_at is null
        returning patient_id, membership_id`;
      if (!row) throw new AppError('NOT_FOUND');
      await recordAudit(
        tx,
        'care_team.ended',
        { patient_id: row.patient_id, membership_id: row.membership_id },
        {
          ...target(ctx, row.patient_id),
          resourceType: 'care_team_member',
          resourceId: input.careTeamMemberId,
        },
      );
    });
    return ok({ ok: true });
  } catch (error) {
    return dbFailure(error, PATIENT_PRECONDITION_KEYS);
  }
}

const PREFERENCE_COLUMNS = {
  portalMode: 'portal_mode',
  locale: 'locale',
  notifyEmail: 'notify_email',
  textSize: 'text_size',
  reducedMotion: 'reduced_motion',
  audioInstructions: 'audio_instructions',
} as const;

export async function updatePatientPreferences(
  ctx: AuthzContext,
  input: UpdatePatientPreferencesInput & { patientId: string },
): Promise<Outcome<{ changedFields: string[] }>> {
  const permitted = await requirePermission(ctx, 'patient.preferences.manage');
  if (!permitted.ok) return permitted;
  const values: Record<string, string | number | boolean | null> = {};
  const changed: string[] = [];
  for (const [key, column] of Object.entries(PREFERENCE_COLUMNS)) {
    const value = (input as Record<string, unknown>)[key];
    if (value !== undefined) {
      values[column] = value as string | number | boolean | null;
      changed.push(column);
    }
  }
  try {
    await withUserTransaction(ctx.claims, async (tx) => {
      const [row] = await tx<{ id: string }[]>`
        update public.patient_preferences set ${tx(values, ...changed)}
        where organization_id = ${ctx.organizationId} and patient_id = ${input.patientId}
        returning id`;
      if (!row) throw new AppError('NOT_FOUND');
      await recordAudit(
        tx,
        'patient_preferences.updated',
        { patient_id: input.patientId, changed_fields: changed },
        {
          ...target(ctx, input.patientId),
          resourceType: 'patient_preferences',
          resourceId: row.id,
        },
      );
    });
    return ok({ changedFields: changed });
  } catch (error) {
    return dbFailure(error, PATIENT_PRECONDITION_KEYS);
  }
}
