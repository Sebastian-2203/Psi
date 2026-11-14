'use client';

import { FilePlus, Lock } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormError, SelectField } from '@/components/shared/form-kit';
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
import { RichTextView, isRichTextEmpty } from '@/modules/clinical-records/components/rich-text';
import { RichTextField } from '@/modules/clinical-records/components/rich-text-field';
import type {
  Action,
  AddendumReason,
  NoteTypeDto,
  NoteWithAddendaDto,
  RichText,
} from '@/modules/clinical-records/components/types';

const REASONS: AddendumReason[] = ['correction', 'clarification', 'late_entry', 'other'];

export type AddendumAction = Action<{
  noteId: string;
  reason: AddendumReason;
  body: RichText;
  contentLocale: 'es' | 'en';
  idempotencyKey: string;
}>;

function AddendumDialog({
  noteId,
  action,
  open,
  onOpenChange,
  onDone,
}: {
  noteId: string;
  action: AddendumAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const t = useTranslations('clinical.notes.addendum');
  const tv = useTranslations('validation');
  const tc = useTranslations('common');
  const [reason, setReason] = useState<AddendumReason>('clarification');
  const [body, setBody] = useState<RichText>({ version: 1, blocks: [] });
  const [locale, setLocale] = useState<'es' | 'en'>('es');
  // One key per opened dialog: a retry after a network error cannot create a second addendum.
  const [key] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<ActionError | null>(null);
  const [fieldError, setFieldError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (isRichTextEmpty(body)) {
      setFieldError(tv('fieldRequired'));
      return;
    }
    setFieldError(undefined);
    setError(null);
    setBusy(true);
    const result = await action({
      noteId,
      reason,
      body,
      contentLocale: locale,
      idempotencyKey: key,
    });
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <SelectField
          label={t('reason')}
          value={reason}
          onChange={(e) => setReason(e.target.value as AddendumReason)}
        >
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {t(`reasons.${r}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('locale')}
          value={locale}
          onChange={(e) => setLocale(e.target.value as 'es' | 'en')}
        >
          <option value="es">{t('localeEs')}</option>
          <option value="en">{t('localeEn')}</option>
        </SelectField>
        <RichTextField label={t('body')} value={body} onChange={setBody} error={fieldError} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Finalized note (NOTE-03/05): locked stripe "Nota finalizada el … · No editable" with the success
 * badge + Lock; addenda are separate cards with an info badge, each with author, date and reason.
 * Nothing here can edit the body; a correction is an addendum with a reason (non-negotiable 6).
 */
export function NoteView({
  note,
  noteTypes,
  myMembershipId,
  addendumAction,
  onChanged,
}: {
  note: NoteWithAddendaDto;
  noteTypes: NoteTypeDto[];
  myMembershipId: string;
  addendumAction: AddendumAction;
  onChanged: () => void;
}) {
  const t = useTranslations('clinical.notes');
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const typeLabel = noteTypes.find((n) => n.id === note.noteTypeId)?.label ?? t('unknownType');
  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const author = (id: string, name: string | null) =>
    id === myMembershipId ? t('you') : (name ?? t('teamMember'));

  return (
    <article
      className="flex flex-col gap-4"
      aria-label={t('viewLabel', { type: typeLabel })}
      data-testid="note-view"
    >
      <div className="rounded-lg border bg-card">
        <div
          className="flex flex-wrap items-center gap-2 rounded-t-lg border-b bg-muted px-4 py-2 text-sm"
          data-testid="note-locked-stripe"
        >
          <Badge variant="success">
            <Lock aria-hidden />
            {t('statusFinalized')}
          </Badge>
          <span>
            {t('finalizedOn', { date: note.finalizedAt ? when(note.finalizedAt) : '' })}
            {' · '}
            {t('notEditable')}
          </span>
        </div>
        <div className="flex flex-col gap-3 p-4 sm:p-6">
          <p className="text-sm text-muted-foreground">
            {typeLabel} · {author(note.authorMembershipId, note.authorName)}
          </p>
          <RichTextView body={note.body} testId="note-body" />
        </div>
      </div>

      <section aria-labelledby={`addenda-${note.id}`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`addenda-${note.id}`}>{t('addenda', { count: note.addenda.length })}</h3>
          <Button variant="outline" onClick={() => setOpen(true)}>
            <FilePlus aria-hidden />
            {t('addAddendum')}
          </Button>
        </div>
        {note.addenda.map((a) => (
          <div
            key={a.id}
            className="flex flex-col gap-2 rounded-lg border bg-card p-4"
            data-testid="addendum"
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="info">
                <FilePlus aria-hidden />
                {t('addendum.badge')}
              </Badge>
              <span className="font-semibold">{t(`addendum.reasons.${a.reason}`)}</span>
              <span className="text-muted-foreground">
                {when(a.createdAt)} · {author(a.authorMembershipId, a.authorName)}
              </span>
            </div>
            <RichTextView body={a.body} />
          </div>
        ))}
      </section>

      {open ? (
        <AddendumDialog
          noteId={note.id}
          action={addendumAction}
          open={open}
          onOpenChange={setOpen}
          onDone={() => {
            setOpen(false);
            onChanged();
          }}
        />
      ) : null}
    </article>
  );
}
