import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGS, PERSONAS, type Persona } from '../fixtures/personas';
import { detectLocalStack, signIn, skipMessage } from '../fixtures/local-stack';

/**
 * Permission registry <-> RLS parity (ADR-004, SECURITY.md §4.2 point 4): for each Phase 1
 * permission with a DB mirror, the TS decision for a real persona context must equal the
 * result of the RLS helper the policy uses, evaluated with the persona's REAL JWT.
 */
const stack = await detectLocalStack();
skipMessage('authz-parity', stack);

const SQL_MIRROR = {
  'org.settings.manage': `select app.can_write_as_role('${ORGS.A.id}', 'organization_owner') as ok`,
  'org.branding.manage': `select app.can_write_as_role('${ORGS.A.id}', 'organization_owner') as ok`,
  'org.domains.manage': `select app.can_write_as_role('${ORGS.A.id}', 'organization_owner') as ok`,
  'org.invitations.manage': `select app.can_write_as_role('${ORGS.A.id}', 'organization_owner') as ok`,
  'org.members.manage': `select app.can_write_as_role('${ORGS.A.id}', 'organization_owner') as ok`,
  'org.members.read': `select app.is_org_member('${ORGS.A.id}') as ok`,
  'org.audit.read': `select app.has_org_role('${ORGS.A.id}', 'organization_owner') as ok`,
  'platform.org.read': `select app.is_platform_admin() as ok`,
  'platform.grant.request': `select app.is_platform_admin() as ok`,
} as const;

type MirroredPermission = keyof typeof SQL_MIRROR;
const PERSONA_LIST: Persona[] = [PERSONAS.ownerA, PERSONAS.ownerPsyA, PERSONAS.psyA, PERSONAS.platform];

describe.skipIf(!stack.available)('registry <-> RLS helper parity (real JWTs)', () => {
  let authz: typeof import('@/server/authz');
  let server: typeof import('@/server/db/server');
  let pool: typeof import('@/server/db/pool');
  let verify: typeof import('@/server/auth/claims')['verifyAccessToken'];

  beforeAll(async () => {
    authz = await import('@/server/authz');
    server = await import('@/server/db/server');
    pool = await import('@/server/db/pool');
    verify = (await import('@/server/auth/claims')).verifyAccessToken;
  });

  afterAll(async () => {
    await pool?.closeSql();
  });

  for (const aal of ['aal2', 'aal1'] as const) {
    for (const persona of PERSONA_LIST) {
      it(`${persona.key} @ ${aal}`, async () => {
        const claims = await verify(await signIn(persona, aal));
        if (!claims) throw new Error('verification failed');
        const ctx = await authz.resolveAuthzContext(claims, { requestId: randomUUID(), locale: 'es' });

        for (const permission of Object.keys(SQL_MIRROR) as MirroredPermission[]) {
          const tsAllowed = ctx.ok && authz.evaluatePermission(ctx.data, permission, { organizationId: ctx.data.organizationId ?? undefined }).allowed;
          const dbAllowed = await server.withUserTransaction(claims, async (tx) => {
            const [row] = await tx.unsafe<{ ok: boolean }[]>(SQL_MIRROR[permission]);
            return row?.ok === true;
          });
          expect({ permission, allowed: tsAllowed }).toEqual({ permission, allowed: dbAllowed });
        }
      });
    }
  }
});
