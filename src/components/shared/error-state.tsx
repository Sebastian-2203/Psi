import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

/** DESIGN_SYSTEM §3.5 / §6.10: banner with icon + text, reassurance, and a retry action. */
export function ErrorState({
  title,
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  const t = useTranslations('states');
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <Alert variant="error">
        <AlertTitle>{title ?? t('errorTitle')}</AlertTitle>
        <AlertDescription>{description ?? t('errorDescription')}</AlertDescription>
      </Alert>
      {action}
    </div>
  );
}
