import 'server-only';
import { recordAudit } from '@/server/audit';
import type { VerifiedClaims } from '@/server/auth/claims';
import { withUserTransaction } from '@/server/db/server';
import { failure, ok, toAppError, type Outcome } from '@/server/errors';
import type { HostScope } from '@/server/tenancy/request';
import { loadCapacities, restrictCapacitiesToHost } from './context';
import type { ActingAs } from './permissions';

export type CapacityTarget = { organizationId: string | null; actingAs: ActingAs };

/**
 * Acting-as switch (F-21, API_CONTRACTS §4). Validates that the REQUESTED capacity is one the
 * caller really holds on this host (loaded from the DB through `app.my_capacities()`), then
 * audits the switch. The caller stores the (organizationId, actingAs) pair in the httpOnly
 * `active_org` / `acting_as` hint cookies; getAuthzContext re-validates them on every request,
 * so the cookies never grant anything.
 *
 * - A staff / platform capacity needs an aal2 session (MFA_REQUIRED otherwise).
 * - Audit: `auth.org_switched` (same capacity, other organization) or `auth.capacity_switched`.
 *   Both require an organization; switching to the platform_admin capacity (no organization) is
 *   therefore not audited here [catalog limitation; the platform sign-in itself is audited].
 */
export async function switchCapacity(
  claims: VerifiedClaims,
  hostScope: HostScope | undefined,
  target: CapacityTarget,
  from: { organizationId: string | null; actingAs: ActingAs | null },
  requestId: string,
): Promise<Outcome<CapacityTarget>> {
  try {
    const capacities = restrictCapacitiesToHost(await loadCapacities(claims), hostScope);
    const match = capacities.find(
      (c) => c.actingAs === target.actingAs && c.organizationId === target.organizationId,
    );
    if (!match) return failure('FORBIDDEN', { messageKey: 'errors.noCapacity' });
    if (
      (match.actingAs === 'staff' || match.actingAs === 'platform_admin') &&
      claims.aal !== 'aal2'
    ) {
      return failure('MFA_REQUIRED');
    }
    if (match.organizationId) {
      const organizationId = match.organizationId;
      const sameCapacity = from.actingAs === match.actingAs;
      await withUserTransaction(claims, (tx) =>
        sameCapacity && from.organizationId !== organizationId
          ? recordAudit(
              tx,
              'auth.org_switched',
              { from_organization_id: from.organizationId },
              { organizationId, requestId },
            )
          : recordAudit(
              tx,
              'auth.capacity_switched',
              { from_acting_as: from.actingAs, to_acting_as: match.actingAs },
              { organizationId, requestId },
            ),
      );
    }
    return ok({ organizationId: match.organizationId, actingAs: match.actingAs });
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
}
