'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Mail } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { emailField, localeField } from '@/lib/validation';
import type { ActionError, ActionResult } from '@/modules/auth/schemas/result';
import {
  FormError,
  FormField,
  SelectField,
  applyFieldErrors,
  useValidationMessage,
} from './form-kit';

const schema = z.object({ email: emailField, emailLocale: localeField });
type Values = z.input<typeof schema>;

/** Invite someone to the portal by email (patient or guardian). The link is emailed, never shown. */
export function InviteDialog({
  title,
  description,
  defaultEmail,
  triggerLabel,
  action,
}: {
  title: string;
  description: string;
  defaultEmail?: string | null;
  triggerLabel: string;
  action: (input: { email: string; emailLocale: 'es' | 'en' }) => Promise<ActionResult<unknown>>;
}) {
  const t = useTranslations('portalInvite');
  const tl = useTranslations('locale');
  const v = useValidationMessage();
  const locale = useLocale() === 'en' ? 'en' : 'es';
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: defaultEmail ?? '', emailLocale: locale },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const result = await action({ email: values.email, emailLocale: values.emailLocale });
    if (result.ok) setSent(true);
    else if (!applyFieldErrors(result.error, form.setError, ['email', 'emailLocale']))
      setServerError(result.error);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setSent(false);
          setServerError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <Mail aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {sent ? (
          <Alert variant="success">{t('sent')}</Alert>
        ) : (
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <FormError error={serverError} />
            <FormField
              label={t('email')}
              type="email"
              autoComplete="off"
              error={v(errors.email?.message)}
              {...form.register('email')}
            />
            <SelectField
              label={t('emailLocale')}
              error={v(errors.emailLocale?.message)}
              {...form.register('emailLocale')}
            >
              <option value="es">{tl('es')}</option>
              <option value="en">{tl('en')}</option>
            </SelectField>
            <Button type="submit" loading={isSubmitting} className="self-start">
              {t('send')}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
