'use client';

import { UserMinus, UserPlus } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  FormError,
  SelectField,
  TextAreaField,
  useValidationMessage,
} from '@/components/shared/form-kit';
import { ReasonDialog } from '@/components/shared/reason-dialog';
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
import type { Action, PatientDetailDto } from './types';

type Role = 'primary' | 'secondary' | 'supervisor';
type AssignInput = { patientId: string; membershipId: string; careRole: Role; reason?: string };
type EndInput = { careTeamMemberId: string; reason: string };

function AssignSelf({
  patientId,
  membershipId,
  action,
}: {
  patientId: string;
  membershipId: string;
  action: Action<AssignInput, unknown>;
}) {
  const t = useTranslations('patients.careTeam');
  const tc = useTranslations('common');
  const v = useValidationMessage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>('secondary');
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const text = reason.trim();
    if (text.length > 0 && text.length < 10) {
      setFieldError(v('fieldTooShort'));
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    const result = await action({
      patientId,
      membershipId,
      careRole: role,
      ...(text ? { reason: text } : {}),
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
        <Button variant="outline">
          <UserPlus aria-hidden />
          {t('assignSelf')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assignSelf')}</DialogTitle>
          <DialogDescription>{t('assignDescription')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <SelectField
          label={t('role')}
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
        >
          {(['primary', 'secondary', 'supervisor'] as const).map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </SelectField>
        <TextAreaField
          label={t('reason')}
          hint={t('reasonHint')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={fieldError}
          maxLength={500}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('assign')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CareTeamTab({
  patient,
  myMembershipId,
  assignAction,
  endAction,
  readOnly,
}: {
  patient: PatientDetailDto;
  myMembershipId: string;
  assignAction: Action<AssignInput, unknown>;
  endAction: Action<EndInput, unknown>;
  readOnly: boolean;
}) {
  const t = useTranslations('patients.careTeam');
  const format = useFormatter();
  const router = useRouter();
  const onTeam = patient.careTeam.some((m) => m.membershipId === myMembershipId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <ul className="flex flex-col divide-y" data-testid="care-team">
        {patient.careTeam.map((m) => {
          const mine = m.membershipId === myMembershipId;
          return (
            <li key={m.careTeamMemberId} className="flex flex-wrap items-center gap-3 py-3">
              <span className="font-semibold">
                {m.displayName ?? t('unknownMember')}
                {mine ? ` (${t('you')})` : ''}
              </span>
              <Badge variant={m.careRole === 'primary' ? 'brand' : 'neutral'}>
                {t(`roles.${m.careRole}`)}
              </Badge>
              <span className="text-sm text-muted-foreground">
                {t('since', {
                  date: format.dateTime(new Date(m.startsAt), { dateStyle: 'medium' }),
                })}
              </span>
              {!readOnly ? (
                <ReasonDialog
                  trigger={
                    <Button variant="destructive" size="sm" className="ml-auto">
                      <UserMinus aria-hidden />
                      {t('end')}
                    </Button>
                  }
                  title={t('endTitle')}
                  description={t('endDescription')}
                  confirmLabel={t('endConfirm')}
                  destructive
                  reasonLabel={t('endReason')}
                  action={(reason) => endAction({ careTeamMemberId: m.careTeamMemberId, reason })}
                  onDone={() => router.refresh()}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      {!onTeam && !readOnly ? (
        <AssignSelf
          patientId={patient.patientId}
          membershipId={myMembershipId}
          action={assignAction}
        />
      ) : null}
    </Card>
  );
}
