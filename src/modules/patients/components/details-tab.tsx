'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  FormError,
  FormField,
  SelectField,
  applyFieldErrors,
  setZodErrors,
  useValidationMessage,
} from '@/components/shared/form-kit';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { DOCUMENT_TYPES } from '@/lib/validation';
import type { ActionError } from '@/modules/auth/schemas/result';
import { useRouter } from '@/i18n/navigation';
import { updatePatientSchema, type UpdatePatientInput } from '@/modules/patients/schemas';
import type { Action, PatientDetailDto } from './types';

type Values = {
  firstName: string;
  lastName: string;
  preferredName: string;
  pronouns: string;
  dateOfBirth: string;
  documentType: string;
  documentNumber: string;
  email: string;
  phone: string;
  sex: string;
  genderIdentity: string;
  preferredLocale: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
};
const KEYS = [
  'firstName',
  'lastName',
  'preferredName',
  'pronouns',
  'dateOfBirth',
  'documentType',
  'documentNumber',
  'email',
  'phone',
  'sex',
  'genderIdentity',
  'preferredLocale',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;

export type UpdatePatientValues = { patientId: string; expectedUpdatedAt: string } & Partial<
  Record<(typeof KEYS)[number], string | null>
>;

function initial(p: PatientDetailDto): Values {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    preferredName: p.preferredName ?? '',
    pronouns: p.pronouns ?? '',
    dateOfBirth: p.dateOfBirth,
    documentType: p.documentType ?? '',
    documentNumber: p.documentNumber ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
    sex: p.sex ?? '',
    genderIdentity: p.genderIdentity ?? '',
    preferredLocale: p.preferredLocale ?? '',
    emergencyContactName: p.emergencyContactName ?? '',
    emergencyContactPhone: p.emergencyContactPhone ?? '',
  };
}

/**
 * Details with optimistic concurrency: `expectedUpdatedAt` is the loaded row version. A CONFLICT
 * (someone else saved first) offers a reload instead of overwriting. Only changed fields are sent.
 */
export function DetailsTab({
  patient,
  action,
  readOnly,
}: {
  patient: PatientDetailDto;
  action: Action<UpdatePatientInput, { updatedAt: string }>;
  readOnly: boolean;
}) {
  const t = useTranslations('patients');
  const tl = useTranslations('locale');
  const v = useValidationMessage();
  const router = useRouter();
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm<Values>({
    defaultValues: initial(patient),
  });
  const { errors, isSubmitting, dirtyFields } = form.formState;
  const reg = form.register;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    setSaved(false);
    const changed: UpdatePatientValues = {
      patientId: patient.patientId,
      expectedUpdatedAt: patient.updatedAt,
    };
    for (const k of KEYS) {
      if (dirtyFields[k]) changed[k] = values[k];
    }
    if (KEYS.every((k) => changed[k] === undefined)) {
      setServerError({
        code: 'VALIDATION_FAILED',
        messageKey: 'validation.nothingToUpdate',
        requestId: '-',
        retryable: false,
      });
      return;
    }
    const parsed = updatePatientSchema.safeParse(changed);
    if (!parsed.success) {
      setZodErrors(parsed.error, form.setError, KEYS);
      return;
    }
    const result = await action(changed as UpdatePatientInput);
    if (result.ok) {
      setSaved(true);
      router.refresh();
    } else if (!applyFieldErrors(result.error, form.setError, KEYS)) setServerError(result.error);
    else setServerError(null);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('tabs.details')}</CardTitle>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <FormError error={serverError} />
        {serverError?.code === 'CONFLICT' ? (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => router.refresh()}
          >
            {t('reload')}
          </Button>
        ) : null}
        {saved ? <Alert variant="success">{t('saved')}</Alert> : null}
        <fieldset disabled={readOnly} className="grid gap-4 sm:grid-cols-2">
          <FormField
            label={t('fields.firstName')}
            error={v(errors.firstName?.message)}
            {...reg('firstName')}
          />
          <FormField
            label={t('fields.lastName')}
            error={v(errors.lastName?.message)}
            {...reg('lastName')}
          />
          <FormField
            label={t('fields.preferredName')}
            error={v(errors.preferredName?.message)}
            {...reg('preferredName')}
          />
          <FormField
            label={t('fields.pronouns')}
            error={v(errors.pronouns?.message)}
            {...reg('pronouns')}
          />
          <FormField
            label={t('fields.dateOfBirth')}
            type="date"
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
            error={v(errors.documentNumber?.message)}
            {...reg('documentNumber')}
          />
          <FormField
            label={t('fields.email')}
            type="email"
            error={v(errors.email?.message)}
            {...reg('email')}
          />
          <FormField
            label={t('fields.phone')}
            type="tel"
            error={v(errors.phone?.message)}
            {...reg('phone')}
          />
          <FormField label={t('fields.sex')} error={v(errors.sex?.message)} {...reg('sex')} />
          <FormField
            label={t('fields.genderIdentity')}
            error={v(errors.genderIdentity?.message)}
            {...reg('genderIdentity')}
          />
          <SelectField
            label={t('fields.preferredLocale')}
            error={v(errors.preferredLocale?.message)}
            {...reg('preferredLocale')}
          >
            <option value="">{t('fields.none')}</option>
            <option value="es">{tl('es')}</option>
            <option value="en">{tl('en')}</option>
          </SelectField>
          <FormField
            label={t('fields.emergencyContactName')}
            error={v(errors.emergencyContactName?.message)}
            {...reg('emergencyContactName')}
          />
          <FormField
            label={t('fields.emergencyContactPhone')}
            type="tel"
            error={v(errors.emergencyContactPhone?.message)}
            {...reg('emergencyContactPhone')}
          />
        </fieldset>
        {readOnly ? (
          <p className="text-sm text-muted-foreground">{t('readOnlyNote')}</p>
        ) : (
          <Button type="submit" loading={isSubmitting} className="self-start">
            {t('save')}
          </Button>
        )}
      </form>
    </Card>
  );
}
