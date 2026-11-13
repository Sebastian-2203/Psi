import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { PatientStatus } from './types';

const VARIANT = {
  intake: 'info',
  active: 'success',
  paused: 'neutral',
  discharged: 'outline',
  archived: 'outline',
} as const;

/** Status is always text (never colour alone). */
export function PatientStatusBadge({ status }: { status: PatientStatus }) {
  const t = useTranslations('patients.status');
  return <Badge variant={VARIANT[status]}>{t(status)}</Badge>;
}

export function MinorBadge({ isMinor }: { isMinor: boolean | null }) {
  const t = useTranslations('patients');
  if (isMinor === null) return null;
  return <Badge variant="neutral">{isMinor ? t('minor') : t('adult')}</Badge>;
}
