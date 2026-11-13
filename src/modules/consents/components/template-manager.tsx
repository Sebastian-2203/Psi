'use client';

import { CheckCircle2, FileText, Save, Send } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  CheckField,
  FormError,
  FormField,
  SelectField,
  applyFieldErrors,
  schemaResolver,
  useValidationMessage,
} from '@/components/shared/form-kit';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActionError } from '@/modules/auth/schemas/result';
import {
  CONSENT_TYPES,
  SIGNER_REQUIREMENTS,
  consentBodySchema,
  createConsentTemplateSchema,
  type CreateConsentTemplateInput,
} from '@/modules/consents/schemas';
import { BodyEditor, emptyRun, toBody, type EditorBlock } from './body-editor';
import { ConsentBodyView } from './consent-body';
import type { TemplateActions } from './types';

type TemplateValues = {
  key: string;
  consentType: string;
  title: string;
  signerRequirement: string;
  appliesToMinors: boolean;
  appliesToAdults: boolean;
  requiredForActivation: boolean;
};
type CreatedTemplate = { templateId: string; key: string; title: string };

const FIELDS = [
  'key',
  'consentType',
  'title',
  'signerRequirement',
  'appliesToMinors',
  'appliesToAdults',
] as const;

function NewTemplateForm({
  action,
  onCreated,
}: {
  action: TemplateActions['createTemplate'];
  onCreated: (t: CreatedTemplate) => void;
}) {
  const t = useTranslations('consents.templates');
  const v = useValidationMessage();
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const form = useForm<TemplateValues>({
    resolver: schemaResolver<TemplateValues>(createConsentTemplateSchema),
    defaultValues: {
      key: '',
      consentType: 'treatment_informed_consent',
      title: '',
      signerRequirement: 'patient',
      appliesToMinors: true,
      appliesToAdults: true,
      requiredForActivation: false,
    },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const result = await action(values as CreateConsentTemplateInput);
    if (result.ok) {
      onCreated({ templateId: result.data.templateId, key: values.key, title: values.title });
      form.reset();
    } else if (!applyFieldErrors(result.error, form.setError, FIELDS)) setServerError(result.error);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('newTitle')}</CardTitle>
        <CardDescription>{t('newDescription')}</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate className="flex max-w-2xl flex-col gap-4">
        <FormError error={serverError} />
        <FormField
          label={t('title')}
          error={v(errors.title?.message)}
          {...form.register('title')}
        />
        <FormField
          label={t('key')}
          hint={t('keyHint')}
          autoCapitalize="none"
          error={v(errors.key?.message)}
          {...form.register('key')}
        />
        <SelectField
          label={t('consentType')}
          error={v(errors.consentType?.message)}
          {...form.register('consentType')}
        >
          {CONSENT_TYPES.map((c) => (
            <option key={c} value={c}>
              {t(`types.${c}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t('signer')}
          error={v(errors.signerRequirement?.message)}
          {...form.register('signerRequirement')}
        >
          {SIGNER_REQUIREMENTS.map((s) => (
            <option key={s} value={s}>
              {t(`signers.${s}`)}
            </option>
          ))}
        </SelectField>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">{t('appliesTo')}</legend>
          <Controller
            control={form.control}
            name="appliesToMinors"
            render={({ field }) => (
              <CheckField
                label={t('minors')}
                checked={field.value}
                onCheckedChange={field.onChange}
                error={v(errors.appliesToMinors?.message)}
              />
            )}
          />
          <Controller
            control={form.control}
            name="appliesToAdults"
            render={({ field }) => (
              <CheckField
                label={t('adults')}
                checked={field.value}
                onCheckedChange={field.onChange}
              />
            )}
          />
        </fieldset>
        <Controller
          control={form.control}
          name="requiredForActivation"
          render={({ field }) => (
            <CheckField
              label={t('requiredForActivation')}
              hint={t('requiredForActivationHint')}
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          )}
        />
        <Button type="submit" loading={isSubmitting} className="self-start">
          {t('create')}
        </Button>
      </form>
    </Card>
  );
}

function VersionEditor({
  template,
  actions,
}: {
  template: CreatedTemplate;
  actions: Pick<TemplateActions, 'saveDraft' | 'publish'>;
}) {
  const t = useTranslations('consents.templates');
  const te = useTranslations('consents.editor');
  const v = useValidationMessage();
  const uiLocale = useLocale() === 'en' ? 'en' : 'es';
  const [locale, setLocale] = useState<'es' | 'en'>(uiLocale);
  const [title, setTitle] = useState(template.title);
  const [review, setReview] = useState('');
  const [blocks, setBlocks] = useState<EditorBlock[]>([{ type: 'paragraph', runs: [emptyRun()] }]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [published, setPublished] = useState<{ bodyHash: string } | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [localError, setLocalError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const body = toBody(blocks);
  const parsed = consentBodySchema.safeParse(body);

  async function save() {
    setError(null);
    setLocalError(undefined);
    if (!title.trim()) {
      setLocalError(v('fieldRequired'));
      return;
    }
    if (!parsed.success) {
      setLocalError(te('invalidBody'));
      return;
    }
    setBusy(true);
    const result = await actions.saveDraft({
      templateId: template.templateId,
      locale,
      title: title.trim(),
      body: parsed.data,
      ...(review.trim() ? { legalReviewReference: review.trim() } : {}),
    });
    setBusy(false);
    if (result.ok) {
      setVersionId(result.data.versionId);
      setDirty(false);
    } else setError(result.error);
  }

  const edit =
    <T,>(setter: (x: T) => void) =>
    (x: T) => {
      setter(x);
      setDirty(true);
    };

  return (
    <Card data-testid={`template-${template.key}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{template.title}</CardTitle>
          <Badge variant="outline">{template.key}</Badge>
          {published ? (
            <Badge variant="success">
              <CheckCircle2 aria-hidden />
              {t('published')}
            </Badge>
          ) : (
            <Badge variant="warning">{t('draft')}</Badge>
          )}
        </div>
        <CardDescription>{t('versionDescription')}</CardDescription>
      </CardHeader>
      <Alert variant="warning">{t('legalNotice')}</Alert>
      {published ? (
        <Alert variant="success">
          <p>{t('publishedBody')}</p>
          <p className="font-mono text-xs break-all">{published.bodyHash}</p>
        </Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <FormError error={error} />
          {localError ? <Alert variant="error">{localError}</Alert> : null}
          <SelectField
            label={t('locale')}
            value={locale}
            onChange={(e) => edit(setLocale)(e.target.value as 'es' | 'en')}
          >
            <option value="es">Español</option>
            <option value="en">English</option>
          </SelectField>
          <p className="text-sm text-muted-foreground">{t('noTranslate')}</p>
          <FormField
            label={t('versionTitle')}
            value={title}
            onChange={(e) => edit(setTitle)(e.target.value)}
            maxLength={200}
          />
          <BodyEditor blocks={blocks} onChange={edit(setBlocks)} />
          <FormField
            label={t('legalReference')}
            hint={t('legalReferenceHint')}
            value={review}
            onChange={(e) => edit(setReview)(e.target.value)}
            maxLength={200}
          />
          <section
            aria-labelledby={`preview-${template.key}`}
            className="rounded-md border bg-muted/30 p-4"
          >
            <h4 id={`preview-${template.key}`} className="mb-2 text-sm font-bold">
              {t('preview')}
            </h4>
            <ConsentBodyView
              body={parsed.success ? parsed.data : null}
              fallback={te('invalidBody')}
            />
          </section>
          <div className="flex flex-wrap gap-2">
            <Button onClick={save} loading={busy}>
              <Save aria-hidden />
              {t('saveDraft')}
            </Button>
            {versionId && !dirty ? (
              <ReasonDialog
                trigger={
                  <Button variant="outline">
                    <Send aria-hidden />
                    {t('publish')}
                  </Button>
                }
                title={t('publishTitle', { title: template.title })}
                description={t('publishDescription')}
                confirmLabel={t('publishConfirm')}
                reasonLabel={t('publishAck')}
                options={[{ value: 'ack', label: t('publishAckOption') }]}
                action={async () => {
                  const result = await actions.publish({ versionId });
                  if (result.ok) setPublished({ bodyHash: result.data.bodyHash });
                  return result;
                }}
              />
            ) : (
              <p className="inline-flex items-center text-sm text-muted-foreground">
                {versionId ? t('saveBeforePublish') : t('draftFirst')}
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Consent templates (owner). Note: the server exposes no template list yet, so the screen works
 * on templates created in this session (see report). Published versions are immutable.
 */
export function TemplateManager({ actions }: { actions: TemplateActions }) {
  const t = useTranslations('consents.templates');
  const [created, setCreated] = useState<CreatedTemplate[]>([]);
  return (
    <div className="flex flex-col gap-6">
      <NewTemplateForm
        action={actions.createTemplate}
        onCreated={(x) => setCreated((c) => [x, ...c])}
      />
      {created.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="size-4" aria-hidden />
          {t('sessionNote')}
        </p>
      ) : (
        created.map((tpl) => (
          <VersionEditor key={tpl.templateId} template={tpl} actions={actions} />
        ))
      )}
    </div>
  );
}
