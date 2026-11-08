import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_TIME_ZONE } from './formatters';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // TODO(tenancy): use organizations.time_zone / user override once tenant resolution exists.
    timeZone: DEFAULT_TIME_ZONE,
  };
});
