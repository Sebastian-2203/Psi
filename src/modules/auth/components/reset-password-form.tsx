'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { resetPasswordSchema, type ResetPasswordInput } from '@/modules/auth/schemas';
import type { ActionError, RedirectingAction } from '@/modules/auth/schemas/result';
import { applyFieldErrors, FormError, FormField, useValidationMessage } from './form-parts';

export function ResetPasswordForm({ action }: { action: RedirectingAction<ResetPasswordInput> }) {
  const t = useTranslations('auth.resetPassword');
  const v = useValidationMessage();
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const result = await action(values);
    if (result && !result.ok) {
      applyFieldErrors(result.error, form.setError, ['password']);
      setServerError(result.error);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError error={serverError} />
      <FormField
        label={t('password')}
        type="password"
        autoComplete="new-password"
        hint={t('passwordHint')}
        error={v(errors.password?.message)}
        {...form.register('password')}
      />
      <FormField
        label={t('confirmPassword')}
        type="password"
        autoComplete="new-password"
        error={v(errors.confirmPassword?.message)}
        {...form.register('confirmPassword')}
      />
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t('submit')}
      </Button>
    </form>
  );
}
