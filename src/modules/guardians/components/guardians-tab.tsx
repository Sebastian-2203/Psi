'use client';

import { UserPlus, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import {
  CheckField,
  FormError,
  FormField,
  SelectField,
  applyFieldErrors,
  compact,
  schemaResolver,
  useValidationMessage,
} from '@/components/shared/form-kit';
import { EmptyState } from '@/components/shared/empty-state';
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
import { DOCUMENT_TYPES } from '@/lib/validation';
import { useRouter } from '@/i18n/navigation';
import type { ActionError } from '@/modules/auth/schemas/result';
import {
  GUARDIAN_RELATIONSHIPS,
  LEGAL_BASES,
  createGuardianSchema,
  type CreateGuardianInput,
} from '@/modules/guardians/schemas';
import { RelationshipCard } from './relationship-card';
import type { GuardianActions, GuardianRelationshipDto } from './types';

type Values = {
  patientId: string;
  firstName: string;
  lastName: string;
  relationship: string;
  isLegalRepresentative: boolean;
  legalBasis?: string;
  isPrimaryContact: boolean;
  documentType?: string;
  documentNumber: string;
  email: string;
  phone: string;
};
const FIELDS = [
  'firstName',
  'lastName',
  'relationship',
  'isLegalRepresentative',
  'legalBasis',
  'isPrimaryContact',
  'documentType',
  'documentNumber',
  'email',
  'phone',
] as const;

function CreateGuardianDialog({
  patientId,
  action,
}: {
  patientId: string;
  action: GuardianActions['create'];
}) {
  const t = useTranslations('guardians');
  const v = useValidationMessage();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const form = useForm<Values>({
    resolver: schemaResolver<Values>(createGuardianSchema, ['documentType', 'legalBasis']),
    defaultValues: {
      patientId,
      firstName: '',
      lastName: '',
      relationship: 'mother',
      isLegalRepresentative: false,
      legalBasis: '',
      isPrimaryContact: false,
      documentType: '',
      documentNumber: '',
      email: '',
      phone: '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const legal = useWatch({ control: form.control, name: 'isLegalRepresentative' });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const result = await action(
      compact({
        ...values,
        legalBasis: legal ? values.legalBasis : undefined,
      }) as CreateGuardianInput,
    );
    if (result.ok) {
      setOpen(false);
      form.reset();
      router.refresh();
    } else if (!applyFieldErrors(result.error, form.setError, FIELDS)) setServerError(result.error);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          {t('add')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('createTitle')}</DialogTitle>
          <DialogDescription>{t('createDescription')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <FormError error={serverError} />
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('fields.firstName')}
              error={v(errors.firstName?.message)}
              {...form.register('firstName')}
            />
            <FormField
              label={t('fields.lastName')}
              error={v(errors.lastName?.message)}
              {...form.register('lastName')}
            />
            <SelectField
              label={t('fields.relationship')}
              error={v(errors.relationship?.message)}
              {...form.register('relationship')}
            >
              {GUARDIAN_RELATIONSHIPS.map((r) => (
                <option key={r} value={r}>
                  {t(`relationships.${r}`)}
                </option>
              ))}
            </SelectField>
            <FormField
              label={t('fields.email')}
              type="email"
              error={v(errors.email?.message)}
              {...form.register('email')}
            />
            <FormField
              label={t('fields.phone')}
              type="tel"
              error={v(errors.phone?.message)}
              {...form.register('phone')}
            />
            <SelectField
              label={t('fields.documentType')}
              error={v(errors.documentType?.message)}
              {...form.register('documentType')}
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
              {...form.register('documentNumber')}
            />
          </div>
          <Controller
            control={form.control}
            name="isLegalRepresentative"
            render={({ field }) => (
              <CheckField
                label={t('fields.isLegalRepresentative')}
                hint={t('fields.isLegalRepresentativeHint')}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          {legal ? (
            <SelectField
              label={t('fields.legalBasis')}
              error={v(errors.legalBasis?.message)}
              {...form.register('legalBasis')}
            >
              <option value="">{t('fields.choose')}</option>
              {LEGAL_BASES.map((b) => (
                <option key={b} value={b}>
                  {t(`legalBases.${b}`)}
                </option>
              ))}
            </SelectField>
          ) : null}
          <Controller
            control={form.control}
            name="isPrimaryContact"
            render={({ field }) => (
              <CheckField
                label={t('fields.isPrimaryContact')}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
          <Button type="submit" loading={isSubmitting} className="self-start">
            {t('createSubmit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GuardiansTab({
  patientId,
  relationships,
  actions,
  readOnly,
  loadFailed,
}: {
  patientId: string;
  relationships: GuardianRelationshipDto[];
  actions: GuardianActions;
  readOnly: boolean;
  loadFailed?: boolean;
}) {
  const t = useTranslations('guardians');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-h3 font-bold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground">{t('description')}</p>
        </div>
        {!readOnly ? <CreateGuardianDialog patientId={patientId} action={actions.create} /> : null}
      </div>
      {loadFailed ? <Alert variant="error">{t('loadError')}</Alert> : null}
      {relationships.length === 0 && !loadFailed ? (
        <EmptyState icon={Users} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        relationships.map((rel) => (
          <RelationshipCard key={rel.patientGuardianId} rel={rel} actions={actions} />
        ))
      )}
    </div>
  );
}
