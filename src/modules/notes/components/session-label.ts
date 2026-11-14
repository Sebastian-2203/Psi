'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { SessionDto } from '@/modules/clinical-records/components/types';

/** "14 nov 2026, 10:00 · Presencial" label for a session option. */
export function useSessionLabel() {
  const format = useFormatter();
  const t = useTranslations('clinical.sessions.modality');
  return (s: Pick<SessionDto, 'start' | 'modality'>) =>
    `${format.dateTime(new Date(s.start), { dateStyle: 'medium', timeStyle: 'short' })} · ${t(s.modality)}`;
}
