'use client';

import { Plus, Stethoscope } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import {
  FormError,
  FormField,
  SelectField,
  useValidationMessage,
} from '@/components/shared/form-kit';
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
import { todayIso, useServerFieldError } from './field-error';
import type { Action, CodeSystem, DiagnosisDto, DiagnosisStatus } from './types';

const SYSTEMS: CodeSystem[] = ['cie10', 'cie11', 'dsm5tr', 'other'];
const STATUSES: DiagnosisStatus[] = ['provisional', 'confirmed', 'ruled_out', 'resolved'];

export type DiagnosisActions = {
  add: Action<
    {
      recordId: string;
      codeSystem: CodeSystem;
      code?: string;
      label: string;
      status: DiagnosisStatus;
      diagnosedOn: string;
    },
    { diagnosisId: string }
  >;
  updateStatus: Action<{ diagnosisId: string; status: DiagnosisStatus; resolvedOn?: string }>;
};

function AddDialog({
  recordId,
  actions,
  onClose,
}: {
  recordId: string;
  actions: DiagnosisActions;
  onClose: () => void;
}) {
  const t = useTranslations('clinical.record.diagnoses');
  const tc = useTranslations('common');
  const v = useValidationMessage();
  const router = useRouter();
  const [system, setSystem] = useState<CodeSystem>('other');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<DiagnosisStatus>('provisional');
  const [date, setDate] = useState(todayIso());
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  const serverError = useServerFieldError(error);

  async function submit() {
    const next: Record<string, string | undefined> = {};
    if (label.trim() === '') next.label = v('fieldRequired');
    if (system !== 'other' && code.trim() === '') next.code = v('fieldRequired');
    if (!date) next.date = v('fieldRequired');
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setError(null);
    setBusy(true);
    const result = await actions.add({
      recordId,
      codeSystem: system,
      ...(code.trim() ? { code: code.trim() } : {}),
      label: label.trim(),
      status,
      diagnosedOn: date,
    });
    setBusy(false);
    if (result.ok) {
      onClose();
      router.refresh();
    } else setError(result.error);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addTitle')}</DialogTitle>
          <DialogDescription>{t('disclaimer')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <SelectField
          label={t('system')}
          value={system}
          onChange={(e) => setSystem(e.target.value as CodeSystem)}
        >
          {SYSTEMS.map((s) => (
            <option key={s} value={s}>
              {t(`systems.${s}`)}
            </option>
          ))}
        </SelectField>
        <FormField
          label={t('code')}
          value={code}
          maxLength={20}
          onChange={(e) => setCode(e.target.value)}
          error={errors.code ?? serverError('code')}
        />
        <FormField
          label={t('label')}
          value={label}
          maxLength={300}
          onChange={(e) => setLabel(e.target.value)}
          error={errors.label ?? serverError('label')}
        />
        <SelectField
          label={t('status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as DiagnosisStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </SelectField>
        <FormField
          label={t('date')}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          error={errors.date ?? serverError('diagnosedOn')}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('addSubmit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({
  diagnosis,
  actions,
  onClose,
}: {
  diagnosis: DiagnosisDto;
  actions: DiagnosisActions;
  onClose: () => void;
}) {
  const t = useTranslations('clinical.record.diagnoses');
  const tc = useTranslations('common');
  const router = useRouter();
  const [status, setStatus] = useState<DiagnosisStatus>(diagnosis.status);
  const [resolvedOn, setResolvedOn] = useState(diagnosis.resolvedOn ?? todayIso());
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    const result = await actions.updateStatus({
      diagnosisId: diagnosis.id,
      status,
      ...(status === 'resolved' ? { resolvedOn } : {}),
    });
    setBusy(false);
    if (result.ok) {
      onClose();
      router.refresh();
    } else setError(result.error);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('statusTitle')}</DialogTitle>
          <DialogDescription>{diagnosis.label}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <SelectField
          label={t('status')}
          value={status}
          onChange={(e) => setStatus(e.target.value as DiagnosisStatus)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </SelectField>
        {status === 'resolved' ? (
          <FormField
            label={t('resolvedOn')}
            type="date"
            value={resolvedOn}
            onChange={(e) => setResolvedOn(e.target.value)}
          />
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('statusSubmit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** CLR-04: diagnoses typed by the psychologist. The system never proposes or computes any. */
export function DiagnosesPanel({
  recordId,
  diagnoses,
  readOnly,
  actions,
}: {
  recordId: string;
  diagnoses: DiagnosisDto[];
  readOnly: boolean;
  actions: DiagnosisActions;
}) {
  const t = useTranslations('clinical.record.diagnoses');
  const format = useFormatter();
  const [adding, setAdding] = useState(false);
  const [changing, setChanging] = useState<DiagnosisDto | null>(null);
  return (
    <section
      aria-labelledby="diagnoses-title"
      className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="diagnoses-title">{t('title')}</h3>
        {!readOnly ? (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden />
            {t('add')}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">{t('disclaimer')}</p>
      {diagnoses.length === 0 ? (
        <EmptyState icon={Stethoscope} title={t('empty')} />
      ) : (
        <ul className="flex flex-col divide-y" data-testid="diagnoses-list">
          {diagnoses.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="font-semibold">{d.label}</span>
                <span className="text-sm text-muted-foreground">
                  {t(`systems.${d.codeSystem}`)}
                  {d.code ? ` ${d.code}` : ''} ·{' '}
                  {format.dateTime(new Date(`${d.diagnosedOn}T12:00:00`), { dateStyle: 'medium' })}
                </span>
              </div>
              <Badge variant={d.status === 'confirmed' ? 'info' : 'neutral'}>
                {t(`statuses.${d.status}`)}
              </Badge>
              {!readOnly ? (
                <Button variant="outline" size="sm" onClick={() => setChanging(d)}>
                  {t('changeStatus')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <AddDialog recordId={recordId} actions={actions} onClose={() => setAdding(false)} />
      ) : null}
      {changing ? (
        <StatusDialog diagnosis={changing} actions={actions} onClose={() => setChanging(null)} />
      ) : null}
    </section>
  );
}
