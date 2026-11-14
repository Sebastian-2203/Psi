'use client';

import { CheckCircle2, FileSearch } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import {
  FormError,
  SelectField,
  TextAreaField,
  useValidationMessage,
} from '@/components/shared/form-kit';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from '@/i18n/navigation';
import type { ActionError } from '@/modules/auth/schemas/result';
import { DataRequestStatusBadge } from './status-badge';
import type { DataRequestType, MyDataRequestDto, SubmitAction } from './types';

/**
 * PAT-09 portal form: the patient (or guardian, about her own data) asks for access or
 * rectification and follows the status. No legal deadline is promised here
 * [NEEDS LEGAL VERIFICATION]; the due date appears only when the practice sets one.
 */
export function PortalDataRequests({
  requests,
  action,
}: {
  requests: MyDataRequestDto[];
  action: SubmitAction;
}) {
  const t = useTranslations('dataRequests');
  const v = useValidationMessage();
  const format = useFormatter();
  const router = useRouter();
  const [type, setType] = useState<DataRequestType>('access');
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

  async function submit() {
    const text = note.trim();
    setServerError(null);
    setSent(false);
    if (text.length > 1000) {
      setNoteError(v('fieldTooLong'));
      return;
    }
    setNoteError(undefined);
    setBusy(true);
    const result = await action({ requestType: type, note: text || undefined });
    setBusy(false);
    if (result.ok) {
      setSent(true);
      setNote('');
      router.refresh();
    } else setServerError(result.error);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-h2">{t('portal.formTitle')}</CardTitle>
          <CardDescription>{t('portal.formDescription')}</CardDescription>
        </CardHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex max-w-xl flex-col gap-4"
          aria-label={t('portal.formTitle')}
        >
          <FormError error={serverError} />
          <SelectField
            label={t('portal.typeLabel')}
            value={type}
            onChange={(e) => setType(e.target.value as DataRequestType)}
          >
            <option value="access">{t('type.access')}</option>
            <option value="rectification">{t('type.rectification')}</option>
          </SelectField>
          <TextAreaField
            label={t('portal.noteLabel')}
            hint={t('portal.noteHint')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            error={noteError}
            maxLength={1000}
          />
          {sent ? (
            <div aria-live="polite">
              <Alert variant="success">
                <CheckCircle2 className="sr-only" aria-hidden />
                {t('portal.sent')}
              </Alert>
            </div>
          ) : null}
          <Button type="submit" className="self-start" loading={busy}>
            {t('portal.submit')}
          </Button>
        </form>
      </Card>

      <section aria-labelledby="my-requests-title" className="flex flex-col gap-3">
        <h2 id="my-requests-title" className="font-display text-h2">
          {t('portal.listTitle')}
        </h2>
        {requests.length === 0 ? (
          <Card>
            <EmptyState icon={FileSearch} title={t('portal.empty')} />
          </Card>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="my-data-requests">
            {requests.map((r) => (
              <li key={r.requestId}>
                <Card>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">
                      {t(`type.${r.requestType as DataRequestType}`)}
                    </span>
                    <DataRequestStatusBadge status={r.status} />
                    <span className="text-sm text-muted-foreground">
                      {t('receivedOn', { date: day(r.receivedAt) })}
                    </span>
                  </div>
                  {r.dueAt && !r.resolvedAt ? (
                    <p className="text-sm">{t('dueOn', { date: day(r.dueAt) })}</p>
                  ) : null}
                  {r.resolutionSummary ? (
                    <p className="text-sm">
                      <span className="font-semibold">{t('resolution')}</span> {r.resolutionSummary}
                    </p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
