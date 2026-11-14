'use client';

import { FolderOpen, Lock, LockOpen } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import { FormError } from '@/components/shared/form-kit';
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
import { useRouter } from '@/i18n/navigation';
import type { ActionError } from '@/modules/auth/schemas/result';
import { AssessmentsPanel, type AssessmentActions } from './assessments-panel';
import { ConfirmDialog } from './confirm-dialog';
import { DiagnosesPanel, type DiagnosisActions } from './diagnoses-panel';
import { RichTextView, isRichTextEmpty } from './rich-text';
import { RichTextField } from './rich-text-field';
import { SectionCard, type SectionActions } from './section-card';
import type {
  Action,
  AssessmentDto,
  ClinicalDocumentDto,
  RecordOverviewDto,
  RichText,
} from './types';

export type RecordActions = {
  open: Action<{ patientId: string }, { recordId: string }>;
  close: Action<{ recordId: string; closureSummary: RichText }>;
  reopen: Action<{ recordId: string }>;
  section: SectionActions;
  assessment: AssessmentActions;
  diagnosis: DiagnosisActions;
};

function CloseDialog({
  recordId,
  action,
  onClose,
}: {
  recordId: string;
  action: RecordActions['close'];
  onClose: () => void;
}) {
  const t = useTranslations('clinical.record.close');
  const tc = useTranslations('common');
  const tv = useTranslations('validation');
  const router = useRouter();
  const [summary, setSummary] = useState<RichText>({ version: 1, blocks: [] });
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (isRichTextEmpty(summary)) {
      setFieldError(tv('fieldRequired'));
      return;
    }
    setFieldError(undefined);
    setError(null);
    setBusy(true);
    const result = await action({ recordId, closureSummary: summary });
    setBusy(false);
    if (result.ok) {
      onClose();
      router.refresh();
    } else setError(result.error);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <RichTextField
          label={t('summary')}
          value={summary}
          onChange={setSummary}
          error={fieldError}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button variant="destructive-solid" onClick={submit} loading={busy}>
            {t('confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Historia clínica tab (CLR-01..06): open / close / reopen, org-configured sections with revision
 * history, assessments and diagnoses. Everything shown is psychologist-authored; nothing is
 * computed or suggested. Care team only (the page does not render this tab otherwise).
 */
export function RecordTab({
  patientId,
  overview,
  assessments,
  documents,
  myMembershipId,
  loadFailed,
  actions,
}: {
  patientId: string;
  overview: RecordOverviewDto | null;
  assessments: AssessmentDto[];
  documents: ClinicalDocumentDto[];
  myMembershipId: string;
  loadFailed: boolean;
  actions: RecordActions;
}) {
  const t = useTranslations('clinical.record');
  const format = useFormatter();
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [openError, setOpenError] = useState<ActionError | null>(null);
  const [opening, setOpening] = useState(false);

  if (loadFailed) {
    return (
      <Alert variant="error">
        <AlertDescription>{t('loadFailed')}</AlertDescription>
      </Alert>
    );
  }

  if (!overview) {
    return (
      <Card>
        <EmptyState
          icon={FolderOpen}
          title={t('noRecordTitle')}
          description={t('noRecordDescription')}
          action={
            <div className="flex flex-col items-center gap-3">
              <FormError error={openError} />
              <Button
                loading={opening}
                onClick={async () => {
                  setOpenError(null);
                  setOpening(true);
                  const result = await actions.open({ patientId });
                  setOpening(false);
                  if (result.ok) router.refresh();
                  else setOpenError(result.error);
                }}
              >
                {t('open')}
              </Button>
            </div>
          }
        />
      </Card>
    );
  }

  const { record } = overview;
  const closed = record.status === 'closed';
  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });
  const visibleSections = overview.sections.filter((s) => s.definition.isActive || s.section);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>
            {t('numberAndOpened', { number: record.recordNumber, date: date(record.openedAt) })}
          </CardDescription>
        </CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={closed ? 'neutral' : 'success'}>
            {closed ? <Lock aria-hidden /> : <LockOpen aria-hidden />}
            {closed ? t('statusClosed') : t('statusOpen')}
          </Badge>
          {overview.isMinor ? <Badge variant="neutral">{t('minor')}</Badge> : null}
          {closed ? (
            <ConfirmDialog
              trigger={
                <Button variant="outline" size="sm">
                  <LockOpen aria-hidden />
                  {t('reopen')}
                </Button>
              }
              title={t('reopenTitle')}
              description={t('reopenDescription')}
              confirmLabel={t('reopenConfirm')}
              action={() => actions.reopen({ recordId: record.id })}
              onDone={() => router.refresh()}
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setClosing(true)}>
              <Lock aria-hidden />
              {t('close.action')}
            </Button>
          )}
        </div>
        {closed ? (
          <Alert variant="info">
            <AlertDescription>
              {t('closedNotice', { date: record.closedAt ? date(record.closedAt) : '' })}
            </AlertDescription>
          </Alert>
        ) : null}
        {closed && record.closureSummary && !isRichTextEmpty(record.closureSummary) ? (
          <div>
            <h4>{t('close.summary')}</h4>
            <RichTextView body={record.closureSummary} />
          </div>
        ) : null}
      </Card>

      {visibleSections.length === 0 ? (
        <Card>
          <p className="text-muted-foreground">{t('noSections')}</p>
        </Card>
      ) : (
        visibleSections.map((entry) => (
          <SectionCard
            key={`${entry.definition.id}-${entry.section?.revision ?? 0}`}
            recordId={record.id}
            entry={entry}
            readOnly={closed}
            myMembershipId={myMembershipId}
            actions={actions.section}
            onSaved={() => router.refresh()}
          />
        ))
      )}

      <DiagnosesPanel
        recordId={record.id}
        diagnoses={overview.diagnoses}
        readOnly={closed}
        actions={actions.diagnosis}
      />
      <AssessmentsPanel
        recordId={record.id}
        assessments={assessments}
        documents={documents}
        myMembershipId={myMembershipId}
        readOnly={closed}
        actions={actions.assessment}
      />
      {closing ? (
        <CloseDialog
          recordId={record.id}
          action={actions.close}
          onClose={() => setClosing(false)}
        />
      ) : null}
    </div>
  );
}
