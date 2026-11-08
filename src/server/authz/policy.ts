import 'server-only';
import { recordSystemAudit } from '@/server/audit';
import { failure, ok, type Outcome } from '@/server/errors';
import type { AuthzContext } from './context';
import { PERMISSIONS, type Permission } from './permissions';

/** The fields of AuthzContext a decision depends on (pure; used by matrix tests). */
export type AuthzSubject = Pick<
  AuthzContext,
  'profileId' | 'aal' | 'organizationId' | 'organizationStatus' | 'actingAs' | 'membership' | 'mfaVerifiedAt'
>;

export type PermissionScope = {
  /** Organization of the target resource, when the caller supplied/loaded one. */
  organizationId?: string;
  /** Target membership (org.professional_profile.manage). */
  membershipId?: string;
  /** Requester of the target grant (platform.grant.approve_second). */
  grantRequesterProfileId?: string;
};

export type DenyCode = 'FORBIDDEN' | 'NOT_FOUND' | 'MFA_REQUIRED';
export type Decision =
  | { allowed: true }
  | { allowed: false; code: DenyCode; reason: string; messageKey?: string };

const deny = (code: DenyCode, reason: string, messageKey?: string): Decision => ({
  allowed: false,
  code,
  reason,
  ...(messageKey ? { messageKey } : {}),
});

/**
 * Pure decision for `permission` in the ACTIVE capacity only (never the union, F-21).
 * Order matters for anti-enumeration: tenant mismatch -> NOT_FOUND before any role check.
 */
export function evaluatePermission(
  subject: AuthzSubject,
  permission: Permission,
  scope: PermissionScope = {},
  now: number = Date.now(),
): Decision {
  const rule = PERMISSIONS[permission];

  if (!(rule.actingAs as readonly string[]).includes(subject.actingAs)) {
    return deny('FORBIDDEN', 'capacity');
  }
  if (rule.requiresAal2 && subject.aal !== 'aal2') {
    return deny('MFA_REQUIRED', 'aal');
  }

  if (rule.scope === 'organization') {
    if (!subject.organizationId) return deny('NOT_FOUND', 'no_organization');
    if (scope.organizationId !== undefined && scope.organizationId !== subject.organizationId) {
      return deny('NOT_FOUND', 'cross_tenant');
    }
    const status = subject.organizationStatus;
    if (rule.orgAccess === 'staff_write' && status !== 'active') {
      return deny('FORBIDDEN', 'org_status', 'errors.organizationReadOnly');
    }
    if (rule.orgAccess === 'staff_read' && status !== 'active' && status !== 'read_only') {
      return deny('FORBIDDEN', 'org_status');
    }
  }

  if (subject.actingAs === 'staff' && rule.scope === 'organization') {
    const roles = subject.membership?.roles ?? [];
    if (!subject.membership) return deny('FORBIDDEN', 'no_membership');
    if (rule.roles.length > 0 && !rule.roles.some((r) => roles.includes(r))) {
      return deny('FORBIDDEN', 'role');
    }
  }

  if ('special' in rule) {
    if (rule.special === 'self_or_owner_membership') {
      const isSelf = scope.membershipId !== undefined && scope.membershipId === subject.membership?.id;
      const isOwner = subject.membership?.roles.includes('organization_owner') ?? false;
      if (!isSelf && !isOwner) return deny('FORBIDDEN', 'not_self_or_owner');
    }
    if (rule.special === 'not_grant_requester') {
      if (!scope.grantRequesterProfileId || scope.grantRequesterProfileId === subject.profileId) {
        return deny('FORBIDDEN', 'self_approval');
      }
    }
  }

  if (rule.recentMfaSeconds !== null) {
    const verifiedAt = subject.mfaVerifiedAt ? Date.parse(subject.mfaVerifiedAt) : NaN;
    if (!Number.isFinite(verifiedAt) || now - verifiedAt > rule.recentMfaSeconds * 1000) {
      return deny('MFA_REQUIRED', 'recent_mfa', 'errors.recentMfaRequired');
    }
  }

  return { allowed: true };
}

/**
 * First line of authorization (SECURITY.md §4.2). Returns ok or a typed AppError.
 * FORBIDDEN/NOT_FOUND denials are audited as `access.denied` through the system writer;
 * an audit failure never turns a denial into an allow.
 */
export async function requirePermission(
  ctx: AuthzContext,
  permission: Permission,
  scope: PermissionScope = {},
): Promise<Outcome<void>> {
  const decision = evaluatePermission(ctx, permission, scope);
  if (decision.allowed) return ok(undefined);

  if (decision.code !== 'MFA_REQUIRED') {
    try {
      await recordSystemAudit(
        'access.denied',
        { permission, code: decision.code, acting_as: ctx.actingAs },
        {
          actorProfileId: ctx.profileId,
          // Cross-tenant probes are logged without the foreign org (no cross-tenant rows).
          organizationId: decision.reason === 'cross_tenant' ? null : ctx.organizationId,
          requestId: ctx.requestId,
        },
      );
    } catch {
      // Swallowed on purpose: the denial stands. Operational logging is added with
      // src/server/logging (PHI-free) by the observability workstream.
    }
  }
  return failure(decision.code, decision.messageKey ? { messageKey: decision.messageKey } : {});
}
