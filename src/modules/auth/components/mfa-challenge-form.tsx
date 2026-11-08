'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { totpCodeSchema, type VerifyMfaInput } from '@/modules/auth/schemas';
import type { ActionError, RedirectingAction } from '@/modules/auth/schemas/result';
import { FormError, FormField, useValidationMessage } from './form-parts';

const formSchema = z.object({ code: totpCodeSchema });
type FormValues = z.input<typeof formSchema>;

/** One-time-code input: numeric keypad, OTP autofill, 6 digits. */
export const otpInputProps = {
  inputMode: 'numeric',
  autoComplete: 'one-time-code',
  pattern: '[0-9]*',
  maxLength: 6,
} as const;

export function MfaChallengeForm({
  action,
  next,
}: {
  action: RedirectingAction<VerifyMfaInput>;
  next?: string;
}) {
  const t = useTranslations('auth.mfa');
  const v = useValidationMessage();
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { code: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ code }) => {
    setServerError(null);
    const result = await action({ code, ...(next ? { next } : {}) });
    if (result && !result.ok) {
      form.reset({ code: '' });
      setServerError(result.error);
      form.setFocus('code');
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError error={serverError} />
      <FormField
        label={t('code')}
        hint={t('codeHint')}
        autoFocus
        error={v(errors.code?.message)}
        {...otpInputProps}
        {...form.register('code')}
      />
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t('submit')}
      </Button>
    </form>
  );
}
