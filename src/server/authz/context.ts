import 'server-only';
import { cookies, headers } from 'next/headers';
import { randomUUID } from 'node:crypto';
import { cache } from 'react';
import { z } from 'zod';
import { getVerifiedClaims, type VerifiedClaims } from '@/server/auth/claims';
import { withUserTransaction } from '@/server/db/server';
import { failure, ok, type Outcome } from '@/server/errors';
import { getRequestHostScope, type HostScope } from '@/server/tenancy/request';
import { ACTING_AS, type ActingAs, type MembershipRole } from './permissions';

export type OrgStatus = 'active' | 'read_only' | 'suspended' | 'closed';

export type Capacity = {
  organizationId: string | null;
  actingAs: ActingAs;
  membershipId?: string;
  roles: MembershipRole[];
  orgStatus: OrgStatus | null;
};

/**
 * Per-request authorization context (API_CONTRACTS §4). Exactly one acting-as capacity.
 * Patient/guardian/break-glass fields are typed for forward compatibility and populated
 * from Phase 2/3 onward.
 */
export type AuthzContext = {
  requestId: string;
  locale: 'es' | 'en';
  profileId: string;
  aal: 'aal1' | 'aal2';
  organizationId: string | null;
  organizationStatus: OrgStatus | null;
  actingAs: ActingAs;
  availableCapacities: Array<{ organizationId: string | null; actingAs: ActingAs }>;
  membership?: { id: string; roles: MembershipRole[] };
  patientId?: string;
  guardian?: {
    guardianId: string;
    relationships: Array<{ patientId: string; patientGuardianId: string; permissions: string[] }>;
    supervisedSessionId?: string;
  };
  platform?: {
    grants: Array<{
      id: string;
      scope: 'org_support_non_clinical' | 'clinical_read_break_glass';
      patientId?: string;
      expiresAt: string;
    }>;
  };
  /** ISO timestamp of the last MFA verification in this session (high-risk checks). */
  mfaVerifiedAt?: string;
  /** Verified claims: the only way the DAL opens a user transaction. Never serialize. */
  claims: VerifiedClaims;
};

export type ContextHints = {
  requestId: string;
  locale: 'es' | 'en';
  /** Untrusted: from the active_org cookie. */
  organizationHint?: string | null;
  /** Untrusted: from the acting_as cookie. */
  actingAsHint?: ActingAs | null;
  /**
   * Server-resolved tenant scope of the request host (ADR-017). It only RESTRICTS the
   * caller's capacities: on a tenant host, only capacities in that organization remain (no
   * platform capacity); on an unknown host none remain. Absent = app host.
   */
  hostScope?: HostScope;
};

/** Pure: capacities usable on this host (never adds anything). */
export function restrictCapacitiesToHost(
  capacities: Capacity[],
  hostScope: HostScope | undefined,
): Capacity[] {
  if (!hostScope || hostScope.kind === 'app') return capacities;
  if (hostScope.kind === 'unknown') return [];
  return capacities.filter((c) => c.organizationId === hostScope.organizationId);
}

type CapacityRow = {
  organization_id: string | null;
  acting_as: string;
  membership_id: string | null;
  membership_status: 'active' | 'suspended' | 'removed' | null;
  org_status: OrgStatus | null;
  roles: MembershipRole[];
};

const uuidSchema = z.uuid();
const actingAsSchema = z.enum(ACTING_AS);

/** Loads the caller's capacities through RLS-bound `app.my_capacities()`. */
async function loadCapacities(claims: VerifiedClaims): Promise<Capacity[]> {
  const rows = await withUserTransaction(claims, async (tx) => {
    return tx<CapacityRow[]>`
      select organization_id, acting_as, membership_id, membership_status, org_status, roles
      from app.my_capacities()
    `;
  });
  const capacities: Capacity[] = [];
  for (const row of rows) {
    if (row.acting_as === 'platform_admin') {
      capacities.push({
        organizationId: null,
        actingAs: 'platform_admin',
        roles: [],
        orgStatus: null,
      });
    } else if (
      row.acting_as === 'staff' &&
      row.membership_id &&
      row.membership_status === 'active' &&
      (row.org_status === 'active' || row.org_status === 'read_only')
    ) {
      capacities.push({
        organizationId: row.organization_id,
        actingAs: 'staff',
        membershipId: row.membership_id,
        roles: row.roles,
        orgStatus: row.org_status,
      });
    }
  }
  return capacities;
}

/**
 * Chooses exactly one capacity: explicit hint pair -> org hint -> the only capacity.
 * Hints never grant anything: they only select among capacities loaded from the DB.
 */
export function selectCapacity(
  capacities: Capacity[],
  organizationHint: string | null | undefined,
  actingAsHint: ActingAs | null | undefined,
): Capacity | 'ambiguous' | 'none' {
  if (capacities.length === 0) return 'none';
  const orgHint = uuidSchema.safeParse(organizationHint).success ? organizationHint : null;
  const actHint = actingAsSchema.safeParse(actingAsHint).success ? actingAsHint : null;

  const matches = capacities.filter(
    (c) =>
      (actHint === null || c.actingAs === actHint) &&
      (orgHint === null || c.organizationId === orgHint || c.actingAs === 'platform_admin'),
  );
  const exact = matches.filter((c) => orgHint === null || c.organizationId === orgHint);
  if (exact.length === 1) return exact[0] as Capacity;
  if (matches.length === 1) return matches[0] as Capacity;
  if (capacities.length === 1) return capacities[0] as Capacity;
  return 'ambiguous';
}

/**
 * Builds the AuthzContext for verified claims. Failures, in this order:
 * - FORBIDDEN (errors.noCapacity): no active capacity usable on this host.
 * - MFA_REQUIRED: the session is aal1 and any usable capacity is staff/platform (checked
 *   BEFORE capacity selection, so an aal1 multi-org user is sent to MFA, not to a picker).
 * - PRECONDITION_FAILED (errors.selectCapacity): several capacities, no valid hint.
 */
export async function resolveAuthzContext(
  claims: VerifiedClaims,
  hints: ContextHints,
): Promise<Outcome<AuthzContext>> {
  const capacities = restrictCapacitiesToHost(await loadCapacities(claims), hints.hostScope);
  if (capacities.length === 0) return failure('FORBIDDEN', { messageKey: 'errors.noCapacity' });
  if (
    claims.aal !== 'aal2' &&
    capacities.some((c) => c.actingAs === 'staff' || c.actingAs === 'platform_admin')
  ) {
    return failure('MFA_REQUIRED');
  }
  const selected = selectCapacity(capacities, hints.organizationHint, hints.actingAsHint);
  if (selected === 'none') return failure('FORBIDDEN', { messageKey: 'errors.noCapacity' });
  if (selected === 'ambiguous') {
    return failure('PRECONDITION_FAILED', { messageKey: 'errors.selectCapacity' });
  }

  return ok({
    requestId: hints.requestId,
    locale: hints.locale,
    profileId: claims.sub,
    aal: claims.aal,
    organizationId: selected.organizationId,
    organizationStatus: selected.orgStatus,
    actingAs: selected.actingAs,
    availableCapacities: capacities.map((c) => ({
      organizationId: c.organizationId,
      actingAs: c.actingAs,
    })),
    ...(selected.membershipId
      ? { membership: { id: selected.membershipId, roles: selected.roles } }
      : {}),
    ...(selected.actingAs === 'platform_admin' ? { platform: { grants: [] } } : {}),
    ...(claims.mfaVerifiedAt !== null
      ? { mfaVerifiedAt: new Date(claims.mfaVerifiedAt * 1000).toISOString() }
      : {}),
    claims,
  });
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Request-scoped context for pages, actions and route handlers (memoized with `cache()`).
 * The proxy strips inbound `x-org-*`/`x-request-id` and sets a fresh `x-request-id`; the
 * tenant scope comes from the Host header resolved here on the server (getRequestHostScope);
 * `active_org` / `acting_as` are host-only hint cookies (selectCapacityAction, pending:
 * Phase 1 users have a single capacity per host).
 */
export const getAuthzContext = cache(async (): Promise<Outcome<AuthzContext>> => {
  const claims = await getVerifiedClaims();
  if (!claims) return failure('UNAUTHENTICATED');
  const headerStore = await headers();
  const cookieStore = await cookies();
  const rawRequestId = headerStore.get('x-request-id');
  const localeHeader = headerStore.get('x-next-intl-locale');
  return resolveAuthzContext(claims, {
    requestId: rawRequestId && REQUEST_ID.test(rawRequestId) ? rawRequestId : randomUUID(),
    locale: localeHeader === 'en' ? 'en' : 'es',
    organizationHint: cookieStore.get('active_org')?.value ?? null,
    actingAsHint: (cookieStore.get('acting_as')?.value as ActingAs | undefined) ?? null,
    hostScope: await getRequestHostScope(),
  });
});
