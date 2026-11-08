'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { recoveryCodeSchema, type RecoveryCodeInput } from '@/modules/auth/schemas';
import type { ActionError, RedirectingAction } from '@/modules/auth/schemas/result';
import { FormError, FormField, useValidationMessage } from './form-parts';

export function RecoveryCodeForm({ action }: { action: RedirectingAction<RecoveryCodeInput> }) {
  const t = useTranslations('auth.mfa');
  const v = useValidationMessage();
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const form = useForm<RecoveryCodeInput>({
    resolver: zodResolver(recoveryCodeSchema),
    defaultValues: { code: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const result = await action(values);
    if (result && !result.ok) {
      form.reset({ code: '' });
      setServerError(result.error);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError error={serverError} />
      <FormField
        label={t('recoveryCode')}
        hint={t('recoveryCodeHint')}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        error={v(errors.code?.message)}
        {...form.register('code')}
      />
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t('recoverySubmit')}
      </Button>
    </form>
  );
}
