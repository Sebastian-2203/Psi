'use client';

import { CheckCircle2, FileText, Save, Send } from 'lucide-react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
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
import { useRouter } from '@/i18n/navigation';
import type { ActionError } from '@/modules/auth/schemas/result';
import {
  CONSENT_TYPES,
  SIGNER_REQUIREMENTS,
  consentBodySchema,
  createConsentTemplateSchema,
  type CreateConsentTemplateInput,
} from '@/modules/consents/schemas';
import { BodyEditor, emptyRun, fromBody, toBody, type EditorBlock } from './body-editor';
import { ConsentBodyView } from './consent-body';
import type { ConsentTemplateDto, ConsentVersionDto, TemplateActions } from './types';

type TemplateValues = {
  key: string;
  consentType: string;
  title: string;
  signerRequirement: string;
  appliesToMinors: boolean;
  appliesToAdults: boolean;
  requiredForActivation: boolean;
};
type CardTemplate = {
  templateId: string;
  key: string;
  title: string;
  status: ConsentTemplateDto['status'];
  versions: ConsentVersionDto[];
};

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
  onCreated: (t: CardTemplate) => void;
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
      onCreated({
        templateId: result.data.templateId,
        key: values.key,
        title: values.title,
        status: 'draft',
        versions: [],
      });
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
  template: CardTemplate;
  actions: Pick<TemplateActions, 'saveDraft' | 'publish'>;
}) {
  const t = useTranslations('consents.templates');
  const te = useTranslations('consents.editor');
  const v = useValidationMessage();
  const router = useRouter();
  const format = useFormatter();
  const uiLocale = useLocale() === 'en' ? 'en' : 'es';
  const draftFor = (l: 'es' | 'en') =>
    template.versions.find((x) => x.locale === l && x.status === 'draft');
  const initial = draftFor(uiLocale);
  const [locale, setLocale] = useState<'es' | 'en'>(uiLocale);
  const [title, setTitle] = useState(initial?.title ?? template.title);
  const [review, setReview] = useState(initial?.legalReviewReference ?? '');
  const [blocks, setBlocks] = useState<EditorBlock[]>(
    initial ? fromBody(initial.draftBody) : [{ type: 'paragraph', runs: [emptyRun()] }],
  );
  const [versionId, setVersionId] = useState<string | null>(initial?.versionId ?? null);
  const [dirty, setDirty] = useState(false);
  const [published, setPublished] = useState<{ bodyHash: string } | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [localError, setLocalError] = useState<string>();
  const [busy, setBusy] = useState(false);

  /** Switching language loads that language's draft (if any) or starts blank. */
  function changeLocale(next: 'es' | 'en') {
    const d = draftFor(next);
    setLocale(next);
    setTitle(d?.title ?? template.title);
    setReview(d?.legalReviewReference ?? '');
    setBlocks(d ? fromBody(d.draftBody) : [{ type: 'paragraph', runs: [emptyRun()] }]);
    setVersionId(d?.versionId ?? null);
    setDirty(false);
    setError(null);
    setLocalError(undefined);
  }

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
          {published || template.status === 'published' ? (
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
      {template.versions.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm" data-testid={`versions-${template.key}`}>
          {template.versions.map((x) => (
            <li key={x.versionId} className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{x.locale.toUpperCase()}</Badge>
              <span>{t('versionLine', { number: x.versionNumber, title: x.title })}</span>
              <Badge variant={x.status === 'published' ? 'success' : 'neutral'}>
                {t(`versionStatus.${x.status}`)}
              </Badge>
              {x.publishedAt ? (
                <span className="text-muted-foreground">
                  {format.dateTime(new Date(x.publishedAt), { dateStyle: 'medium' })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
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
            onChange={(e) => changeLocale(e.target.value as 'es' | 'en')}
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
                onDone={() => router.refresh()}
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

/** Consent templates (owner): existing templates (server list) plus those created in this session. */
export function TemplateManager({
  actions,
  templates,
}: {
  actions: TemplateActions;
  templates: ConsentTemplateDto[];
}) {
  const t = useTranslations('consents.templates');
  const [created, setCreated] = useState<CardTemplate[]>([]);
  const known = new Set(templates.map((x) => x.templateId));
  const all: CardTemplate[] = [...created.filter((c) => !known.has(c.templateId)), ...templates];
  return (
    <div className="flex flex-col gap-6">
      <NewTemplateForm
        action={actions.createTemplate}
        onCreated={(x) => setCreated((c) => [x, ...c])}
      />
      {all.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="size-4" aria-hidden />
          {t('emptyList')}
        </p>
      ) : (
        all.map((tpl) => <VersionEditor key={tpl.templateId} template={tpl} actions={actions} />)
      )}
    </div>
  );
}
