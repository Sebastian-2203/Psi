import 'server-only';
import { redirect } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import {
  classifyPortalAccess,
  getAuthzContext,
  type AuthzContext,
  type PortalAccess,
} from '@/server/authz';

/**
 * Route guards (ARCHITECTURE §7). First line only: every page/action/route handler checks
 * itself (layouts do not wrap server actions) and RLS re-checks aal2 + membership in SQL.
 */

export type StaffAccess =
  { ok: true; ctx: AuthzContext } | { ok: false; reason: 'no_access' | 'select_organization' };

/**
 * (professional) routes: verified session + active staff membership in the organization of
 * this host + aal2. Redirects: no session -> sign-in; aal1 -> MFA step-up (enrollment when
 * no factor). platform_admin gets NO professional access by role (actingAs must be staff).
 */
export async function requireStaffAccess(locale: Locale, next?: string): Promise<StaffAccess> {
  const outcome = await getAuthzContext();
  const query = next ? `?next=${encodeURIComponent(next)}` : '';
  if (!outcome.ok) {
    switch (outcome.error.code) {
      case 'UNAUTHENTICATED':
        return redirect({ href: `/sign-in${query}`, locale });
      case 'MFA_REQUIRED':
        return redirect({ href: `/mfa${query}`, locale });
      case 'PRECONDITION_FAILED':
        return { ok: false, reason: 'select_organization' };
      default:
        return { ok: false, reason: 'no_access' };
    }
  }
  if (outcome.data.actingAs !== 'staff' || !outcome.data.membership) {
    return { ok: false, reason: 'no_access' };
  }
  return { ok: true, ctx: outcome.data };
}

/**
 * Pages under (professional): same rule, re-checked by the page itself (memoized per request).
 * Returns null when denied: the page then renders nothing and the layout (rendered in the same
 * request) shows the access-denied screen. Never throws notFound(), which would replace the
 * layout with the global 404.
 */
export async function getStaffPageContext(
  locale: Locale,
  next?: string,
): Promise<AuthzContext | null> {
  const access = await requireStaffAccess(locale, next);
  return access.ok ? access.ctx : null;
}

/** (portal) routes: a signed-in patient/guardian of the organization of this host. */
export async function requirePortalAccess(): Promise<PortalAccess> {
  return classifyPortalAccess(await getAuthzContext());
}
