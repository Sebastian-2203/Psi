'use client';

import {
  ChevronsLeft,
  ChevronsRight,
  Home,
  LogOut,
  Menu,
  Settings,
  Shapes,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Link, usePathname } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { ContextScope } from './context-scope';
import { LocaleSwitcher } from './locale-switcher';
import { PoweredBy } from './powered-by';
import { PracticeName } from './practice-name';
import { SkipLink } from './skip-link';

type NavKey = 'dashboard' | 'patients' | 'activities' | 'settings';
// `href` only for routes that exist. Phase 2 routes are listed disabled so the shell shows the final structure.
const NAV: { key: NavKey; icon: LucideIcon; href?: '/dashboard' | '/settings' }[] = [
  { key: 'dashboard', icon: Home, href: '/dashboard' },
  { key: 'patients', icon: Users },
  { key: 'activities', icon: Shapes },
  { key: 'settings', icon: Settings, href: '/settings' },
];

function NavList({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const pathname = usePathname();

  return (
    <ul className="flex flex-col gap-1">
      {NAV.map(({ key, icon: Icon, href }) => {
        const active = href !== undefined && pathname.startsWith(href);
        const base =
          'relative flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors';
        const label = <span className={cn(collapsed && 'sr-only')}>{t(key)}</span>;
        const inner = (
          <>
            {active ? (
              <span
                className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-primary"
                aria-hidden
              />
            ) : null}
            <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
            {label}
            {!href && !collapsed ? (
              <Badge variant="neutral" className="ml-auto">
                {tc('comingSoon')}
              </Badge>
            ) : null}
          </>
        );
        const item = href ? (
          <Link
            href={href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              base,
              active ? 'bg-accent font-bold text-primary' : 'text-foreground hover:bg-accent',
            )}
          >
            {inner}
          </Link>
        ) : (
          <span aria-disabled="true" className={cn(base, 'text-muted-foreground')}>
            {inner}
            {collapsed ? <span className="sr-only">{tc('comingSoon')}</span> : null}
          </span>
        );
        return (
          <li key={key}>
            {collapsed ? (
              <Tooltip>
                <TooltipTrigger asChild>{item}</TooltipTrigger>
                <TooltipContent side="right">{t(key)}</TooltipContent>
              </Tooltip>
            ) : (
              item
            )}
          </li>
        );
      })}
    </ul>
  );
}

function UserMenu({ signOutAction }: { signOutAction?: () => Promise<void> }) {
  const t = useTranslations('shell.professional');
  // The form lives outside the menu: Radix unmounts the menu content on select, which would
  // cancel a submit fired from inside it.
  const signOutForm = useRef<HTMLFormElement>(null);
  return (
    <>
      {signOutAction ? <form ref={signOutForm} action={signOutAction} hidden /> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('userMenu')}>
            <User aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled>
            <User aria-hidden />
            {t('profile')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!signOutAction}
            onSelect={() => signOutForm.current?.requestSubmit()}
          >
            <LogOut aria-hidden />
            {t('signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * Professional dashboard shell (context `professional`). >= lg: collapsible sidebar (264px / 72px);
 * < lg: top bar + sheet drawer (DESIGN_SYSTEM §6.6).
 */
export function ProfessionalShell({
  children,
  signOutAction,
}: {
  children: ReactNode;
  /** Server action (auth module) passed from the layout; components never import server code. */
  signOutAction?: () => Promise<void>;
}) {
  const t = useTranslations('shell.professional');
  const tc = useTranslations('common');
  const [collapsed, setCollapsed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <ContextScope context="professional" className="flex">
      <SkipLink />
      <TooltipProvider delayDuration={200}>
        {/* The aside stretches the full page height (background + border); the inner panel is
            sticky at viewport height and scrolls on its own when the content is taller. */}
        <aside
          className={cn(
            'hidden shrink-0 self-stretch border-r bg-sidebar transition-[width] duration-(--duration-base) ease-(--ease-standard) lg:block',
            collapsed ? 'w-[72px]' : 'w-[264px]',
          )}
        >
          <div className="sticky top-0 flex h-dvh flex-col gap-4 overflow-y-auto p-3">
            <div className={cn('flex min-h-12 items-center px-2', collapsed && 'sr-only')}>
              <PracticeName display={false} />
            </div>
            <nav aria-label={t('navLabel')} className="flex-1">
              <NavList collapsed={collapsed} />
            </nav>
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => setCollapsed((v) => !v)}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronsRight aria-hidden /> : <ChevronsLeft aria-hidden />}
              <span className="sr-only">{collapsed ? t('expand') : t('collapse')}</span>
            </Button>
            <div className={cn('px-2', collapsed && 'sr-only')}>
              <PoweredBy />
            </div>
          </div>
        </aside>
      </TooltipProvider>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex min-h-16 items-center gap-2 border-b bg-background px-4 sm:px-6">
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={tc('openMenu')}>
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetTitle>
                <PracticeName />
              </SheetTitle>
              <SheetDescription className="sr-only">{t('navLabel')}</SheetDescription>
              <nav aria-label={t('navLabel')} className="flex-1">
                <NavList onNavigate={() => setSheetOpen(false)} />
              </nav>
              <PoweredBy />
            </SheetContent>
          </Sheet>
          <PracticeName className="truncate lg:sr-only" />
          <div className="ml-auto flex items-center gap-1">
            <LocaleSwitcher />
            <UserMenu signOutAction={signOutAction} />
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6 lg:p-8"
        >
          {children}
        </main>
      </div>
    </ContextScope>
  );
}
