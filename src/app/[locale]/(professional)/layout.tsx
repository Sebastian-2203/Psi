import { setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';
import { rememberLocaleAction } from '@/modules/profiles/server/actions';
import { ProfessionalShell } from '@/components/shared/professional-shell';
import { getRouteLocale } from '@/i18n/route-locale';
import { redirect } from '@/i18n/navigation';
import { AccessDenied } from '@/modules/auth';
import { signOutAction } from '@/modules/auth/server/actions';
import { requirePortalAccess, requireStaffAccess } from '@/modules/auth/server/guards';

export const dynamic = 'force-dynamic';

/**
 * Guard (first line; every page and action re-checks, RLS re-checks aal2 in SQL):
 * verified session + active staff membership in THIS host's organization + aal2.
 * aal1 -> MFA step-up; platform_admin and non-members -> access denied.
 */
export default async function ProfessionalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = await getRouteLocale(params);
  setRequestLocale(locale);
  const access = await requireStaffAccess(locale);
  if (!access.ok && access.reason === 'no_access' && (await requirePortalAccess()).ok) {
    // A patient/guardian who landed here (sign-in lands portal identities on /portal; this covers direct visits) belongs in the portal.
    redirect({ href: '/portal', locale });
  }
  if (!access.ok) return <AccessDenied reason={access.reason} signOutAction={signOutAction} />;
  return (
    <ProfessionalShell signOutAction={signOutAction} rememberLocaleAction={rememberLocaleAction}>
      {children}
    </ProfessionalShell>
  );
}
