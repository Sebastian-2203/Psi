import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORGS, PERSONAS, SEED, type Persona } from '../fixtures/personas';
import {
  adminSql,
  deleteFictionalUser,
  detectLocalStack,
  signIn,
  skipMessage,
} from '../fixtures/local-stack';
import { mailpitAvailable, waitForEmail } from '../fixtures/mailpit';

/**
 * Phase 2 server layer against the REAL local stack: server actions (Zod -> permission -> one
 * user transaction -> audit) for patients, guardians and consents; portal invitations; portal
 * capacities in the AuthzContext; the portal guard decision; acting-as switching. Contexts come
 * from real persona JWTs. Fictional data only; records created here use unique fictional names.
 */

// Actions run outside Next: feed them a real AuthzContext and fixed request metadata.
const current = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/server/authz', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/authz')>();
  return {
    ...real,
    getAuthzContext: async () =>
      current.ctx ?? {
        ok: false,
        error: { code: 'UNAUTHENTICATED', messageKey: 'errors.unauthenticated' },
      },
  };
});
vi.mock('@/server/auth/request-meta', () => ({
  getRequestMeta: async () => ({
    requestId: 'it-request-0001',
    ip: '203.0.113.77',
    userAgent: 'vitest-phase2',
    host: 'demo-a.localhost:3000',
    origin: 'http://demo-a.localhost:3000',
  }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    `${key} ${String(values?.link ?? '')}`,
}));

const stack = await detectLocalStack();
skipMessage('phase2-server', stack);
const mail = stack.available ? await mailpitAvailable() : false;

type Ctx = import('@/server/authz').AuthzContext;
const uniq = () => randomUUID().slice(0, 8).replace(/\d/g, 'x');
const yearsAgo = (n: number) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - n);
  return d.toISOString().slice(0, 10);
};

describe.skipIf(!stack.available)('Phase 2 server layer', () => {
  let admin: postgres.Sql;
  let authz: typeof import('@/server/authz');
  let verify: (typeof import('@/server/auth/claims'))['verifyAccessToken'];
  let pool: typeof import('@/server/db/pool');
  let inv: typeof import('@/server/auth/invitations');
  let supa: typeof import('@/server/auth/supabase');
  let patients: typeof import('@/modules/patients/server/actions');
  let guardians: typeof import('@/modules/guardians/server/actions');
  let consents: typeof import('@/modules/consents/server/actions');
  let guard: typeof import('@/server/authz/portal-access');
  const cleanupUsers: string[] = [];

  async function ctxFor(
    persona: Persona,
    aal: 'aal1' | 'aal2' = persona.hasTotp ? 'aal2' : 'aal1',
    org: 'A' | 'B' = persona.org ?? 'A',
  ): Promise<Ctx> {
    const claims = await verify(await signIn(persona, aal));
    if (!claims) throw new Error('verification failed');
    const outcome = await authz.resolveAuthzContext(claims, {
      requestId: randomUUID(),
      locale: 'es',
      hostScope: { kind: 'tenant', organizationId: ORGS[org].id },
    });
    if (!outcome.ok) throw new Error(`context failed: ${outcome.error.code}`);
    return outcome.data;
  }
  const as = (ctx: Ctx | null) => {
    current.ctx = ctx ? { ok: true, data: ctx } : null;
  };
  function data<T>(result: { ok: boolean } & Record<string, unknown>): T {
    if (!result.ok) throw new Error(`unexpected failure: ${JSON.stringify(result)}`);
    return (result as unknown as { data: T }).data;
  }
  const errorOf = (result: { ok: boolean; error?: unknown }) =>
    (result.ok ? null : result.error) as {
      code: string;
      messageKey: string;
      fieldErrors?: Record<string, string[]>;
    } | null;

  async function auditRows(eventType: string, resourceId?: string) {
    return admin<
      { metadata: Record<string, unknown>; actor_roles: string[]; patient_id: string | null }[]
    >`
      select metadata, actor_roles, patient_id from public.audit_logs
      where event_type = ${eventType} and (${resourceId ?? null}::uuid is null or resource_id = ${resourceId ?? null}::uuid
        or patient_id = ${resourceId ?? null}::uuid)
      order by seq desc limit 20`;
  }

  async function tokenFromMail(address: string): Promise<string> {
    const message = await waitForEmail(address);
    const match = /token=([A-Za-z0-9_-]{43})/.exec(message.Text);
    if (!match?.[1]) throw new Error('no token in email');
    return match[1];
  }

  const portalMeta = () => ({
    requestId: randomUUID(),
    ip: `203.0.113.${Math.floor(Math.random() * 250) + 1}`,
    userAgent: 'vitest-phase2',
    host: 'demo-a.localhost:3000',
    origin: 'http://demo-a.localhost:3000',
  });
  const authClient = (): SupabaseClient =>
    supa.createAuthClient({ getAll: () => [], setAll: () => undefined });

  let psyA: Ctx;
  let ownerA: Ctx;
  let ownerPsyA: Ctx;

  beforeAll(async () => {
    admin = adminSql();
    await admin`truncate public.rate_limit_counters`;
    authz = await import('@/server/authz');
    verify = (await import('@/server/auth/claims')).verifyAccessToken;
    pool = await import('@/server/db/pool');
    inv = await import('@/server/auth/invitations');
    supa = await import('@/server/auth/supabase');
    patients = await import('@/modules/patients/server/actions');
    guardians = await import('@/modules/guardians/server/actions');
    consents = await import('@/modules/consents/server/actions');
    guard = await import('@/server/authz/portal-access');
    psyA = await ctxFor(PERSONAS.psyA);
    ownerA = await ctxFor(PERSONAS.ownerA);
    ownerPsyA = await ctxFor(PERSONAS.ownerPsyA);
  });

  afterAll(async () => {
    as(null);
    for (const id of cleanupUsers) await deleteFictionalUser(id).catch(() => undefined);
    await admin?.end();
    await pool?.closeSql();
  });

  // ---------------------------------------------------------------------------------------
  describe('portal capacities in the AuthzContext + guard', () => {
    it('a patient resolves to the patient capacity at aal1 with its patient id', async () => {
      const ctx = await ctxFor(PERSONAS.patientA, 'aal1');
      expect(ctx).toMatchObject({
        actingAs: 'patient',
        patientId: SEED.patients.adultA,
        organizationId: ORGS.A.id,
        aal: 'aal1',
      });
      expect(ctx.membership).toBeUndefined();
      expect(guard.classifyPortalAccess({ ok: true, data: ctx }).ok).toBe(true);
    });

    it('a guardian resolves with relationships and DB-derived effective permissions', async () => {
      const ctx = await ctxFor(PERSONAS.guardianA, 'aal1');
      expect(ctx.actingAs).toBe('guardian');
      const rel = ctx.guardian?.relationships.find((r) => r.patientId === SEED.patients.minorA);
      expect(rel?.patientGuardianId).toBe(SEED.relationships.martaActive);
      expect(rel?.permissions).toEqual(
        expect.arrayContaining(['sign_consents', 'view_assignments', 'complete_assignments']),
      );
      expect(guard.classifyPortalAccess({ ok: true, data: ctx }).ok).toBe(true);
    });

    it('the guard denies staff, platform admins and signed-out callers; hosts of other tenants have no capacity', async () => {
      expect(guard.classifyPortalAccess({ ok: true, data: psyA })).toEqual({
        ok: false,
        reason: 'no_access',
      });
      const platform = await verify(await signIn(PERSONAS.platform, 'aal2'));
      const platformCtx = await authz.resolveAuthzContext(platform!, {
        requestId: randomUUID(),
        locale: 'es',
      });
      if (!platformCtx.ok) throw new Error('platform context failed');
      expect(guard.classifyPortalAccess(platformCtx).ok).toBe(false);
      expect(
        guard.classifyPortalAccess({ ok: false, error: { code: 'UNAUTHENTICATED' } } as never),
      ).toEqual({ ok: false, reason: 'signed_out' });

      const claims = await verify(await signIn(PERSONAS.patientA, 'aal1'));
      const other = await authz.resolveAuthzContext(claims!, {
        requestId: randomUUID(),
        locale: 'es',
        hostScope: { kind: 'tenant', organizationId: ORGS.B.id },
      });
      expect(!other.ok && other.error.messageKey).toBe('errors.noCapacity');
      const unknown = await authz.resolveAuthzContext(claims!, {
        requestId: randomUUID(),
        locale: 'es',
        hostScope: { kind: 'unknown' },
      });
      expect(unknown.ok).toBe(false);
    });

    it('a staff session never reaches a patient capacity and a patient never a staff permission', async () => {
      const patientCtx = await ctxFor(PERSONAS.patientA, 'aal1');
      as(patientCtx);
      const created = await patients.createPatientAction({
        firstName: 'Intruso',
        lastName: 'Ficticio',
        dateOfBirth: '1990-01-01',
      });
      expect(errorOf(created)?.code).toBe('FORBIDDEN');
      const detail = await patients.getPatientAction({ patientId: SEED.patients.adultA });
      expect(errorOf(detail)?.code).toBe('FORBIDDEN');
    });

    it('switchCapacity validates against the DB capacities and audits the switch', async () => {
      const claims = await verify(await signIn(PERSONAS.patientA, 'aal1'));
      const host = { kind: 'tenant', organizationId: ORGS.A.id } as const;
      const since = new Date();
      const ok = await authz.switchCapacity(
        claims!,
        host,
        { organizationId: ORGS.A.id, actingAs: 'patient' },
        { organizationId: null, actingAs: null },
        randomUUID(),
      );
      expect(ok.ok).toBe(true);
      const staff = await authz.switchCapacity(
        claims!,
        host,
        { organizationId: ORGS.A.id, actingAs: 'staff' },
        { organizationId: null, actingAs: null },
        randomUUID(),
      );
      expect(!staff.ok && staff.error.code).toBe('FORBIDDEN');
      const [row] = await admin<{ n: number }[]>`
        select count(*)::int as n from public.audit_logs
        where event_type = 'auth.capacity_switched' and actor_profile_id = ${PERSONAS.patientA.id}
          and occurred_at >= ${since}`;
      expect(row?.n).toBe(1);
      // A staff capacity needs aal2.
      const aal1Staff = await verify(await signIn(PERSONAS.psyA, 'aal1'));
      const denied = await authz.switchCapacity(
        aal1Staff!,
        host,
        { organizationId: ORGS.A.id, actingAs: 'staff' },
        { organizationId: null, actingAs: null },
        randomUUID(),
      );
      expect(!denied.ok && denied.error.code).toBe('MFA_REQUIRED');
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('patients', () => {
    const last = `Prueba${uniq()}`;
    let patientId = '';

    it('validates input strictly (message keys, no extra keys)', async () => {
      as(psyA);
      const bad = await patients.createPatientAction({
        firstName: ' ',
        lastName: 'X',
        dateOfBirth: '2999-01-01',
        documentNumber: 'AB',
        extra: true,
      } as never);
      const error = errorOf(bad);
      expect(error?.code).toBe('VALIDATION_FAILED');
      expect(Object.keys(error?.fieldErrors ?? {}).length).toBeGreaterThan(0);
    });

    it('a psychologist creates a patient (primary care team, intake); duplicates need confirmation', async () => {
      as(psyA);
      const input = { firstName: 'Ficticia', lastName: last, dateOfBirth: '1991-02-03' };
      patientId = data<{ patientId: string }>(await patients.createPatientAction(input)).patientId;
      const [row] = await admin<{ status: string; role: string }[]>`
        select p.status::text as status, c.care_role::text as role
        from public.patients p join public.care_team_members c on c.patient_id = p.id where p.id = ${patientId}`;
      expect(row).toEqual({ status: 'intake', role: 'primary' });
      const again = errorOf(await patients.createPatientAction(input));
      expect(again).toMatchObject({
        code: 'CONFLICT',
        messageKey: 'patients.errors.possibleDuplicate',
      });
      expect(again?.fieldErrors?.duplicate).toContain('name_dob');
      const [audit] = await auditRows('patient.created', patientId);
      expect(audit?.metadata).toMatchObject({ patient_id: patientId, is_minor: false });
      expect(JSON.stringify(audit?.metadata)).not.toContain(last);
    });

    it('owner-only staff cannot create patients but sees the directory (name + status only)', async () => {
      as(ownerA);
      const denied = await patients.createPatientAction({
        firstName: 'No',
        lastName: 'Permitido',
        dateOfBirth: '1991-02-03',
      });
      expect(errorOf(denied)?.code).toBe('FORBIDDEN');
      const dir = data<Array<Record<string, unknown>>>(await patients.listDirectoryAction());
      expect(dir.length).toBeGreaterThanOrEqual(6);
      expect(Object.keys(dir[0]!).sort()).toEqual(
        ['firstName', 'lastName', 'onMyCareTeam', 'patientId', 'preferredName', 'status'].sort(),
      );
      expect(dir.every((d) => d.onMyCareTeam === false)).toBe(true);
      // Q-03: no row access off the care team.
      expect(errorOf(await patients.getPatientAction({ patientId }))?.code).toBe('FORBIDDEN');
      const [dv] = await auditRows('patient.directory_viewed');
      expect(dv?.metadata).toHaveProperty('result_count');
    });

    it('care-team detail DTO is audited; off-team and cross-tenant callers get NOT_FOUND', async () => {
      as(psyA);
      const detail = data<import('@/modules/patients/server/queries').PatientDetail>(
        await patients.getPatientAction({ patientId: SEED.patients.minorA }),
      );
      expect(detail).toMatchObject({
        patientId: SEED.patients.minorA,
        isMinor: true,
        preferredName: 'Cami',
        hasPortalLogin: false,
      });
      expect(detail.majorityDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(detail.careTeam).toHaveLength(1);
      expect((await auditRows('patient.viewed', SEED.patients.minorA))[0]?.metadata).toEqual({
        patient_id: SEED.patients.minorA,
      });

      as(ownerPsyA); // psychologist, but not on adultA's care team
      expect(
        errorOf(await patients.getPatientAction({ patientId: SEED.patients.adultA }))?.code,
      ).toBe('NOT_FOUND');
      const psyB = await ctxFor(PERSONAS.psyB);
      as(psyB);
      expect(
        errorOf(await patients.getPatientAction({ patientId: SEED.patients.adultA }))?.code,
      ).toBe('NOT_FOUND');
      const mine = data<Array<{ patientId: string }>>(await patients.listMyPatientsAction({}));
      expect(mine.every((p) => p.patientId.startsWith('b3'))).toBe(true);
    });

    it('updates with optimistic concurrency; the audit row lists field NAMES only', async () => {
      as(psyA);
      const detail = data<import('@/modules/patients/server/queries').PatientDetail>(
        await patients.getPatientAction({ patientId }),
      );
      const stale = errorOf(
        await patients.updatePatientAction({
          patientId,
          expectedUpdatedAt: '2000-01-01 00:00:00+00',
          phone: '3000000000',
        }),
      );
      expect(stale?.code).toBe('CONFLICT');
      const done = await patients.updatePatientAction({
        patientId,
        expectedUpdatedAt: detail.updatedAt,
        phone: '3000000000',
        preferredName: 'Fic',
      });
      expect(done.ok).toBe(true);
      const [audit] = await auditRows('patient.updated', patientId);
      expect((audit?.metadata.changed_fields as string[]).sort()).toEqual([
        'phone',
        'preferred_name',
      ]);
      expect(JSON.stringify(audit?.metadata)).not.toContain('3000000000');
      expect(
        errorOf(await patients.updatePatientAction({ patientId, expectedUpdatedAt: 'x' } as never))
          ?.code,
      ).toBe('VALIDATION_FAILED');
    });

    it('activation is gated by consents; recording the consent unblocks it (PAT-02, CON-05)', async () => {
      as(psyA);
      const blocked = errorOf(
        await patients.changePatientStatusAction({ patientId, status: 'active' }),
      );
      expect(blocked).toMatchObject({
        code: 'PRECONDITION_FAILED',
        messageKey: 'patients.errors.activationRequirementsMissing',
      });
      expect(blocked?.fieldErrors?.missing).toContain('consent:tratamiento:patient');

      const recorded = await consents.recordConsentAction({
        patientId,
        versionId: SEED.consent.versionPublished,
        signerType: 'patient',
        method: 'verbal_recorded',
        decision: 'accepted',
        decidedAt: new Date().toISOString(),
      });
      expect(recorded.ok, JSON.stringify(recorded)).toBe(true);
      const status = data<import('@/modules/consents/server/queries').PatientConsentStatus>(
        await consents.getPatientConsentStatusAction({ patientId }),
      );
      expect(status.activationMissing).toEqual([]);
      expect(status.records[0]).toMatchObject({ templateKey: 'tratamiento', status: 'accepted' });
      expect(JSON.stringify(status)).not.toMatch(/typed|ip_address|user_agent/);

      expect((await patients.changePatientStatusAction({ patientId, status: 'active' })).ok).toBe(
        true,
      );
      expect((await auditRows('patient.status_changed', patientId))[0]?.metadata).toMatchObject({
        from_status: 'intake',
        to_status: 'active',
      });
      expect(
        errorOf(await patients.changePatientStatusAction({ patientId, status: 'intake' } as never))
          ?.code,
      ).toBe('VALIDATION_FAILED');
    });

    it('care team: owner+psychologist self-assignment needs a reason and is audited (F-06); end is audited', async () => {
      as(ownerPsyA);
      const target = {
        patientId: SEED.patients.adultA,
        membershipId: PERSONAS.ownerPsyA.membershipId!,
      };
      const missing = errorOf(
        await patients.assignCareTeamMemberAction({ ...target, careRole: 'secondary' }),
      );
      expect(missing).toMatchObject({
        code: 'PRECONDITION_FAILED',
        messageKey: 'patients.errors.selfAssignmentReasonRequired',
      });
      const assigned = data<{ careTeamMemberId: string; selfAssigned: boolean }>(
        await patients.assignCareTeamMemberAction({
          ...target,
          careRole: 'secondary',
          reason: 'Cobertura ficticia por vacaciones',
        }),
      );
      expect(assigned.selfAssigned).toBe(true);
      expect(
        (await auditRows('care_team.self_assigned', SEED.patients.adultA)).length,
      ).toBeGreaterThan(0);
      expect(
        (
          await patients.endCareTeamMemberAction({
            careTeamMemberId: assigned.careTeamMemberId,
            reason: 'Fin de la cobertura',
          })
        ).ok,
      ).toBe(true);
      expect((await auditRows('care_team.ended', SEED.patients.adultA))[0]?.metadata).toMatchObject(
        {
          patient_id: SEED.patients.adultA,
        },
      );
    });

    it('only the care team changes preferences (portal mode)', async () => {
      as(psyA);
      expect(
        (
          await patients.updatePatientPreferencesAction({
            patientId,
            portalMode: 'adult',
            textSize: 125,
          })
        ).ok,
      ).toBe(true);
      as(ownerA);
      expect(
        errorOf(await patients.updatePatientPreferencesAction({ patientId, textSize: 100 }))?.code,
      ).toBe('FORBIDDEN');
    });
  });

  // ---------------------------------------------------------------------------------------
  describe.skipIf(!mail)('portal invitations, guardians and consent decisions (end to end)', () => {
    const password = `Fictional-${randomUUID()}`;
    const patientEmail = `it-patient-${uniq()}@example.test`;
    const guardianEmail = `it-guardian-${uniq()}@example.test`;
    let adultId = '';
    let minorId = '';
    let relationshipId = '';
    let guardianId = '';

    it('patient invitation: created by the care team, accepted once, links the patient to the new login', async () => {
      as(psyA);
      adultId = data<{ patientId: string }>(
        await patients.createPatientAction({
          firstName: 'Portal',
          lastName: `Adulta${uniq()}`,
          dateOfBirth: '1988-08-08',
        }),
      ).patientId;
      const invited = await patients.invitePatientToPortalAction({
        patientId: adultId,
        email: patientEmail,
        emailLocale: 'es',
      });
      expect(invited.ok).toBe(true);
      const token = await tokenFromMail(patientEmail);
      const [invRow] = await admin<{ token_hash: Buffer; invitation_type: string }[]>`
        select token_hash, invitation_type::text from public.invitations where patient_id = ${adultId} and status = 'pending'`;
      expect(invRow?.invitation_type).toBe('patient');
      expect(Buffer.from(invRow!.token_hash).toString('hex')).toBe(
        inv.hashInvitationToken(token).toString('hex'),
      );
      expect((await auditRows('invitation.created', adultId))[0]?.metadata).toEqual({
        invitation_type: 'patient',
        patient_id: adultId,
      });

      // Staff-kind preview/accept entry points refuse portal tokens and vice versa.
      expect((await inv.previewStaffInvitation(token, portalMeta())).ok).toBe(false);
      const preview = await inv.previewPortalInvitation(token, portalMeta());
      expect(preview.ok && preview.data.kind).toBe('patient');

      // A wrong-account / weak path is generic; then the real acceptance.
      const accepted = await inv.acceptPortalInvitation(
        authClient(),
        { token, displayName: 'Portal Adulta', password, locale: 'es' },
        portalMeta(),
      );
      if (!accepted.ok) throw new Error(`accept failed: ${accepted.error.code}`);
      cleanupUsers.push(accepted.data.claims.sub);
      expect(accepted.data.kind).toBe('patient');
      const [linked] = await admin<
        { profile_id: string }[]
      >`select profile_id from public.patients where id = ${adultId}`;
      expect(linked?.profile_id).toBe(accepted.data.claims.sub);

      const reused = await inv.acceptPortalInvitation(
        authClient(),
        { token, displayName: 'x', password, locale: 'es' },
        portalMeta(),
      );
      expect(!reused.ok && reused.error.messageKey).toBe('auth.errors.invitationInvalid');

      // The new login resolves to the patient capacity (aal1) and passes the portal guard.
      const outcome = await authz.resolveAuthzContext(accepted.data.claims, {
        requestId: randomUUID(),
        locale: 'es',
        hostScope: { kind: 'tenant', organizationId: ORGS.A.id },
      });
      if (!outcome.ok) throw new Error('context failed');
      expect(outcome.data).toMatchObject({ actingAs: 'patient', patientId: adultId });
      expect(guard.classifyPortalAccess(outcome).ok).toBe(true);
      expect((await auditRows('patient.portal_linked', adultId)).length).toBe(1);
    });

    it('guardian: create (pending), invite, accept; acceptance does NOT activate the relationship', async () => {
      as(psyA);
      minorId = data<{ patientId: string }>(
        await patients.createPatientAction({
          firstName: 'Menor',
          lastName: `Ficticio${uniq()}`,
          dateOfBirth: yearsAgo(11),
        }),
      ).patientId;
      const adultAsGuardian = errorOf(
        await guardians.createGuardianAction({
          patientId: adultId,
          firstName: 'Mal',
          lastName: 'Puesto',
          relationship: 'mother',
          isLegalRepresentative: false,
        }),
      );
      expect(adultAsGuardian).toMatchObject({ messageKey: 'guardians.errors.patientNotMinor' });
      const created = data<{ guardianId: string; patientGuardianId: string }>(
        await guardians.createGuardianAction({
          patientId: minorId,
          firstName: 'Gabriela',
          lastName: `Guardiana${uniq()}`,
          relationship: 'mother',
          isLegalRepresentative: true,
          legalBasis: 'parental_authority',
          isPrimaryContact: true,
        }),
      );
      relationshipId = created.patientGuardianId;
      guardianId = created.guardianId;
      expect(
        errorOf(
          await guardians.createGuardianAction({
            patientId: minorId,
            firstName: 'Sin',
            lastName: 'Base',
            relationship: 'mother',
            isLegalRepresentative: true,
          }),
        )?.code,
      ).toBe('VALIDATION_FAILED');

      expect(
        (
          await guardians.inviteGuardianToPortalAction({
            patientGuardianId: relationshipId,
            email: guardianEmail,
            emailLocale: 'en',
          })
        ).ok,
      ).toBe(true);
      const token = await tokenFromMail(guardianEmail);
      const accepted = await inv.acceptPortalInvitation(
        authClient(),
        { token, displayName: 'Gabriela Guardiana', password, locale: 'es' },
        portalMeta(),
      );
      if (!accepted.ok) throw new Error(`accept failed: ${accepted.error.code}`);
      cleanupUsers.push(accepted.data.claims.sub);
      expect(accepted.data.kind).toBe('guardian');
      const [rel] = await admin<
        { status: string }[]
      >`select status::text from public.patient_guardians where id = ${relationshipId}`;
      expect(rel?.status).toBe('pending_verification');

      const outcome = await authz.resolveAuthzContext(accepted.data.claims, {
        requestId: randomUUID(),
        locale: 'es',
        hostScope: { kind: 'tenant', organizationId: ORGS.A.id },
      });
      if (!outcome.ok) throw new Error('context failed');
      const relationship = outcome.data.guardian?.relationships[0];
      expect(relationship).toMatchObject({ patientGuardianId: relationshipId, permissions: [] });
      as(outcome.data);
      const mine = data<Array<{ effective: boolean; patientDisplayName: string | null }>>(
        await guardians.getMyRelationshipsAction(),
      );
      expect(mine[0]).toMatchObject({ effective: false, patientDisplayName: null });
    });

    it('verification, permission diff and legal-basis gate; then a guardian signs and withdraws; revocation cuts access', async () => {
      as(psyA);
      expect(
        (
          await guardians.setGuardianPermissionsAction({
            patientGuardianId: relationshipId,
            permissions: ['sign_consents', 'view_assignments'],
          })
        ).ok,
      ).toBe(true);
      const verified = data<{ status: string }>(
        await guardians.verifyGuardianRelationshipAction({
          patientGuardianId: relationshipId,
          verificationNote: 'Documento revisado (ficticio)',
          verifyLegalBasis: false,
        }),
      );
      expect(verified.status).toBe('active');
      const diff = data<{ granted: string[]; revoked: string[] }>(
        await guardians.setGuardianPermissionsAction({
          patientGuardianId: relationshipId,
          permissions: ['sign_consents', 'complete_assignments'],
        }),
      );
      expect(diff).toEqual({ granted: ['complete_assignments'], revoked: ['view_assignments'] });
      expect(
        (await auditRows('guardian_permission.granted', relationshipId)).length,
      ).toBeGreaterThan(0);

      // The caller learns the guardian's state only through the care-team DTO (caveat included).
      expect(
        (
          await guardians.setGuardianCaveatAction({
            patientGuardianId: relationshipId,
            caveat: 'Precaución ficticia de prueba',
            restrictSchedule: true,
          })
        ).ok,
      ).toBe(true);
      const listed = data<
        Array<{ caveat: { restrictSchedule: boolean } | null; legalBasisVerified: boolean }>
      >(await guardians.listGuardiansAction({ patientId: minorId }));
      expect(listed[0]).toMatchObject({
        caveat: { restrictSchedule: true },
        legalBasisVerified: false,
      });
      expect(
        errorOf(
          await guardians.setGuardianPermissionsAction({
            patientGuardianId: relationshipId,
            permissions: ['view_session_schedule'],
          }),
        )?.messageKey,
      ).toBe('guardians.errors.scheduleRestricted');

      const guardianLogin = await signInPortal(guardianEmail);
      let gctx = await portalCtx(guardianLogin);
      expect(gctx.guardian?.relationships[0]?.permissions).toEqual([
        'complete_assignments',
        'sign_consents',
      ]);
      as(gctx);
      const signable = data<Array<{ versionId: string; bodyHash: string; patientId: string }>>(
        await consents.listSignableConsentsAction({ patientId: minorId }),
      );
      const version = signable.find((s) => s.versionId === SEED.consent.versionPublished)!;
      expect(version.bodyHash).toMatch(/^[0-9a-f]{64}$/);
      const sign = (over: Record<string, unknown> = {}) =>
        consents.signConsentAction({
          patientId: minorId,
          versionId: version.versionId,
          decision: 'accepted',
          typedName: 'Gabriela Guardiana',
          checkboxConfirmed: true,
          textHash: version.bodyHash,
          ...over,
        } as never);
      // Legal representation is not verified yet (F-12).
      expect(errorOf(await sign())).toMatchObject({
        messageKey: 'consents.errors.legalRepresentativeNotVerified',
      });
      expect(errorOf(await sign({ textHash: '0'.repeat(64) }))?.messageKey).toBeDefined();

      as(psyA);
      expect(
        (
          await guardians.verifyGuardianRelationshipAction({
            patientGuardianId: relationshipId,
            verifyLegalBasis: true,
          })
        ).ok,
      ).toBe(true);
      as(gctx);
      expect(errorOf(await sign({ textHash: '0'.repeat(64) }))?.messageKey).toBe(
        'consents.errors.textMismatch',
      );
      expect(errorOf(await sign({ checkboxConfirmed: false }))?.code).toBe('VALIDATION_FAILED');
      const signed = data<{ consentRecordId: string }>(await sign());
      const [evidence] = await admin<
        { typed_name: string; ip_address: string; checkbox_confirmed: boolean }[]
      >`
        select typed_name, host(ip_address) as ip_address, checkbox_confirmed
        from public.consent_record_evidence where consent_record_id = ${signed.consentRecordId}`;
      expect(evidence).toEqual({
        typed_name: 'Gabriela Guardiana',
        ip_address: '203.0.113.77',
        checkbox_confirmed: true,
      });
      expect(
        (await auditRows('consent.signed', signed.consentRecordId))[0]?.metadata,
      ).toMatchObject({
        signer_type: 'guardian',
        patient_id: minorId,
      });

      // A patient (other capacity) cannot sign for a minor; a guardian cannot read others' records.
      as(await ctxFor(PERSONAS.patientA, 'aal1'));
      expect(
        errorOf(
          await consents.signConsentAction({
            patientId: minorId,
            versionId: version.versionId,
            decision: 'accepted',
            typedName: 'Ana Ficticia',
            checkboxConfirmed: true,
            textHash: version.bodyHash,
          }),
        )?.code,
      ).toBe('NOT_FOUND');

      as(gctx);
      expect(
        (
          await consents.withdrawConsentAction({
            consentRecordId: signed.consentRecordId,
            reason: 'Retiro ficticio de prueba',
          })
        ).ok,
      ).toBe(true);
      expect(
        errorOf(
          await consents.withdrawConsentAction({
            consentRecordId: signed.consentRecordId,
            reason: 'Otra vez',
          }),
        )?.messageKey,
      ).toBe('consents.errors.notWithdrawable');
      expect((await auditRows('consent.withdrawn', signed.consentRecordId)).length).toBe(1);

      // The care team sees the withdrawn status; staff cannot use portal permissions.
      as(psyA);
      expect(errorOf(await consents.signConsentAction({} as never))?.code).toBe(
        'VALIDATION_FAILED',
      );
      const status = data<import('@/modules/consents/server/queries').PatientConsentStatus>(
        await consents.getPatientConsentStatusAction({ patientId: minorId }),
      );
      expect(status.records.some((r) => r.status === 'withdrawn')).toBe(true);

      // Revocation: terminal, revokes every grant; the guardian loses effective access at once.
      expect(
        errorOf(
          await guardians.revokeGuardianRelationshipAction({
            patientGuardianId: relationshipId,
            reason: 'x',
          }),
        )?.code,
      ).toBe('VALIDATION_FAILED');
      expect(
        (
          await guardians.revokeGuardianRelationshipAction({
            patientGuardianId: relationshipId,
            reason: 'Revocación ficticia',
          })
        ).ok,
      ).toBe(true);
      expect(
        (await auditRows('patient_guardian.revoked', relationshipId))[0]?.metadata,
      ).toMatchObject({
        permissions_revoked: 2,
        from_status: 'active',
      });
      gctx = await portalCtx(guardianLogin);
      expect(
        gctx.guardian?.relationships.find((r) => r.patientGuardianId === relationshipId),
      ).toBeUndefined();
      as(gctx);
      expect(errorOf(await sign())?.code).toBe('FORBIDDEN');
      expect(guardianId).not.toBe('');
      expect(
        errorOf(
          await guardians.reactivateGuardianRelationshipAction({
            patientGuardianId: relationshipId,
          }),
        )?.code,
      ).toBe('FORBIDDEN');
    });

    async function signInPortal(email: string) {
      const client = authClient();
      const { data: session, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !session.session) throw new Error('portal sign-in failed');
      const claims = await verify(session.session.access_token);
      if (!claims) throw new Error('verify failed');
      return claims;
    }
    async function portalCtx(claims: Awaited<ReturnType<typeof signInPortal>>) {
      const outcome = await authz.resolveAuthzContext(claims, {
        requestId: randomUUID(),
        locale: 'es',
        hostScope: { kind: 'tenant', organizationId: ORGS.A.id },
      });
      if (!outcome.ok) throw new Error(`context failed: ${outcome.error.code}`);
      return outcome.data;
    }
  });

  // ---------------------------------------------------------------------------------------
  describe('seeded portal identities and consent templates', () => {
    it('the seeded adult patient signs as herself (hash-bound), not for another patient', async () => {
      const ctx = await ctxFor(PERSONAS.patientA, 'aal1');
      as(ctx);
      const signable = data<
        Array<{ versionId: string; bodyHash: string; myStatus: string | null }>
      >(await consents.listSignableConsentsAction({}));
      const v = signable.find((s) => s.versionId === SEED.consent.versionPublished);
      expect(v).toBeDefined();
      // The retired v1 is never offered.
      expect(signable.some((s) => s.versionId === SEED.consent.versionRetired)).toBe(false);
      const input = {
        versionId: v!.versionId,
        decision: 'accepted' as const,
        typedName: 'Ana Ficticia',
        checkboxConfirmed: true as const,
        textHash: v!.bodyHash,
      };
      expect(
        errorOf(await consents.signConsentAction({ ...input, patientId: SEED.patients.minorA }))
          ?.code,
      ).toBe('NOT_FOUND');
      const done = await consents.signConsentAction({ ...input, patientId: SEED.patients.adultA });
      expect(done.ok).toBe(true);
      const record = data<{ consentRecordId: string }>(done).consentRecordId;
      const [row] = await admin<{ signer_type: string; status: string; method: string }[]>`
        select signer_type::text, status::text, method::text from public.consent_records where id = ${record}`;
      expect(row).toEqual({
        signer_type: 'patient',
        status: 'accepted',
        method: 'portal_typed_name',
      });
      // Declined and withdrawn are separate states; withdrawing keeps the history.
      expect(
        (
          await consents.withdrawConsentAction({
            consentRecordId: record,
            reason: 'Retiro ficticio',
          })
        ).ok,
      ).toBe(true);
      const [after] = await admin<{ status: string; n: number }[]>`
        select status::text, (select count(*)::int from public.consent_records where patient_id = ${SEED.patients.adultA}) as n
        from public.consent_records where id = ${record}`;
      expect(after?.status).toBe('withdrawn');
      expect(after?.n).toBeGreaterThanOrEqual(2);
    });

    it('privacy view and relationships DTOs are limited to the caller', async () => {
      as(await ctxFor(PERSONAS.patientA, 'aal1'));
      expect(data<unknown[]>(await patients.getPrivacyViewAction())).toEqual([]);
      expect(errorOf(await guardians.getMyRelationshipsAction())?.code).toBe('FORBIDDEN');
      as(await ctxFor(PERSONAS.guardianA, 'aal1'));
      const mine = data<
        Array<{ patientId: string; effective: boolean; patientDisplayName: string }>
      >(await guardians.getMyRelationshipsAction());
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({
        patientId: SEED.patients.minorA,
        effective: true,
        patientDisplayName: 'Cami',
      });
      expect(errorOf(await patients.getPrivacyViewAction())?.code).toBe('FORBIDDEN');
    });

    it('consent templates: owner creates, drafts and publishes; the text is then immutable; psychologists cannot', async () => {
      const key = `it_${uniq()}`;
      as(psyA);
      expect(
        errorOf(
          await consents.createConsentTemplateAction({
            key,
            consentType: 'portal_use',
            title: 'Uso del portal (ficticio)',
            signerRequirement: 'patient',
            appliesToMinors: true,
            appliesToAdults: true,
          }),
        )?.code,
      ).toBe('FORBIDDEN');
      as(ownerA);
      const template = data<{ templateId: string }>(
        await consents.createConsentTemplateAction({
          key,
          consentType: 'portal_use',
          title: 'Uso del portal (ficticio)',
          signerRequirement: 'patient',
          appliesToMinors: true,
          appliesToAdults: true,
        }),
      );
      const body = {
        version: 1 as const,
        blocks: [
          {
            type: 'paragraph' as const,
            children: [{ type: 'text' as const, text: '[TEXTO FICTICIO]' }],
          },
        ],
      };
      const draft = data<{ versionId: string }>(
        await consents.saveConsentVersionDraftAction({
          templateId: template.templateId,
          locale: 'es',
          title: 'Uso del portal v1',
          body,
        }),
      );
      // HTML-like / unknown blocks are rejected by the AST schema.
      expect(
        errorOf(
          await consents.saveConsentVersionDraftAction({
            templateId: template.templateId,
            locale: 'es',
            title: 'x',
            body: { version: 1, blocks: [{ type: 'html', html: '<script>1</script>' }] } as never,
          }),
        )?.code,
      ).toBe('VALIDATION_FAILED');
      const published = data<{ bodyHash: string }>(
        await consents.publishConsentVersionAction({ versionId: draft.versionId }),
      );
      expect(published.bodyHash).toMatch(/^[0-9a-f]{64}$/);
      const [t] = await admin<
        { status: string }[]
      >`select status::text from public.consent_templates where id = ${template.templateId}`;
      expect(t?.status).toBe('published');
      await expect(
        admin`update public.consent_template_versions set title = 'cambio' where id = ${draft.versionId}`,
      ).rejects.toThrow(/IMMUTABLE/);
      expect(
        errorOf(await consents.publishConsentVersionAction({ versionId: draft.versionId }))?.code,
      ).toBe('NOT_FOUND');
      expect((await auditRows('consent_template_version.published', draft.versionId)).length).toBe(
        1,
      );
    });
  });
});
