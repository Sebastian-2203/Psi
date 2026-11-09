import 'server-only';

/**
 * Permission registry — single source of truth in code (ARCHITECTURE §5, API_CONTRACTS §4).
 * Phase 1 + Phase 2 (patients, guardians, consents, portal reads) permissions; clinical and
 * activity permissions arrive with their modules. The permission-matrix tests (tests/authz) are
 * generated from this object.
 *
 * Care-team and relationship scope ("psychologist ON THE CARE TEAM", "guardian WITH
 * sign_consents") are NOT expressible here: the registry gates capacity + role + aal + org
 * status, and RLS / the definer functions (`app.can_manage_patient`, `app.guardian_can`, ...)
 * decide the row-level part. A care-team miss therefore surfaces as NOT_FOUND / FORBIDDEN from
 * the DAL, never as data.
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

/** Care-team staff capability: psychologist role, aal2, active org (writes). */
const psychologistWrite = {
  actingAs: ['staff'],
  roles: ['psychologist'],
  scope: 'organization',
  orgAccess: 'staff_write',
  requiresAal2: true,
  recentMfaSeconds: null,
} as const;
const psychologistRead = { ...psychologistWrite, orgAccess: 'staff_read' } as const;

/**
 * Portal capability (patient / guardian). MFA is optional for portal identities (Q-07
 * default), so no aal2. `orgAccess: 'staff_write'` is the "organization is active" gate; portal
 * capacities are only ever loaded for active organizations.
 */
const portal = (actingAs: readonly ('patient' | 'guardian')[]) =>
  ({
    actingAs,
    roles: [],
    scope: 'organization',
    orgAccess: 'staff_write',
    requiresAal2: false,
    recentMfaSeconds: null,
  }) as const;

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
  // --- Phase 2: patients ---------------------------------------------------------------
  'patient.create': { ...psychologistWrite, mirrorsPolicy: 'function app.create_patient' },
  'patient.directory.read': {
    actingAs: ['staff'],
    roles: [],
    scope: 'organization',
    orgAccess: 'staff_read',
    requiresAal2: true,
    recentMfaSeconds: null,
    mirrorsPolicy: 'function app.patient_directory (app.is_org_member)',
  },
  'patient.read': { ...psychologistRead, mirrorsPolicy: 'patients_select_care_team' },
  'patient.update': { ...psychologistWrite, mirrorsPolicy: 'patients_update_care_team' },
  'patient.status.manage': { ...psychologistWrite, mirrorsPolicy: 'patients_update_care_team' },
  'patient.care_team.manage': {
    actingAs: ['staff'],
    roles: ['organization_owner', 'psychologist'],
    scope: 'organization',
    orgAccess: 'staff_write',
    requiresAal2: true,
    recentMfaSeconds: null,
    mirrorsPolicy: 'care_team_members_insert (app.can_assign_care_team)',
  },
  'patient.portal.invite': { ...psychologistWrite, mirrorsPolicy: 'invitations_insert_care_team' },
  'patient.preferences.manage': {
    ...psychologistWrite,
    mirrorsPolicy: 'patient_preferences_update (app.can_manage_patient)',
  },
  // --- Phase 2: guardians --------------------------------------------------------------
  'guardian.manage': { ...psychologistWrite, mirrorsPolicy: 'patient_guardians_update_care_team' },
  'guardian.permissions.manage': {
    ...psychologistWrite,
    mirrorsPolicy: 'function app.set_guardian_permissions',
  },
  'guardian.caveat.manage': {
    ...psychologistWrite,
    mirrorsPolicy: 'patient_guardian_caveats_insert',
  },
  // --- Phase 2: consents ---------------------------------------------------------------
  'consent.request': { ...psychologistWrite, mirrorsPolicy: 'function app.record_consent' },
  'consent.record.read': { ...psychologistRead, mirrorsPolicy: 'consent_records_select_care_team' },
  'consent.sign.self': {
    ...portal(['patient']),
    mirrorsPolicy: 'function app.sign_consent (app.is_patient_self)',
  },
  'consent.sign.guardian': {
    ...portal(['guardian']),
    mirrorsPolicy: 'function app.sign_consent (app.guardian_can sign_consents)',
  },
  'consent.withdraw': { ...psychologistWrite, mirrorsPolicy: 'function app.withdraw_consent (care team)' },
  'consent.withdraw.own': {
    ...portal(['patient', 'guardian']),
    mirrorsPolicy: 'function app.withdraw_consent (signer, own record)',
  },
  // --- Phase 2: portal reads (own data only) -----------------------------------------------
  'portal.consent.read': {
    ...portal(['patient', 'guardian']),
    mirrorsPolicy: 'consent_template_versions_select_portal + consent_records_select_*',
  },
  'portal.privacy.read': {
    ...portal(['patient']),
    mirrorsPolicy: 'function app.patient_privacy_view (app.is_patient_self)',
  },
  'portal.guardian.read': {
    ...portal(['guardian']),
    mirrorsPolicy: 'function app.guardian_patient_summary',
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
