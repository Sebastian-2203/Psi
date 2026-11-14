import { CalendarClock, FilePenLine } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { listMyPatients } from '@/modules/patients/server/queries';
import type { AuthzContext } from '@/server/authz';
import { listPendingNoteSessions } from '../server/service';

/**
 * Dashboard cards (SES-04): held sessions of the caller without a finalized note, and the subset
 * whose note is still a draft ("to finalize"). Counts and names only; no clinical content.
 * Drafts not linked to a session are not discoverable with the current server API (reported).
 */
export async function PendingNotesCards({ ctx }: { ctx: AuthzContext }) {
  const t = await getTranslations('shell.professional.dashboard');
  const td = await getTranslations('clinical.dashboard');
  const tn = await getTranslations('clinical.sessions.noteState');
  const format = await getFormatter();
  const [pending, patients] = await Promise.all([
    listPendingNoteSessions(ctx),
    listMyPatients(ctx, { limit: 100 }),
  ]);
  const names = new Map(
    patients.ok
      ? patients.data.map((p) => [p.patientId, `${p.firstName} ${p.lastName}`] as const)
      : [],
  );
  const sessions = pending.ok ? pending.data : [];
  const drafts = sessions.filter((s) => s.noteState === 'draft');

  const list = (items: typeof sessions, testId: string) => (
    <ul className="flex flex-col divide-y" data-testid={testId}>
      {items.slice(0, 6).map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">{names.get(s.patientId) ?? td('unknownPatient')}</span>
            <span className="text-sm text-muted-foreground">
              {format.dateTime(new Date(s.start), { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </div>
          <Badge variant={s.noteState === 'draft' ? 'warning' : 'neutral'}>{tn(s.noteState)}</Badge>
          <Link
            href={{
              pathname: `/patients/${s.patientId}`,
              query: { tab: 'notes', session: s.id },
            }}
            className="inline-flex min-h-(--target-min) items-center text-sm font-semibold text-primary underline underline-offset-4"
          >
            {s.noteState === 'draft' ? td('continueNote') : td('writeNote')}
          </Link>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <Card className="p-4 sm:p-5" data-testid="dashboard-pending-sessions">
        <CardHeader>
          <CardTitle>{t('sessionsTitle')}</CardTitle>
        </CardHeader>
        {!pending.ok ? (
          <ErrorState description={td('loadFailed')} />
        ) : sessions.length === 0 ? (
          <EmptyState icon={CalendarClock} title={t('sessionsEmpty')} />
        ) : (
          list(sessions, 'pending-sessions-list')
        )}
      </Card>
      <Card className="p-4 sm:p-5" data-testid="dashboard-drafts">
        <CardHeader>
          <CardTitle>{t('draftsTitle')}</CardTitle>
        </CardHeader>
        {!pending.ok ? (
          <ErrorState description={td('loadFailed')} />
        ) : drafts.length === 0 ? (
          <EmptyState icon={FilePenLine} title={t('draftsEmpty')} />
        ) : (
          list(drafts, 'drafts-list')
        )}
      </Card>
    </>
  );
}
