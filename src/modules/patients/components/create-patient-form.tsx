'use client';

import { TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  FormError,
  FormField,
  SelectField,
  applyFieldErrors,
  compact,
  schemaResolver,
  useMessage,
  useValidationMessage,
} from '@/components/shared/form-kit';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/i18n/navigation';
import type { ActionError } from '@/modules/auth/schemas/result';
import { createPatientSchema } from '@/modules/patients/schemas';
import { DOCUMENT_TYPES } from '@/lib/validation';
import type { Action, CreatePatientValues } from './types';

type FormValues = {
  firstName: string;
  lastName: string;
  preferredName: string;
  dateOfBirth: string;
  documentType?: string;
  documentNumber: string;
  email: string;
  phone: string;
  preferredLocale: string;
};

const FIELDS = [
  'firstName',
  'lastName',
  'preferredName',
  'dateOfBirth',
  'documentType',
  'documentNumber',
  'email',
  'phone',
  'preferredLocale',
] as const;

/**
 * Create a patient (adult or minor: the age is derived by the server from the date of birth).
 * PAT-07 duplicate flow: the first submit may come back with `possibleDuplicate`; the professional
 * then reviews or confirms explicitly (second submit with `confirmDuplicate`).
 */
export function CreatePatientForm({
  action,
}: {
  action: Action<CreatePatientValues, { patientId: string }>;
}) {
  const t = useTranslations('patients');
  const tl = useTranslations('locale');
  const message = useMessage();
  const v = useValidationMessage();
  const router = useRouter();
  const locale = useLocale();
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const [duplicate, setDuplicate] = useState<string[] | null>(null);
  const form = useForm<FormValues>({
    resolver: schemaResolver<FormValues>(createPatientSchema, ['documentType']),
    defaultValues: {
      firstName: '',
      lastName: '',
      preferredName: '',
      dateOfBirth: '',
      documentType: '',
      documentNumber: '',
      email: '',
      phone: '',
      preferredLocale: locale === 'en' ? 'en' : 'es',
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function submit(values: FormValues, confirmDuplicate: boolean) {
    setServerError(null);
    const payload = compact({ ...values }) as CreatePatientValues;
    const result = await action(
      confirmDuplicate ? { ...payload, confirmDuplicate: true } : payload,
    );
    if (result.ok) {
      router.push(`/patients/${result.data.patientId}`);
      return;
    }
    if (result.error.messageKey === 'patients.errors.possibleDuplicate') {
      setDuplicate(result.error.fieldErrors?.duplicate ?? []);
      return;
    }
    setDuplicate(null);
    if (!applyFieldErrors(result.error, form.setError, FIELDS)) setServerError(result.error);
  }

  const onSubmit = form.handleSubmit((values) => submit(values, false));
  const confirm = form.handleSubmit((values) => submit(values, true));
  const reg = form.register;

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-4">
      <FormError error={serverError} />
      {duplicate ? (
        <Alert variant="warning" data-testid="duplicate-warning">
          <AlertTitle className="flex items-center gap-2">
            <TriangleAlert className="size-4" aria-hidden />
            {t('duplicate.title')}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <p>{message('patients.errors.possibleDuplicate')}</p>
            <ul className="list-disc pl-5">
              {duplicate.map((k) => (
                <li key={k}>{t(k === 'document' ? 'duplicate.document' : 'duplicate.nameDob')}</li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setDuplicate(null)}>
                {t('duplicate.review')}
              </Button>
              <Button type="button" onClick={confirm} loading={isSubmitting}>
                {t('duplicate.confirm')}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label={t('fields.firstName')}
          autoComplete="off"
          error={v(errors.firstName?.message)}
          {...reg('firstName')}
        />
        <FormField
          label={t('fields.lastName')}
          autoComplete="off"
          error={v(errors.lastName?.message)}
          {...reg('lastName')}
        />
        <FormField
          label={t('fields.preferredName')}
          autoComplete="off"
          error={v(errors.preferredName?.message)}
          {...reg('preferredName')}
        />
        <FormField
          label={t('fields.dateOfBirth')}
          type="date"
          hint={t('fields.dateOfBirthHint')}
          error={v(errors.dateOfBirth?.message)}
          {...reg('dateOfBirth')}
        />
        <SelectField
          label={t('fields.documentType')}
          error={v(errors.documentType?.message)}
          {...reg('documentType')}
        >
          <option value="">{t('fields.none')}</option>
          {DOCUMENT_TYPES.map((d) => (
            <option key={d} value={d}>
              {t(`documentTypes.${d}`)}
            </option>
          ))}
        </SelectField>
        <FormField
          label={t('fields.documentNumber')}
          autoComplete="off"
          error={v(errors.documentNumber?.message)}
          {...reg('documentNumber')}
        />
        <FormField
          label={t('fields.email')}
          type="email"
          autoComplete="off"
          error={v(errors.email?.message)}
          {...reg('email')}
        />
        <FormField
          label={t('fields.phone')}
          type="tel"
          autoComplete="off"
          error={v(errors.phone?.message)}
          {...reg('phone')}
        />
        <SelectField
          label={t('fields.preferredLocale')}
          error={v(errors.preferredLocale?.message)}
          {...reg('preferredLocale')}
        >
          <option value="es">{tl('es')}</option>
          <option value="en">{tl('en')}</option>
        </SelectField>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={isSubmitting && !duplicate}>
          {t('createSubmit')}
        </Button>
      </div>
    </form>
  );
}
