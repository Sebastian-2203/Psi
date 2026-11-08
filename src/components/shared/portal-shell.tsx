'use client';

import { CalendarDays, Home, Shapes, Smile, User, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { ContextScope } from './context-scope';
import { LocaleSwitcher } from './locale-switcher';
import { PoweredBy } from './powered-by';
import { PracticeName } from './practice-name';
import { SkipLink } from './skip-link';

export type PortalMode = 'adult' | 'child';

type NavKey =
  | 'portalHome'
  | 'portalActivities'
  | 'portalAppointments'
  | 'portalProfile'
  | 'portalChildHome'
  | 'portalChildActivities'
  | 'portalChildMe';
type Item = { key: NavKey; icon: LucideIcon; href?: '/portal' };

// `href` only for routes that exist; the rest are placeholders (Phase 2). Adolescents use `child` (client decision).
const ITEMS: Record<PortalMode, Item[]> = {
  adult: [
    { key: 'portalHome', icon: Home, href: '/portal' },
    { key: 'portalActivities', icon: Shapes },
    { key: 'portalAppointments', icon: CalendarDays },
    { key: 'portalProfile', icon: User },
  ],
  child: [
    { key: 'portalChildHome', icon: Home, href: '/portal' },
    { key: 'portalChildActivities', icon: Shapes },
    { key: 'portalChildMe', icon: Smile },
  ],
};

function PortalNav({ mode, variant }: { mode: PortalMode; variant: 'top' | 'bottom' }) {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const child = mode === 'child';

  return (
    <ul className={cn('flex', variant === 'bottom' ? 'justify-around' : 'items-center gap-1')}>
      {ITEMS[mode].map(({ key, icon: Icon, href }) => {
        const active = href !== undefined && pathname.startsWith(href);
        const classes = cn(
          'flex items-center justify-center rounded-md text-sm',
          variant === 'bottom'
            ? 'min-h-14 min-w-16 flex-col gap-1 px-2 text-xs'
            : 'min-h-(--target-min) gap-2 px-3 font-semibold',
          active ? 'text-primary font-bold' : 'text-foreground',
          !href && 'text-muted-foreground',
          variant === 'top' && active && 'underline decoration-2 underline-offset-8',
        );
        const iconEl = (
          <span
            className={cn(
              'flex items-center justify-center',
              child && variant === 'bottom' && 'size-11 rounded-full bg-secondary',
            )}
          >
            <Icon
              className={child && variant === 'bottom' ? 'size-7' : 'size-6 md:size-5'}
              aria-hidden
            />
          </span>
        );
        return (
          <li key={key} className={variant === 'bottom' ? 'flex-1' : undefined}>
            {href ? (
              <Link href={href} aria-current={active ? 'page' : undefined} className={classes}>
                {iconEl}
                <span>{t(key)}</span>
              </Link>
            ) : (
              <span aria-disabled="true" className={classes}>
                {iconEl}
                <span>{t(key)}</span>
                <span className="sr-only">{tc('comingSoon')}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Patient/guardian portal shell. `mode` selects the design context (`portal-adult` / `portal-child`).
 * TODO(patient-profile): `mode` must be derived server-side from the patient profile (adolescents
 * render `portal-child`); it is a prop for now and a dev-only query in the page.
 */
export function PortalShell({
  mode,
  children,
  devSwitcher,
}: {
  mode: PortalMode;
  children: ReactNode;
  devSwitcher?: ReactNode;
}) {
  const t = useTranslations('shell.portal');
  return (
    <ContextScope
      context={mode === 'child' ? 'portal-child' : 'portal-adult'}
      className="flex flex-col"
    >
      <SkipLink />
      <header className="flex min-h-16 items-center gap-4 border-b bg-background px-4 sm:px-8">
        <PracticeName />
        <nav aria-label={t('navLabel')} className="ml-6 hidden md:block">
          <PortalNav mode={mode} variant="top" />
        </nav>
        <LocaleSwitcher className="ml-auto" />
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 pb-28 sm:px-8 md:pb-12"
      >
        {devSwitcher}
        {children}
        <div className="mt-12 flex justify-center">
          <PoweredBy />
        </div>
      </main>
      <nav
        aria-label={t('navLabel')}
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-card px-2 pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <PortalNav mode={mode} variant="bottom" />
      </nav>
    </ContextScope>
  );
}
