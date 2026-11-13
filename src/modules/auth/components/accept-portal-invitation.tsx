'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { LoadingState } from '@/components/shared/loading-state';
import { Button } from '@/components/ui/button';
import {
  acceptPortalInvitationSchema,
  type AcceptPortalInvitationInput,
} from '@/modules/auth/schemas';
import type { ActionError, ActionResult, RedirectingAction } from '@/modules/auth/schemas/result';
import { takeTokenFromFragment } from './accept-invitation';
import {
  applyFieldErrors,
  FormError,
  FormField,
  FormNotice,
  useValidationMessage,
} from './form-parts';

type Preview = { organizationName: string; email: string; kind: 'patient' | 'guardian' };

const formSchema = acceptPortalInvitationSchema.omit({ token: true });
type FormValues = { displayName: string; password: string };

/**
 * Patient / guardian invitation acceptance. The token comes from the URL fragment (moved into
 * POST bodies only); `kind` in the fragment is a routing hint, the server-side preview decides.
 */
export function AcceptPortalInvitation({
  previewAction,
  acceptAction,
}: {
  previewAction: (input: { token: string }) => Promise<ActionResult<Preview>>;
  acceptAction: RedirectingAction<AcceptPortalInvitationInput>;
}) {
  const t = useTranslations('auth.portalInvitation');
  const v = useValidationMessage();
  const [state, setState] = useState<'loading' | 'invalid' | 'ready'>('loading');
  const [preview, setPreview] = useState<(Preview & { token: string }) | null>(null);
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as never,
    defaultValues: { displayName: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const token = takeTokenFromFragment();
      const result = token ? await previewAction({ token }) : null;
      if (cancelled) return;
      if (token && result?.ok) {
        setPreview({ ...result.data, token });
        setState('ready');
      } else setState('invalid');
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [previewAction]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!preview) return;
    setServerError(null);
    const result = await acceptAction({ token: preview.token, ...values });
    if (result && !result.ok) {
      form.resetField('password');
      applyFieldErrors(result.error, form.setError, ['displayName', 'password']);
      setServerError(result.error);
    }
  });

  if (state === 'loading') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">{t('loading')}</p>
        <LoadingState rows={2} />
      </div>
    );
  }
  if (state === 'invalid' || !preview) {
    return (
      <FormNotice variant="warning">
        <p className="font-bold">{t('invalidTitle')}</p>
        <p>{t('invalidBody')}</p>
      </FormNotice>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p>
        {t(preview.kind === 'guardian' ? 'introGuardian' : 'introPatient', {
          organization: preview.organizationName,
        })}
      </p>
      <FormError error={serverError} />
      <FormField
        label={t('email')}
        type="email"
        value={preview.email}
        readOnly
        autoComplete="username"
      />
      <FormField
        label={t('displayName')}
        autoComplete="name"
        error={v(errors.displayName?.message)}
        {...form.register('displayName')}
      />
      <FormField
        label={t('password')}
        type="password"
        autoComplete="new-password"
        hint={t('passwordHint')}
        error={v(errors.password?.message)}
        {...form.register('password')}
      />
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t('submit')}
      </Button>
    </form>
  );
}
