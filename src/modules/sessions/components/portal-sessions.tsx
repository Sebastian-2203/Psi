import { CalendarClock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { EmptyState } from '@/components/shared/empty-state';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { PortalSessionDto } from '@/modules/clinical-records/components/types';

/** Portal "Próximas sesiones": date, time, status and modality only (no place, no notes). */
export function PortalSessions({ sessions }: { sessions: PortalSessionDto[] }) {
  const t = useTranslations('clinical.portal.sessions');
  const ts = useTranslations('clinical.sessions');
  const format = useFormatter();
  if (sessions.length === 0) {
    return (
      <Card>
        <EmptyState icon={CalendarClock} title={t('empty')} />
      </Card>
    );
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="portal-sessions">
      {sessions.map((s) => (
        <li
          key={s.sessionId}
          className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="font-semibold">
              {format.dateTime(new Date(s.start), { dateStyle: 'full', timeStyle: 'short' })}
            </span>
            <span className="text-sm text-muted-foreground">{ts(`modality.${s.modality}`)}</span>
          </div>
          <Badge variant="info">{ts(`statuses.${s.status}`)}</Badge>
        </li>
      ))}
    </ul>
  );
}
