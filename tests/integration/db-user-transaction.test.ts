import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ORGS, PERSONAS } from '../fixtures/personas';
import { detectLocalStack, signIn, skipMessage } from '../fixtures/local-stack';

/**
 * ADR-019 Option A data path: verified claims -> one transaction as `authenticated`.
 * Runs against the local Supabase stack with REAL persona tokens (fictional seed).
 */
const stack = await detectLocalStack();
skipMessage('db-user-transaction', stack);

type ClaimsModule = typeof import('@/server/auth/claims');
type ServerModule = typeof import('@/server/db/server');
type PoolModule = typeof import('@/server/db/pool');
type AdminModule = typeof import('@/server/db/admin');

describe.skipIf(!stack.available)('withUserTransaction (ADR-019 Option A)', () => {
  let claimsMod: ClaimsModule;
  let server: ServerModule;
  let pool: PoolModule;
  let admin: AdminModule;
  let ownerA: Awaited<ReturnType<ClaimsModule['verifyAccessToken']>>;
  let ownerB: Awaited<ReturnType<ClaimsModule['verifyAccessToken']>>;
  let ownerAal1: Awaited<ReturnType<ClaimsModule['verifyAccessToken']>>;

  beforeAll(async () => {
    claimsMod = await import('@/server/auth/claims');
    server = await import('@/server/db/server');
    pool = await import('@/server/db/pool');
    admin = await import('@/server/db/admin');
    ownerA = await claimsMod.verifyAccessToken(await signIn(PERSONAS.ownerA, 'aal2'));
    ownerB = await claimsMod.verifyAccessToken(await signIn(PERSONAS.ownerB, 'aal2'));
    ownerAal1 = await claimsMod.verifyAccessToken(await signIn(PERSONAS.ownerA, 'aal1'));
  });

  afterAll(async () => {
    await pool?.closeSql();
  });

  it('verifies real tokens into branded claims', () => {
    expect(ownerA?.sub).toBe(PERSONAS.ownerA.id);
    expect(ownerA?.aal).toBe('aal2');
    expect(ownerA?.mfaVerifiedAt).toBeTypeOf('number');
    expect(ownerAal1?.aal).toBe('aal1');
  });

  it('binds auth.uid(), role and aal inside the transaction', async () => {
    const row = await server.withUserTransaction(ownerA!, async (tx) => {
      const [r] = await tx<{ uid: string; role: string; aal: string; session_user: string }[]>`
        select auth.uid() as uid, current_user as role, app.aal() as aal, session_user
      `;
      return r;
    });
    expect(row).toEqual({
      uid: PERSONAS.ownerA.id,
      role: 'authenticated',
      aal: 'aal2',
      session_user: 'app_server',
    });
  });

  it('applies RLS: each owner only sees their own organization', async () => {
    const slugsA = await server.withUserTransaction(
      ownerA!,
      (tx) => tx<{ slug: string }[]>`select slug from public.organizations`,
    );
    const slugsB = await server.withUserTransaction(
      ownerB!,
      (tx) => tx<{ slug: string }[]>`select slug from public.organizations`,
    );
    expect(slugsA.map((r) => r.slug)).toEqual([ORGS.A.slug]);
    expect(slugsB.map((r) => r.slug)).toEqual([ORGS.B.slug]);
    const updated = await server.withUserTransaction(
      ownerA!,
      (tx) =>
        tx`update public.organizations set display_name = display_name where id = ${ORGS.B.id}`,
    );
    expect(updated.count).toBe(0);
  });

  it('aal1 sessions see no tenant rows but still see their own capacities', async () => {
    const result = await server.withUserTransaction(ownerAal1!, async (tx) => {
      const orgs = await tx`select id from public.organizations`;
      const caps = await tx`select organization_id from app.my_capacities()`;
      return { orgs: orgs.length, caps: caps.length };
    });
    expect(result).toEqual({ orgs: 0, caps: 1 });
  });

  it('refuses claims that were not produced by the claims module', async () => {
    const forged = { ...ownerA!, sub: PERSONAS.ownerB.id };
    await expect(
      server.withUserTransaction(forged as typeof ownerA & object, async () => 1),
    ).rejects.toThrow(/Unverified claims/);
    await expect(
      server.withUserTransaction(
        { sub: PERSONAS.ownerA.id } as unknown as NonNullable<typeof ownerA>,
        async () => 1,
      ),
    ).rejects.toThrow(/Unverified claims/);
  });

  it('rejects tampered, garbage and revoked tokens', async () => {
    const token = await signIn(PERSONAS.ownerB, 'aal1', { fresh: true });
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p ?? '', 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const tampered = [
      h,
      Buffer.from(JSON.stringify({ ...payload, aal: 'aal2' })).toString('base64url'),
      s,
    ].join('.');
    expect(await claimsMod.verifyAccessToken(tampered)).toBeNull();
    expect(await claimsMod.verifyAccessToken('not-a-jwt')).toBeNull();
    expect(
      await claimsMod.verifyAccessToken(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string),
    ).toBeNull();

    // Still signature-valid after sign-out, but the session is gone: getUser() rejects it.
    expect(await claimsMod.verifyAccessToken(token)).not.toBeNull();
    const { error } = await signOutToken(token);
    expect(error).toBeNull();
    expect(await claimsMod.verifyAccessToken(token)).toBeNull();
  });

  it('cannot escalate: no SET ROLE to privileged roles, RESET ROLE leaves no privileges', async () => {
    for (const role of ['service_role', 'postgres', 'supabase_admin', 'authenticator']) {
      await expect(
        server.withUserTransaction(ownerA!, (tx) => tx.unsafe(`set local role ${role}`)),
      ).rejects.toThrow(/permission denied/);
    }
    await expect(
      server.withUserTransaction(ownerA!, async (tx) => {
        await tx`reset role`;
        return tx`select id from public.organizations`;
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      server.withUserTransaction(
        ownerA!,
        (tx) => tx`select app.write_system_audit('access.denied')`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('transaction-local settings never leak across pooled connections', async () => {
    const sql = pool.getSql();
    const rounds = 25;
    await Promise.all(
      Array.from({ length: rounds }, async (_, i) => {
        const claims = i % 2 === 0 ? ownerA! : ownerB!;
        const uid = await server.withUserTransaction(claims, async (tx) => {
          const [r] = await tx<{ uid: string }[]>`select auth.uid() as uid`;
          return r?.uid;
        });
        expect(uid).toBe(claims.sub);
      }),
    );
    // Every pooled connection is back to the bare login role with no identity.
    const probes = await Promise.all(
      Array.from(
        { length: 10 },
        () =>
          // (Bare app_server has no USAGE on schema auth, so read the raw settings.)
          sql<{ sub: string | null; role: string; claims: string | null }[]>`
          select current_setting('request.jwt.claim.sub', true) as sub, current_user as role,
                 current_setting('request.jwt.claims', true) as claims
        `,
      ),
    );
    for (const [probe] of probes) {
      expect(probe?.sub ?? '').toBe('');
      expect(probe?.role).toBe('app_server');
      expect(probe?.claims ?? '').toBe('');
    }
    // A failed (rolled-back) user transaction leaks nothing either.
    await expect(
      server.withUserTransaction(ownerA!, async (tx) => {
        await tx`select 1/0`;
      }),
    ).rejects.toThrow();
    const [after] = await sql<{ sub: string | null; role: string }[]>`
      select current_setting('request.jwt.claim.sub', true) as sub, current_user as role
    `;
    expect(after?.sub ?? '').toBe('');
    expect(after?.role).toBe('app_server');
  });

  it('system path runs as app_server without identity and only reaches granted functions', async () => {
    expect(await admin.systemResolveOrganizationIdByHost(ORGS.A.host)).toBe(ORGS.A.id);
    const sql = pool.getSql();
    await expect(sql`select id from public.organizations`).rejects.toThrow(/permission denied/);
  });
});

/** Revokes the session behind an access token (Auth `POST /logout`, scope local). */
async function signOutToken(token: string): Promise<{ error: Error | null }> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/logout?scope=local`, {
    method: 'POST',
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      authorization: `Bearer ${token}`,
    },
  });
  return { error: res.status === 204 ? null : new Error(`logout returned ${res.status}`) };
}
