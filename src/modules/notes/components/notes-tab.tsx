'use client';

import { FilePlus, FileText, Lock, PencilLine, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import { FormError, SelectField } from '@/components/shared/form-kit';
import { LoadingState } from '@/components/shared/loading-state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from '@/i18n/navigation';
import type { ActionError } from '@/modules/auth/schemas/result';
import type {
  Action,
  NoteSummaryDto,
  NoteTypeDto,
  NoteWithAddendaDto,
  RichText,
  SessionDto,
} from '@/modules/clinical-records/components/types';
import { NoteEditor, type NoteEditorActions } from './note-editor';
import { NoteView, type AddendumAction } from './note-view';
import { useSessionLabel } from './session-label';

export type NotesActions = NoteEditorActions & {
  create: Action<
    {
      recordId: string;
      noteTypeId: string;
      therapySessionId?: string;
      body: RichText;
      contentLocale: 'es' | 'en';
    },
    { noteId: string; updatedAt: string }
  >;
  get: Action<{ noteId: string }, NoteWithAddendaDto>;
  addendum: AddendumAction;
};

/**
 * Notes tab (care team only): list of finalized notes + MY drafts (RLS), open one to edit (draft)
 * or read (locked + addenda). Bodies are fetched on open through the audited `getNote` action.
 */
export function NotesTab({
  recordId,
  recordClosed,
  notes,
  noteTypes,
  sessions,
  myMembershipId,
  initialSessionId,
  loadFailed,
  actions,
}: {
  recordId: string;
  recordClosed: boolean;
  notes: NoteSummaryDto[];
  noteTypes: NoteTypeDto[];
  sessions: SessionDto[];
  myMembershipId: string;
  initialSessionId?: string;
  loadFailed: boolean;
  actions: NotesActions;
}) {
  const t = useTranslations('clinical.notes');
  const format = useFormatter();
  const router = useRouter();
  const sessionLabel = useSessionLabel();
  const activeTypes = noteTypes.filter((n) => n.isActive);
  const heldSessions = sessions.filter((s) => s.status === 'held');
  const [creating, setCreating] = useState(initialSessionId !== undefined);
  const [typeId, setTypeId] = useState(activeTypes[0]?.id ?? '');
  const [sessionId, setSessionId] = useState(initialSessionId ?? '');
  const [locale, setLocale] = useState<'es' | 'en'>('es');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [opened, setOpened] = useState<NoteWithAddendaDto | null>(null);
  const [loading, setLoading] = useState(false);

  async function open(noteId: string) {
    setError(null);
    setLoading(true);
    const result = await actions.get({ noteId });
    setLoading(false);
    if (result.ok) setOpened(result.data);
    else setError(result.error);
  }

  async function create() {
    setError(null);
    setBusy(true);
    const result = await actions.create({
      recordId,
      noteTypeId: typeId,
      ...(sessionId ? { therapySessionId: sessionId } : {}),
      body: { version: 1, blocks: [] },
      contentLocale: locale,
    });
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    setCreating(false);
    await open(result.data.noteId);
    setBusy(false);
    router.refresh();
  }

  const typeLabel = (id: string) => noteTypes.find((n) => n.id === id)?.label ?? t('unknownType');
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

  if (opened) {
    const back = (
      <Button
        variant="link"
        className="self-start"
        onClick={() => {
          setOpened(null);
          router.refresh();
        }}
      >
        {t('backToList')}
      </Button>
    );
    return (
      <div className="flex flex-col gap-4">
        {back}
        <FormError error={error} />
        {opened.status === 'draft' ? (
          <NoteEditor
            key={opened.id}
            note={opened}
            noteTypes={noteTypes}
            sessions={sessions}
            actions={actions}
            onFinalized={() => {
              void open(opened.id);
              router.refresh();
            }}
            onDiscarded={() => {
              setOpened(null);
              router.refresh();
            }}
          />
        ) : (
          <NoteView
            note={opened}
            noteTypes={noteTypes}
            myMembershipId={myMembershipId}
            addendumAction={actions.addendum}
            onChanged={() => {
              void open(opened.id);
              router.refresh();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription className="flex items-center gap-1.5">
            <Lock className="size-3.5" aria-hidden />
            {t('privateNote')}
          </CardDescription>
        </CardHeader>
        <FormError error={error} />
        {loadFailed ? (
          <Alert variant="error">
            <AlertDescription>{t('loadFailed')}</AlertDescription>
          </Alert>
        ) : null}
        {recordClosed ? (
          <Alert variant="info">
            <AlertDescription>{t('recordClosed')}</AlertDescription>
          </Alert>
        ) : null}
        {!recordClosed && !creating ? (
          <Button
            className="self-start"
            onClick={() => setCreating(true)}
            disabled={activeTypes.length === 0}
          >
            <Plus aria-hidden />
            {t('new')}
          </Button>
        ) : null}
        {activeTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noTypes')}</p>
        ) : null}
        {creating && !recordClosed ? (
          <div
            className="flex flex-col gap-4 rounded-lg border bg-card p-4"
            role="group"
            aria-label={t('newTitle')}
          >
            <h4>{t('newTitle')}</h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                label={t('type')}
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
              >
                {activeTypes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={t('session')}
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
              >
                <option value="">{t('noSession')}</option>
                {heldSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {sessionLabel(s)}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label={t('contentLocale')}
                value={locale}
                onChange={(e) => setLocale(e.target.value as 'es' | 'en')}
              >
                <option value="es">{t('localeEs')}</option>
                <option value="en">{t('localeEn')}</option>
              </SelectField>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={create} loading={busy} disabled={!typeId}>
                {t('createDraft')}
              </Button>
              <Button variant="outline" onClick={() => setCreating(false)}>
                {t('cancelNew')}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      {loading ? <LoadingState rows={2} /> : null}

      {notes.length === 0 && !loadFailed ? (
        <Card>
          <EmptyState icon={FileText} title={t('emptyTitle')} description={t('emptyDescription')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="notes-list">
          {notes.map((n) => (
            <li
              key={n.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4"
              data-testid={`note-${n.status}`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-semibold">{typeLabel(n.noteTypeId)}</span>
                <span className="text-sm text-muted-foreground">
                  {n.status === 'finalized' && n.finalizedAt
                    ? t('finalizedOn', { date: day(n.finalizedAt) })
                    : t('draftUpdated', { date: day(n.updatedAt) })}
                </span>
              </div>
              {n.status === 'draft' ? (
                <Badge variant="warning">
                  <PencilLine aria-hidden />
                  {t('statusDraft')}
                </Badge>
              ) : (
                <Badge variant="success">
                  <Lock aria-hidden />
                  {t('statusFinalized')}
                </Badge>
              )}
              {n.addendumCount > 0 ? (
                <Badge variant="info">
                  <FilePlus aria-hidden />
                  {t('addenda', { count: n.addendumCount })}
                </Badge>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => void open(n.id)}>
                {n.status === 'draft' ? t('continueDraft') : t('open')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
