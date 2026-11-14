import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ORGS, PERSONAS, SEED, type Persona } from '../fixtures/personas';
import { adminSql, detectLocalStack, signIn, skipMessage } from '../fixtures/local-stack';

/**
 * QA D-1 / D-2 / D-3 against the REAL local stack: PAT-04 server-side search (name / document,
 * RLS-bound, directory rows name-only), PAT-06 majority notice (care team only), PAT-09
 * data-subject requests (portal intake, care-team resolution, audit). Fictional data only.
 */

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
    requestId: 'it-dsr-0001',
    ip: '203.0.113.78',
    userAgent: 'vitest-dsr',
    host: 'demo-a.localhost:3000',
    origin: 'http://demo-a.localhost:3000',
  }),
}));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

const stack = await detectLocalStack();
skipMessage('data-requests', stack);

type Ctx = import('@/server/authz').AuthzContext;
const uniq = () => randomUUID().slice(0, 8).replace(/\d/g, 'x');

describe.skipIf(!stack.available)('Phase 2 QA: search, majority notice, data requests', () => {
  let admin: postgres.Sql;
  let authz: typeof import('@/server/authz');
  let verify: (typeof import('@/server/auth/claims'))['verifyAccessToken'];
  let pool: typeof import('@/server/db/pool');
  let patients: typeof import('@/modules/patients/server/actions');
  let dsr: typeof import('@/modules/data-requests/server/actions');

  async function ctxFor(persona: Persona, aal?: 'aal1' | 'aal2'): Promise<Ctx> {
    const level = aal ?? (persona.hasTotp ? 'aal2' : 'aal1');
    const claims = await verify(await signIn(persona, level));
    if (!claims) throw new Error('verification failed');
    const outcome = await authz.resolveAuthzContext(claims, {
      requestId: randomUUID(),
      locale: 'es',
      hostScope: { kind: 'tenant', organizationId: ORGS[persona.org ?? 'A'].id },
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

  let psyA: Ctx;
  let ownerA: Ctx;
  let patientCtx: Ctx;
  let guardianCtx: Ctx;

  beforeAll(async () => {
    admin = adminSql();
    await admin`delete from public.data_subject_requests where organization_id = ${ORGS.A.id}`;
    authz = await import('@/server/authz');
    verify = (await import('@/server/auth/claims')).verifyAccessToken;
    pool = await import('@/server/db/pool');
    patients = await import('@/modules/patients/server/actions');
    dsr = await import('@/modules/data-requests/server/actions');
    psyA = await ctxFor(PERSONAS.psyA);
    ownerA = await ctxFor(PERSONAS.ownerA);
    patientCtx = await ctxFor(PERSONAS.patientA, 'aal1');
    guardianCtx = await ctxFor(PERSONAS.guardianA, 'aal1');
  });

  afterAll(async () => {
    as(null);
    await admin?.end();
    await pool?.closeSql();
  });

  describe('PAT-04 search', () => {
    type Found = {
      mine: Array<{ patientId: string; firstName: string }>;
      directory: Array<{ patientId: string }>;
    };

    it('care team: matches name and document number, literally (wildcards do not widen)', async () => {
      as(psyA);
      const byDoc = data<Found>(await patients.searchPatientsAction({ search: 'FICT-1001' }));
      expect(byDoc.mine.map((p) => p.patientId)).toEqual([SEED.patients.adultA]);
      const byName = data<Found>(await patients.searchPatientsAction({ search: 'ficti' }));
      expect(byName.mine.length).toBeGreaterThan(0);
      for (const wildcard of ['%', '_', '\\']) {
        const r = data<Found>(await patients.searchPatientsAction({ search: wildcard }));
        expect(r.mine, `wildcard ${wildcard}`).toEqual([]);
      }
      const all = data<Found>(await patients.searchPatientsAction({}));
      expect(all.mine.length).toBeGreaterThanOrEqual(byName.mine.length);
    });

    it('off the care team: directory rows match by name only, never by document number', async () => {
      as(ownerA);
      const byDoc = data<Found>(await patients.searchPatientsAction({ search: 'FICT-1001' }));
      expect(byDoc).toEqual({ mine: [], directory: [] });
      const byName = data<Found>(await patients.searchPatientsAction({ search: 'Ana' }));
      expect(byName.directory.map((d) => d.patientId)).toContain(SEED.patients.adultA);
    });

    it('the search term is never audited and the schema is strict', async () => {
      as(psyA);
      const term = `Buscado${uniq()}`;
      await patients.searchPatientsAction({ search: term });
      const rows = await admin<{ metadata: unknown }[]>`
        select metadata from public.audit_logs where event_type in ('patient.list_viewed', 'patient.directory_viewed')
          and organization_id = ${ORGS.A.id} order by seq desc limit 10`;
      expect(JSON.stringify(rows)).not.toContain(term);
      expect(
        errorOf(await patients.searchPatientsAction({ search: 'x', extra: 1 } as never))?.code,
      ).toBe('VALIDATION_FAILED');
      expect(errorOf(await patients.searchPatientsAction({ search: 'x'.repeat(101) }))?.code).toBe(
        'VALIDATION_FAILED',
      );
    });

    it('another tenant sees none of the rows', async () => {
      as(await ctxFor(PERSONAS.psyB));
      const r = data<Found>(await patients.searchPatientsAction({ search: 'FICT-1001' }));
      expect(r.mine).toEqual([]);
      expect(r.directory).toEqual([]);
    });
  });

  describe('PAT-06 majority notice', () => {
    it('lists care-team minors inside the window with days left; owners off the team get no list', async () => {
      const dob = new Date();
      dob.setUTCFullYear(dob.getUTCFullYear() - 18);
      dob.setUTCDate(dob.getUTCDate() + 30);
      as(psyA);
      const last = `Pronto${uniq()}`;
      const created = data<{ patientId: string }>(
        await patients.createPatientAction({
          firstName: 'Mayo',
          lastName: last,
          dateOfBirth: dob.toISOString().slice(0, 10),
        }),
      );
      const notice = data<{
        windowDays: number;
        entries: Array<{ patientId: string; daysLeft: number }>;
      }>(await patients.listUpcomingMajorityAction());
      expect(notice.windowDays).toBe(60);
      const mine = notice.entries.find((e) => e.patientId === created.patientId);
      expect(mine?.daysLeft).toBeGreaterThanOrEqual(29);
      expect(mine?.daysLeft).toBeLessThanOrEqual(31);
      // Outside the window / adults are not listed.
      expect(notice.entries.some((e) => e.patientId === SEED.patients.adultA)).toBe(false);
      const summary = data<{ majorityInDays: number | null }>(
        await patients.getPatientAction({ patientId: created.patientId }),
      );
      expect(summary.majorityInDays).toBe(mine?.daysLeft);
      // Another psychologist of the same org (not on the team) sees nothing of this patient.
      as(ownerA);
      expect(errorOf(await patients.listUpcomingMajorityAction())?.code).toBe('FORBIDDEN');
    });
  });

  describe('PAT-09 data-subject requests', () => {
    it('a patient submits for herself; one open request per type; audited without free text', async () => {
      as(patientCtx);
      const note = `Nota privada ${uniq()}`;
      const sent = data<{ requestId: string }>(
        await dsr.submitDataRequestAction({ requestType: 'access', note }),
      );
      const dup = errorOf(await dsr.submitDataRequestAction({ requestType: 'access' }));
      expect(dup?.code).toBe('PRECONDITION_FAILED');
      expect(dup?.messageKey).toBe('dataRequests.errors.alreadyOpen');
      // A different type is a different request.
      expect((await dsr.submitDataRequestAction({ requestType: 'rectification' })).ok).toBe(true);
      expect(
        errorOf(await dsr.submitDataRequestAction({ requestType: 'suppression' } as never))?.code,
      ).toBe('VALIDATION_FAILED');
      expect(
        errorOf(
          await dsr.submitDataRequestAction({ requestType: 'access', note: 'x'.repeat(1001) }),
        )?.code,
      ).toBe('VALIDATION_FAILED');

      const own = data<Array<{ requestId: string; status: string }>>(
        await dsr.listMyDataRequestsAction(),
      );
      expect(own.find((r) => r.requestId === sent.requestId)?.status).toBe('received');
      const [row] = await admin<{ metadata: Record<string, unknown>; patient_id: string | null }[]>`
        select metadata, patient_id from public.audit_logs
        where event_type = 'data_subject_request.submitted' and resource_id = ${sent.requestId}`;
      expect(row?.patient_id).toBe(SEED.patients.adultA);
      expect(row?.metadata).toMatchObject({ request_type: 'access', subject_type: 'patient' });
      expect(JSON.stringify(row?.metadata)).not.toContain(note);
      // Portal identities cannot reach staff actions.
      expect(errorOf(await dsr.listDataRequestsAction())?.code).toBe('FORBIDDEN');
      expect(
        errorOf(
          await dsr.updateDataRequestAction({ requestId: sent.requestId, status: 'in_review' }),
        )?.code,
      ).toBe('FORBIDDEN');
    });

    it('a guardian submits about her own record and never sees the patient requests', async () => {
      as(guardianCtx);
      expect((await dsr.submitDataRequestAction({ requestType: 'rectification' })).ok).toBe(true);
      const own = data<Array<{ requestType: string }>>(await dsr.listMyDataRequestsAction());
      expect(own).toHaveLength(1);
      expect(own[0]?.requestType).toBe('rectification');
    });

    it('care team and owner see them; another tenant does not; resolution is forward-only and audited', async () => {
      as(psyA);
      const list = data<
        Array<{
          requestId: string;
          status: string;
          subjectType: string;
          subjectName: string | null;
        }>
      >(await dsr.listDataRequestsAction());
      expect(list.filter((r) => r.subjectType === 'patient').length).toBeGreaterThanOrEqual(2);
      expect(list.some((r) => r.subjectType === 'guardian')).toBe(true);
      const target = list.find((r) => r.subjectType === 'patient' && r.status === 'received')!;

      // A final status needs a summary (Zod first, then the DB).
      expect(
        errorOf(
          await dsr.updateDataRequestAction({ requestId: target.requestId, status: 'rejected' }),
        )?.code,
      ).toBe('VALIDATION_FAILED');
      expect(
        (
          await dsr.updateDataRequestAction({
            requestId: target.requestId,
            status: 'in_review',
            dueDate: '2030-01-31',
          })
        ).ok,
      ).toBe(true);
      expect(
        (
          await dsr.updateDataRequestAction({
            requestId: target.requestId,
            status: 'partially_fulfilled',
            resolutionSummary: 'Se entregó copia parcial (ficticio).',
          })
        ).ok,
      ).toBe(true);
      const again = errorOf(
        await dsr.updateDataRequestAction({
          requestId: target.requestId,
          status: 'rejected',
          resolutionSummary: 'Cambio de decisión',
        }),
      );
      expect(again?.messageKey).toBe('dataRequests.errors.alreadyResolved');

      const [row] = await admin<
        {
          status: string;
          due_at: Date | null;
          handled_by_membership_id: string | null;
          resolved_at: Date | null;
        }[]
      >`select status::text, due_at, handled_by_membership_id, resolved_at
        from public.data_subject_requests where id = ${target.requestId}`;
      expect(row?.status).toBe('partially_fulfilled');
      expect(row?.due_at?.toISOString()).toBe('2030-01-31T23:59:59.000Z');
      expect(row?.handled_by_membership_id).not.toBeNull();
      expect(row?.resolved_at).not.toBeNull();
      const changes = await admin<{ metadata: Record<string, unknown> }[]>`
        select metadata from public.audit_logs
        where event_type = 'data_subject_request.status_changed' and resource_id = ${target.requestId}
        order by seq`;
      expect(changes.map((c) => `${c.metadata.from_status}>${c.metadata.to_status}`)).toEqual([
        'received>in_review',
        'in_review>partially_fulfilled',
      ]);
      expect(JSON.stringify(changes)).not.toContain('copia parcial');
      expect(
        (
          await admin`select 1 from public.audit_logs where event_type = 'data_subject_request.due_date_set' and resource_id = ${target.requestId}`
        ).length,
      ).toBe(1);

      as(ownerA);
      const all = data<Array<{ requestId: string }>>(await dsr.listDataRequestsAction());
      expect(all.some((r) => r.requestId === target.requestId)).toBe(true);

      as(await ctxFor(PERSONAS.psyB));
      expect(data<unknown[]>(await dsr.listDataRequestsAction())).toEqual([]);
      expect(
        errorOf(
          await dsr.updateDataRequestAction({ requestId: target.requestId, status: 'in_review' }),
        )?.code,
      ).toBe('FORBIDDEN');
    });
  });
});
