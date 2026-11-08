'use client';

import { Languages } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { routing, type Locale } from '@/i18n/routing';
import { cn } from '@/lib/utils';

/**
 * Two plain links (works without JS, keyboard friendly). Each link carries its own `lang`.
 * With JS, the choice is also stored on the signed-in user's profile.
 */
export function LocaleSwitcher({
  className,
  onSelectLocale,
}: {
  className?: string;
  /** Server action passed down by a server component; stores the choice for signed-in users. */
  onSelectLocale?: (input: { locale: Locale }) => Promise<void>;
}) {
  const t = useTranslations('locale');
  const current = useLocale() as Locale;
  const pathname = usePathname();

  return (
    <nav aria-label={t('label')} className={cn('flex items-center gap-1', className)}>
      <Languages className="size-5 text-muted-foreground" aria-hidden />
      <ul className="flex items-center">
        {routing.locales.map((locale) => {
          const active = locale === current;
          return (
            <li key={locale}>
              <Link
                href={pathname}
                locale={locale}
                lang={locale}
                hrefLang={locale}
                aria-current={active ? 'true' : undefined}
                onClick={() => {
                  // Persist for signed-in users (I18N-02); a no-op when signed out.
                  if (!active && onSelectLocale)
                    void onSelectLocale({ locale }).catch(() => undefined);
                }}
                aria-label={active ? undefined : t('switchTo', { language: t(locale) })}
                className={cn(
                  'inline-flex min-h-(--target-min) min-w-(--target-min) items-center justify-center rounded-md px-2 text-sm uppercase',
                  active
                    ? 'font-bold text-primary underline underline-offset-4'
                    : 'font-semibold text-muted-foreground hover:bg-accent',
                )}
              >
                {locale}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
