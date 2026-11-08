/**
 * FICTIONAL personas — mirror supabase/seed.sql (ARCHITECTURE §14, Phase 1 subset).
 * Emails use the reserved @example.test domain. Never real people or patient data.
 */

export const FICTIONAL_PASSWORD = 'Psi-Local-Fictional-2026';
/** Fictional base32 TOTP secret seeded for every staff/platform persona with MFA. */
export const FICTIONAL_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

export const ORGS = {
  A: { id: '0a000000-0000-4000-8000-000000000001', slug: 'demo-a', host: 'demo-a.localhost' },
  B: { id: '0b000000-0000-4000-8000-000000000001', slug: 'demo-b', host: 'demo-b.localhost' },
} as const;

export type OrgKey = keyof typeof ORGS;
export type PersonaRole = 'organization_owner' | 'psychologist';

export type Persona = {
  key: string;
  id: string;
  email: string;
  kind: 'owner_only' | 'owner_psychologist' | 'psychologist' | 'platform_admin';
  org: OrgKey | null;
  membershipId: string | null;
  roles: PersonaRole[];
  hasTotp: boolean;
};

export const PERSONAS = {
  ownerA: {
    key: 'ownerA',
    id: 'a1000000-0000-4000-8000-000000000001',
    email: 'owner.a@example.test',
    kind: 'owner_only',
    org: 'A',
    membershipId: 'a2000000-0000-4000-8000-000000000001',
    roles: ['organization_owner'],
    hasTotp: true,
  },
  ownerPsyA: {
    key: 'ownerPsyA',
    id: 'a1000000-0000-4000-8000-000000000002',
    email: 'owner-psy.a@example.test',
    kind: 'owner_psychologist',
    org: 'A',
    membershipId: 'a2000000-0000-4000-8000-000000000002',
    roles: ['organization_owner', 'psychologist'],
    hasTotp: true,
  },
  psyA: {
    key: 'psyA',
    id: 'a1000000-0000-4000-8000-000000000003',
    email: 'psy.a@example.test',
    kind: 'psychologist',
    org: 'A',
    membershipId: 'a2000000-0000-4000-8000-000000000003',
    roles: ['psychologist'],
    hasTotp: true,
  },
  psyNoMfaA: {
    key: 'psyNoMfaA',
    id: 'a1000000-0000-4000-8000-000000000004',
    email: 'psy-nomfa.a@example.test',
    kind: 'psychologist',
    org: 'A',
    membershipId: 'a2000000-0000-4000-8000-000000000004',
    roles: ['psychologist'],
    hasTotp: false,
  },
  ownerB: {
    key: 'ownerB',
    id: 'b1000000-0000-4000-8000-000000000001',
    email: 'owner.b@example.test',
    kind: 'owner_only',
    org: 'B',
    membershipId: 'b2000000-0000-4000-8000-000000000001',
    roles: ['organization_owner'],
    hasTotp: true,
  },
  ownerPsyB: {
    key: 'ownerPsyB',
    id: 'b1000000-0000-4000-8000-000000000002',
    email: 'owner-psy.b@example.test',
    kind: 'owner_psychologist',
    org: 'B',
    membershipId: 'b2000000-0000-4000-8000-000000000002',
    roles: ['organization_owner', 'psychologist'],
    hasTotp: true,
  },
  psyB: {
    key: 'psyB',
    id: 'b1000000-0000-4000-8000-000000000003',
    email: 'psy.b@example.test',
    kind: 'psychologist',
    org: 'B',
    membershipId: 'b2000000-0000-4000-8000-000000000003',
    roles: ['psychologist'],
    hasTotp: true,
  },
  platform: {
    key: 'platform',
    id: 'f1000000-0000-4000-8000-000000000001',
    email: 'platform@example.test',
    kind: 'platform_admin',
    org: null,
    membershipId: null,
    roles: [],
    hasTotp: true,
  },
  platform2: {
    key: 'platform2',
    id: 'f1000000-0000-4000-8000-000000000002',
    email: 'platform2@example.test',
    kind: 'platform_admin',
    org: null,
    membershipId: null,
    roles: [],
    hasTotp: true,
  },
} as const satisfies Record<string, Persona>;

export type PersonaKey = keyof typeof PERSONAS;
