'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { requestPasswordResetSchema, type RequestPasswordResetInput } from '@/modules/auth/schemas';
import type { ActionError, ActionResult } from '@/modules/auth/schemas/result';
import { FormError, FormField, FormNotice, useValidationMessage } from './form-parts';

export function ForgotPasswordForm({
  action,
}: {
  action: (input: RequestPasswordResetInput) => Promise<ActionResult<{ sent: true }>>;
}) {
  const t = useTranslations('auth.forgotPassword');
  const v = useValidationMessage();
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const [sent, setSent] = useState(false);
  const form = useForm<RequestPasswordResetInput>({
    resolver: zodResolver(requestPasswordResetSchema),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const result = await action(values);
    if (result.ok) setSent(true);
    else setServerError(result.error);
  });

  if (sent) {
    // Identical for known and unknown emails (SECURITY.md §3.5).
    return (
      <div aria-live="polite">
        <FormNotice variant="success">{t('sent')}</FormNotice>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError error={serverError} />
      <FormField
        label={t('email')}
        type="email"
        autoComplete="username"
        inputMode="email"
        error={v(errors.email?.message)}
        {...form.register('email')}
      />
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t('submit')}
      </Button>
    </form>
  );
}
