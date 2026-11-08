import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/** "Powered by SyV Solutions" - neutral, text-only, muted xs (BRAND §12, DESIGN_SYSTEM §2.4). No logo, no brand colour. */
export function PoweredBy({ className }: { className?: string }) {
  const t = useTranslations('common');
  return <p className={cn('text-xs text-muted-foreground', className)}>{t('poweredBy')}</p>;
}
