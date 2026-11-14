'use client';

import { Inbox } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import {
  FormError,
  FormField,
  SelectField,
  TextAreaField,
  useValidationMessage,
} from '@/components/shared/form-kit';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { DataRequestStatusBadge } from './status-badge';
import type {
  DataRequestStatus,
  DataRequestType,
  StaffDataRequestDto,
  UpdateAction,
} from './types';

const FINAL = ['fulfilled', 'partially_fulfilled', 'rejected'] as const;

function ManageDialog({
  request,
  action,
  canManage,
}: {
  request: StaffDataRequestDto;
  action: UpdateAction;
  canManage: boolean;
}) {
  const t = useTranslations('dataRequests.staff');
  const tc = useTranslations('common');
  const ts = useTranslations('dataRequests.status');
  const v = useValidationMessage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const options: DataRequestStatus[] = [
    'in_review',
    'fulfilled',
    'partially_fulfilled',
    'rejected',
  ];
  const [status, setStatus] = useState<DataRequestStatus>(
    request.status === 'received' ? 'in_review' : 'fulfilled',
  );
  const [summary, setSummary] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [errors, setErrors] = useState<{ summary?: string; due?: string }>({});
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);
  const final = (FINAL as readonly string[]).includes(status);
  const name = request.subjectName ?? t('unknownSubject');

  async function save() {
    const text = summary.trim();
    const next = {
      summary: final && text.length < 3 ? v(text ? 'fieldTooShort' : 'fieldRequired') : undefined,
      due: dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? v('dateInvalid') : undefined,
    };
    setErrors(next);
    setServerError(null);
    if (next.summary || next.due) return;
    setBusy(true);
    const result = await action({
      requestId: request.requestId,
      status,
      resolutionSummary: final ? text : undefined,
      dueDate: dueDate || undefined,
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else setServerError(result.error);
  }

  if (!canManage) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t('manage')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('manageTitle', { name })}</DialogTitle>
          <DialogDescription>{t('manageDescription')}</DialogDescription>
        </DialogHeader>
        <FormError error={serverError} />
        <SelectField
          label={t('newStatus')}
          value={status}
          onChange={(e) => setStatus(e.target.value as DataRequestStatus)}
        >
          {options.map((s) => (
            <option key={s} value={s}>
              {ts(s)}
            </option>
          ))}
        </SelectField>
        {final ? (
          <TextAreaField
            label={t('summary')}
            hint={t('summaryHint')}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            error={errors.summary}
            maxLength={2000}
          />
        ) : null}
        <FormField
          label={t('dueDate')}
          hint={t('dueDateHint')}
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          error={errors.due}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc('cancel')}
          </Button>
          <Button onClick={save} loading={busy}>
            {t('save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** PAT-09 staff view: owner sees all, the care team sees its patients' requests (RLS). */
export function StaffDataRequests({
  requests,
  action,
  canManage,
}: {
  requests: StaffDataRequestDto[];
  action: UpdateAction;
  canManage: boolean;
}) {
  const t = useTranslations('dataRequests');
  const format = useFormatter();
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium' });

  if (requests.length === 0) {
    return (
      <Card>
        <EmptyState icon={Inbox} title={t('staff.empty')} />
      </Card>
    );
  }
  return (
    <ul className="flex flex-col gap-3" data-testid="staff-data-requests">
      {requests.map((r) => {
        const open = r.status === 'received' || r.status === 'in_review';
        return (
          <li key={r.requestId}>
            <Card data-testid={`data-request-${r.requestId}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{r.subjectName ?? t('staff.unknownSubject')}</span>
                <span className="text-sm text-muted-foreground">
                  {t(`staff.subject.${r.subjectType}`)}
                </span>
                <span className="font-semibold">
                  {t(`type.${r.requestType as DataRequestType}`)}
                </span>
                <DataRequestStatusBadge status={r.status} />
                <span className="ml-auto text-sm text-muted-foreground">
                  {t('receivedOn', { date: day(r.receivedAt) })}
                </span>
              </div>
              {r.requesterNote ? <p className="text-sm">{r.requesterNote}</p> : null}
              {r.dueAt ? <p className="text-sm">{t('dueOn', { date: day(r.dueAt) })}</p> : null}
              {r.resolutionSummary ? (
                <p className="text-sm">
                  <span className="font-semibold">{t('resolution')}</span> {r.resolutionSummary}
                </p>
              ) : null}
              {open ? <ManageDialog request={r} action={action} canManage={canManage} /> : null}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
