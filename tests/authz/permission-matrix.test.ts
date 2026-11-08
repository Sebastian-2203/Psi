import { describe, expect, it, vi } from 'vitest';

// Pure test: the authz barrel transitively loads src/server/env.ts, so give it placeholder
// values before imports run. No network or database connection is made here.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'matrix-test-placeholder';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'matrix-test-placeholder';
  process.env.DATABASE_URL ??= 'postgresql://app_server:placeholder@127.0.0.1:1/postgres';
  process.env.APP_BASE_DOMAIN ??= 'localhost';
});

import {
  evaluatePermission,
  PERMISSION_NAMES,
  PERMISSIONS,
  type AuthzSubject,
  type Permission,
} from '@/server/authz';
import { ORGS, PERSONAS, type Persona } from '../fixtures/personas';

/**
 * Permission matrix (SECURITY.md §13.1), generated from the registry × personas × states.
 * The BASE expectations below are written by hand from SECURITY.md §4.1 / API_CONTRACTS §4
 * (independent of policy.ts); state rules (aal1, cross-tenant, read_only org, stale MFA) are
 * applied on top. Adding a permission without a row here fails the suite.
 * Phase 2+ adds patient/guardian personas and relationship states.
 */

type Kind = Persona['kind'];
const KINDS: Kind[] = ['owner_only', 'owner_psychologist', 'psychologist', 'platform_admin'];

const OWNERS = {
  owner_only: true,
  owner_psychologist: true,
  psychologist: false,
  platform_admin: false,
};
const STAFF = {
  owner_only: true,
  owner_psychologist: true,
  psychologist: true,
  platform_admin: false,
};
const PLATFORM = {
  owner_only: false,
  owner_psychologist: false,
  psychologist: false,
  platform_admin: true,
};
const EVERYONE = {
  owner_only: true,
  owner_psychologist: true,
  psychologist: true,
  platform_admin: true,
};

const BASE: Record<Permission, Record<Kind, boolean>> = {
  'org.settings.manage': OWNERS,
  'org.branding.manage': OWNERS,
  'org.domains.manage': OWNERS,
  'org.members.read': STAFF,
  'org.members.manage': OWNERS,
  'org.invitations.manage': OWNERS,
  'org.audit.read': OWNERS,
  'org.professional_profile.manage': STAFF, // scope = own membership
  'profile.self.update': EVERYONE,
  'platform.org.read': PLATFORM,
  'platform.org.provision': PLATFORM,
  'platform.org.suspend': PLATFORM,
  'platform.grant.request': PLATFORM,
  'platform.grant.approve_tenant': OWNERS,
  'platform.grant.approve_second': PLATFORM, // scope = grant requested by someone else
};

const NOW = Date.parse('2026-11-08T12:00:00Z');
const personaOfKind = (kind: Kind): Persona =>
  Object.values(PERSONAS).find(
    (p) => p.kind === kind && (p.org === 'A' || p.org === null),
  ) as Persona;

type State = 'baseline' | 'aal1' | 'cross_tenant' | 'org_read_only' | 'stale_mfa';
const STATES: State[] = ['baseline', 'aal1', 'cross_tenant', 'org_read_only', 'stale_mfa'];

function subjectFor(persona: Persona, state: State): AuthzSubject {
  const isPlatform = persona.kind === 'platform_admin';
  return {
    profileId: persona.id,
    aal: state === 'aal1' ? 'aal1' : 'aal2',
    organizationId: isPlatform ? null : ORGS.A.id,
    organizationStatus: isPlatform ? null : state === 'org_read_only' ? 'read_only' : 'active',
    actingAs: isPlatform ? 'platform_admin' : 'staff',
    ...(persona.membershipId
      ? { membership: { id: persona.membershipId, roles: [...persona.roles] } }
      : {}),
    mfaVerifiedAt: new Date(state === 'stale_mfa' ? NOW - 16 * 60_000 : NOW - 60_000).toISOString(),
  };
}

function scopeFor(persona: Persona, permission: Permission, state: State) {
  return {
    ...(state === 'cross_tenant' ? { organizationId: ORGS.B.id } : {}),
    ...(permission === 'org.professional_profile.manage' && persona.membershipId
      ? { membershipId: persona.membershipId }
      : {}),
    ...(permission === 'platform.grant.approve_second'
      ? { grantRequesterProfileId: PERSONAS.platform2.id }
      : {}),
  };
}

/** Expected outcome: base table + state rules from SECURITY.md §3.2, §4.5, DATABASE.md §5.1. */
function expected(
  kind: Kind,
  permission: Permission,
  state: State,
): 'allow' | 'FORBIDDEN' | 'NOT_FOUND' | 'MFA_REQUIRED' {
  const rule = PERMISSIONS[permission];
  const capacityOk = (rule.actingAs as readonly string[]).includes(
    kind === 'platform_admin' ? 'platform_admin' : 'staff',
  );
  if (!capacityOk) return 'FORBIDDEN';
  if (state === 'aal1' && rule.requiresAal2) return 'MFA_REQUIRED';
  if (state === 'cross_tenant' && rule.scope === 'organization') return 'NOT_FOUND';
  if (state === 'org_read_only' && rule.orgAccess === 'staff_write') return 'FORBIDDEN';
  if (!BASE[permission][kind]) return 'FORBIDDEN';
  if (state === 'stale_mfa' && rule.recentMfaSeconds !== null) return 'MFA_REQUIRED';
  return 'allow';
}

describe('permission registry', () => {
  it('every registered permission has a matrix row and vice versa', () => {
    expect(Object.keys(BASE).sort()).toEqual([...PERMISSION_NAMES].sort());
  });

  it('platform_admin holds no organization-scoped permission (no implicit tenant access)', () => {
    for (const name of PERMISSION_NAMES) {
      const rule = PERMISSIONS[name];
      if (rule.scope === 'organization') expect(rule.actingAs).not.toContain('platform_admin');
    }
  });

  it('every staff/platform permission requires aal2', () => {
    for (const name of PERMISSION_NAMES) {
      const rule = PERMISSIONS[name];
      if (rule.scope !== 'self') expect(rule.requiresAal2).toBe(true);
    }
  });
});

const cases = PERMISSION_NAMES.flatMap((permission) =>
  KINDS.flatMap((kind) => STATES.map((state) => ({ permission, kind, state }))),
);

describe('permission matrix', () => {
  it.each(cases)('$permission × $kind × $state', ({ permission, kind, state }) => {
    const persona = personaOfKind(kind);
    const decision = evaluatePermission(
      subjectFor(persona, state),
      permission,
      scopeFor(persona, permission, state),
      NOW,
    );
    const want = expected(kind, permission, state);
    expect(decision.allowed ? 'allow' : decision.code).toBe(want);
  });

  it('professional profile: psychologist cannot manage another member; owner can', () => {
    const psy = subjectFor(PERSONAS.psyA, 'baseline');
    const owner = subjectFor(PERSONAS.ownerA, 'baseline');
    const other = { membershipId: PERSONAS.ownerPsyA.membershipId };
    expect(evaluatePermission(psy, 'org.professional_profile.manage', other, NOW).allowed).toBe(
      false,
    );
    expect(evaluatePermission(owner, 'org.professional_profile.manage', other, NOW).allowed).toBe(
      true,
    );
  });

  it('second approval is refused for the requester', () => {
    const platform = subjectFor(PERSONAS.platform, 'baseline');
    const decision = evaluatePermission(
      platform,
      'platform.grant.approve_second',
      { grantRequesterProfileId: PERSONAS.platform.id },
      NOW,
    );
    expect(decision).toMatchObject({ allowed: false, code: 'FORBIDDEN' });
  });
});
