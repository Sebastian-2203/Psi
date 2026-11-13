import 'server-only';
import type { Outcome } from '@/server/errors';
import type { AuthzContext } from './context';

export type PortalAccess =
  | { ok: true; ctx: AuthzContext }
  | { ok: false; reason: 'no_access' | 'select_organization' | 'signed_out' };

/**
 * Pure decision (unit tested): a context is admitted to the portal only with an ACTIVE
 * patient or guardian capacity bound to an organization. aal1 is fine (portal MFA is optional,
 * Q-07). Staff / platform capacities, a missing capacity, an MFA step-up request (the user also
 * holds a staff capacity on this host) and any other failure are denied. Hints never grant.
 */
export function classifyPortalAccess(outcome: Outcome<AuthzContext>): PortalAccess {
  if (!outcome.ok) {
    switch (outcome.error.code) {
      case 'UNAUTHENTICATED':
        return { ok: false, reason: 'signed_out' };
      case 'PRECONDITION_FAILED':
        return { ok: false, reason: 'select_organization' };
      default:
        return { ok: false, reason: 'no_access' };
    }
  }
  const ctx = outcome.data;
  const portalCapacity = ctx.actingAs === 'patient' || ctx.actingAs === 'guardian';
  if (!portalCapacity || !ctx.organizationId || ctx.organizationStatus !== 'active') {
    return { ok: false, reason: 'no_access' };
  }
  if (ctx.actingAs === 'patient' && !ctx.patientId) return { ok: false, reason: 'no_access' };
  if (ctx.actingAs === 'guardian' && !ctx.guardian) return { ok: false, reason: 'no_access' };
  return { ok: true, ctx };
}
