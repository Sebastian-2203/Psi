import type postgres from 'postgres';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGS, PERSONAS } from '../fixtures/personas';
import {
  adminSql,
  detectLocalStack,
  serviceClient,
  signIn,
  skipMessage,
} from '../fixtures/local-stack';

const stack = await detectLocalStack();
skipMessage('tenancy-context', stack);

type VerifiedClaims = NonNullable<
  Awaited<ReturnType<(typeof import('@/server/auth/claims'))['verifyAccessToken']>>
>;

describe.skipIf(!stack.available)(
  'tenancy resolution, AuthzContext and invitation acceptance',
  () => {
    let tenancy: typeof import('@/server/tenancy');
    let authz: typeof import('@/server/authz');
    let admin: typeof import('@/server/db/system');
    let pool: typeof import('@/server/db/pool');
    let pg: postgres.Sql;
    const claims: Record<string, VerifiedClaims> = {};

    beforeAll(async () => {
      tenancy = await import('@/server/tenancy');
      authz = await import('@/server/authz');
      admin = await import('@/server/db/system');
      pool = await import('@/server/db/pool');
      pg = adminSql();
      const { verifyAccessToken } = await import('@/server/auth/claims');
      for (const [key, persona, aal] of [
        ['ownerA', PERSONAS.ownerA, 'aal2'],
        ['ownerAal1', PERSONAS.ownerA, 'aal1'],
        ['psyNoMfaA', PERSONAS.psyNoMfaA, 'aal1'],
        ['platform', PERSONAS.platform, 'aal2'],
      ] as const) {
        const verified = await verifyAccessToken(await signIn(persona, aal));
        if (!verified) throw new Error(`could not verify ${key}`);
        claims[key] = verified;
      }
    });

    afterAll(async () => {
      await pg?.end();
      await pool?.closeSql();
    });

    it('resolves verified hosts only (ids only, normalized)', async () => {
      tenancy.clearHostCache();
      expect(await tenancy.resolveOrganizationIdByHost('demo-a.localhost:3000')).toBe(ORGS.A.id);
      expect(await tenancy.resolveOrganizationIdByHost('DEMO-B.localhost.')).toBe(ORGS.B.id);
      expect(await tenancy.resolveOrganizationIdByHost('unverified-b.localhost')).toBeNull();
      expect(await tenancy.resolveOrganizationIdByHost('evil.example.test')).toBeNull();
      expect(
        await tenancy.resolveOrganizationIdByHost("demo-a.localhost'; drop table x;--"),
      ).toBeNull();
      expect(tenancy.normalizeHost('[::1]:3000')).toBeNull();
    });

    it('returns public branding tokens for pre-auth rendering', async () => {
      const branding = await tenancy.getPublicBranding(ORGS.A.id);
      expect(branding?.slug).toBe('demo-a');
      expect(branding?.brandColor).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('builds a staff context for an aal2 owner; hints never add capacities', async () => {
      const ctx = await authz.resolveAuthzContext(claims.ownerA!, {
        requestId: randomUUID(),
        locale: 'es',
        organizationHint: ORGS.B.id, // foreign hint is ignored
      });
      expect(ctx.ok).toBe(true);
      if (!ctx.ok) return;
      expect(ctx.data.actingAs).toBe('staff');
      expect(ctx.data.organizationId).toBe(ORGS.A.id);
      expect(ctx.data.membership?.roles).toEqual(['organization_owner']);
      expect(ctx.data.availableCapacities).toEqual([
        { organizationId: ORGS.A.id, actingAs: 'staff' },
      ]);
    });

    it('returns MFA_REQUIRED for staff at aal1', async () => {
      for (const key of ['ownerAal1', 'psyNoMfaA']) {
        const ctx = await authz.resolveAuthzContext(claims[key]!, {
          requestId: randomUUID(),
          locale: 'es',
        });
        expect(ctx.ok).toBe(false);
        if (!ctx.ok) expect(ctx.error.code).toBe('MFA_REQUIRED');
      }
    });

    it('builds a platform_admin context without any organization', async () => {
      const ctx = await authz.resolveAuthzContext(claims.platform!, {
        requestId: randomUUID(),
        locale: 'en',
      });
      expect(ctx.ok).toBe(true);
      if (ctx.ok) {
        expect(ctx.data.actingAs).toBe('platform_admin');
        expect(ctx.data.organizationId).toBeNull();
        expect(authz.evaluatePermission(ctx.data, 'org.members.read').allowed).toBe(false);
      }
    });

    it('accepts a staff invitation once, bound to the verified email', async () => {
      const email = `invitee-${randomUUID()}@example.test`;
      const rawToken = randomUUID() + randomUUID();
      const tokenHash = createHash('sha256').update(rawToken).digest();
      await pg`
      insert into public.invitations (organization_id, email, roles, token_hash, expires_at, invited_by)
      values (${ORGS.B.id}, ${email}, '{organization_owner}', ${tokenHash}, now() + interval '1 hour', ${PERSONAS.ownerB.id})
    `;
      const { data, error } = await serviceClient().auth.admin.createUser({
        email,
        password: `Fictional-${randomUUID()}`,
        email_confirm: true,
        user_metadata: { display_name: 'Fictional invitee', fictional: true },
      });
      if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);

      await expect(
        admin.systemAcceptStaffInvitation({
          tokenHash,
          profileId: PERSONAS.psyA.id,
          requestId: null,
        }),
      ).rejects.toThrow(/PRECONDITION:invitation_invalid/);

      const accepted = await admin.systemAcceptStaffInvitation({
        tokenHash,
        profileId: data.user.id,
        requestId: null,
      });
      expect(accepted.organizationId).toBe(ORGS.B.id);

      await expect(
        admin.systemAcceptStaffInvitation({ tokenHash, profileId: data.user.id, requestId: null }),
      ).rejects.toThrow(/PRECONDITION:invitation_invalid/);

      const events = await pg<{ event_type: string }[]>`
      select event_type from public.audit_logs where resource_id in (${accepted.membershipId}::uuid)
         or (event_type = 'invitation.accepted' and actor_profile_id = ${data.user.id}) order by seq
    `;
      expect(events.map((e) => e.event_type)).toEqual([
        'invitation.accepted',
        'membership.created',
      ]);
    });
  },
);
