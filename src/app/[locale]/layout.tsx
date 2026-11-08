import type { Metadata } from 'next';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { getRouteLocale } from '@/i18n/route-locale';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { TenantBrandProvider } from '@/components/shared/tenant-brand';
import { ThemeVariables } from '@/components/shared/theme-variables';
import { routing } from '@/i18n/routing';
import { getTenantBrand } from '@/modules/branding/server/queries';
import { fontVariables } from '@/styles/fonts';
import '../globals.css';

/** Title follows the host's organization (cached per request and per org, non-PHI). */
export async function generateMetadata(): Promise<Metadata> {
  const { brand } = await getTenantBrand();
  return { title: { default: brand.displayName, template: `%s | ${brand.displayName}` } };
}

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
  // Branding of the organization the HOST resolves to (ADR-010/017); default Daniela brand on the
  // app host or unknown hosts. Server-side, so the stylesheet is in the first byte (no flash).
  const { brand, logoUrl } = await getTenantBrand();
  // CSP nonce set by src/proxy.ts on the request; required by every inline <style> (style-src-elem).
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang={locale} data-tenant={brand.slug} className={fontVariables}>
      <head>
        <ThemeVariables brand={brand} nonce={nonce} />
      </head>
      <body>
        {/* Client messages: the whole catalog is small; narrow per-route when it grows. */}
        <NextIntlClientProvider>
          <TenantBrandProvider value={{ displayName: brand.displayName, logoUrl }}>
            {children}
          </TenantBrandProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
