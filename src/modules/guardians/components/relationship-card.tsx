'use client';

import { BadgeCheck, Ban, Pause, Play, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  CheckField,
  FormError,
  FormField,
  TextAreaField,
  useValidationMessage,
} from '@/components/shared/form-kit';
import { InviteDialog } from '@/components/shared/invite-dialog';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
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
import { PermissionsChecklist } from './permissions-checklist';
import type { GuardianActions, GuardianRelationshipDto } from './types';

const STATUS_VARIANT = {
  pending_verification: 'warning',
  active: 'success',
  suspended: 'neutral',
  revoked: 'outline',
} as const;

function VerifyDialog({
  rel,
  action,
  onDone,
}: {
  rel: GuardianRelationshipDto;
  action: GuardianActions['verify'];
  onDone: () => void;
}) {
  const t = useTranslations('guardians.verify');
  const tc = useTranslations('common');
  const v = useValidationMessage();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [from, setFrom] = useState('');
  const [until, setUntil] = useState('');
  const [legal, setLegal] = useState(rel.isLegalRepresentative);
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (from && until && until < from) {
      setFieldError(v('dateInvalid'));
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    const result = await action({
      patientGuardianId: rel.patientGuardianId,
      verifyLegalBasis: legal,
      ...(note.trim() ? { verificationNote: note.trim() } : {}),
      ...(from ? { validFrom: from } : {}),
      ...(until ? { validUntil: until } : {}),
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      onDone();
    } else setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <BadgeCheck aria-hidden />
          {t('trigger')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title', { name: `${rel.firstName} ${rel.lastName}` })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <TextAreaField
          label={t('note')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('validFrom')}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <FormField
            label={t('validUntil')}
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            error={fieldError}
          />
        </div>
        {rel.isLegalRepresentative ? (
          <CheckField
            label={t('verifyLegalBasis')}
            hint={t('verifyLegalBasisHint')}
            checked={legal}
            onCheckedChange={setLegal}
          />
        ) : null}
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

function CaveatDialog({
  rel,
  actions,
  onDone,
}: {
  rel: GuardianRelationshipDto;
  actions: Pick<GuardianActions, 'setCaveat' | 'endCaveat'>;
  onDone: () => void;
}) {
  const t = useTranslations('guardians.caveat');
  const tc = useTranslations('common');
  const v = useValidationMessage();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(rel.caveat?.text ?? '');
  const [restrict, setRestrict] = useState(rel.caveat?.restrictSchedule ?? false);
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    if (text.trim().length < 3) {
      setFieldError(v(text.trim() ? 'fieldTooShort' : 'fieldRequired'));
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    const result = await actions.setCaveat({
      patientGuardianId: rel.patientGuardianId,
      caveat: text.trim(),
      restrictSchedule: restrict,
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      onDone();
    } else setError(result.error);
  }
  async function end() {
    setBusy(true);
    const result = await actions.endCaveat({ patientGuardianId: rel.patientGuardianId });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      onDone();
    } else setError(result.error);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ShieldAlert aria-hidden />
          {rel.caveat ? t('edit') : t('add')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <TextAreaField
          label={t('text')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={fieldError}
          maxLength={1000}
        />
        <CheckField
          label={t('restrictSchedule')}
          hint={t('restrictScheduleHint')}
          checked={restrict}
          onCheckedChange={setRestrict}
        />
        <div className="flex flex-wrap justify-end gap-2">
          {rel.caveat ? (
            <Button variant="destructive" onClick={end} loading={busy}>
              {t('end')}
            </Button>
          ) : null}
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

/** One guardian relationship: state, legal-representation status, caveat, lifecycle actions, permissions. */
export function RelationshipCard({
  rel,
  actions,
}: {
  rel: GuardianRelationshipDto;
  actions: GuardianActions;
}) {
  const t = useTranslations('guardians');
  const router = useRouter();
  const refresh = () => router.refresh();
  const name = `${rel.firstName} ${rel.lastName}`;
  const ended = rel.status === 'revoked';
  const majority = rel.suspensionReason === 'age_of_majority';

  return (
    <Card data-testid={`guardian-${rel.patientGuardianId}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{name}</CardTitle>
          <Badge variant={STATUS_VARIANT[rel.status]}>{t(`status.${rel.status}`)}</Badge>
          {rel.isPrimaryContact ? <Badge variant="neutral">{t('primaryContact')}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {t(`relationships.${rel.relationship}` as never)}
          {rel.isLegalRepresentative
            ? ` · ${rel.legalBasisVerified ? t('legal.verified') : t('legal.unverified')}`
            : ` · ${t('legal.notLegal')}`}
          {rel.suspensionReason
            ? ` · ${t(`suspensionReasons.${rel.suspensionReason}` as never)}`
            : ''}
        </p>
      </CardHeader>

      {rel.caveat ? (
        <Alert variant="warning">
          <p className="font-bold">{t('caveat.label')}</p>
          <p>{rel.caveat.text}</p>
          {rel.caveat.restrictSchedule ? <p>{t('caveat.scheduleRestricted')}</p> : null}
          <p className="text-xs">{t('caveat.careTeamOnly')}</p>
        </Alert>
      ) : null}

      {!ended ? (
        <div className="flex flex-wrap gap-2">
          {rel.status === 'pending_verification' ? (
            <VerifyDialog rel={rel} action={actions.verify} onDone={refresh} />
          ) : null}
          {rel.status === 'active' ? (
            <ReasonDialog
              trigger={
                <Button variant="outline">
                  <Pause aria-hidden />
                  {t('suspend.trigger')}
                </Button>
              }
              title={t('suspend.title', { name })}
              description={t('suspend.description')}
              confirmLabel={t('suspend.confirm')}
              reasonLabel={t('suspend.reason')}
              options={(['custody_review', 'safety_concern', 'other'] as const).map((r) => ({
                value: r,
                label: t(`suspensionReasons.${r}`),
              }))}
              action={(reason) =>
                actions.suspend({
                  patientGuardianId: rel.patientGuardianId,
                  reason: reason as 'custody_review' | 'safety_concern' | 'other',
                })
              }
              onDone={refresh}
            />
          ) : null}
          {rel.status === 'suspended' && !majority ? (
            <Button
              variant="outline"
              onClick={async () => {
                const r = await actions.reactivate({ patientGuardianId: rel.patientGuardianId });
                if (r.ok) refresh();
              }}
            >
              <Play aria-hidden />
              {t('reactivate')}
            </Button>
          ) : null}
          <CaveatDialog rel={rel} actions={actions} onDone={refresh} />
          {!rel.hasPortalLogin ? (
            <InviteDialog
              title={t('invite.title', { name })}
              description={t('invite.description')}
              triggerLabel={t('invite.trigger')}
              defaultEmail={rel.email}
              action={(v) => actions.invite({ patientGuardianId: rel.patientGuardianId, ...v })}
            />
          ) : (
            <span className="inline-flex items-center text-sm text-muted-foreground">
              {t('invite.hasLogin')}
            </span>
          )}
          <ReasonDialog
            trigger={
              <Button variant="destructive">
                <Ban aria-hidden />
                {t('revoke.trigger')}
              </Button>
            }
            title={t('revoke.title', { name })}
            description={t('revoke.description')}
            confirmLabel={t('revoke.confirm')}
            destructive
            reasonLabel={t('revoke.reason')}
            action={(reason) =>
              actions.revoke({ patientGuardianId: rel.patientGuardianId, reason })
            }
            onDone={refresh}
          />
        </div>
      ) : null}

      {!ended ? <PermissionsChecklist relationship={rel} action={actions.setPermissions} /> : null}
    </Card>
  );
}
