import { setRequestLocale } from 'next-intl/server';
import { getRouteLocale } from '@/i18n/route-locale';
import type { ReactNode } from 'react';
import { CenteredPage } from '@/components/shared/centered-page';
import { LocaleSwitcher } from '@/components/shared/locale-switcher';

// Layout only: the auth workstream implements the flows (sign-in, MFA, recovery, invitations).
export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale(await getRouteLocale(params));
  return (
    <CenteredPage header={<LocaleSwitcher />} className="max-w-[400px]">
      {children}
    </CenteredPage>
  );
}
