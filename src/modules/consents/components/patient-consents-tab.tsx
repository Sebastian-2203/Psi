'use client';

import { FilePlus2, FileText, Undo2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import { FormError, FormField, SelectField } from '@/components/shared/form-kit';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useRouter } from '@/i18n/navigation';
import type { ActionError } from '@/modules/auth/schemas/result';
import type { ConsentActions, ConsentStatusEntryDto, RecordableConsentDto } from './types';

const STATUS_VARIANT = { accepted: 'success', declined: 'neutral', withdrawn: 'warning' } as const;

type GuardianOption = { patientGuardianId: string; name: string };

function RecordDialog({
  patientId,
  options,
  guardians,
  action,
}: {
  patientId: string;
  options: RecordableConsentDto[];
  guardians: GuardianOption[];
  action: ConsentActions['record'];
}) {
  const t = useTranslations('consents.record');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [versionId, setVersionId] = useState(options[0]?.versionId ?? '');
  const [signer, setSigner] = useState<'patient' | 'guardian'>('patient');
  const [guardianId, setGuardianId] = useState(guardians[0]?.patientGuardianId ?? '');
  const [decision, setDecision] = useState<'accepted' | 'declined'>('accepted');
  const [decidedAt, setDecidedAt] = useState('');
  const [error, setError] = useState<ActionError | null>(null);
  const [dateError, setDateError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const tv = useTranslations('validation');

  async function submit() {
    setError(null);
    const when = decidedAt ? new Date(decidedAt) : null;
    if (!when || Number.isNaN(when.getTime())) {
      setDateError(tv('dateInvalid'));
      return;
    }
    setDateError(undefined);
    setBusy(true);
    const result = await action({
      patientId,
      versionId,
      signerType: signer,
      ...(signer === 'guardian' ? { patientGuardianId: guardianId } : {}),
      method: 'verbal_recorded',
      decision,
      decidedAt: when.toISOString(),
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={options.length === 0}>
          <FilePlus2 aria-hidden />
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        {options.length === 0 ? <Alert variant="info">{t('noDocuments')}</Alert> : null}
        <SelectField
          label={t('document')}
          value={versionId}
          onChange={(e) => setVersionId(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.versionId} value={o.versionId}>
              {o.requiredForActivation ? `${o.title} ${t('requiredSuffix')}` : o.title}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('signer')}
          value={signer}
          onChange={(e) => setSigner(e.target.value as 'patient' | 'guardian')}
        >
          <option value="patient">{t('signerPatient')}</option>
          <option value="guardian" disabled={guardians.length === 0}>
            {t('signerGuardian')}
          </option>
        </SelectField>
        {signer === 'guardian' ? (
          <SelectField
            label={t('guardian')}
            value={guardianId}
            onChange={(e) => setGuardianId(e.target.value)}
          >
            {guardians.map((g) => (
              <option key={g.patientGuardianId} value={g.patientGuardianId}>
                {g.name}
              </option>
            ))}
          </SelectField>
        ) : null}
        <SelectField
          label={t('decision')}
          value={decision}
          onChange={(e) => setDecision(e.target.value as 'accepted' | 'declined')}
        >
          <option value="accepted">{t('accepted')}</option>
          <option value="declined">{t('declined')}</option>
        </SelectField>
        <FormField
          label={t('decidedAt')}
          type="datetime-local"
          hint={t('decidedAtHint')}
          value={decidedAt}
          onChange={(e) => setDecidedAt(e.target.value)}
          error={dateError}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Consent status per template and signer (latest decision), verbal-decision recording and
 * withdrawal. Evidence (typed name, IP, user agent) is never exposed to the UI.
 */
export function PatientConsentsTab({
  patientId,
  records,
  activationMissing,
  guardians,
  recordable,
  actions,
  readOnly,
  loadFailed,
}: {
  patientId: string;
  records: ConsentStatusEntryDto[];
  activationMissing: string[];
  guardians: GuardianOption[];
  recordable: RecordableConsentDto[];
  actions: ConsentActions;
  readOnly: boolean;
  loadFailed?: boolean;
}) {
  const t = useTranslations('consents');
  const format = useFormatter();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-h3 font-bold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        {!readOnly ? (
          <RecordDialog
            patientId={patientId}
            options={recordable}
            guardians={guardians}
            action={actions.record}
          />
        ) : null}
      </div>
      {loadFailed ? <Alert variant="error">{t('loadError')}</Alert> : null}
      {activationMissing.length > 0 ? (
        <Alert variant="info">
          <AlertTitle>{t('activationTitle')}</AlertTitle>
          <AlertDescription>{t('activationBody')}</AlertDescription>
        </Alert>
      ) : null}
      {records.length === 0 && !loadFailed ? (
        <EmptyState icon={FileText} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="consent-records">
          {records.map((r) => (
            <li key={r.consentRecordId}>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{r.title}</CardTitle>
                    <Badge variant={STATUS_VARIANT[r.status]}>{t(`status.${r.status}`)}</Badge>
                    <Badge variant="outline">{t(`signers.${r.signerType}`)}</Badge>
                  </div>
                  <CardDescription>
                    {t('recordedOn', {
                      date: format.dateTime(new Date(r.acceptedAt), {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }),
                      method: t.has(`methods.${r.method}` as never)
                        ? t(`methods.${r.method}` as never)
                        : r.method,
                    })}
                    {r.withdrawnAt
                      ? ` · ${t('withdrawnOn', { date: format.dateTime(new Date(r.withdrawnAt), { dateStyle: 'medium' }) })}`
                      : ''}
                  </CardDescription>
                </CardHeader>
                {r.status !== 'withdrawn' && !readOnly ? (
                  <ReasonDialog
                    trigger={
                      <Button variant="destructive" size="sm" className="self-start">
                        <Undo2 aria-hidden />
                        {t('withdraw.trigger')}
                      </Button>
                    }
                    title={t('withdraw.title', { title: r.title })}
                    description={t('withdraw.description')}
                    confirmLabel={t('withdraw.confirm')}
                    destructive
                    reasonLabel={t('withdraw.reason')}
                    action={(reason) =>
                      actions.withdraw({ consentRecordId: r.consentRecordId, reason })
                    }
                    onDone={() => router.refresh()}
                  />
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
