import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGS, PERSONAS } from '../fixtures/personas';
import { adminSql, detectLocalStack, signIn, skipMessage } from '../fixtures/local-stack';

const stack = await detectLocalStack();
skipMessage('audit', stack);

describe.skipIf(!stack.available)('audit writer (ADR-012)', () => {
  let admin: postgres.Sql;
  let audit: typeof import('@/server/audit');
  let server: typeof import('@/server/db/server');
  let pool: typeof import('@/server/db/pool');
  let authz: typeof import('@/server/authz');
  let ownerA: NonNullable<Awaited<ReturnType<typeof import('@/server/auth/claims')['verifyAccessToken']>>>;

  beforeAll(async () => {
    admin = adminSql();
    audit = await import('@/server/audit');
    server = await import('@/server/db/server');
    pool = await import('@/server/db/pool');
    authz = await import('@/server/authz');
    const { verifyAccessToken } = await import('@/server/auth/claims');
    const claims = await verifyAccessToken(await signIn(PERSONAS.ownerA, 'aal2'));
    if (!claims) throw new Error('could not verify ownerA');
    ownerA = claims;
  });

  afterAll(async () => {
    await admin?.end();
    await pool?.closeSql();
  });

  it('TS event catalog equals the DB allowlist', async () => {
    const rows = await admin<{ event_type: string; category: string; writer: string; org_optional: boolean }[]>`
      select event_type, category, writer, org_optional from app.audit_event_types order by event_type
    `;
    const db = rows.map((r) => [r.event_type, r.category, r.writer, r.org_optional]);
    const ts = Object.entries(audit.AUDIT_EVENTS)
      .map(([type, spec]) => [type, spec.category, spec.writer, spec.orgOptional])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(ts).toEqual(db);
  });

  it('recordAudit writes with the actor and roles taken from the DB', async () => {
    const requestId = `it-${Date.now()}`;
    const id = await server.withUserTransaction(ownerA, (tx) =>
      audit.recordAudit(tx, 'organization.updated', { changed_fields: ['display_name'] }, {
        organizationId: ORGS.A.id,
        resourceType: 'organization',
        resourceId: ORGS.A.id,
        requestId,
      }),
    );
    const [row] = await admin<{ actor_profile_id: string; actor_type: string; actor_roles: string[]; metadata: unknown }[]>`
      select actor_profile_id, actor_type, actor_roles, metadata from public.audit_logs where id = ${id}
    `;
    expect(row).toEqual({
      actor_profile_id: PERSONAS.ownerA.id,
      actor_type: 'user',
      actor_roles: ['organization_owner'],
      metadata: { changed_fields: ['display_name'] },
    });
  });

  it('rejects metadata outside the event schema before it reaches the DB', async () => {
    await expect(
      server.withUserTransaction(ownerA, (tx) =>
        audit.recordAudit(tx, 'organization.updated', { changed_fields: ['x'], display_name: 'Ana' } as never, {
          organizationId: ORGS.A.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it('cannot write for a foreign organization', async () => {
    await expect(
      server.withUserTransaction(ownerA, (tx) =>
        audit.recordAudit(tx, 'organization.updated', { changed_fields: [] }, { organizationId: ORGS.B.id }),
      ),
    ).rejects.toThrow(/AUDIT:organization_not_allowed/);
  });

  it('requirePermission audits a cross-tenant denial as access.denied (system writer)', async () => {
    const ctx = await authz.resolveAuthzContext(ownerA, { requestId: `deny-${Date.now()}`, locale: 'es' });
    if (!ctx.ok) throw new Error('context failed');
    const result = await authz.requirePermission(ctx.data, 'org.settings.manage', { organizationId: ORGS.B.id });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOT_FOUND');
    const [row] = await admin<{ actor_type: string; actor_profile_id: string; organization_id: string | null; metadata: Record<string, unknown> }[]>`
      select actor_type, actor_profile_id, organization_id, metadata from public.audit_logs
      where request_id = ${ctx.data.requestId} and event_type = 'access.denied'
    `;
    expect(row).toEqual({
      actor_type: 'system',
      actor_profile_id: PERSONAS.ownerA.id,
      organization_id: null,
      metadata: { permission: 'org.settings.manage', code: 'NOT_FOUND', acting_as: 'staff' },
    });
  });

  it('audit rows are immutable even for the superuser connection', async () => {
    await expect(admin`update public.audit_logs set event_type = event_type where seq = (select max(seq) from public.audit_logs)`).rejects.toThrow(
      /IMMUTABLE:audit_logs/,
    );
  });
});
