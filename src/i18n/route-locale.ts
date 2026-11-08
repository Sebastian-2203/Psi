import { notFound } from 'next/navigation';
import { isLocale, type Locale } from './routing';

/** Validates the `[locale]` route param and narrows it to `Locale` (404 otherwise). */
export async function getRouteLocale(params: Promise<{ locale: string }>): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return locale;
}
