import type { ReactNode } from 'react';
import { ContextScope } from './context-scope';
import { PoweredBy } from './powered-by';
import { SkipLink } from './skip-link';
import { cn } from '@/lib/utils';

/** Centered single-column page on the cream canvas (auth, errors, landing). */
export function CenteredPage({
  children,
  header,
  className,
}: {
  children: ReactNode;
  header?: ReactNode;
  className?: string;
}) {
  return (
    <ContextScope context="portal-adult" className="flex flex-col">
      <SkipLink />
      <header className="flex min-h-16 items-center justify-end px-4 sm:px-8">{header}</header>
      <main
        id="main-content"
        tabIndex={-1}
        className={cn(
          'mx-auto flex w-full flex-1 flex-col items-center justify-center gap-6 px-4 pb-8 sm:px-8',
          className,
        )}
      >
        {children}
      </main>
      <footer className="flex justify-center px-4 py-6">
        <PoweredBy />
      </footer>
    </ContextScope>
  );
}
