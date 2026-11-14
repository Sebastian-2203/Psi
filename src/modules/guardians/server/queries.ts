import 'server-only';
import { requirePermission, type AuthzContext } from '@/server/authz';
import { withUserTransaction } from '@/server/db/server';
import { failure, ok, type Outcome } from '@/server/errors';

/**
 * Guardian reads. Two audiences with different DTOs:
 * - care team: full relationship (legal basis state, permissions, caveat) — never to guardians;
 * - guardian portal: `app.guardian_patient_summary` only (state + patient first/preferred name
 *   when the relationship is effective; no notes, no caveat, no other guardians).
 */

export type RelationshipStatus = 'pending_verification' | 'active' | 'suspended' | 'revoked';

export type GuardianRelationship = {
  patientGuardianId: string;
  guardianId: string;
  firstName: string;
  lastName: string;
  /** Care team only: prefills the portal invitation form. */
  email: string | null;
  relationship: string;
  status: RelationshipStatus;
  suspensionReason: string | null;
  isLegalRepresentative: boolean;
  legalBasis: string | null;
  legalBasisVerified: boolean;
  isPrimaryContact: boolean;
  validFrom: string;
  validUntil: string | null;
  hasPortalLogin: boolean;
  permissions: string[];
  /** Safety caveat (GRD-08): care team only. */
  caveat: { text: string; restrictSchedule: boolean } | null;
};

export async function listGuardiansForPatient(
  ctx: AuthzContext,
  patientId: string,
): Promise<Outcome<GuardianRelationship[]>> {
  const permitted = await requirePermission(ctx, 'patient.read');
  if (!permitted.ok) return permitted;
  const rows = await withUserTransaction(
    ctx.claims,
    (tx) => tx<
      {
        id: string;
        guardian_id: string;
        first_name: string;
        last_name: string;
        email: string | null;
        relationship: string;
        status: RelationshipStatus;
        suspension_reason: string | null;
        is_legal_representative: boolean;
        legal_basis: string | null;
        legal_verified: boolean;
        is_primary_contact: boolean;
        valid_from: string;
        valid_until: string | null;
        has_login: boolean;
        permissions: string[];
        caveat: string | null;
        restrict_schedule: boolean | null;
      }[]
    >`select pg.id, g.id as guardian_id, g.first_name, g.last_name, g.email::text as email, pg.relationship::text as relationship,
             pg.status::text as status, pg.suspension_reason::text as suspension_reason,
             pg.is_legal_representative, pg.legal_basis::text as legal_basis,
             (pg.legal_basis_verified_at is not null) as legal_verified, pg.is_primary_contact,
             pg.valid_from::text as valid_from, pg.valid_until::text as valid_until,
             (g.profile_id is not null) as has_login,
             coalesce((select array_agg(pp.permission::text order by pp.permission)
                       from public.patient_guardian_permissions pp
                       where pp.organization_id = pg.organization_id and pp.patient_guardian_id = pg.id
                         and pp.revoked_at is null), '{}') as permissions,
             c.caveat, c.restrict_schedule
      from public.patient_guardians pg
      join public.guardians g on g.organization_id = pg.organization_id and g.id = pg.guardian_id
      left join public.patient_guardian_caveats c
        on c.organization_id = pg.organization_id and c.patient_guardian_id = pg.id and c.ended_at is null
      where pg.organization_id = ${ctx.organizationId} and pg.patient_id = ${patientId}
      order by pg.created_at`,
  );
  return ok(
    rows.map((r) => ({
      patientGuardianId: r.id,
      guardianId: r.guardian_id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      relationship: r.relationship,
      status: r.status,
      suspensionReason: r.suspension_reason,
      isLegalRepresentative: r.is_legal_representative,
      legalBasis: r.legal_basis,
      legalBasisVerified: r.legal_verified,
      isPrimaryContact: r.is_primary_contact,
      validFrom: r.valid_from,
      validUntil: r.valid_until,
      hasPortalLogin: r.has_login,
      permissions: r.permissions,
      caveat: r.caveat ? { text: r.caveat, restrictSchedule: r.restrict_schedule === true } : null,
    })),
  );
}

export type MyRelationship = {
  patientGuardianId: string;
  patientId: string;
  relationship: string;
  status: RelationshipStatus;
  /** Active, verified, in window, patient is a minor and the portal is allowed. */
  effective: boolean;
  /** Present only when effective. */
  patientDisplayName: string | null;
  permissions: string[];
};

export async function getMyRelationships(ctx: AuthzContext): Promise<Outcome<MyRelationship[]>> {
  const permitted = await requirePermission(ctx, 'portal.guardian.read');
  if (!permitted.ok) return permitted;
  if (ctx.actingAs !== 'guardian') return failure('FORBIDDEN');
  const rows = await withUserTransaction(
    ctx.claims,
    (tx) => tx<
      {
        patient_guardian_id: string;
        patient_id: string;
        relationship: string;
        relationship_status: RelationshipStatus;
        effective: boolean;
        patient_display_name: string | null;
        permissions: string[];
      }[]
    >`select patient_guardian_id, patient_id, relationship::text as relationship,
             relationship_status::text as relationship_status, effective, patient_display_name,
             permissions::text[] as permissions
      from app.guardian_patient_summary(${ctx.organizationId}::uuid)`,
  );
  return ok(
    rows.map((r) => ({
      patientGuardianId: r.patient_guardian_id,
      patientId: r.patient_id,
      relationship: r.relationship,
      status: r.relationship_status,
      effective: r.effective,
      patientDisplayName: r.patient_display_name,
      permissions: r.permissions,
    })),
  );
}
