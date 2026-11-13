import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getRouteLocale } from '@/i18n/route-locale';
import { redirect } from '@/i18n/navigation';
import { isPortalPreviewEnabled } from '@/lib/portal-preview';
import { AccessDenied } from '@/modules/auth';
import { signOutAction } from '@/modules/auth/server/actions';
import { requirePortalAccess } from '@/modules/auth/server/guards';

export const dynamic = 'force-dynamic';

/**
 * Portal guard (deny by default). Admits a signed-in patient or guardian of the organization of
 * this host (aal1 is fine); every page and action re-checks (first line only, RLS re-checks).
 * - signed out -> sign-in, except the documented dev-only static preview
 *   (src/lib/portal-preview.ts), which renders no data at all;
 * - signed in without a portal capacity (staff, platform admin, other tenant) -> access denied
 *   (staff are never patients or guardians through their staff session, F-21).
 */
export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const access = await requirePortalAccess();
  if (access.ok) return children;
  if (access.reason === 'signed_out') {
    if (!isPortalPreviewEnabled()) redirect({ href: '/sign-in', locale });
    return children;
  }
  return <AccessDenied reason={access.reason} signOutAction={signOutAction} />;
}
