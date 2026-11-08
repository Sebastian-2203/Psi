import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getRouteLocale } from '@/i18n/route-locale';
import { redirect } from '@/i18n/navigation';
import { isPortalPreviewEnabled } from '@/lib/portal-preview';
import { AccessDenied } from '@/modules/auth';
import { signOutAction } from '@/modules/auth/server/actions';
import { getVerifiedClaims } from '@/server/auth/claims';

export const dynamic = 'force-dynamic';

/**
 * Portal guard, Phase 1 (deny by default). Patient/guardian identities do not exist until
 * Phase 2, so NO session can hold a portal capacity:
 * - any signed-in user (staff, platform admin) -> access denied (staff are never patients or
 *   guardians through their staff session, F-21);
 * - signed out -> sign-in, except the documented dev-only static preview
 *   (src/lib/portal-preview.ts), which renders no data at all.
 * Phase 2 replaces this with getAuthzContext() + actingAs patient/guardian.
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
  if (await getVerifiedClaims()) {
    return <AccessDenied reason="no_access" signOutAction={signOutAction} />;
  }
  if (!isPortalPreviewEnabled()) redirect({ href: '/sign-in', locale });
  return children;
}
