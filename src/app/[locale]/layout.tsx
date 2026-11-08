import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { getRouteLocale } from '@/i18n/route-locale';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ThemeVariables } from '@/components/shared/theme-variables';
import { routing } from '@/i18n/routing';
import { DEFAULT_BRAND } from '@/styles/default-brand';
import { fontVariables } from '@/styles/fonts';
import '../globals.css';

export const metadata: Metadata = {
  title: { default: DEFAULT_BRAND.displayName, template: `%s | ${DEFAULT_BRAND.displayName}` },
};

// NOTE: pages render dynamically: with Next 16.4.5 + next-intl 4.14.9, static prerender ignored setRequestLocale
// (every /en page rendered Spanish). Locale comes from the x-next-intl-locale header set by proxy.ts.
// TODO(perf): revisit static rendering when upgrading next-intl.
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const locale = await getRouteLocale(params);
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} data-tenant={DEFAULT_BRAND.slug} className={fontVariables}>
      <head>
        <ThemeVariables brand={DEFAULT_BRAND} />
      </head>
      <body>
        {/* Client messages: the whole catalog is small; narrow per-route when it grows. */}
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
