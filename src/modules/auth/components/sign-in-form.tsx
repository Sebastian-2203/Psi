'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Link } from '@/i18n/navigation';
import { signInSchema, type SignInInput } from '@/modules/auth/schemas';
import type { ActionError, RedirectingAction } from '@/modules/auth/schemas/result';
import { applyFieldErrors, FormError, FormField, useValidationMessage } from './form-parts';

const formSchema = signInSchema.pick({ email: true, password: true });
type FormValues = z.input<typeof formSchema>;

export function SignInForm({
  action,
  next,
}: {
  action: RedirectingAction<SignInInput>;
  next?: string;
}) {
  const t = useTranslations('auth.signIn');
  const v = useValidationMessage();
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const result = await action({ ...values, ...(next ? { next } : {}) });
    if (result && !result.ok) {
      // Generic message for any credential problem (no account enumeration).
      form.resetField('password');
      if (!applyFieldErrors(result.error, form.setError, ['email', 'password'])) {
        setServerError(result.error);
      }
    }
  });

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
      <FormField
        label={t('password')}
        type="password"
        autoComplete="current-password"
        error={v(errors.password?.message)}
        {...form.register('password')}
      />
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {isSubmitting ? t('submitting') : t('submit')}
      </Button>
      <Link
        href="/forgot-password"
        className="self-center text-sm font-semibold text-primary underline underline-offset-4"
      >
        {t('forgotPassword')}
      </Link>
    </form>
  );
}
