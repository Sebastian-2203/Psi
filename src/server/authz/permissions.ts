import 'server-only';

/**
 * Permission registry — single source of truth in code (ARCHITECTURE §5, API_CONTRACTS §4).
 * Phase 1 permissions only; patient/clinical/portal/guardian permissions arrive with their
 * modules. The permission-matrix tests (tests/authz) are generated from this object.
 *
 * Each rule mirrors an RLS policy in supabase/migrations/20261108120100_tenancy_identity.sql
 * (column `mirrorsPolicy`), so TS and SQL can be asserted to agree.
 */

export const ACTING_AS = ['staff', 'patient', 'guardian', 'platform_admin'] as const;
export type ActingAs = (typeof ACTING_AS)[number];

export const MEMBERSHIP_ROLES = ['organization_owner', 'psychologist'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export type OrgAccess = 'staff_read' | 'staff_write';

export type PermissionRule = {
  /** Capacities that may hold the permission (evaluated for the ACTIVE capacity only). */
  actingAs: readonly ActingAs[];
  /** For staff: any of these roles. Empty = any active staff member. */
  roles: readonly MembershipRole[];
  /** organization: requires ctx.organizationId (+ scope org match); platform/self: none. */
  scope: 'organization' | 'platform' | 'self';
  /** Organization status gate (DATABASE.md §5.1). */
  orgAccess: OrgAccess | null;
  requiresAal2: boolean;
  /** High-risk: last MFA verification must be within this many seconds (SECURITY.md §3.2). */
  recentMfaSeconds: number | null;
  /** Extra scope rule evaluated by policy.ts. */
  special?: 'self_or_owner_membership' | 'not_grant_requester';
  /** The RLS policy (or "function") the DB uses for the same decision. */
  mirrorsPolicy: string;
};

const RECENT_MFA = 15 * 60;

const ownerWrite = {
  actingAs: ['staff'],
  roles: ['organization_owner'],
  scope: 'organization',
  orgAccess: 'staff_write',
  requiresAal2: true,
  recentMfaSeconds: null,
} as const;

export const PERMISSIONS = {
  'org.settings.manage': { ...ownerWrite, mirrorsPolicy: 'organizations_update_owner' },
  'org.branding.manage': { ...ownerWrite, mirrorsPolicy: 'organization_branding_update_owner' },
  'org.domains.manage': { ...ownerWrite, mirrorsPolicy: 'organization_domains_insert_owner' },
  'org.members.read': {
    actingAs: ['staff'],
    roles: [],
    scope: 'organization',
    orgAccess: 'staff_read',
    requiresAal2: true,
    recentMfaSeconds: null,
    mirrorsPolicy: 'memberships_select_member',
  },
  'org.members.manage': {
    ...ownerWrite,
    recentMfaSeconds: RECENT_MFA,
    mirrorsPolicy: 'membership_roles_insert_owner',
  },
  'org.invitations.manage': { ...ownerWrite, mirrorsPolicy: 'invitations_insert_owner' },
  'org.audit.read': {
    actingAs: ['staff'],
    roles: ['organization_owner'],
    scope: 'organization',
    orgAccess: 'staff_read',
    requiresAal2: true,
    recentMfaSeconds: null,
    mirrorsPolicy: 'audit_logs_select_owner',
  },
  'org.professional_profile.manage': {
    actingAs: ['staff'],
    roles: [],
    scope: 'organization',
    orgAccess: 'staff_write',
    requiresAal2: true,
    recentMfaSeconds: null,
    special: 'self_or_owner_membership',
    mirrorsPolicy: 'professional_profiles_update_self_or_owner',
  },
  'profile.self.update': {
    actingAs: ['staff', 'patient', 'guardian', 'platform_admin'],
    roles: [],
    scope: 'self',
    orgAccess: null,
    requiresAal2: false,
    recentMfaSeconds: null,
    mirrorsPolicy: 'profiles_update_self',
  },
  'platform.org.read': {
    actingAs: ['platform_admin'],
    roles: [],
    scope: 'platform',
    orgAccess: null,
    requiresAal2: true,
    recentMfaSeconds: null,
    mirrorsPolicy: 'organizations_select_platform',
  },
  'platform.org.provision': {
    actingAs: ['platform_admin'],
    roles: [],
    scope: 'platform',
    orgAccess: null,
    requiresAal2: true,
    recentMfaSeconds: RECENT_MFA,
    mirrorsPolicy: 'function (system path, Phase 1.3)',
  },
  'platform.org.suspend': {
    actingAs: ['platform_admin'],
    roles: [],
    scope: 'platform',
    orgAccess: null,
    requiresAal2: true,
    recentMfaSeconds: RECENT_MFA,
    mirrorsPolicy: 'function (not yet implemented)',
  },
  'platform.grant.request': {
    actingAs: ['platform_admin'],
    roles: [],
    scope: 'platform',
    orgAccess: null,
    requiresAal2: true,
    recentMfaSeconds: null,
    mirrorsPolicy: 'platform_access_grants_insert_platform',
  },
  'platform.grant.approve_tenant': {
    ...ownerWrite,
    recentMfaSeconds: RECENT_MFA,
    mirrorsPolicy: 'app.approve_grant_as_owner (stub: denies until Phase 3)',
  },
  'platform.grant.approve_second': {
    actingAs: ['platform_admin'],
    roles: [],
    scope: 'platform',
    orgAccess: null,
    requiresAal2: true,
    recentMfaSeconds: RECENT_MFA,
    special: 'not_grant_requester',
    mirrorsPolicy: 'app.approve_grant_as_second_admin (stub: denies until Phase 3)',
  },
} as const satisfies Record<string, PermissionRule>;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as Permission[];

export function getPermissionRule(permission: Permission): PermissionRule {
  return PERMISSIONS[permission];
}
