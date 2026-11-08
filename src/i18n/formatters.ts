/**
 * Localized date / number helpers (ARCHITECTURE §9). Pure `Intl` wrappers so they work in server
 * components, client components and tests. Timestamps are stored in UTC; display uses the
 * organization time zone (default America/Bogota) unless overridden.
 */
export const DEFAULT_TIME_ZONE = 'America/Bogota';

type DateInput = Date | string | number;

export function formatDate(
  value: DateInput,
  locale: string,
  options: { timeZone?: string; style?: 'short' | 'medium' | 'long' } = {},
): string {
  const { timeZone = DEFAULT_TIME_ZONE, style = 'medium' } = options;
  return new Intl.DateTimeFormat(locale, { dateStyle: style, timeZone }).format(new Date(value));
}

export function formatDateTime(
  value: DateInput,
  locale: string,
  options: { timeZone?: string } = {},
): string {
  const { timeZone = DEFAULT_TIME_ZONE } = options;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

export function formatNumber(
  value: number,
  locale: string,
  options: Intl.NumberFormatOptions = {},
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}
