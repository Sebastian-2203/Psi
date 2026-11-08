import { setRequestLocale } from 'next-intl/server';
import { getRouteLocale } from '@/i18n/route-locale';
import type { ReactNode } from 'react';

// The shell (and its adult/child context) is rendered by the page: the mode will come from the patient profile.
export default async function PortalLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  setRequestLocale(await getRouteLocale(params));
  // TODO(auth): require an authenticated patient/guardian session here.
  return children;
}
