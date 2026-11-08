import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** DESIGN_SYSTEM §6.10: Lucide icon in a bluegray-100 circle, title, one sentence, one primary action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-4 py-8 text-center', className)}>
      <span className="flex size-12 items-center justify-center rounded-full bg-info-surface text-info-surface-foreground">
        <Icon className="size-6" aria-hidden />
      </span>
      <p className="text-base font-bold">{title}</p>
      {description ? (
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
