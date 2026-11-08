import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Static under prefers-reduced-motion (globals.css clamps animation duration). */
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('animate-pulse rounded-md bg-muted', className)}
      {...props}
    />
  );
}

export { Skeleton };
