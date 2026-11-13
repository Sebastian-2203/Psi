'use client';

import { CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  CheckField,
  FormError,
  FormField,
  useValidationMessage,
} from '@/components/shared/form-kit';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from '@/i18n/navigation';
import type { ActionError, ActionResult } from '@/modules/auth/schemas/result';
import { ConsentBodyView } from './consent-body';
import type { SignableConsentDto } from './types';

export type SignAction = (input: {
  patientId: string;
  versionId: string;
  decision: 'accepted' | 'declined';
  typedName: string;
  checkboxConfirmed: true;
  textHash: string;
}) => Promise<ActionResult<{ consentRecordId: string }>>;

const STATUS_VARIANT = { accepted: 'success', declined: 'neutral', withdrawn: 'warning' } as const;

function SignCard({ consent, action }: { consent: SignableConsent; action: SignAction }) {
  const t = useTranslations('consents.sign');
  const tt = useTranslations('consents');
  const v = useValidationMessage();
  const router = useRouter();
  const [typedName, setTypedName] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; check?: string }>({});
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState<'accepted' | 'declined' | null>(null);
  const [done, setDone] = useState<'accepted' | 'declined' | null>(null);
  const decided = consent.myStatus === 'accepted' || consent.myStatus === 'declined';

  async function submit(decision: 'accepted' | 'declined') {
    const name = typedName.trim();
    const next = {
      name: name.length < 2 ? v(name ? 'fieldTooShort' : 'fieldRequired') : undefined,
      check: confirmed ? undefined : v('fieldRequired'),
    };
    setErrors(next);
    setServerError(null);
    if (next.name || next.check) return;
    setBusy(decision);
    const result = await action({
      patientId: consent.patientId,
      versionId: consent.versionId,
      decision,
      typedName: name,
      checkboxConfirmed: true,
      // The hash the signer was shown; the server re-checks it against the published body.
      textHash: consent.bodyHash,
    });
    setBusy(null);
    if (result.ok) {
      setDone(decision);
      router.refresh();
    } else setServerError(result.error);
  }

  return (
    <Card data-testid={`consent-${consent.templateKey}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-display text-h2">{consent.title}</CardTitle>
          {consent.myStatus ? (
            <Badge variant={STATUS_VARIANT[consent.myStatus]}>
              {tt(`status.${consent.myStatus}`)}
            </Badge>
          ) : (
            <Badge variant="warning">{t('pending')}</Badge>
          )}
        </div>
      </CardHeader>
      <ConsentBodyView body={consent.body} fallback={t('unreadable')} />
      {done ? (
        <div aria-live="polite">
          <Alert variant="success">
            <CheckCircle2 className="sr-only" aria-hidden />
            {done === 'accepted' ? t('doneAccepted') : t('doneDeclined')}
          </Alert>
        </div>
      ) : decided ? (
        <p className="text-sm text-muted-foreground">{t('alreadyDecided')}</p>
      ) : (
        <form
          noValidate
          onSubmit={(e) => e.preventDefault()}
          className="flex max-w-xl flex-col gap-4 border-t pt-4"
        >
          <FormError error={serverError} />
          <FormField
            label={t('typedName')}
            hint={t('typedNameHint')}
            autoComplete="name"
            value={typedName}
            onChange={(e) => setTypedName(e.target.value)}
            error={errors.name}
          />
          <CheckField
            label={t('checkbox')}
            checked={confirmed}
            onCheckedChange={setConfirmed}
            error={errors.check}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => submit('accepted')}
              loading={busy === 'accepted'}
              disabled={busy !== null}
            >
              {t('accept')}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => submit('declined')}
              loading={busy === 'declined'}
              disabled={busy !== null}
            >
              {t('decline')}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

type SignableConsent = SignableConsentDto;

/** Signable consents for the active capacity. Sign = typed name + checkbox; sends the shown body hash. */
export function SignConsentList({
  consents,
  action,
}: {
  consents: SignableConsentDto[];
  action: SignAction;
}) {
  return (
    <div className="flex flex-col gap-6">
      {consents.map((c) => (
        <SignCard key={c.versionId} consent={c} action={action} />
      ))}
    </div>
  );
}
