import 'server-only';
import type {
  CreateGuardianInput,
  RelationshipIdInput,
  RevokeRelationshipInput,
  SetCaveatInput,
  SetPermissionsInput,
  SuspendRelationshipInput,
  VerifyRelationshipInput,
} from '@/modules/guardians/schemas';
import { recordAudit } from '@/server/audit';
import { requirePermission, type AuthzContext } from '@/server/authz';
import { withUserTransaction, type UserTransaction } from '@/server/db/server';
import { AppError, dbFailure, ok, type Outcome } from '@/server/errors';
import { GUARDIAN_PRECONDITION_KEYS } from './errors';

/**
 * Guardian use cases. The relationship state machine, permission diff and revocation cascade
 * live in the DB (`app.guard_patient_guardian`, `app.set_guardian_permissions`); these functions
 * authorize, load the row through RLS (care team only, else NOT_FOUND) and audit.
 * Guardians never receive caveat text, verification notes or any of these write paths.
 */

type Relationship = {
  id: string;
  patient_id: string;
  status: 'pending_verification' | 'active' | 'suspended' | 'revoked';
  is_legal_representative: boolean;
};

async function loadRelationship(
  tx: UserTransaction,
  ctx: AuthzContext,
  patientGuardianId: string,
): Promise<Relationship> {
  const [row] = await tx<Relationship[]>`
    select id, patient_id, status::text as status, is_legal_representative
    from public.patient_guardians
    where organization_id = ${ctx.organizationId} and id = ${patientGuardianId} for update`;
  if (!row) throw new AppError('NOT_FOUND');
  return row;
}

const auditTarget = (ctx: AuthzContext, id: string) => ({
  organizationId: ctx.organizationId as string,
  resourceType: 'patient_guardian',
  resourceId: id,
  requestId: ctx.requestId,
});

export async function createGuardian(
  ctx: AuthzContext,
  input: CreateGuardianInput & { patientId: string },
): Promise<Outcome<{ guardianId: string; patientGuardianId: string }>> {
  const permitted = await requirePermission(ctx, 'guardian.manage');
  if (!permitted.ok) return permitted;
  try {
    const row = await withUserTransaction(ctx.claims, async (tx) => {
      // The patient must be visible to the caller (care team); otherwise NOT_FOUND.
      const [visible] = await tx`
        select 1 from public.patients where organization_id = ${ctx.organizationId} and id = ${input.patientId}`;
      if (!visible) throw new AppError('NOT_FOUND');
      const [created] = await tx<{ guardian_id: string; patient_guardian_id: string }[]>`
        select * from app.create_guardian(
          ${ctx.organizationId}::uuid, ${input.patientId}::uuid, ${input.firstName}, ${input.lastName},
          ${input.documentType ?? null}::public.document_type, ${input.documentNumber ?? null},
          ${input.email ?? null}, ${input.phone ?? null},
          ${input.relationship}::public.guardian_relationship, ${input.isLegalRepresentative},
          ${input.legalBasis ?? null}::public.legal_representation_basis, ${input.isPrimaryContact ?? false},
          ${ctx.requestId})`;
      if (!created) throw new Error('create_guardian returned no row');
      return created;
    });
    return ok({ guardianId: row.guardian_id, patientGuardianId: row.patient_guardian_id });
  } catch (error) {
    return dbFailure(error, GUARDIAN_PRECONDITION_KEYS);
  }
}

/** Verifies the relationship (pending -> active) and/or its legal basis (GRD-03, GRD-06). */
export async function verifyRelationship(
  ctx: AuthzContext,
  input: VerifyRelationshipInput & { patientGuardianId: string },
): Promise<Outcome<{ status: string; legalBasisVerified: boolean }>> {
  const permitted = await requirePermission(ctx, 'guardian.manage');
  if (!permitted.ok) return permitted;
  try {
    const result = await withUserTransaction(ctx.claims, async (tx) => {
      const rel = await loadRelationship(tx, ctx, input.patientGuardianId);
      const activating = rel.status === 'pending_verification';
      if (!activating && !(rel.status === 'active' && input.verifyLegalBasis)) {
        throw new AppError('PRECONDITION_FAILED', {
          messageKey: 'guardians.errors.invalidTransition',
          detail: 'PRECONDITION:invalid_relationship_transition',
        });
      }
      if (input.verifyLegalBasis && !rel.is_legal_representative) {
        throw new AppError('VALIDATION_FAILED', {
          messageKey: 'guardians.errors.notLegalRepresentative',
          fieldErrors: { verifyLegalBasis: ['choiceInvalid'] },
        });
      }
      const values: Record<string, string | null> = {};
      if (activating) {
        values.status = 'active';
        values.verification_note = input.verificationNote ?? null;
        if (input.validFrom) values.valid_from = input.validFrom;
        if (input.validUntil) values.valid_until = input.validUntil;
      }
      if (input.verifyLegalBasis) values.legal_basis_verified_at = new Date().toISOString();
      const [row] = await tx<{ status: string }[]>`
        update public.patient_guardians set ${tx(values, ...Object.keys(values))}
        where organization_id = ${ctx.organizationId} and id = ${input.patientGuardianId}
        returning status::text as status`;
      if (!row) throw new AppError('NOT_FOUND');
      await recordAudit(
        tx,
        'patient_guardian.verified',
        {
          patient_id: rel.patient_id,
          patient_guardian_id: rel.id,
          legal_basis_verified: input.verifyLegalBasis,
          from_status: rel.status,
        },
        auditTarget(ctx, rel.id),
      );
      return { status: row.status, legalBasisVerified: input.verifyLegalBasis };
    });
    return ok(result);
  } catch (error) {
    return dbFailure(error, GUARDIAN_PRECONDITION_KEYS);
  }
}

export async function suspendRelationship(
  ctx: AuthzContext,
  input: SuspendRelationshipInput & { patientGuardianId: string },
): Promise<Outcome<{ status: 'suspended' }>> {
  const permitted = await requirePermission(ctx, 'guardian.manage');
  if (!permitted.ok) return permitted;
  try {
    await withUserTransaction(ctx.claims, async (tx) => {
      const rel = await loadRelationship(tx, ctx, input.patientGuardianId);
      await tx`
        update public.patient_guardians
        set status = 'suspended', suspension_reason = ${input.reason}::public.relationship_suspension_reason
        where organization_id = ${ctx.organizationId} and id = ${rel.id}`;
      await recordAudit(
        tx,
        'patient_guardian.suspended',
        { patient_id: rel.patient_id, patient_guardian_id: rel.id, suspension: input.reason },
        auditTarget(ctx, rel.id),
      );
    });
    return ok({ status: 'suspended' });
  } catch (error) {
    return dbFailure(error, GUARDIAN_PRECONDITION_KEYS);
  }
}

export async function reactivateRelationship(
  ctx: AuthzContext,
  input: RelationshipIdInput,
): Promise<Outcome<{ status: 'active' }>> {
  const permitted = await requirePermission(ctx, 'guardian.manage');
  if (!permitted.ok) return permitted;
  try {
    await withUserTransaction(ctx.claims, async (tx) => {
      const rel = await loadRelationship(tx, ctx, input.patientGuardianId);
      await tx`
        update public.patient_guardians set status = 'active'
        where organization_id = ${ctx.organizationId} and id = ${rel.id}`;
      await recordAudit(
        tx,
        'patient_guardian.reactivated',
        { patient_id: rel.patient_id, patient_guardian_id: rel.id },
        auditTarget(ctx, rel.id),
      );
    });
    return ok({ status: 'active' });
  } catch (error) {
    return dbFailure(error, GUARDIAN_PRECONDITION_KEYS);
  }
}

/** Revocation is terminal and revokes every active grant (trigger) and pending invitation. */
export async function revokeRelationship(
  ctx: AuthzContext,
  input: RevokeRelationshipInput & { patientGuardianId: string },
): Promise<Outcome<{ ok: true }>> {
  const permitted = await requirePermission(ctx, 'guardian.manage');
  if (!permitted.ok) return permitted;
  try {
    await withUserTransaction(ctx.claims, async (tx) => {
      const rel = await loadRelationship(tx, ctx, input.patientGuardianId);
      const [count] = await tx<{ n: number }[]>`
        select count(*)::int as n from public.patient_guardian_permissions
        where organization_id = ${ctx.organizationId} and patient_guardian_id = ${rel.id} and revoked_at is null`;
      await tx`
        update public.patient_guardians set status = 'revoked', revoke_reason = ${input.reason}
        where organization_id = ${ctx.organizationId} and id = ${rel.id}`;
      await recordAudit(
        tx,
        'patient_guardian.revoked',
        {
          patient_id: rel.patient_id,
          patient_guardian_id: rel.id,
          from_status: rel.status,
          permissions_revoked: count?.n ?? 0,
        },
        auditTarget(ctx, rel.id),
      );
    });
    return ok({ ok: true });
  } catch (error) {
    return dbFailure(error, GUARDIAN_PRECONDITION_KEYS);
  }
}

/** GRD-08: at most one active caveat; setting a new one ends the previous (both audited). */
export async function setCaveat(
  ctx: AuthzContext,
  input: SetCaveatInput & { patientGuardianId: string },
): Promise<Outcome<{ ok: true }>> {
  const permitted = await requirePermission(ctx, 'guardian.caveat.manage');
  if (!permitted.ok) return permitted;
  try {
    await withUserTransaction(ctx.claims, async (tx) => {
      const rel = await loadRelationship(tx, ctx, input.patientGuardianId);
      const ended = await tx`
        update public.patient_guardian_caveats set ended_at = now()
        where organization_id = ${ctx.organizationId} and patient_guardian_id = ${rel.id} and ended_at is null
        returning id`;
      if (ended.length > 0) {
        await recordAudit(
          tx,
          'guardian_caveat.ended',
          { patient_id: rel.patient_id, patient_guardian_id: rel.id },
          auditTarget(ctx, rel.id),
        );
      }
      await tx`
        insert into public.patient_guardian_caveats (organization_id, patient_guardian_id, caveat, restrict_schedule)
        values (${ctx.organizationId}, ${rel.id}, ${input.caveat}, ${input.restrictSchedule})`;
      await recordAudit(
        tx,
        'guardian_caveat.set',
        {
          patient_id: rel.patient_id,
          patient_guardian_id: rel.id,
          restrict_schedule: input.restrictSchedule,
        },
        auditTarget(ctx, rel.id),
      );
    });
    return ok({ ok: true });
  } catch (error) {
    return dbFailure(error, GUARDIAN_PRECONDITION_KEYS);
  }
}

export async function endCaveat(
  ctx: AuthzContext,
  input: RelationshipIdInput,
): Promise<Outcome<{ ok: true }>> {
  const permitted = await requirePermission(ctx, 'guardian.caveat.manage');
  if (!permitted.ok) return permitted;
  try {
    await withUserTransaction(ctx.claims, async (tx) => {
      const rel = await loadRelationship(tx, ctx, input.patientGuardianId);
      const ended = await tx`
        update public.patient_guardian_caveats set ended_at = now()
        where organization_id = ${ctx.organizationId} and patient_guardian_id = ${rel.id} and ended_at is null
        returning id`;
      if (ended.length === 0) throw new AppError('NOT_FOUND');
      await recordAudit(
        tx,
        'guardian_caveat.ended',
        { patient_id: rel.patient_id, patient_guardian_id: rel.id },
        auditTarget(ctx, rel.id),
      );
    });
    return ok({ ok: true });
  } catch (error) {
    return dbFailure(error, GUARDIAN_PRECONDITION_KEYS);
  }
}

/** Diff + audit are atomic inside `app.set_guardian_permissions` (invoker: RLS applies). */
export async function setPermissions(
  ctx: AuthzContext,
  input: SetPermissionsInput & { patientGuardianId: string },
): Promise<Outcome<{ granted: string[]; revoked: string[] }>> {
  const permitted = await requirePermission(ctx, 'guardian.permissions.manage');
  if (!permitted.ok) return permitted;
  try {
    const row = await withUserTransaction(ctx.claims, async (tx) => {
      await loadRelationship(tx, ctx, input.patientGuardianId);
      const [r] = await tx<{ granted: string[]; revoked: string[] }[]>`
        select granted::text[] as granted, revoked::text[] as revoked
        from app.set_guardian_permissions(
          ${ctx.organizationId}::uuid, ${input.patientGuardianId}::uuid,
          ${input.permissions}::public.guardian_permission[], ${ctx.requestId})`;
      if (!r) throw new Error('set_guardian_permissions returned no row');
      return r;
    });
    return ok({ granted: row.granted, revoked: row.revoked });
  } catch (error) {
    return dbFailure(error, GUARDIAN_PRECONDITION_KEYS);
  }
}
