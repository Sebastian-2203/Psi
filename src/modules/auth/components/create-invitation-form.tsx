'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  createInvitationSchema,
  STAFF_ROLES,
  type CreateInvitationInput,
} from '@/modules/auth/schemas';
import type { ActionError, ActionResult } from '@/modules/auth/schemas/result';
import {
  applyFieldErrors,
  FormError,
  FormField,
  FormNotice,
  useValidationMessage,
} from './form-parts';

export function CreateInvitationForm({
  action,
}: {
  action: (
    input: CreateInvitationInput,
  ) => Promise<ActionResult<{ invitationId: string; expiresAt: string }>>;
}) {
  const t = useTranslations('auth.settings');
  const tl = useTranslations('locale');
  const v = useValidationMessage();
  const locale = useLocale() === 'en' ? 'en' : 'es';
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const [created, setCreated] = useState(false);
  const form = useForm<CreateInvitationInput>({
    resolver: zodResolver(createInvitationSchema),
    defaultValues: { email: '', roles: ['psychologist'], emailLocale: locale },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    setCreated(false);
    const result = await action(values);
    if (result.ok) {
      setCreated(true);
      form.reset({ email: '', roles: ['psychologist'], emailLocale: values.emailLocale });
    } else if (!applyFieldErrors(result.error, form.setError, ['email', 'roles'])) {
      setServerError(result.error);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError error={serverError} />
      {created ? (
        <div aria-live="polite">
          <FormNotice variant="success">{t('created')}</FormNotice>
        </div>
      ) : null}
      <FormField
        label={t('email')}
        type="email"
        autoComplete="off"
        error={v(errors.email?.message)}
        {...form.register('email')}
      />
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={errors.roles ? 'invitation-roles-error' : undefined}
      >
        <legend className="mb-1 text-sm font-semibold">{t('roles')}</legend>
        <Controller
          control={form.control}
          name="roles"
          render={({ field }) => (
            <>
              {STAFF_ROLES.map((role) => {
                const id = `invitation-role-${role}`;
                const checked = field.value.includes(role);
                return (
                  <div key={role} className="flex items-center gap-2">
                    <Checkbox
                      id={id}
                      checked={checked}
                      onCheckedChange={(next) =>
                        field.onChange(
                          next === true
                            ? [...field.value, role]
                            : field.value.filter((r) => r !== role),
                        )
                      }
                    />
                    <Label htmlFor={id} className="font-normal">
                      {role === 'organization_owner' ? t('roleOwner') : t('rolePsychologist')}
                    </Label>
                  </div>
                );
              })}
            </>
          )}
        />
        {errors.roles ? (
          <p id="invitation-roles-error" className="text-sm font-semibold text-destructive">
            {v(errors.roles.message ?? errors.roles.root?.message ?? 'rolesRequired')}
          </p>
        ) : null}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invitation-email-locale">{t('emailLocale')}</Label>
        <select
          id="invitation-email-locale"
          className="h-(--control-h) rounded-md border border-input bg-card px-3 text-base"
          {...form.register('emailLocale')}
        >
          <option value="es">{tl('es')}</option>
          <option value="en">{tl('en')}</option>
        </select>
      </div>
      <Button type="submit" loading={isSubmitting} className="self-start">
        {t('submit')}
      </Button>
    </form>
  );
}
