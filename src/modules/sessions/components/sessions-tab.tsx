'use client';

import { CalendarClock, ClipboardPen, Pencil, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import {
  FormError,
  FormField,
  SelectField,
  useValidationMessage,
} from '@/components/shared/form-kit';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { usePathname, useRouter } from '@/i18n/navigation';
import type { ActionError } from '@/modules/auth/schemas/result';
import type {
  Action,
  SessionDto,
  SessionModality,
  SessionStatus,
} from '@/modules/clinical-records/components/types';

const STATUSES: SessionStatus[] = [
  'scheduled',
  'held',
  'cancelled_by_patient',
  'cancelled_by_psychologist',
  'no_show',
];
const MODALITIES: SessionModality[] = ['in_person', 'remote_external', 'phone'];
const isCancelled = (s: SessionStatus) =>
  s === 'cancelled_by_patient' || s === 'cancelled_by_psychologist';

export type SessionsActions = {
  record: Action<
    {
      patientId: string;
      start: string;
      end: string;
      status: SessionStatus;
      modality: SessionModality;
      locationOrLink?: string;
      cancelledReason?: string;
    },
    { sessionId: string }
  >;
  update: Action<{
    sessionId: string;
    status?: SessionStatus;
    start?: string;
    end?: string;
    modality?: SessionModality;
    locationOrLink?: string | null;
    cancelledReason?: string | null;
  }>;
};

/** ISO instant -> `datetime-local` value in the browser's zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return toLocalInput(d.toISOString());
}

function SessionDialog({
  patientId,
  session,
  open,
  onOpenChange,
  actions,
  onDone,
}: {
  patientId: string;
  session: SessionDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: SessionsActions;
  onDone: () => void;
}) {
  const t = useTranslations('clinical.sessions');
  const tc = useTranslations('common');
  const v = useValidationMessage();
  const initialStart = session ? toLocalInput(session.start) : defaultStart();
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(
    session
      ? toLocalInput(session.end)
      : toLocalInput(new Date(new Date(initialStart).getTime() + 50 * 60_000).toISOString()),
  );
  const [status, setStatus] = useState<SessionStatus>(session?.status ?? 'held');
  const [modality, setModality] = useState<SessionModality>(session?.modality ?? 'in_person');
  const [location, setLocation] = useState(session?.locationOrLink ?? '');
  const [reason, setReason] = useState(session?.cancelledReason ?? '');
  const [errors, setErrors] = useState<{ start?: string; end?: string }>({});
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next: typeof errors = {};
    if (!start) next.start = v('fieldRequired');
    if (!end) next.end = v('fieldRequired');
    if (start && end && new Date(end) <= new Date(start)) next.end = v('dateInvalid');
    setErrors(next);
    if (next.start || next.end) return;
    setError(null);
    setBusy(true);
    const startIso = new Date(start).toISOString();
    const endIso = new Date(end).toISOString();
    const place = location.trim();
    const why = reason.trim();
    const result = session
      ? await actions.update({
          sessionId: session.id,
          status,
          start: startIso,
          end: endIso,
          modality,
          locationOrLink: place === '' ? null : place,
          cancelledReason: isCancelled(status) && why !== '' ? why : null,
        })
      : await actions.record({
          patientId,
          start: startIso,
          end: endIso,
          status,
          modality,
          ...(place ? { locationOrLink: place } : {}),
          ...(isCancelled(status) && why ? { cancelledReason: why } : {}),
        });
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{session ? t('editTitle') : t('recordTitle')}</DialogTitle>
          <DialogDescription>{t('recordDescription')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('start')}
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            error={errors.start}
          />
          <FormField
            label={t('end')}
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            error={errors.end}
          />
          <SelectField
            label={t('status')}
            value={status}
            onChange={(e) => setStatus(e.target.value as SessionStatus)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t('modalityLabel')}
            value={modality}
            onChange={(e) => setModality(e.target.value as SessionModality)}
          >
            {MODALITIES.map((m) => (
              <option key={m} value={m}>
                {t(`modality.${m}`)}
              </option>
            ))}
          </SelectField>
        </div>
        <FormField
          label={t('location')}
          hint={t('locationHint')}
          value={location}
          maxLength={500}
          onChange={(e) => setLocation(e.target.value)}
        />
        {isCancelled(status) ? (
          <FormField
            label={t('cancelledReason')}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
          />
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {session ? t('saveChanges') : t('recordSubmit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Sessions tab (SES-01..04): records of sessions (no scheduling engine, calendar or reminders) and
 * the caller's pending-note list; "write note" opens the notes tab with the session preselected.
 */
export function SessionsTab({
  patientId,
  sessions,
  myMembershipId,
  loadFailed,
  actions,
}: {
  patientId: string;
  sessions: SessionDto[];
  myMembershipId: string;
  loadFailed: boolean;
  actions: SessionsActions;
}) {
  const t = useTranslations('clinical.sessions');
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const [editing, setEditing] = useState<SessionDto | null>(null);
  const [creating, setCreating] = useState(false);
  const pending = sessions.filter(
    (s) =>
      s.status === 'held' &&
      s.psychologistMembershipId === myMembershipId &&
      s.noteState !== 'finalized',
  );
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  const row = (s: SessionDto, withNote: boolean) => (
    <li
      key={s.id}
      className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4"
      data-testid={`session-${s.status}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold">{when(s.start)}</span>
        <span className="text-sm text-muted-foreground">
          {t(`modality.${s.modality}`)}
          {s.locationOrLink ? ` · ${s.locationOrLink}` : ''}
        </span>
      </div>
      <Badge
        variant={s.status === 'held' ? 'success' : s.status === 'scheduled' ? 'info' : 'neutral'}
      >
        {t(`statuses.${s.status}`)}
      </Badge>
      {s.status === 'held' ? (
        <Badge variant={s.noteState === 'finalized' ? 'success' : 'warning'}>
          {t(`noteState.${s.noteState}`)}
        </Badge>
      ) : null}
      {withNote ? (
        <Button size="sm" onClick={() => router.replace(`${pathname}?tab=notes&session=${s.id}`)}>
          <ClipboardPen aria-hidden />
          {s.noteState === 'draft' ? t('continueNote') : t('writeNote')}
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setEditing(s)}>
          <Pencil aria-hidden />
          {t('edit')}
        </Button>
      )}
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        {loadFailed ? (
          <Alert variant="error">
            <AlertDescription>{t('loadFailed')}</AlertDescription>
          </Alert>
        ) : null}
        <Button className="self-start" onClick={() => setCreating(true)}>
          <Plus aria-hidden />
          {t('record')}
        </Button>
      </Card>

      {pending.length > 0 ? (
        <section aria-labelledby="pending-notes" className="flex flex-col gap-3">
          <h3 id="pending-notes">{t('pendingTitle')}</h3>
          <ul className="flex flex-col gap-3" data-testid="pending-note-sessions">
            {pending.map((s) => row(s, true))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="all-sessions" className="flex flex-col gap-3">
        <h3 id="all-sessions">{t('allTitle')}</h3>
        {sessions.length === 0 && !loadFailed ? (
          <Card>
            <EmptyState
              icon={CalendarClock}
              title={t('emptyTitle')}
              description={t('emptyDescription')}
            />
          </Card>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="sessions-list">
            {sessions.map((s) => row(s, false))}
          </ul>
        )}
      </section>

      {creating ? (
        <SessionDialog
          patientId={patientId}
          session={null}
          open
          onOpenChange={setCreating}
          actions={actions}
          onDone={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      ) : null}
      {editing ? (
        <SessionDialog
          key={editing.id + editing.updatedAt}
          patientId={patientId}
          session={editing}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          actions={actions}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
