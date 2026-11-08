import { defineRouting } from 'next-intl/routing';

/** ADR-009: locale-prefixed routing, `es` default, `en` secondary. */
export const routing = defineRouting({
  locales: ['es', 'en'],
  defaultLocale: 'es',
  localePrefix: 'always',
});

export type Locale = (typeof routing.locales)[number];

export function isLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}
