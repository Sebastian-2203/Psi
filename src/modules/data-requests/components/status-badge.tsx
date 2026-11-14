import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { DataRequestStatus } from './types';

const VARIANT = {
  received: 'info',
  in_review: 'warning',
  fulfilled: 'success',
  partially_fulfilled: 'success',
  rejected: 'neutral',
} as const;

/** Status is always text (never colour alone). */
export function DataRequestStatusBadge({ status }: { status: DataRequestStatus }) {
  const t = useTranslations('dataRequests.status');
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}
