'use client';

import { Lock, PencilLine, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { FormError, SelectField } from '@/components/shared/form-kit';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ActionError } from '@/modules/auth/schemas/result';
import { RichTextField } from '@/modules/clinical-records/components/rich-text-field';
import { SaveIndicator } from '@/modules/clinical-records/components/save-indicator';
import type {
  Action,
  NoteTypeDto,
  NoteWithAddendaDto,
  RichText,
  SessionDto,
} from '@/modules/clinical-records/components/types';
import { useAutosave } from '@/modules/clinical-records/components/use-autosave';
import { useSessionLabel } from './session-label';

export type NoteDraftValue = {
  body: RichText;
  noteTypeId: string;
  sessionId: string;
  locale: 'es' | 'en';
};

export type NoteEditorActions = {
  update: Action<
    {
      noteId: string;
      body?: RichText;
      noteTypeId?: string;
      therapySessionId?: string | null;
      contentLocale?: 'es' | 'en';
      expectedUpdatedAt: string;
    },
    { noteId: string; updatedAt: string }
  >;
  finalize: Action<{ noteId: string }>;
  discard: Action<{ noteId: string; reason: string }>;
};

/**
 * Draft editor (NOTE-01/02): white reading area, `note` typography at 72ch, autosave with an
 * `aria-live` indicator, sticky action bar. Finalizing is irreversible and asks for an explicit
 * confirmation first (ADR-006); the server re-checks authorship, aal2 and content.
 */
export function NoteEditor({
  note,
  noteTypes,
  sessions,
  actions,
  onFinalized,
  onDiscarded,
}: {
  note: NoteWithAddendaDto;
  noteTypes: NoteTypeDto[];
  sessions: SessionDto[];
  actions: NoteEditorActions;
  onFinalized: () => void;
  onDiscarded: () => void;
}) {
  const t = useTranslations('clinical.notes');
  const tc = useTranslations('common');
  const sessionLabel = useSessionLabel();
  const token = useRef(note.updatedAt);
  const [draft, setDraft] = useState<NoteDraftValue>({
    body: note.body,
    noteTypeId: note.noteTypeId,
    sessionId: note.therapySessionId ?? '',
    locale: note.contentLocale,
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<ActionError | null>(null);

  const autosave = useAutosave<NoteDraftValue>({
    value: draft,
    save: async (v) => {
      const result = await actions.update({
        noteId: note.id,
        body: v.body,
        noteTypeId: v.noteTypeId,
        therapySessionId: v.sessionId === '' ? null : v.sessionId,
        contentLocale: v.locale,
        expectedUpdatedAt: token.current,
      });
      if (result.ok) token.current = result.data.updatedAt;
      return result;
    },
  });

  async function finalize() {
    setFinalizeError(null);
    setFinalizing(true);
    const saved = await autosave.flush();
    if (!saved) {
      setFinalizing(false);
      setConfirmOpen(false);
      return;
    }
    const result = await actions.finalize({ noteId: note.id });
    setFinalizing(false);
    if (result.ok) {
      setConfirmOpen(false);
      onFinalized();
    } else setFinalizeError(result.error);
  }

  const activeTypes = noteTypes.filter((n) => n.isActive || n.id === draft.noteTypeId);
  const selectableSessions = sessions.filter(
    (s) => s.status === 'held' || s.id === note.therapySessionId,
  );

  return (
    <section
      aria-label={t('editorLabel')}
      className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:p-6"
      data-testid="note-editor"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="warning">
          <PencilLine aria-hidden />
          {t('statusDraft')}
        </Badge>
        <span className="flex items-center gap-1 text-sm text-muted-foreground">
          <Lock className="size-3.5" aria-hidden />
          {t('privateNote')}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          label={t('type')}
          value={draft.noteTypeId}
          onChange={(e) => setDraft((d) => ({ ...d, noteTypeId: e.target.value }))}
        >
          {activeTypes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('session')}
          value={draft.sessionId}
          onChange={(e) => setDraft((d) => ({ ...d, sessionId: e.target.value }))}
        >
          <option value="">{t('noSession')}</option>
          {selectableSessions.map((s) => (
            <option key={s.id} value={s.id}>
              {sessionLabel(s)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('contentLocale')}
          hint={t('contentLocaleHint')}
          value={draft.locale}
          onChange={(e) => setDraft((d) => ({ ...d, locale: e.target.value as 'es' | 'en' }))}
        >
          <option value="es">{t('localeEs')}</option>
          <option value="en">{t('localeEn')}</option>
        </SelectField>
      </div>

      <RichTextField
        label={t('body')}
        value={draft.body}
        onChange={(body) => setDraft((d) => ({ ...d, body }))}
        rows={16}
      />

      <FormError error={autosave.error} />

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t bg-card px-4 py-3 sm:-mx-6 sm:px-6">
        <SaveIndicator
          status={autosave.status}
          savedAt={autosave.savedAt}
          onRetry={() => void autosave.flush()}
        />
        <div className="flex flex-wrap gap-2">
          <ReasonDialog
            trigger={
              <Button variant="destructive">
                <Trash2 aria-hidden />
                {t('discard')}
              </Button>
            }
            title={t('discardTitle')}
            description={t('discardDescription')}
            confirmLabel={t('discardConfirm')}
            destructive
            reasonLabel={t('discardReason')}
            action={(reason) => actions.discard({ noteId: note.id, reason })}
            onDone={onDiscarded}
          />
          <Button onClick={() => setConfirmOpen(true)}>
            <Lock aria-hidden />
            {t('finalize')}
          </Button>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('finalizeTitle')}</DialogTitle>
            <DialogDescription>{t('finalizeDescription')}</DialogDescription>
          </DialogHeader>
          <FormError error={finalizeError} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={finalize} loading={finalizing}>
              {t('finalizeConfirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
