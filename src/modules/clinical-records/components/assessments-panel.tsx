'use client';

import { ClipboardList, Lock, PencilLine, Plus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import { FormError, FormField, useValidationMessage } from '@/components/shared/form-kit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useRouter } from '@/i18n/navigation';
import type { ActionError } from '@/modules/auth/schemas/result';
import { ConfirmDialog } from './confirm-dialog';
import { todayIso, useServerFieldError } from './field-error';
import { RichTextView, isRichTextEmpty } from './rich-text';
import { RichTextField } from './rich-text-field';
import type { Action, AssessmentDto, RichText } from './types';

type Fields = {
  assessedOn: string;
  instrumentName: string;
  instrumentReference?: string;
  administeredBy?: string;
  results: RichText;
  interpretation?: RichText;
};

export type AssessmentActions = {
  create: Action<
    Fields & { recordId: string; correctsAssessmentId?: string },
    { assessmentId: string; updatedAt: string }
  >;
  update: Action<
    Partial<Fields> & { assessmentId: string; expectedUpdatedAt: string },
    { assessmentId: string; updatedAt: string }
  >;
  finalize: Action<{ assessmentId: string }>;
  discard: Action<{ assessmentId: string }>;
};

type Mode =
  | { kind: 'create' }
  | { kind: 'edit'; assessment: AssessmentDto }
  | { kind: 'correct'; assessment: AssessmentDto };

function AssessmentDialog({
  recordId,
  mode,
  actions,
  onClose,
}: {
  recordId: string;
  mode: Mode;
  actions: AssessmentActions;
  onClose: () => void;
}) {
  const t = useTranslations('clinical.record.assessments');
  const tc = useTranslations('common');
  const v = useValidationMessage();
  const router = useRouter();
  const source = mode.kind === 'create' ? null : mode.assessment;
  const [date, setDate] = useState(
    mode.kind === 'edit' ? (source?.assessedOn ?? todayIso()) : todayIso(),
  );
  const [name, setName] = useState(source?.instrumentName ?? '');
  const [reference, setReference] = useState(source?.instrumentReference ?? '');
  const [by, setBy] = useState(source?.administeredBy ?? '');
  const [results, setResults] = useState<RichText>(source?.results ?? { version: 1, blocks: [] });
  const [interpretation, setInterpretation] = useState<RichText>(
    source?.interpretation ?? { version: 1, blocks: [] },
  );
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef(source?.updatedAt ?? '');
  const serverError = useServerFieldError(error);

  async function submit() {
    const next: Record<string, string | undefined> = {};
    if (name.trim() === '') next.name = v('fieldRequired');
    if (!date) next.date = v('fieldRequired');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setError(null);
    setBusy(true);
    const fields: Fields = {
      assessedOn: date,
      instrumentName: name.trim(),
      ...(reference.trim() ? { instrumentReference: reference.trim() } : {}),
      ...(by.trim() ? { administeredBy: by.trim() } : {}),
      results,
      ...(isRichTextEmpty(interpretation) ? {} : { interpretation }),
    };
    const result =
      mode.kind === 'edit'
        ? await actions.update({
            assessmentId: mode.assessment.id,
            expectedUpdatedAt: token.current,
            ...fields,
          })
        : await actions.create({
            recordId,
            ...(mode.kind === 'correct' ? { correctsAssessmentId: mode.assessment.id } : {}),
            ...fields,
          });
    setBusy(false);
    if (result.ok) {
      onClose();
      router.refresh();
    } else setError(result.error);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode.kind === 'edit'
              ? t('editTitle')
              : mode.kind === 'correct'
                ? t('correctTitle')
                : t('createTitle')}
          </DialogTitle>
          <DialogDescription>
            {mode.kind === 'correct' ? t('correctDescription') : t('disclaimer')}
          </DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('instrument')}
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            error={errors.name ?? serverError('instrumentName')}
          />
          <FormField
            label={t('date')}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            error={errors.date ?? serverError('assessedOn')}
          />
          <FormField
            label={t('reference')}
            value={reference}
            maxLength={300}
            onChange={(e) => setReference(e.target.value)}
          />
          <FormField
            label={t('administeredBy')}
            value={by}
            maxLength={200}
            onChange={(e) => setBy(e.target.value)}
          />
        </div>
        <RichTextField
          label={t('results')}
          hint={t('resultsHint')}
          value={results}
          onChange={setResults}
          rows={6}
        />
        <RichTextField
          label={t('interpretation')}
          hint={t('interpretationHint')}
          value={interpretation}
          onChange={setInterpretation}
          rows={5}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {mode.kind === 'edit' ? t('saveDraft') : t('createDraft')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * CLR-06: assessments typed by the psychologist (draft -> finalized; a finalized one is only
 * corrected by a new assessment that references it). The system computes no scores.
 */
export function AssessmentsPanel({
  recordId,
  assessments,
  myMembershipId,
  readOnly,
  actions,
}: {
  recordId: string;
  assessments: AssessmentDto[];
  myMembershipId: string;
  readOnly: boolean;
  actions: AssessmentActions;
}) {
  const t = useTranslations('clinical.record.assessments');
  const format = useFormatter();
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [confirming, setConfirming] = useState<AssessmentDto | null>(null);
  const [finalizeError, setFinalizeError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  const tc = useTranslations('common');

  async function finalize(a: AssessmentDto) {
    setBusy(true);
    setFinalizeError(null);
    const result = await actions.finalize({ assessmentId: a.id });
    setBusy(false);
    if (result.ok) {
      setConfirming(null);
      router.refresh();
    } else setFinalizeError(result.error);
  }

  return (
    <section
      aria-labelledby="assessments-title"
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="assessments-title">{t('title')}</h3>
        {!readOnly ? (
          <Button variant="outline" size="sm" onClick={() => setMode({ kind: 'create' })}>
            <Plus aria-hidden />
            {t('add')}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{t('disclaimer')}</p>
      {assessments.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t('empty')} />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="assessments-list">
          {assessments.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{a.instrumentName}</span>
                <span className="text-sm text-muted-foreground">
                  {format.dateTime(new Date(`${a.assessedOn}T12:00:00`), { dateStyle: 'medium' })}
                </span>
                {a.status === 'draft' ? (
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
                {a.correctsAssessmentId ? <Badge variant="info">{t('correction')}</Badge> : null}
              </div>
              {a.administeredBy || a.instrumentReference ? (
                <p className="text-sm text-muted-foreground">
                  {[a.administeredBy, a.instrumentReference].filter(Boolean).join(' · ')}
                </p>
              ) : null}
              {!isRichTextEmpty(a.results) ? (
                <div>
                  <h4>{t('results')}</h4>
                  <RichTextView body={a.results} />
                </div>
              ) : null}
              {a.interpretation && !isRichTextEmpty(a.interpretation) ? (
                <div>
                  <h4>{t('interpretation')}</h4>
                  <RichTextView body={a.interpretation} />
                </div>
              ) : null}
              {!readOnly ? (
                <div className="flex flex-wrap gap-2">
                  {a.status === 'draft' && a.authorMembershipId === myMembershipId ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setMode({ kind: 'edit', assessment: a })}
                      >
                        {t('edit')}
                      </Button>
                      <Button size="sm" onClick={() => setConfirming(a)}>
                        <Lock aria-hidden />
                        {t('finalize')}
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button variant="destructive" size="sm">
                            {t('discard')}
                          </Button>
                        }
                        title={t('discardTitle')}
                        description={t('discardDescription')}
                        confirmLabel={t('discardConfirm')}
                        destructive
                        action={() => actions.discard({ assessmentId: a.id })}
                        onDone={() => router.refresh()}
                      />
                    </>
                  ) : null}
                  {a.status === 'finalized' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMode({ kind: 'correct', assessment: a })}
                    >
                      {t('correct')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {mode ? (
        <AssessmentDialog
          key={mode.kind === 'create' ? 'new' : mode.assessment.id + mode.kind}
          recordId={recordId}
          mode={mode}
          actions={actions}
          onClose={() => setMode(null)}
        />
      ) : null}
      <Dialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('finalizeTitle')}</DialogTitle>
            <DialogDescription>{t('finalizeDescription')}</DialogDescription>
          </DialogHeader>
          <FormError error={finalizeError} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirming(null)}>
              {tc('cancel')}
            </Button>
            <Button onClick={() => confirming && finalize(confirming)} loading={busy}>
              {t('finalizeConfirm')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
