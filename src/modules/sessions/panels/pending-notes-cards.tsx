import { CalendarClock, FilePenLine } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/shared/empty-state';
import { ErrorState } from '@/components/shared/error-state';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Link } from '@/i18n/navigation';
import { listMyDraftNotes } from '@/modules/notes/server/service';
import { listMyPatients } from '@/modules/patients/server/queries';
import type { AuthzContext } from '@/server/authz';
import { listPendingNoteSessions } from '../server/service';

/**
 * Dashboard cards (SES-04): held sessions of the caller without a finalized note, and the caller's
 * own note drafts across patients ("to finalize", RLS-bound, includes drafts not linked to a
 * session). Names and dates only; no clinical content.
 */
export async function PendingNotesCards({ ctx }: { ctx: AuthzContext }) {
  const t = await getTranslations('shell.professional.dashboard');
  const td = await getTranslations('clinical.dashboard');
  const tn = await getTranslations('clinical.sessions.noteState');
  const format = await getFormatter();
  const [pending, drafted, patients] = await Promise.all([
    listPendingNoteSessions(ctx),
    listMyDraftNotes(ctx),
    listMyPatients(ctx, { limit: 100 }),
  ]);
  const names = new Map(
    patients.ok
      ? patients.data.map((p) => [p.patientId, `${p.firstName} ${p.lastName}`] as const)
      : [],
  );
  const sessions = pending.ok ? pending.data : [];
  const drafts = drafted.ok ? drafted.data : [];

  const link = (patientId: string, query: Record<string, string>, label: string) => (
    <Link
      href={{ pathname: `/patients/${patientId}`, query }}
      className="inline-flex min-h-(--target-min) items-center text-sm font-semibold text-primary underline underline-offset-4"
    >
      {label}
    </Link>
  );
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const sessionList = (
    <ul className="flex flex-col divide-y" data-testid="pending-sessions-list">
      {sessions.slice(0, 6).map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-2 py-2.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">{names.get(s.patientId) ?? td('unknownPatient')}</span>
            <span className="text-sm text-muted-foreground">{when(s.start)}</span>
          </div>
          <Badge variant={s.noteState === 'draft' ? 'warning' : 'neutral'}>{tn(s.noteState)}</Badge>
          {link(
            s.patientId,
            { tab: 'notes', session: s.id },
            s.noteState === 'draft' ? td('continueNote') : td('writeNote'),
          )}
        </li>
      ))}
    </ul>
  );
  const draftList = (
    <ul className="flex flex-col divide-y" data-testid="drafts-list">
      {drafts.slice(0, 6).map((d) => (
        <li key={d.noteId} className="flex flex-wrap items-center gap-2 py-2.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">{names.get(d.patientId) ?? td('unknownPatient')}</span>
            <span className="text-sm text-muted-foreground">{when(d.updatedAt)}</span>
          </div>
          <Badge variant="warning">{tn('draft')}</Badge>
          {link(d.patientId, { tab: 'notes' }, td('continueNote'))}
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
          sessionList
        )}
      </Card>
      <Card className="p-4 sm:p-5" data-testid="dashboard-drafts">
        <CardHeader>
          <CardTitle>{t('draftsTitle')}</CardTitle>
        </CardHeader>
        {!drafted.ok ? (
          <ErrorState description={td('loadFailed')} />
        ) : drafts.length === 0 ? (
          <EmptyState icon={FilePenLine} title={t('draftsEmpty')} />
        ) : (
          draftList
        )}
      </Card>
    </>
  );
}
