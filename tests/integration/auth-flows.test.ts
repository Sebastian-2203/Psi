import type { SupabaseClient } from '@supabase/supabase-js';
import type postgres from 'postgres';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ORGS, PERSONAS, FICTIONAL_PASSWORD, FICTIONAL_TOTP_SECRET } from '../fixtures/personas';
import {
  adminSql,
  anonClient,
  deleteFictionalUser,
  detectLocalStack,
  serviceClient,
  skipMessage,
} from '../fixtures/local-stack';
import { clearMailbox, firstLink, mailpitAvailable, waitForEmail } from '../fixtures/mailpit';
import { totp } from '../fixtures/totp';

/**
 * Workstream 1.3 integration tests against the LOCAL stack (fictional personas only):
 * pre-auth rate limits, sign-in, MFA step-up, aal1 vs aal2 access, host scoping, recovery
 * codes (bcrypt hashing, single use, factor reset), invitation token lifecycle, password reset
 * through the real recovery email in Mailpit.
 */

/**
 * Fault injection for the P1-05 test: pass-through to the real Auth admin call unless a test
 * arms `fault.factorDeletion`, which makes the next reset fail at the deletion stage WITHOUT
 * touching the factors (as a GoTrue error on the first delete would).
 */
const fault = vi.hoisted(() => ({ factorDeletion: 0 }));
vi.mock('@/server/db/service-role', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/db/service-role')>();
  return {
    ...real,
    adminDeleteAllMfaFactors: async (userId: string) => {
      if (fault.factorDeletion > 0) {
        fault.factorDeletion -= 1;
        return { ok: false as const, removed: 0, stage: 'delete' as const };
      }
      return real.adminDeleteAllMfaFactors(userId);
    },
  };
});

const stack = await detectLocalStack();
skipMessage('auth-flows', stack);
const mail = stack.available ? await mailpitAvailable() : false;
if (stack.available && !mail) {
  console.warn('[integration] auth-flows: Mailpit unavailable; email-dependent tests skipped.');
}

type Claims = NonNullable<
  Awaited<ReturnType<(typeof import('@/server/auth/claims'))['verifyAccessToken']>>
>;

/** In-memory cookie jar standing in for the Next.js request cookies. */
function cookieJar() {
  const jar = new Map<string, string>();
  return {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (list: { name: string; value: string; options: Record<string, unknown> }[]) => {
      for (const { name, value, options } of list) {
        if (value === '' || options.maxAge === 0) jar.delete(name);
        else jar.set(name, value);
      }
    },
    size: () => jar.size,
  };
}

/** TEST-NET-3 addresses: unique per run so counters never collide with other suites. */
const runIp = () => `203.0.113.${Math.floor(Math.random() * 250) + 1}`;

function meta(ip: string | null = runIp()) {
  return {
    requestId: randomUUID(),
    ip,
    userAgent: 'vitest-auth-flows',
    host: 'localhost:3000',
    origin: 'http://localhost:3000',
  };
}

/** Polls until a TOTP window boundary is not imminent (avoids codes expiring mid-request). */
async function freshTotp(secret: string): Promise<string> {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 3_000) await new Promise((r) => setTimeout(r, remaining + 200));
  return totp(secret);
}

describe.skipIf(!stack.available)('auth flows (workstream 1.3)', () => {
  let pg: postgres.Sql;
  let pool: typeof import('@/server/db/pool');
  let claimsMod: typeof import('@/server/auth/claims');
  let supa: typeof import('@/server/auth/supabase');
  let signInMod: typeof import('@/server/auth/sign-in');
  let rate: typeof import('@/server/auth/rate-limit');
  let mfa: typeof import('@/server/auth/mfa');
  let codes: typeof import('@/server/auth/recovery-codes');
  let inv: typeof import('@/server/auth/invitations');
  let pw: typeof import('@/server/auth/password');
  let authz: typeof import('@/server/authz');
  let tenancy: typeof import('@/server/tenancy');
  let db: typeof import('@/server/db/server');
  const cleanupUsers: string[] = [];

  beforeAll(async () => {
    pg = adminSql();
    // LOCAL ONLY: per-email sign-in limits (ADR-020) would otherwise trip on repeated runs.
    await pg`truncate public.rate_limit_counters`;
    pool = await import('@/server/db/pool');
    claimsMod = await import('@/server/auth/claims');
    supa = await import('@/server/auth/supabase');
    signInMod = await import('@/server/auth/sign-in');
    rate = await import('@/server/auth/rate-limit');
    mfa = await import('@/server/auth/mfa');
    codes = await import('@/server/auth/recovery-codes');
    inv = await import('@/server/auth/invitations');
    pw = await import('@/server/auth/password');
    authz = await import('@/server/authz');
    tenancy = await import('@/server/tenancy');
    db = await import('@/server/db/server');
  });

  afterAll(async () => {
    for (const id of cleanupUsers) await deleteFictionalUser(id).catch(() => undefined);
    await pg?.end();
    await pool?.closeSql();
  });

  function client(): { client: SupabaseClient; jar: ReturnType<typeof cookieJar> } {
    const jar = cookieJar();
    return { client: supa.createAuthClient(jar), jar };
  }

  async function passwordAndTotp(email: string, password: string, secret: string) {
    const c = client();
    const signed = await signInMod.signInWithPassword(c.client, { email, password }, meta());
    if (!signed.ok) throw new Error(`sign-in failed: ${signed.error.code}`);
    const upgraded = await mfa.verifyTotpChallenge(
      c.client,
      signed.data.claims,
      await freshTotp(secret),
      meta(),
    );
    if (!upgraded.ok) throw new Error(`mfa failed: ${upgraded.error.code}`);
    return { ...c, aal1: signed.data.claims, aal2: upgraded.data.claims };
  }

  /** Throwaway fictional user with its own TOTP factor (never a seeded persona). */
  async function throwawayUserWithTotp() {
    const email = `throwaway-${randomUUID()}@example.test`;
    const password = `Fictional-${randomUUID()}`;
    const { data, error } = await serviceClient().auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Fictional throwaway', locale: 'es', fictional: true },
    });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    cleanupUsers.push(data.user.id);
    const c = client();
    const signed = await signInMod.signInWithPassword(c.client, { email, password }, meta());
    if (!signed.ok) throw new Error('throwaway sign-in failed');
    expect(signed.data.step).toBe('app'); // no staff capacity -> MFA optional
    const started = await mfa.startTotpEnrollment(c.client, signed.data.claims);
    if (!started.ok) throw new Error('enroll failed');
    expect(started.data.qrCode.startsWith('data:image/svg+xml;')).toBe(true);
    const secret = started.data.secret;
    const verified = await mfa.verifyTotpEnrollment(
      c.client,
      signed.data.claims,
      { factorId: started.data.factorId, code: await freshTotp(secret) },
      meta(),
    );
    if (!verified.ok) throw new Error(`enroll verify failed: ${verified.error.code}`);
    expect(verified.data.claims.aal).toBe('aal2');
    return { id: data.user.id, email, password, secret, aal2: verified.data.claims, ...c };
  }

  async function auditCount(eventType: string, actor: string | null, since: Date) {
    const [row] = await pg<{ n: number }[]>`
      select count(*)::int as n from public.audit_logs
      where event_type = ${eventType} and occurred_at >= ${since}
        and (${actor}::uuid is null or actor_profile_id = ${actor}::uuid)
    `;
    return row?.n ?? 0;
  }

  /** `outcome:factors_removed` of the user's auth.mfa_reset rows, oldest first. */
  async function resetOutcomes(actor: string, since: Date) {
    const rows = await pg<{ outcome: string; removed: string | null }[]>`
      select metadata->>'outcome' as outcome, metadata->>'factors_removed' as removed
      from public.audit_logs
      where event_type = 'auth.mfa_reset' and occurred_at >= ${since}
        and actor_profile_id = ${actor}::uuid
      order by seq
    `;
    return rows.map((r) => `${r.outcome}:${r.removed ?? ''}`);
  }

  // -------------------------------------------------------------------------
  describe('rate limiting (ADR-020, Postgres counters, fail closed)', () => {
    it('limits per subject and audits auth.rate_limited without storing raw keys', async () => {
      const since = new Date();
      const subject = `limit-${randomUUID()}@example.test`;
      const results: boolean[] = [];
      for (let i = 0; i < 11; i += 1) {
        results.push(
          await rate.consumePreAuthLimit({ action: 'auth.sign_in', ip: runIp(), subject }),
        );
      }
      expect(results.slice(0, 10).every(Boolean)).toBe(true);
      expect(results[10]).toBe(false);
      expect(await auditCount('auth.rate_limited', null, since)).toBeGreaterThanOrEqual(1);
      const key = rate.bucketKey('auth.sign_in', 'subject', subject);
      const [row] = await pg<{ count: number }[]>`
        select max(count)::int as count from public.rate_limit_counters where bucket_key = ${Buffer.from(key)}
      `;
      expect(row?.count).toBe(11);
    });

    it('signInWithPassword returns RATE_LIMITED before calling Supabase Auth', async () => {
      const email = `limited-${randomUUID()}@example.test`;
      for (let i = 0; i < 10; i += 1) {
        await rate.consumePreAuthLimit({ action: 'auth.sign_in', ip: runIp(), subject: email });
      }
      const { client: c } = client();
      const result = await signInMod.signInWithPassword(
        c,
        { email, password: 'irrelevant-password' },
        meta(),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('RATE_LIMITED');
    });
  });

  // -------------------------------------------------------------------------
  describe('sign-in and MFA step-up', () => {
    it('wrong password and unknown email give the same generic error (no enumeration)', async () => {
      const since = new Date();
      const { client: c1 } = client();
      const wrong = await signInMod.signInWithPassword(
        c1,
        { email: PERSONAS.psyA.email, password: 'definitely-wrong-password' },
        meta(),
      );
      const { client: c2 } = client();
      const unknown = await signInMod.signInWithPassword(
        c2,
        { email: `nobody-${randomUUID()}@example.test`, password: 'definitely-wrong-password' },
        meta(),
      );
      for (const r of [wrong, unknown]) {
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.error.code).toBe('UNAUTHENTICATED');
          expect(r.error.messageKey).toBe('auth.errors.invalidCredentials');
        }
      }
      expect(await auditCount('auth.sign_in_failed', null, since)).toBeGreaterThanOrEqual(2);
    });

    it('password -> aal1 (step mfa / mfa_enroll) -> TOTP -> aal2, audited', async () => {
      const since = new Date();
      const { client: c } = client();
      const signed = await signInMod.signInWithPassword(
        c,
        { email: PERSONAS.psyA.email, password: FICTIONAL_PASSWORD },
        meta(),
      );
      expect(signed.ok).toBe(true);
      if (!signed.ok) return;
      expect(signed.data.claims.aal).toBe('aal1');
      expect(signed.data.step).toBe('mfa');

      const bad = await mfa.verifyTotpChallenge(c, signed.data.claims, '000000', meta());
      expect(bad.ok).toBe(false);
      if (!bad.ok) expect(bad.error.messageKey).toBe('auth.errors.invalidCode');

      const good = await mfa.verifyTotpChallenge(
        c,
        signed.data.claims,
        await freshTotp(FICTIONAL_TOTP_SECRET),
        meta(),
      );
      expect(good.ok).toBe(true);
      if (good.ok) {
        expect(good.data.claims.aal).toBe('aal2');
        expect(good.data.claims.mfaVerifiedAt).not.toBeNull();
      }
      expect(await auditCount('auth.signed_in', PERSONAS.psyA.id, since)).toBe(1);
      expect(await auditCount('auth.mfa_failed', PERSONAS.psyA.id, since)).toBe(1);
      expect(await auditCount('auth.mfa_verified', PERSONAS.psyA.id, since)).toBe(1);

      const { client: c2 } = client();
      const noMfa = await signInMod.signInWithPassword(
        c2,
        { email: PERSONAS.psyNoMfaA.email, password: FICTIONAL_PASSWORD },
        meta(),
      );
      expect(noMfa.ok && noMfa.data.step).toBe('mfa_enroll');
    });

    it('sign-out revokes the session at Supabase Auth', async () => {
      const { client: c, jar } = client();
      const signed = await signInMod.signInWithPassword(
        c,
        { email: PERSONAS.ownerB.email, password: FICTIONAL_PASSWORD },
        meta(),
      );
      if (!signed.ok) throw new Error('sign-in failed');
      const token = (await c.auth.getSession()).data.session?.access_token as string;
      await signInMod.signOutCurrentSession(c, signed.data.claims, meta());
      expect(jar.size()).toBe(0);
      expect(await claimsMod.verifyAccessToken(token)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('aal1 vs aal2 and host scope (ADR-017, F-03)', () => {
    let ownerAal1: Claims;
    let ownerAal2: Claims;
    let platformAal2: Claims;

    beforeAll(async () => {
      const a = await passwordAndTotp(
        PERSONAS.ownerA.email,
        FICTIONAL_PASSWORD,
        FICTIONAL_TOTP_SECRET,
      );
      ownerAal1 = a.aal1;
      ownerAal2 = a.aal2;
      const p = await passwordAndTotp(
        PERSONAS.platform.email,
        FICTIONAL_PASSWORD,
        FICTIONAL_TOTP_SECRET,
      );
      platformAal2 = p.aal2;
    });

    const hints = (hostScope?: Parameters<typeof authz.resolveAuthzContext>[1]['hostScope']) => ({
      requestId: randomUUID(),
      locale: 'es' as const,
      ...(hostScope ? { hostScope } : {}),
    });

    it('aal1 staff: MFA_REQUIRED in the app AND no rows in the database', async () => {
      const ctx = await authz.resolveAuthzContext(ownerAal1, hints({ kind: 'app' }));
      expect(ctx.ok).toBe(false);
      if (!ctx.ok) expect(ctx.error.code).toBe('MFA_REQUIRED');
      const [aal1Rows] = await db.withUserTransaction(
        ownerAal1,
        (tx) => tx<{ n: number }[]>`select count(*)::int as n from public.memberships`,
      );
      const [aal2Rows] = await db.withUserTransaction(
        ownerAal2,
        (tx) => tx<{ n: number }[]>`select count(*)::int as n from public.memberships`,
      );
      expect(aal1Rows?.n).toBe(0);
      expect(aal2Rows?.n).toBeGreaterThan(0);
    });

    it('host scope restricts capacities: own tenant ok, foreign/unknown tenant denied', async () => {
      const own = await authz.resolveAuthzContext(
        ownerAal2,
        hints({ kind: 'tenant', organizationId: ORGS.A.id }),
      );
      expect(own.ok && own.data.organizationId).toBe(ORGS.A.id);
      for (const scope of [
        { kind: 'tenant', organizationId: ORGS.B.id } as const,
        { kind: 'unknown' } as const,
      ]) {
        const denied = await authz.resolveAuthzContext(ownerAal2, hints(scope));
        expect(denied.ok).toBe(false);
        if (!denied.ok) expect(denied.error.code).toBe('FORBIDDEN');
      }
      // aal1 on a foreign tenant host: denied without an MFA prompt (no capacity there).
      const foreignAal1 = await authz.resolveAuthzContext(
        ownerAal1,
        hints({ kind: 'tenant', organizationId: ORGS.B.id }),
      );
      expect(!foreignAal1.ok && foreignAal1.error.code).toBe('FORBIDDEN');
    });

    it('platform_admin: no staff capacity on tenant hosts, platform capacity only on the app host', async () => {
      const tenant = await authz.resolveAuthzContext(
        platformAal2,
        hints({ kind: 'tenant', organizationId: ORGS.A.id }),
      );
      expect(tenant.ok).toBe(false);
      const app = await authz.resolveAuthzContext(platformAal2, hints({ kind: 'app' }));
      expect(app.ok && app.data.actingAs).toBe('platform_admin');
      expect(app.ok && app.data.membership).toBeFalsy();
    });

    it('resolveHostScope maps app, tenant and unknown hosts', async () => {
      tenancy.clearHostCache();
      const opts = { baseDomain: 'localhost', production: false };
      expect(await tenancy.resolveHostScope('localhost:3000', opts)).toEqual({ kind: 'app' });
      expect(await tenancy.resolveHostScope('127.0.0.1:3000', opts)).toEqual({ kind: 'app' });
      expect(await tenancy.resolveHostScope('demo-b.localhost:3000', opts)).toEqual({
        kind: 'tenant',
        organizationId: ORGS.B.id,
      });
      expect(await tenancy.resolveHostScope('unverified-b.localhost', opts)).toEqual({
        kind: 'unknown',
      });
      expect(await tenancy.resolveHostScope('evil.example.test', opts)).toEqual({
        kind: 'unknown',
      });
      expect(
        await tenancy.resolveHostScope('127.0.0.1', {
          baseDomain: 'app.example.test',
          production: true,
        }),
      ).toEqual({ kind: 'unknown' });
    });
  });

  // -------------------------------------------------------------------------
  describe('password reset through the real recovery email (Mailpit)', () => {
    it.skipIf(!mail)(
      'same response for unknown email; link -> session -> MFA -> new password',
      async () => {
        const user = await throwawayUserWithTotp();
        const since = new Date();
        await clearMailbox(user.email);
        const redirectTo = 'http://localhost:3000/api/auth/confirm/es';

        const unknownEmail = `unknown-${randomUUID()}@example.test`;
        const unknown = await pw.requestPasswordReset(unknownEmail, redirectTo, meta());
        const known = await pw.requestPasswordReset(user.email, redirectTo, meta());
        expect(unknown).toEqual(known);
        expect(known.ok).toBe(true);

        const email = await waitForEmail(user.email);
        const link = new URL(firstLink(email));
        expect(`${link.origin}${link.pathname}`).toBe(redirectTo);
        expect(link.searchParams.get('type')).toBe('recovery');
        const tokenHash = link.searchParams.get('token_hash') as string;

        const { client: c } = client();
        expect(await pw.confirmRecoveryToken(c, tokenHash)).toBe(true);
        // single use
        expect(await pw.confirmRecoveryToken(client().client, tokenHash)).toBe(false);

        const recoveryClaims = await claimsMod.verifyAccessToken(
          (await c.auth.getSession()).data.session?.access_token as string,
        );
        if (!recoveryClaims) throw new Error('no recovery session');
        expect(recoveryClaims.aal).toBe('aal1');
        const newPassword = `Fictional-new-${randomUUID()}`;
        const atAal1 = await pw.completePasswordReset(c, recoveryClaims, newPassword, meta());
        expect(!atAal1.ok && atAal1.error.code).toBe('MFA_REQUIRED');

        const stepped = await mfa.verifyTotpChallenge(
          c,
          recoveryClaims,
          await freshTotp(user.secret),
          meta(),
        );
        if (!stepped.ok) throw new Error('step-up failed');
        const done = await pw.completePasswordReset(c, stepped.data.claims, newPassword, meta());
        expect(done.ok).toBe(true);
        expect(await auditCount('auth.password_reset', user.id, since)).toBe(1);
        // The enrollment session (another session) was revoked.
        expect(
          await claimsMod.verifyAccessToken(
            (await user.client.auth.getSession()).data.session?.access_token as string,
          ),
        ).toBeNull();
        // Old password no longer works; the new one does.
        const old = await anonClient().auth.signInWithPassword({
          email: user.email,
          password: user.password,
        });
        expect(old.error).not.toBeNull();
        const fresh = await anonClient().auth.signInWithPassword({
          email: user.email,
          password: newPassword,
        });
        expect(fresh.error).toBeNull();
      },
    );
  });

  // -------------------------------------------------------------------------
  describe('recovery codes (ADR-021)', () => {
    it('generated codes are bcrypt-hashed, shown once, single use, reset the factor', async () => {
      const user = await throwawayUserWithTotp();
      const since = new Date();

      // aal1 cannot generate (server check and DB check).
      const aal1Client = client().client;
      const aal1 = await signInMod.signInWithPassword(
        aal1Client,
        { email: user.email, password: user.password },
        meta(),
      );
      if (!aal1.ok) throw new Error('sign-in failed');
      const denied = await codes.regenerateRecoveryCodes(aal1.data.claims);
      expect(!denied.ok && denied.error.code).toBe('MFA_REQUIRED');
      await expect(
        db.withUserTransaction(
          aal1.data.claims,
          (tx) => tx`select app.replace_recovery_codes(${codes.generateRecoveryCodeSet()}::text[])`,
        ),
      ).rejects.toThrow(/recent_mfa_required/);

      const generated = await codes.regenerateRecoveryCodes(user.aal2);
      if (!generated.ok) throw new Error(`generate failed: ${generated.error.code}`);
      expect(generated.data.codes).toHaveLength(10);
      for (const code of generated.data.codes)
        expect(code).toMatch(/^([A-HJ-NP-Z2-9]{4}-){3}[A-HJ-NP-Z2-9]{4}$/);

      const rows = await pg<{ code_hash: string; batch_id: string }[]>`
        select code_hash, batch_id from public.mfa_recovery_codes
        where profile_id = ${user.id} and revoked_at is null
      `;
      expect(rows).toHaveLength(10);
      for (const row of rows) {
        expect(row.code_hash).toMatch(/^\$2[aby]\$10\$/);
        for (const code of generated.data.codes) {
          expect(row.code_hash).not.toContain(code.replace(/-/g, ''));
        }
      }
      expect(await codes.getRecoveryCodesStatus(user.aal2)).toMatchObject({
        remaining: 10,
        total: 10,
      });

      // Regeneration revokes the previous batch.
      const second = await codes.regenerateRecoveryCodes(user.aal2);
      if (!second.ok) throw new Error('regenerate failed');
      const [revoked] = await pg<{ n: number }[]>`
        select count(*)::int as n from public.mfa_recovery_codes
        where profile_id = ${user.id} and revoked_at is not null
      `;
      expect(revoked?.n).toBe(10);

      // A revoked (old batch) code is rejected; a current code works once.
      const oldCode = generated.data.codes[0] as string;
      const goodCode = (second.data.codes[3] as string).toLowerCase(); // input is normalized
      const rejected = await codes.redeemRecoveryCode(
        aal1Client,
        aal1.data.claims,
        oldCode,
        meta(),
      );
      expect(!rejected.ok && rejected.error.code).toBe('VALIDATION_FAILED');

      const used = await codes.redeemRecoveryCode(aal1Client, aal1.data.claims, goodCode, meta());
      expect(used.ok).toBe(true);
      if (used.ok) expect(used.data.factorsRemoved).toBe(1);
      const { data: factors } = await serviceClient().auth.admin.mfa.listFactors({
        userId: user.id,
      });
      expect(factors?.factors).toHaveLength(0);
      // Every session of the user was revoked (the enrollment aal2 session too).
      expect(
        await claimsMod.verifyAccessToken(
          (await user.client.auth.getSession()).data.session?.access_token as string,
        ),
      ).toBeNull();
      expect(await auditCount('auth.recovery_code_used', user.id, since)).toBe(1);
      expect(await resetOutcomes(user.id, since)).toEqual(['started:', 'ok:1']);
      expect(await auditCount('auth.mfa_failed', user.id, since)).toBeGreaterThanOrEqual(1);

      // Sign in again (no factor now -> enrollment), the same code cannot be reused.
      const againClient = client().client;
      const again = await signInMod.signInWithPassword(
        againClient,
        { email: user.email, password: user.password },
        meta(),
      );
      if (!again.ok) throw new Error('sign-in after reset failed');
      const reuse = await codes.redeemRecoveryCode(
        againClient,
        again.data.claims,
        goodCode,
        meta(),
      );
      expect(!reuse.ok && reuse.error.code).toBe('VALIDATION_FAILED');

      // Per-profile limiter (5 / 15 min) is fail closed and audited.
      let last: Awaited<ReturnType<typeof codes.redeemRecoveryCode>> | undefined;
      for (let i = 0; i < 4; i += 1) {
        last = await codes.redeemRecoveryCode(
          againClient,
          again.data.claims,
          'AAAA-AAAA-AAAA-AAAA',
          meta(),
        );
      }
      expect(last && !last.ok && last.error.code).toBe('RATE_LIMITED');
      expect(await auditCount('auth.rate_limited', user.id, since)).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('recovery reset failure is recoverable and audited (P1-05)', () => {
    it('a factor-deletion failure keeps the code pending; the same code retries to completion', async () => {
      const user = await throwawayUserWithTotp();
      const since = new Date();
      const generated = await codes.regenerateRecoveryCodes(user.aal2);
      if (!generated.ok) throw new Error('generate failed');
      const code = generated.data.codes[0] as string;
      const codeState = async () => {
        const rows = await pg<{ reset_status: string | null; n: number }[]>`
          select reset_status, count(*)::int as n from public.mfa_recovery_codes
          where profile_id = ${user.id} and revoked_at is null and used_at is not null
          group by reset_status
        `;
        return rows.map((r) => `${r.reset_status}:${r.n}`);
      };
      const factorCount = async () =>
        (await serviceClient().auth.admin.mfa.listFactors({ userId: user.id })).data?.factors
          .length;

      const aal1Client = client().client;
      const aal1 = await signInMod.signInWithPassword(
        aal1Client,
        { email: user.email, password: user.password },
        meta(),
      );
      if (!aal1.ok) throw new Error('sign-in failed');

      // 1. Deletion fails: INTERNAL, nothing reset, sessions intact, code pending, audited.
      fault.factorDeletion = 1;
      const failed = await codes.redeemRecoveryCode(aal1Client, aal1.data.claims, code, meta());
      expect(!failed.ok && failed.error.code).toBe('INTERNAL');
      expect(fault.factorDeletion).toBe(0);
      expect(await factorCount()).toBe(1);
      expect(await codeState()).toEqual(['pending:1']);
      expect(await resetOutcomes(user.id, since)).toEqual(['started:', 'failed:0']);
      expect(
        await claimsMod.verifyAccessToken(
          (await user.client.auth.getSession()).data.session?.access_token as string,
        ),
      ).not.toBeNull();
      expect((await codes.getRecoveryCodesStatus(user.aal2))?.remaining).toBe(9);

      // 2. Retry with the SAME code completes the reset and revokes every session.
      const retried = await codes.redeemRecoveryCode(aal1Client, aal1.data.claims, code, meta());
      expect(retried.ok).toBe(true);
      if (retried.ok) expect(retried.data.factorsRemoved).toBe(1);
      expect(await factorCount()).toBe(0);
      expect(await codeState()).toEqual(['completed:1']);
      expect(await resetOutcomes(user.id, since)).toEqual([
        'started:',
        'failed:0',
        'started:',
        'ok:1',
      ]);
      expect(await auditCount('auth.recovery_code_used', user.id, since)).toBe(1);
      expect(await auditCount('auth.session_revoked', user.id, since)).toBe(1);
      expect(
        await claimsMod.verifyAccessToken(
          (await user.client.auth.getSession()).data.session?.access_token as string,
        ),
      ).toBeNull();

      // 3. Completed: the code is dead.
      const againClient = client().client;
      const again = await signInMod.signInWithPassword(
        againClient,
        { email: user.email, password: user.password },
        meta(),
      );
      if (!again.ok) throw new Error('sign-in after reset failed');
      const reuse = await codes.redeemRecoveryCode(againClient, again.data.claims, code, meta());
      expect(!reuse.ok && reuse.error.code).toBe('VALIDATION_FAILED');
    });
  });

  // -------------------------------------------------------------------------
  describe('staff invitation lifecycle (SECURITY.md §3.8)', () => {
    let ownerCtx: Awaited<ReturnType<typeof authz.resolveAuthzContext>>;

    beforeAll(async () => {
      const owner = await passwordAndTotp(
        PERSONAS.ownerA.email,
        FICTIONAL_PASSWORD,
        FICTIONAL_TOTP_SECRET,
      );
      ownerCtx = await authz.resolveAuthzContext(owner.aal2, {
        requestId: randomUUID(),
        locale: 'es',
        hostScope: { kind: 'tenant', organizationId: ORGS.A.id },
      });
    });

    const render = (link: string) => ({
      to: '',
      subject: 'Fictional invitation',
      text: `Open ${link}`,
    });

    it('non-owner staff cannot create invitations', async () => {
      const psy = await passwordAndTotp(
        PERSONAS.psyA.email,
        FICTIONAL_PASSWORD,
        FICTIONAL_TOTP_SECRET,
      );
      const ctx = await authz.resolveAuthzContext(psy.aal2, {
        requestId: randomUUID(),
        locale: 'es',
      });
      if (!ctx.ok) throw new Error('psy context failed');
      const result = await inv.createStaffInvitation(
        ctx.data,
        { email: `x-${randomUUID()}@example.test`, roles: ['psychologist'] },
        'http://demo-a.localhost:3000',
        render,
        'es',
      );
      expect(!result.ok && result.error.code).toBe('FORBIDDEN');
    });

    it.skipIf(!mail)(
      'create -> email (fragment token, hash only stored) -> preview -> accept once',
      async () => {
        if (!ownerCtx.ok) throw new Error('owner context failed');
        const since = new Date();
        const email = `new-staff-${randomUUID()}@example.test`;
        await clearMailbox(email);
        const first = await inv.createStaffInvitation(
          ownerCtx.data,
          { email, roles: ['psychologist'] },
          'http://demo-a.localhost:3000',
          render,
          'es',
        );
        expect(first.ok).toBe(true);
        // Re-sending revokes the previous token.
        const created = await inv.createStaffInvitation(
          ownerCtx.data,
          { email, roles: ['psychologist'] },
          'http://demo-a.localhost:3000',
          render,
          'es',
        );
        if (!created.ok || !first.ok) throw new Error(`create failed`);
        const [firstRow] = await pg<{ status: string }[]>`
        select status from public.invitations where id = ${first.data.invitationId}
      `;
        expect(firstRow?.status).toBe('revoked');

        const message = await waitForEmail(email);
        const link = new URL(firstLink(message));
        expect(link.origin).toBe('http://demo-a.localhost:3000');
        expect(link.pathname).toBe('/es/invitation');
        expect(link.search).toBe('');
        const token = new URLSearchParams(link.hash.slice(1)).get('token') as string;
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

        const [stored] = await pg<{ token_hash: Buffer; expires_at: Date; created_at: Date }[]>`
        select token_hash, expires_at, created_at from public.invitations where id = ${created.data.invitationId}
      `;
        expect(stored?.token_hash.equals(createHash('sha256').update(token).digest())).toBe(true);
        expect(stored?.token_hash.toString('utf8')).not.toContain(token);
        const ttlHours =
          ((stored?.expires_at.getTime() ?? 0) - (stored?.created_at.getTime() ?? 0)) / 3.6e6;
        expect(Math.round(ttlHours)).toBe(72);
        expect(await auditCount('invitation.created', PERSONAS.ownerA.id, since)).toBe(2);
        expect(await auditCount('invitation.revoked', PERSONAS.ownerA.id, since)).toBe(1);

        const preview = await inv.previewStaffInvitation(token, meta());
        expect(preview.ok && preview.data).toMatchObject({
          email,
          roles: ['psychologist'],
          requiresProfessionalProfile: true,
        });
        expect(preview.ok && 'existingProfileId' in preview.data).toBe(false);

        const password = `Fictional-${randomUUID()}`;
        const missingProfessional = await inv.acceptStaffInvitation(
          client().client,
          { token, displayName: 'Fictional New Staff', password, locale: 'es' },
          meta(),
        );
        expect(!missingProfessional.ok && missingProfessional.error.code).toBe('VALIDATION_FAILED');

        const professional = {
          title: 'Psicóloga (ficticia)',
          licenseNumber: `TP-FICT-${randomUUID().slice(0, 8)}`,
          licenseIssuer: 'Colegio Ficticio',
        };
        const { client: c } = client();
        const accepted = await inv.acceptStaffInvitation(
          c,
          { token, displayName: 'Fictional New Staff', password, locale: 'es', professional },
          meta(),
        );
        if (!accepted.ok) throw new Error(`accept failed: ${accepted.error.code}`);
        cleanupUsers.push(accepted.data.claims.sub);
        expect(accepted.data.step).toBe('mfa_enroll');
        const [membership] = await pg<{ status: string; roles: string[] }[]>`
        select m.status, array_agg(r.role::text) as roles
        from public.memberships m join public.membership_roles r on r.membership_id = m.id
        where m.profile_id = ${accepted.data.claims.sub} and m.organization_id = ${ORGS.A.id}
        group by m.status
      `;
        expect(membership).toEqual({ status: 'active', roles: ['psychologist'] });
        expect(await auditCount('invitation.accepted', accepted.data.claims.sub, since)).toBe(1);

        // Single use: the same token (and the revoked first token) are rejected generically.
        const reused = await inv.acceptStaffInvitation(
          client().client,
          { token, displayName: 'x', password, locale: 'es', professional },
          meta(),
        );
        expect(!reused.ok && reused.error.messageKey).toBe('auth.errors.invitationInvalid');
        expect((await inv.previewStaffInvitation(token, meta())).ok).toBe(false);
      },
    );

    it('expired tokens and wrong existing-account passwords are rejected; no user is created', async () => {
      const expiredToken = inv.generateInvitationToken();
      const expiredEmail = `expired-${randomUUID()}@example.test`;
      await pg`
        insert into public.invitations (organization_id, email, roles, token_hash, created_at, expires_at, invited_by)
        values (${ORGS.A.id}, ${expiredEmail}, '{organization_owner}', ${inv.hashInvitationToken(expiredToken)},
                now() - interval '4 days', now() - interval '1 day', ${PERSONAS.ownerA.id})
      `;
      expect((await inv.previewStaffInvitation(expiredToken, meta())).ok).toBe(false);
      const expired = await inv.acceptStaffInvitation(
        client().client,
        {
          token: expiredToken,
          displayName: 'x',
          password: `Fictional-${randomUUID()}`,
          locale: 'es',
        },
        meta(),
      );
      expect(!expired.ok && expired.error.messageKey).toBe('auth.errors.invitationInvalid');
      const [users] = await pg<
        { n: number }[]
      >`select count(*)::int as n from auth.users where email = ${expiredEmail}`;
      expect(users?.n).toBe(0);

      // Existing account: the password must be the account's current password.
      const existing = await throwawayUserWithTotp();
      const token = inv.generateInvitationToken();
      await pg`
        insert into public.invitations (organization_id, email, roles, token_hash, expires_at, invited_by)
        values (${ORGS.A.id}, ${existing.email}, '{organization_owner}', ${inv.hashInvitationToken(token)},
                now() + interval '1 day', ${PERSONAS.ownerA.id})
      `;
      const wrong = await inv.acceptStaffInvitation(
        client().client,
        { token, displayName: 'x', password: 'not-the-current-password', locale: 'es' },
        meta(),
      );
      expect(!wrong.ok && wrong.error.messageKey).toBe('auth.errors.invitationInvalid');
      const right = await inv.acceptStaffInvitation(
        client().client,
        { token, displayName: 'x', password: existing.password, locale: 'es' },
        meta(),
      );
      expect(right.ok && right.data.step).toBe('mfa');
    });
  });
});
