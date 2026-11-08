import { setRequestLocale } from 'next-intl/server';
import { getRouteLocale } from '@/i18n/route-locale';
import type { ReactNode } from 'react';
import { ProfessionalShell } from '@/components/shared/professional-shell';

export default async function ProfessionalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale(await getRouteLocale(params));
  // TODO(auth): require an authenticated professional session here (server-side authz is the boundary).
  return <ProfessionalShell>{children}</ProfessionalShell>;
}
