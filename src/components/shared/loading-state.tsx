import { useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/** Skeleton block with an accessible status label (skeletons themselves are aria-hidden). */
export function LoadingState({ rows = 3, className }: { rows?: number; className?: string }) {
  const t = useTranslations('states');
  return (
    <div role="status" aria-live="polite" className={cn('flex flex-col gap-3', className)}>
      <span className="sr-only">{t('loadingTitle')}</span>
      <Skeleton className="h-8 w-1/2" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  );
}
