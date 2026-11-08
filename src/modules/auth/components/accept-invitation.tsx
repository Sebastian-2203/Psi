'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/shared/loading-state';
import {
  acceptInvitationSchema,
  professionalFieldsSchema,
  type AcceptInvitationInput,
} from '@/modules/auth/schemas';
import type { ActionError, ActionResult, RedirectingAction } from '@/modules/auth/schemas/result';
import {
  applyFieldErrors,
  FormError,
  FormField,
  FormNotice,
  useValidationMessage,
} from './form-parts';

type Preview = {
  organizationName: string;
  email: string;
  roles: Array<'organization_owner' | 'psychologist'>;
  requiresProfessionalProfile: boolean;
};

const baseSchema = acceptInvitationSchema.omit({ token: true, professional: true });
const withProfessional = baseSchema.extend({ professional: professionalFieldsSchema });
type FormValues = z.input<typeof withProfessional>;

/** Survives React Strict Mode's effect double-invocation (the fragment is cleared on first read). */
let fragmentToken: string | null = null;

/**
 * Reads the token from the URL FRAGMENT (never sent to the server, logs or Referer), removes
 * it from the address bar immediately and only sends it in server-action POST bodies
 * (SECURITY.md §3.8 point 5).
 */
function takeTokenFromFragment(): string | null {
  if (window.location.hash) {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
    fragmentToken = token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return fragmentToken;
}

export function AcceptInvitation({
  previewAction,
  acceptAction,
}: {
  previewAction: (input: { token: string }) => Promise<ActionResult<Preview>>;
  acceptAction: RedirectingAction<AcceptInvitationInput>;
}) {
  const t = useTranslations('auth.invitation');
  const v = useValidationMessage();
  const [state, setState] = useState<'loading' | 'invalid' | 'ready'>('loading');
  const [preview, setPreview] = useState<(Preview & { token: string }) | null>(null);
  const [serverError, setServerError] = useState<ActionError | null>(null);

  const requiresProfessional = preview?.requiresProfessionalProfile ?? false;
  const form = useForm<FormValues>({
    resolver: zodResolver(requiresProfessional ? withProfessional : baseSchema) as never,
    defaultValues: {
      displayName: '',
      password: '',
      professional: { title: '', licenseNumber: '', licenseIssuer: '' },
    },
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
      } else {
        setState('invalid');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [previewAction]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!preview) return;
    setServerError(null);
    const result = await acceptAction({
      token: preview.token,
      displayName: values.displayName,
      password: values.password,
      ...(requiresProfessional ? { professional: values.professional } : {}),
    });
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

  const roleNames = preview.roles.map((r) =>
    r === 'organization_owner' ? t('roleOwner') : t('rolePsychologist'),
  );
  const roles =
    roleNames.length === 2
      ? t('rolesJoin', { first: roleNames[0] ?? '', second: roleNames[1] ?? '' })
      : (roleNames[0] ?? '');

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <p>{t('intro', { organization: preview.organizationName, roles })}</p>
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
      {requiresProfessional ? (
        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 font-bold">{t('professionalLegend')}</legend>
          <FormField
            label={t('professionalTitle')}
            error={v(errors.professional?.title?.message)}
            {...form.register('professional.title')}
          />
          <FormField
            label={t('licenseNumber')}
            error={v(errors.professional?.licenseNumber?.message)}
            {...form.register('professional.licenseNumber')}
          />
          <FormField
            label={t('licenseIssuer')}
            error={v(errors.professional?.licenseIssuer?.message)}
            {...form.register('professional.licenseIssuer')}
          />
        </fieldset>
      ) : null}
      <Button type="submit" className="w-full" loading={isSubmitting}>
        {t('submit')}
      </Button>
    </form>
  );
}
