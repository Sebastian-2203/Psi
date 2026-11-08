'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { totpCodeSchema, type VerifyEnrollmentInput } from '@/modules/auth/schemas';
import type { ActionError, ActionResult, RedirectingAction } from '@/modules/auth/schemas/result';
import { FormError, FormField, useValidationMessage } from './form-parts';
import { otpInputProps } from './mfa-challenge-form';

type Enrollment = { factorId: string; qrCode: string; secret: string };

const formSchema = z.object({ code: totpCodeSchema });
type FormValues = z.input<typeof formSchema>;

/** Only Supabase Auth's SVG data URI is rendered, and only inside <img> (no inline markup). */
function isSvgDataUri(value: string): boolean {
  return value.startsWith('data:image/svg+xml;');
}

export function MfaEnroll({
  startAction,
  verifyAction,
}: {
  startAction: () => Promise<ActionResult<Enrollment>>;
  verifyAction: RedirectingAction<VerifyEnrollmentInput>;
}) {
  const t = useTranslations('auth.mfa');
  const v = useValidationMessage();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [starting, setStarting] = useState(false);
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { code: '' },
  });
  const { errors, isSubmitting } = form.formState;

  async function start() {
    setStarting(true);
    setServerError(null);
    const result = await startAction();
    setStarting(false);
    if (result.ok) {
      setEnrollment(result.data);
      form.reset({ code: '' });
    } else {
      setServerError(result.error);
    }
  }

  const onSubmit = form.handleSubmit(async ({ code }) => {
    if (!enrollment) return;
    setServerError(null);
    const result = await verifyAction({ factorId: enrollment.factorId, code });
    if (result && !result.ok) {
      form.reset({ code: '' });
      setServerError(result.error);
      if (result.error.code === 'PRECONDITION_FAILED') setEnrollment(null);
      else form.setFocus('code');
    }
  });

  if (!enrollment) {
    return (
      <div className="flex flex-col gap-4">
        <FormError error={serverError} />
        <Button type="button" className="w-full" onClick={start} loading={starting}>
          {t('enrollStart')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormError error={serverError} />
      <p>{t('enrollStep1')}</p>
      {isSvgDataUri(enrollment.qrCode) ? (
        // eslint-disable-next-line @next/next/no-img-element -- data URI from Supabase Auth; next/image cannot optimize it.
        <img
          src={enrollment.qrCode}
          alt={t('qrAlt')}
          width={192}
          height={192}
          className="self-center rounded-md border bg-white p-2"
        />
      ) : null}
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{t('manualKeyLabel')}</p>
        <code
          className="rounded-md bg-muted px-3 py-2 text-center font-mono text-sm break-all select-all"
          data-testid="totp-secret"
        >
          {enrollment.secret}
        </code>
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <p>{t('enrollStep2')}</p>
        <FormField
          label={t('code')}
          hint={t('codeHint')}
          error={v(errors.code?.message)}
          {...otpInputProps}
          {...form.register('code')}
        />
        <Button type="submit" className="w-full" loading={isSubmitting}>
          {t('enrollVerify')}
        </Button>
        <Button type="button" variant="link" onClick={start} disabled={starting}>
          {t('enrollRestart')}
        </Button>
      </form>
    </div>
  );
}
