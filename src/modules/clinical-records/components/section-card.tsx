'use client';

import { History, Pencil } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { FormError } from '@/components/shared/form-kit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ActionError } from '@/modules/auth/schemas/result';
import { RichTextView, isRichTextEmpty } from './rich-text';
import { RichTextField } from './rich-text-field';
import type { Action, RecordSectionDto, RichText, SectionRevisionDto } from './types';

export type SectionActions = {
  save: Action<
    {
      recordId: string;
      sectionDefinitionId: string;
      content: RichText;
      contentLocale: 'es' | 'en';
      expectedRevision: number;
    },
    { sectionId: string; revision: number; updatedAt: string }
  >;
  revisions: Action<{ sectionId: string }, SectionRevisionDto[]>;
};

/**
 * One clinical-record section (CLR-02/03): reading view (`note` typography), explicit save as a new
 * revision (optimistic `expectedRevision`), and on-demand revision history (audited read).
 */
export function SectionCard({
  recordId,
  entry,
  readOnly,
  myMembershipId,
  actions,
  onSaved,
}: {
  recordId: string;
  entry: RecordSectionDto;
  readOnly: boolean;
  myMembershipId: string;
  actions: SectionActions;
  onSaved: () => void;
}) {
  const t = useTranslations('clinical.record.sections');
  const format = useFormatter();
  const { definition, section } = entry;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RichText>(section?.content ?? { version: 1, blocks: [] });
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<SectionRevisionDto[] | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    const result = await actions.save({
      recordId,
      sectionDefinitionId: definition.id,
      content: draft,
      contentLocale: section?.contentLocale ?? 'es',
      expectedRevision: section?.revision ?? 0,
    });
    setBusy(false);
    if (result.ok) {
      setEditing(false);
      setHistory(null);
      onSaved();
    } else setError(result.error);
  }

  async function loadHistory() {
    if (!section) return;
    setHistoryBusy(true);
    const result = await actions.revisions({ sectionId: section.id });
    setHistoryBusy(false);
    if (result.ok) setHistory(result.data);
    else setError(result.error);
  }

  const when = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const who = (id: string) => (id === myMembershipId ? t('you') : t('teamMember'));
  const titleId = `section-${definition.id}`;

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:p-5"
      data-testid={`section-${definition.key}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={titleId}>{definition.title}</h3>
        {definition.isRequired ? <Badge variant="neutral">{t('required')}</Badge> : null}
        {!definition.isActive ? <Badge variant="outline">{t('inactive')}</Badge> : null}
        {section ? (
          <span className="text-sm text-muted-foreground">
            {t('revision', { n: section.revision })} · {when(section.updatedAt)} ·{' '}
            {who(section.lastEditedByMembershipId)}
          </span>
        ) : null}
      </div>
      {definition.description ? (
        <p className="text-sm text-muted-foreground">{definition.description}</p>
      ) : null}

      {editing ? (
        <>
          <RichTextField label={t('content')} value={draft} onChange={setDraft} rows={10} />
          <FormError error={error} />
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} loading={busy}>
              {t('save')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setEditing(false);
                setError(null);
                setDraft(section?.content ?? { version: 1, blocks: [] });
              }}
            >
              {t('cancel')}
            </Button>
          </div>
        </>
      ) : (
        <>
          {section && !isRichTextEmpty(section.content) ? (
            <RichTextView body={section.content} />
          ) : (
            <p className="text-muted-foreground">{t('empty')}</p>
          )}
          <FormError error={error} />
          <div className="flex flex-wrap gap-2">
            {!readOnly ? (
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil aria-hidden />
                {section ? t('edit') : t('fill')}
              </Button>
            ) : null}
            {section && section.revision > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => (history ? setHistory(null) : void loadHistory())}
                loading={historyBusy}
                aria-expanded={history !== null}
              >
                <History aria-hidden />
                {history ? t('hideHistory') : t('showHistory')}
              </Button>
            ) : null}
          </div>
        </>
      )}

      {history ? (
        <ol className="flex flex-col gap-3 border-l-2 pl-4" aria-label={t('historyLabel')}>
          {history.map((r) => (
            <li key={r.revision} className="flex flex-col gap-1">
              <span className="text-sm font-semibold">
                {t('revision', { n: r.revision })} · {when(r.editedAt)} ·{' '}
                {who(r.editedByMembershipId)}
              </span>
              {isRichTextEmpty(r.content) ? (
                <span className="text-sm text-muted-foreground">{t('empty')}</span>
              ) : (
                <RichTextView body={r.content} />
              )}
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
