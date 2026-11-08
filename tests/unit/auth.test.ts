import { describe, expect, it, vi } from 'vitest';

// Pure tests: some server modules load src/server/env.ts; give it placeholders first.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'unit-test-placeholder';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'unit-test-placeholder';
  process.env.DATABASE_URL ??= 'postgresql://app_server:placeholder@127.0.0.1:1/postgres';
  process.env.APP_BASE_DOMAIN ??= 'localhost';
  process.env.SESSION_ACTIVITY_SECRET ??= 'unit-test-placeholder-secret-0123456789';
});

import { AUTH_COOKIE_OPTIONS, isAuthCookieName } from '@/lib/auth-cookies';
import { normalizeRecoveryCode, RECOVERY_CODE_ALPHABET } from '@/lib/recovery-codes';
import { evaluateSessionExpiry, SESSION_POLICY, sessionStartedAt } from '@/lib/session-policy';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  newPasswordSchema,
  recoveryCodeSchema,
  resetPasswordSchema,
  safeNextPath,
  signInSchema,
  verifyMfaSchema,
} from '@/modules/auth/schemas';
import {
  clientIpFromHeaders,
  requestMetaFromHeaders,
  trustedProxyFromEnv,
} from '@/server/auth/request-meta';
import { formatRecoveryCode, generateRecoveryCodeSet } from '@/server/auth/recovery-codes';
import {
  generateInvitationToken,
  hashInvitationToken,
  invitationLink,
} from '@/server/auth/invitations';
import { restrictCapacitiesToHost, type Capacity } from '@/server/authz';
import { combineHostScopes } from '@/server/tenancy';

describe('password policy (SECURITY.md §3.5)', () => {
  it('requires >= 12 characters and rejects (never truncates) > 72 bytes', () => {
    expect(newPasswordSchema.safeParse('short-pass1').success).toBe(false);
    expect(newPasswordSchema.safeParse('a'.repeat(12)).success).toBe(true);
    expect(newPasswordSchema.safeParse('a'.repeat(72)).success).toBe(true);
    const tooLong = newPasswordSchema.safeParse('a'.repeat(73));
    expect(tooLong.success).toBe(false);
    if (!tooLong.success) expect(tooLong.error.issues[0]?.message).toBe('passwordTooLong');
    // 25 x "ñ" = 50 bytes ok; 37 x "ñ" = 74 bytes (37 chars) rejected by bytes, not chars.
    expect(newPasswordSchema.safeParse('ñ'.repeat(25)).success).toBe(true);
    expect(newPasswordSchema.safeParse('ñ'.repeat(37)).success).toBe(false);
  });

  it('reset requires matching confirmation', () => {
    const r = resetPasswordSchema.safeParse({
      password: 'a'.repeat(12),
      confirmPassword: 'b'.repeat(12),
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(['confirmPassword']);
  });
});

describe('auth schemas', () => {
  it('sign-in normalizes the email, is strict and drops unsafe next paths', () => {
    const ok = signInSchema.parse({
      email: '  Owner.A@Example.TEST ',
      password: 'x',
      next: '/settings',
    });
    expect(ok).toEqual({ email: 'owner.a@example.test', password: 'x', next: '/settings' });
    expect(
      signInSchema.parse({ email: 'a@example.test', password: 'x', next: '//evil.example' }).next,
    ).toBeUndefined();
    expect(
      signInSchema.safeParse({ email: 'a@example.test', password: 'x', organizationId: 'x' })
        .success,
    ).toBe(false);
    expect(signInSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).toBe(false);
  });

  it('safeNextPath allows only known internal paths', () => {
    for (const good of [
      '/dashboard',
      '/settings',
      '/settings/team',
      '/mfa/recovery-codes',
      '/reset-password',
    ]) {
      expect(safeNextPath(good)).toBe(good);
    }
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil',
      '/dashboard?x=1',
      '/portal',
      '/es/dashboard',
      'dashboard',
      42,
      null,
    ]) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });

  it('TOTP codes are exactly 6 digits', () => {
    expect(verifyMfaSchema.safeParse({ code: '123456' }).success).toBe(true);
    expect(verifyMfaSchema.safeParse({ code: ' 123456 ' }).success).toBe(true);
    for (const code of ['12345', '1234567', 'abcdef', '12 3456']) {
      expect(verifyMfaSchema.safeParse({ code }).success).toBe(false);
    }
  });

  it('recovery codes are normalized (case, dashes, spaces) and validated against the alphabet', () => {
    expect(recoveryCodeSchema.parse({ code: 'abcd-efgh-jkmn-pqrs' }).code).toBe('ABCDEFGHJKMNPQRS');
    expect(recoveryCodeSchema.safeParse({ code: 'ABCD-EFGH-IJKL-MNOP' }).success).toBe(false); // I, O
    expect(recoveryCodeSchema.safeParse({ code: 'ABCD-EFGH' }).success).toBe(false);
    expect(normalizeRecoveryCode(' ab cd-ef ')).toBe('ABCDEF');
  });

  it('invitation acceptance: 43-char base64url token, strict, professional fields complete', () => {
    const base = { token: 'A'.repeat(43), displayName: 'Fictional', password: 'a'.repeat(12) };
    expect(acceptInvitationSchema.safeParse(base).success).toBe(true);
    expect(acceptInvitationSchema.safeParse({ ...base, token: 'A'.repeat(42) }).success).toBe(
      false,
    );
    expect(
      acceptInvitationSchema.safeParse({ ...base, roles: ['organization_owner'] }).success,
    ).toBe(false);
    expect(
      acceptInvitationSchema.safeParse({
        ...base,
        professional: { title: 'x', licenseNumber: '', licenseIssuer: 'y' },
      }).success,
    ).toBe(false);
  });

  it('create invitation: roles from the closed set, unique, 1-2', () => {
    const base = { email: 'new@example.test', emailLocale: 'es' as const };
    expect(createInvitationSchema.safeParse({ ...base, roles: ['psychologist'] }).success).toBe(
      true,
    );
    expect(createInvitationSchema.safeParse({ ...base, roles: [] }).success).toBe(false);
    expect(
      createInvitationSchema.safeParse({ ...base, roles: ['psychologist', 'psychologist'] })
        .success,
    ).toBe(false);
    expect(createInvitationSchema.safeParse({ ...base, roles: ['platform_admin'] }).success).toBe(
      false,
    );
  });
});

describe('session lifetime policy (SECURITY.md §3.5)', () => {
  const now = 1_800_000_000;
  it('session start is the earliest amr timestamp (falls back to iat)', () => {
    expect(
      sessionStartedAt({
        amr: [
          { method: 'totp', timestamp: 20 },
          { method: 'password', timestamp: 10 },
        ],
      }),
    ).toBe(10);
    expect(sessionStartedAt({ iat: 5 })).toBe(5);
    expect(sessionStartedAt({})).toBeNull();
  });

  it('expires after 15 min idle or 12 h absolute', () => {
    const { idleSeconds, absoluteSeconds } = SESSION_POLICY.staff;
    expect(idleSeconds).toBe(900);
    expect(absoluteSeconds).toBe(43_200);
    expect(evaluateSessionExpiry(now - 60, now - 60, now)).toBe('active');
    expect(evaluateSessionExpiry(now - 3600, null, now)).toBe('active');
    expect(evaluateSessionExpiry(now - 3600, now - 901, now)).toBe('idle');
    expect(evaluateSessionExpiry(now - 43_201, now - 1, now)).toBe('absolute');
  });

  it('auth cookies are httpOnly, Lax, host-only and capped at the absolute lifetime', () => {
    expect(AUTH_COOKIE_OPTIONS).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 43_200,
    });
    expect('domain' in AUTH_COOKIE_OPTIONS).toBe(false);
    expect(isAuthCookieName('sb-127-auth-token')).toBe(true);
    expect(isAuthCookieName('sb-127-auth-token.0')).toBe(true);
    expect(isAuthCookieName('psi_activity')).toBe(false);
  });
});

describe('recovery codes and invitation tokens (generation)', () => {
  it('10 distinct codes of 16 symbols (80 bits) from the alphabet', () => {
    const set = generateRecoveryCodeSet();
    expect(set).toHaveLength(10);
    expect(new Set(set).size).toBe(10);
    for (const code of set) {
      expect(code).toHaveLength(16);
      for (const ch of code) expect(RECOVERY_CODE_ALPHABET).toContain(ch);
    }
    expect(RECOVERY_CODE_ALPHABET).toHaveLength(32);
    expect(formatRecoveryCode('ABCDEFGHJKMNPQRS')).toBe('ABCD-EFGH-JKMN-PQRS');
  });

  it('invitation token: 32 random bytes base64url; only the sha256 is stored; link uses the fragment', () => {
    const token = generateInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateInvitationToken()).not.toBe(token);
    expect(hashInvitationToken(token)).toHaveLength(32);
    const link = new URL(invitationLink('https://demo-a.example.test', 'es', token));
    expect(link.search).toBe('');
    expect(link.hash).toBe(`#token=${token}`);
  });
});

describe('request metadata', () => {
  const xff1 = { mode: 'xff', hops: 1 } as const;

  it('validates IPs/hosts and request ids', () => {
    const meta = requestMetaFromHeaders(
      new Headers({
        'x-forwarded-for': '198.51.100.7, 10.0.0.1',
        host: 'Demo-A.localhost:3000',
        'x-request-id': 'abc',
        'user-agent': 'x'.repeat(600),
      }),
      'development',
      xff1,
    );
    expect(meta.ip).toBe('10.0.0.1'); // rightmost = appended by the one trusted proxy
    expect(meta.host).toBe('demo-a.localhost:3000');
    expect(meta.origin).toBe('http://demo-a.localhost:3000');
    expect(meta.requestId).not.toBe('abc');
    expect(meta.userAgent).toHaveLength(512);
    const bad = requestMetaFromHeaders(
      new Headers({ 'x-forwarded-for': 'not-an-ip', host: 'evil.example/x' }),
      'production',
      xff1,
    );
    expect(bad.ip).toBeNull();
    expect(bad.origin).toBeNull();
  });

  it('P1-13: production links are https whatever x-forwarded-proto says (loopback excepted)', () => {
    const at = (host: string, proto: string, nodeEnv: string) =>
      requestMetaFromHeaders(new Headers({ host, 'x-forwarded-proto': proto }), nodeEnv, xff1)
        .origin;
    expect(at('demo-a.example.test', 'http', 'production')).toBe('https://demo-a.example.test');
    expect(at('demo-a.example.test', 'https', 'production')).toBe('https://demo-a.example.test');
    expect(at('localhost:3000', 'http', 'production')).toBe('http://localhost:3000');
    expect(at('127.0.0.1:3000', 'https', 'production')).toBe('https://127.0.0.1:3000');
    expect(at('localhost:3000', 'http', 'development')).toBe('http://localhost:3000');
    expect(at('localhost:3000', 'gopher', 'development')).toBe('http://localhost:3000');
  });
});

describe('client IP under the trusted-proxy config (P1-03)', () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it('defaults: vercel on Vercel, else xff with 1 hop; explicit mode wins', () => {
    expect(trustedProxyFromEnv({ VERCEL: '1' })).toEqual({ mode: 'vercel', hops: 1 });
    expect(trustedProxyFromEnv({})).toEqual({ mode: 'xff', hops: 1 });
    expect(trustedProxyFromEnv({ VERCEL: '1', TRUSTED_PROXY: 'none' }).mode).toBe('none');
    expect(trustedProxyFromEnv({ TRUSTED_PROXY: 'xff', TRUSTED_PROXY_HOPS: 2 })).toEqual({
      mode: 'xff',
      hops: 2,
    });
  });

  it('vercel: x-vercel-forwarded-for, then x-real-ip; never the spoofable x-forwarded-for', () => {
    const vercel = { mode: 'vercel', hops: 1 } as const;
    expect(
      clientIpFromHeaders(
        h({
          'x-vercel-forwarded-for': '198.51.100.9',
          'x-real-ip': '198.51.100.8',
          'x-forwarded-for': '203.0.113.66',
        }),
        vercel,
      ),
    ).toBe('198.51.100.9');
    expect(clientIpFromHeaders(h({ 'x-real-ip': '2001:db8::1' }), vercel)).toBe('2001:db8::1');
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': '203.0.113.66' }), vercel)).toBeNull();
    expect(clientIpFromHeaders(h({ 'x-vercel-forwarded-for': 'junk' }), vercel)).toBeNull();
  });

  it('xff: rightmost untrusted hop; client-prepended entries are ignored', () => {
    const forged = h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.7, 10.0.0.2' });
    expect(clientIpFromHeaders(forged, { mode: 'xff', hops: 1 })).toBe('10.0.0.2');
    expect(clientIpFromHeaders(forged, { mode: 'xff', hops: 2 })).toBe('198.51.100.7');
    expect(clientIpFromHeaders(forged, { mode: 'xff', hops: 4 })).toBeNull(); // too few hops
    expect(clientIpFromHeaders(h({ 'x-forwarded-for': ' , ' }), { mode: 'xff', hops: 1 })).toBeNull();
    expect(clientIpFromHeaders(h({}), { mode: 'xff', hops: 1 })).toBeNull();
    expect(
      clientIpFromHeaders(h({ 'x-forwarded-for': '198.51.100.7, not-ip' }), {
        mode: 'xff',
        hops: 1,
      }),
    ).toBeNull();
  });

  it('none: no IP at all', () => {
    expect(
      clientIpFromHeaders(h({ 'x-real-ip': '198.51.100.8', 'x-forwarded-for': '198.51.100.7' }), {
        mode: 'none',
        hops: 1,
      }),
    ).toBeNull();
  });
});

describe('host scope never adds capacities (ADR-017)', () => {
  const caps: Capacity[] = [
    {
      organizationId: 'org-a',
      actingAs: 'staff',
      membershipId: 'm-a',
      roles: ['psychologist'],
      orgStatus: 'active',
    },
    {
      organizationId: 'org-b',
      actingAs: 'staff',
      membershipId: 'm-b',
      roles: ['organization_owner'],
      orgStatus: 'active',
    },
    { organizationId: null, actingAs: 'platform_admin', roles: [], orgStatus: null },
  ];
  it('app host keeps all; tenant host keeps only that org (no platform); unknown keeps none', () => {
    expect(restrictCapacitiesToHost(caps, undefined)).toHaveLength(3);
    expect(restrictCapacitiesToHost(caps, { kind: 'app' })).toHaveLength(3);
    expect(restrictCapacitiesToHost(caps, { kind: 'tenant', organizationId: 'org-b' })).toEqual([
      caps[1],
    ]);
    expect(restrictCapacitiesToHost(caps, { kind: 'tenant', organizationId: 'org-x' })).toEqual([]);
    expect(restrictCapacitiesToHost(caps, { kind: 'unknown' })).toEqual([]);
  });
});

describe('host scope combination (x-forwarded-host + Host)', () => {
  const a = { kind: 'tenant', organizationId: 'org-a' } as const;
  const b = { kind: 'tenant', organizationId: 'org-b' } as const;
  it('keeps the more restrictive scope; conflicting tenants deny', () => {
    expect(combineHostScopes([{ kind: 'app' }, { kind: 'app' }])).toEqual({ kind: 'app' });
    expect(combineHostScopes([{ kind: 'app' }, b])).toEqual(b);
    expect(combineHostScopes([a, a])).toEqual(a);
    expect(combineHostScopes([a, b])).toEqual({ kind: 'unknown' });
    expect(combineHostScopes([{ kind: 'unknown' }, { kind: 'app' }])).toEqual({ kind: 'unknown' });
  });
});
