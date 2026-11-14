import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ORGS, PERSONAS, SEED, type Persona } from '../fixtures/personas';
import { adminSql, detectLocalStack, signIn, skipMessage } from '../fixtures/local-stack';

/**
 * Phase 3 clinical server layer against the REAL local stack: actions -> permission -> one
 * user transaction (RLS + DB triggers) -> audit. Care-team-only access, immutability of
 * finalized notes, append-only addenda, portal projections, private storage + signed URLs.
 * Fictional data only; rows created here carry fictional text.
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
    requestId: 'it-clinical-0001',
    ip: '203.0.113.78',
    userAgent: 'vitest-clinical',
    host: 'demo-a.localhost:3000',
    origin: 'http://demo-a.localhost:3000',
  }),
}));

const stack = await detectLocalStack();
skipMessage('clinical-server', stack);

type Ctx = import('@/server/authz').AuthzContext;
const text = (t: string) => ({
  version: 1 as const,
  blocks: [{ type: 'paragraph' as const, children: [{ type: 'text' as const, text: t }] }],
});
// Minimal valid PDF header bytes (fictional content).
const PDF = new TextEncoder().encode('%PDF-1.4\n% documento ficticio de prueba\n%%EOF\n');

describe.skipIf(!stack.available)('Phase 3 clinical server layer', () => {
  let admin: postgres.Sql;
  let authz: typeof import('@/server/authz');
  let verify: (typeof import('@/server/auth/claims'))['verifyAccessToken'];
  let pool: typeof import('@/server/db/pool');
  let records: typeof import('@/modules/clinical-records/server/actions');
  let notes: typeof import('@/modules/notes/server/actions');
  let treatment: typeof import('@/modules/treatment/server/actions');
  let sessions: typeof import('@/modules/sessions/server/actions');
  let documents: typeof import('@/modules/documents/server/actions');
  let psyA: Ctx;
  let ownerPsyA: Ctx;
  let patientA: Ctx;

  async function ctxFor(
    persona: Persona,
    aal: 'aal1' | 'aal2' = persona.hasTotp ? 'aal2' : 'aal1',
  ) {
    const claims = await verify(await signIn(persona, aal));
    if (!claims) throw new Error('verification failed');
    const outcome = await authz.resolveAuthzContext(claims, {
      requestId: randomUUID(),
      locale: 'es',
      hostScope: { kind: 'tenant', organizationId: ORGS.A.id },
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
  const codeOf = (result: { ok: boolean; error?: { code: string } }) =>
    result.ok ? null : (result.error?.code ?? null);
  const audits = (eventType: string, resourceId: string) =>
    admin<{ patient_id: string | null; metadata: Record<string, unknown> }[]>`
      select patient_id, metadata from public.audit_logs
      where event_type = ${eventType} and resource_id = ${resourceId}::uuid order by seq desc`;

  let recordId: string;
  const minor = SEED.patients.minorA;

  beforeAll(async () => {
    admin = adminSql();
    await admin`truncate public.rate_limit_counters`;
    authz = await import('@/server/authz');
    verify = (await import('@/server/auth/claims')).verifyAccessToken;
    pool = await import('@/server/db/pool');
    records = await import('@/modules/clinical-records/server/actions');
    notes = await import('@/modules/notes/server/actions');
    treatment = await import('@/modules/treatment/server/actions');
    sessions = await import('@/modules/sessions/server/actions');
    documents = await import('@/modules/documents/server/actions');
    psyA = await ctxFor(PERSONAS.psyA);
    ownerPsyA = await ctxFor(PERSONAS.ownerPsyA);
    patientA = await ctxFor(PERSONAS.patientA, 'aal1');
    as(psyA);
    recordId = data<{ recordId: string }>(
      await records.openClinicalRecordAction({ patientId: minor }),
    ).recordId;
  });

  afterAll(async () => {
    as(null);
    await admin?.end();
    await pool?.closeSql();
  });

  it('opening the record is idempotent (one record per patient)', async () => {
    as(psyA);
    const again = data<{ recordId: string; created: boolean }>(
      await records.openClinicalRecordAction({ patientId: minor }),
    );
    expect(again).toMatchObject({ recordId, created: false });
    const overview = data<{ isMinor: boolean; sections: { definition: { audience: string } }[] }>(
      await records.getClinicalRecordAction({ patientId: minor }),
    );
    expect(overview.isMinor).toBe(true);
    expect(overview.sections.some((s) => s.definition.audience === 'minor')).toBe(true);
    expect((await audits('clinical_record.viewed', recordId))[0]?.patient_id).toBe(minor);
  });

  it('off-care-team psychologist gets NOT_FOUND (audited access.denied); patients get FORBIDDEN', async () => {
    as(ownerPsyA);
    expect(codeOf(await records.getClinicalRecordAction({ patientId: minor }))).toBe('NOT_FOUND');
    const [denied] = await admin<{ metadata: Record<string, unknown> }[]>`
      select metadata from public.audit_logs where event_type = 'access.denied'
        and actor_profile_id = ${PERSONAS.ownerPsyA.id}::uuid order by seq desc limit 1`;
    expect(denied?.metadata).toMatchObject({
      permission: 'clinical.record.read',
      code: 'NOT_FOUND',
    });
    as(patientA);
    expect(codeOf(await records.getClinicalRecordAction({ patientId: SEED.patients.adultA }))).toBe(
      'FORBIDDEN',
    );
    expect(codeOf(await notes.listNotesAction({ patientId: SEED.patients.adultA }))).toBe(
      'FORBIDDEN',
    );
  });

  it('sections keep revisions and reject stale saves', async () => {
    as(psyA);
    const [def] = await admin<{ id: string }[]>`
      select id from public.clinical_section_definitions
      where organization_id = ${ORGS.A.id}::uuid and key = 'school_history'`;
    const first = await records.updateRecordSectionAction({
      recordId,
      sectionDefinitionId: def!.id,
      content: text('Historia escolar ficticia v1'),
      expectedRevision: 0,
    });
    const saved = first.ok
      ? first.data
      : data<{ revision: number; sectionId: string }>(
          await records.updateRecordSectionAction({
            recordId,
            sectionDefinitionId: def!.id,
            content: text('Historia escolar ficticia v1'),
            expectedRevision: (
              await admin<{ revision: number }[]>`
                select revision from public.clinical_record_sections
                where clinical_record_id = ${recordId}::uuid and section_definition_id = ${def!.id}::uuid`
            )[0]!.revision,
          }),
        );
    const next = data<{ revision: number; sectionId: string }>(
      await records.updateRecordSectionAction({
        recordId,
        sectionDefinitionId: def!.id,
        content: text('Historia escolar ficticia v2'),
        expectedRevision: saved.revision,
      }),
    );
    expect(next.revision).toBe(saved.revision + 1);
    expect(
      codeOf(
        await records.updateRecordSectionAction({
          recordId,
          sectionDefinitionId: def!.id,
          content: text('stale'),
          expectedRevision: saved.revision,
        }),
      ),
    ).toBe('CONFLICT');
    const history = data<{ revision: number }[]>(
      await records.listSectionRevisionsAction({ sectionId: next.sectionId }),
    );
    expect(history[0]?.revision).toBe(saved.revision);
  });

  it('note lifecycle: author-only draft -> finalize (hash) -> immutable -> idempotent addendum', async () => {
    as(psyA);
    const [type] = await admin<{ id: string }[]>`
      select id from public.clinical_note_types where organization_id = ${ORGS.A.id}::uuid and key = 'free_text'`;
    const draft = data<{ noteId: string; updatedAt: string }>(
      await notes.createNoteDraftAction({
        recordId,
        noteTypeId: type!.id,
        body: text('Borrador ficticio'),
      }),
    );
    expect(codeOf(await notes.finalizeNoteAction({ noteId: draft.noteId }))).toBeNull();
    const finalizedNote = data<{ status: string; contentHash: string | null; addenda: unknown[] }>(
      await notes.getNoteAction({ noteId: draft.noteId }),
    );
    expect(finalizedNote.status).toBe('finalized');
    expect(finalizedNote.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const edit = await notes.updateNoteDraftAction({
      noteId: draft.noteId,
      body: text('cambio'),
      expectedUpdatedAt: draft.updatedAt,
    });
    expect(codeOf(edit)).toBe('IMMUTABLE_RECORD');
    const key = randomUUID();
    const a1 = data<{ id: string }>(
      await notes.createAddendumAction({
        noteId: draft.noteId,
        reason: 'clarification',
        body: text('Adenda ficticia'),
        idempotencyKey: key,
      }),
    );
    const a2 = data<{ id: string }>(
      await notes.createAddendumAction({
        noteId: draft.noteId,
        reason: 'clarification',
        body: text('Adenda ficticia'),
        idempotencyKey: key,
      }),
    );
    expect(a2.id).toBe(a1.id);
    const [audit] = await audits('clinical_note.addendum_created', draft.noteId);
    expect(audit?.metadata).toMatchObject({ patient_id: minor, correction_kind: 'clarification' });
    expect(JSON.stringify(audit?.metadata)).not.toContain('ficticia');

    // A second care-team member would see the finalized note but never someone else's draft.
    const other = data<{ noteId: string }>(
      await notes.createNoteDraftAction({
        recordId,
        noteTypeId: type!.id,
        body: text('Solo autor'),
      }),
    );
    // Own drafts across patients: listed for the author only (RLS), no body, includes `other`.
    const mine = data<{ noteId: string; patientId: string }[]>(
      await notes.listMyDraftNotesAction(),
    );
    expect(mine.map((d) => d.noteId)).toContain(other.noteId);
    expect(mine.map((d) => d.noteId)).not.toContain(draft.noteId); // finalized
    expect(Object.keys(mine[0]!).sort()).toEqual([
      'createdAt',
      'noteId',
      'noteTypeId',
      'patientId',
      'therapySessionId',
      'updatedAt',
    ]);
    // Author display names come from org_member_directory (care team only).
    const full = data<{ authorName: string | null; addenda: { authorName: string | null }[] }>(
      await notes.getNoteAction({ noteId: draft.noteId }),
    );
    expect(full.authorName).toEqual(expect.any(String));
    expect(full.addenda[0]?.authorName).toEqual(expect.any(String));

    as(ownerPsyA);
    expect(codeOf(await notes.getNoteAction({ noteId: other.noteId }))).toBe('NOT_FOUND');
    const theirs = data<{ noteId: string }[]>(await notes.listMyDraftNotesAction());
    expect(theirs.map((d) => d.noteId)).not.toContain(other.noteId);
  });

  it('plans: draft with patient-facing goal -> active; portal sees wording + status only', async () => {
    as(psyA);
    const plan = data<{ planId: string }>(
      await treatment.createTreatmentPlanDraftAction({
        recordId,
        summary: text('Plan ficticio'),
        startDate: new Date().toISOString().slice(0, 10),
        goals: [
          {
            description: text('Redaccion clinica ficticia'),
            patientFacingText: text('Mi meta ficticia'),
          },
        ],
      }),
    );
    const activated = await treatment.activateTreatmentPlanAction({ planId: plan.planId });
    if (!activated.ok) {
      // A previous run left a draft: the one-draft-per-record rule makes the create fail first.
      throw new Error(JSON.stringify(activated));
    }
    const full = data<{ goals: { id: string }[]; status: string }>(
      await treatment.getTreatmentPlanAction({ planId: plan.planId }),
    );
    expect(full.status).toBe('active');
    expect(
      codeOf(
        await treatment.setPatientFacingGoalTextAction({
          goalId: full.goals[0]!.id,
          patientFacingText: text('cambio'),
        }),
      ),
    ).toBe('PRECONDITION_FAILED'); // plan_not_draft: wording frozen with the active plan

    as(patientA);
    const goals = data<{ patientFacingText: unknown; status: string }[]>(
      await treatment.listMyGoalsAction({}),
    );
    expect(goals.length).toBeGreaterThan(0);
    expect(Object.keys(goals[0]!).sort()).toEqual(['goalId', 'patientFacingText', 'status']);
  });

  it('sessions are records only; the portal sees date/time/status', async () => {
    as(psyA);
    const start = new Date(Date.now() + 3 * 86_400_000);
    const end = new Date(start.getTime() + 50 * 60_000);
    data(
      await sessions.recordSessionAction({
        patientId: SEED.patients.adultA,
        start: start.toISOString(),
        end: end.toISOString(),
        status: 'scheduled',
        modality: 'in_person',
      }),
    );
    const list = data<{ noteState: string }[]>(
      await sessions.listSessionsAction({ patientId: SEED.patients.adultA }),
    );
    expect(list.length).toBeGreaterThan(0);
    as(patientA);
    const upcoming = data<Record<string, unknown>[]>(
      await sessions.listMyUpcomingSessionsAction({}),
    );
    expect(upcoming.length).toBeGreaterThan(0);
    expect(Object.keys(upcoming[0]!).sort()).toEqual([
      'end',
      'modality',
      'sessionId',
      'start',
      'status',
    ]);
  });

  it('documents: private upload, signed URL, share -> portal list/URL, unshare -> gone', async () => {
    as(psyA);
    const [adultRecord] = await admin<{ id: string }[]>`
      select id from public.clinical_records where patient_id = ${SEED.patients.adultA}::uuid`;
    const bad = new FormData();
    bad.set('recordId', adultRecord!.id);
    bad.set('documentType', 'report');
    bad.set('title', 'Falso');
    bad.set(
      'file',
      new File([new TextEncoder().encode('<html>no</html>')], 'x.pdf', { type: 'application/pdf' }),
    );
    expect(codeOf(await documents.uploadClinicalDocumentAction(bad))).toBe('VALIDATION_FAILED');

    const form = new FormData();
    form.set('recordId', adultRecord!.id);
    form.set('documentType', 'report');
    form.set('title', 'Informe ficticio');
    form.set('file', new File([PDF], 'informe/../ficticio.pdf', { type: 'application/pdf' }));
    const uploaded = data<{ documentId: string; fileObjectId: string }>(
      await documents.uploadClinicalDocumentAction(form),
    );
    const [file] = await admin<{ storage_path: string; status: string; display_name: string }[]>`
      select storage_path, status, display_name from public.file_objects where id = ${uploaded.fileObjectId}::uuid`;
    expect(file).toMatchObject({ status: 'ready' });
    expect(file!.storage_path).toBe(
      `org/${ORGS.A.id}/patient/${SEED.patients.adultA}/${uploaded.fileObjectId}`,
    );
    expect(file!.display_name).not.toContain('/');

    const url = data<{ url: string; expiresInSeconds: number }>(
      await documents.issueClinicalFileUrlAction({ fileObjectId: uploaded.fileObjectId }),
    );
    expect(url.expiresInSeconds).toBeLessThanOrEqual(60);
    const fetched = await fetch(url.url);
    expect(fetched.status).toBe(200);
    expect((await audits('file.download_url_issued', uploaded.fileObjectId)).length).toBe(1);

    as(patientA);
    expect(
      data<{ documentId: string }[]>(await documents.listMySharedDocumentsAction({})).some(
        (d) => d.documentId === uploaded.documentId,
      ),
    ).toBe(false);
    expect(
      codeOf(await documents.issuePortalDocumentUrlAction({ documentId: uploaded.documentId })),
    ).toBe('NOT_FOUND');

    as(psyA);
    const share = data<{ shareId: string }>(
      await documents.shareClinicalDocumentAction({ documentId: uploaded.documentId }),
    );
    as(patientA);
    const portalDocs = data<Record<string, unknown>[]>(
      await documents.listMySharedDocumentsAction({}),
    );
    expect(portalDocs.some((d) => d.documentId === uploaded.documentId)).toBe(true);
    const portalUrl = data<{ url: string }>(
      await documents.issuePortalDocumentUrlAction({ documentId: uploaded.documentId }),
    );
    expect((await fetch(portalUrl.url)).status).toBe(200);
    expect((await audits('document.portal_url_issued', uploaded.documentId)).length).toBe(1);

    as(psyA);
    data(await documents.unshareClinicalDocumentAction({ shareId: share.shareId }));
    as(patientA);
    expect(
      codeOf(await documents.issuePortalDocumentUrlAction({ documentId: uploaded.documentId })),
    ).toBe('NOT_FOUND');
  });

  it('a platform admin gets no tenant context, hence no clinical path', async () => {
    await expect(ctxFor(PERSONAS.platform)).rejects.toThrow('FORBIDDEN');
  });
});
