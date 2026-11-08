'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useFormatter, useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BrandTokens } from '@/styles/branding';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { decodeContrastIssue, evaluateBrandColors } from '@/modules/branding/lib/contrast-guard';
import {
  DISPLAY_NAME_MAX,
  updateBrandingSchema,
  type UpdateBrandingInput,
  type UpdateBrandingOutput,
} from '@/modules/branding/schemas';
import { BrandingPreview } from './branding-preview';
import { ColorField } from './color-field';
import { LogoPanel } from './logo-panel';
import { useMessage, useValidationMessage } from './use-message';
import type { ActionError, ActionResult, SavedBranding } from './types';

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX_OR_EMPTY = /^(#[0-9a-fA-F]{6})?$/;
const floor2 = (n: number) => Math.floor(n * 100) / 100;

export type BrandingSettingsProps = {
  initial: {
    displayName: string;
    brandColor: string;
    functionalColor: string | null;
    secondaryColor: string | null;
    logoUrl: string | null;
    updatedAt: string;
  };
  updateAction: (input: UpdateBrandingInput) => Promise<ActionResult<SavedBranding>>;
  uploadLogoAction: (formData: FormData) => Promise<ActionResult<SavedBranding>>;
  removeLogoAction: () => Promise<ActionResult<SavedBranding>>;
};

export function BrandingSettings({
  initial,
  updateAction,
  uploadLogoAction,
  removeLogoAction,
}: BrandingSettingsProps) {
  const t = useTranslations('branding');
  const v = useValidationMessage();
  const message = useMessage();
  const format = useFormatter();
  const [version, setVersion] = useState(initial.updatedAt);
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [serverError, setServerError] = useState<ActionError | null>(null);
  const [saved, setSaved] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  const form = useForm<UpdateBrandingInput, unknown, UpdateBrandingOutput>({
    resolver: zodResolver(updateBrandingSchema),
    defaultValues: {
      displayName: initial.displayName,
      brandColor: initial.brandColor,
      functionalColor: initial.functionalColor ?? '',
      secondaryColor: initial.secondaryColor ?? '',
      expectedUpdatedAt: initial.updatedAt,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const [displayName, brandColor, functionalColor, secondaryColor] = useWatch({
    control: form.control,
    name: ['displayName', 'brandColor', 'functionalColor', 'secondaryColor'],
  });

  // Keep the concurrency token in sync after logo changes / saves.
  useEffect(() => {
    form.setValue('expectedUpdatedAt', version);
  }, [form, version]);
  useEffect(() => {
    if (serverError) errorRef.current?.focus();
  }, [serverError]);

  // Live contrast guard (the server re-runs the same function and is the authority).
  const guard = useMemo(() => {
    if (!HEX6.test(brandColor)) return null;
    if (!HEX_OR_EMPTY.test(functionalColor) || !HEX_OR_EMPTY.test(secondaryColor)) return null;
    return evaluateBrandColors({
      brandColor,
      functionalColor: functionalColor || null,
      secondaryColor: secondaryColor || null,
    });
  }, [brandColor, functionalColor, secondaryColor]);

  // Last valid tokens keep the preview stable while the owner is mid-typing.
  const [tokens, setTokens] = useState<BrandTokens>(() => {
    const first = evaluateBrandColors({
      brandColor: initial.brandColor,
      functionalColor: initial.functionalColor,
      secondaryColor: initial.secondaryColor,
    });
    return first.ok ? first.tokens : {};
  });
  // Adjusting state while rendering (guard is memoized, so this settles in one extra pass).
  if (guard?.ok && guard.tokens !== tokens) setTokens(guard.tokens);

  const ratioText = (n: number) =>
    format.number(floor2(n), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const functionalIssue =
    guard && !guard.ok ? guard.issues.find((i) => i.field === 'functionalColor') : undefined;
  const serverContrast = decodeContrastIssue(errors.functionalColor?.message ?? '');
  const contrastError = functionalIssue
    ? { suggestion: functionalIssue.suggestion, ratio: ratioText(functionalIssue.ratio) }
    : serverContrast
      ? { suggestion: serverContrast.suggestion, ratio: serverContrast.ratio }
      : null;
  const functionalMessage = contrastError
    ? t('contrast.rejected', {
        ratio: contrastError.ratio,
        minimum: format.number(4.5, { minimumFractionDigits: 1 }),
      }) +
      (contrastError.suggestion
        ? ' ' + t('contrast.suggest', { color: contrastError.suggestion })
        : '')
    : errors.functionalColor
      ? v(errors.functionalColor.message)
      : undefined;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    setSaved(false);
    if (guard && !guard.ok) return; // inline contrast error is already displayed
    const result = await updateAction({
      displayName: values.displayName,
      brandColor: values.brandColor,
      functionalColor: values.functionalColor ?? '',
      secondaryColor: values.secondaryColor ?? '',
      expectedUpdatedAt: version,
    });
    if (result.ok) {
      setVersion(result.data.updatedAt);
      setSaved(true);
      return;
    }
    let applied = false;
    for (const [field, keys] of Object.entries(result.error.fieldErrors ?? {})) {
      if (
        ['displayName', 'brandColor', 'functionalColor', 'secondaryColor'].includes(field) &&
        keys[0]
      ) {
        form.setError(field as 'brandColor', { type: 'server', message: keys[0] });
        applied = true;
      }
    }
    if (!applied) setServerError(result.error);
  });

  const report = guard?.ok ? guard.report : null;

  return (
    <div className="flex flex-col gap-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{t('identity.title')}</CardTitle>
          <CardDescription>{t('identity.description')}</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          {serverError ? (
            <div ref={errorRef} tabIndex={-1} className="outline-none">
              <Alert variant="error">
                <p>{message(serverError.messageKey)}</p>
              </Alert>
            </div>
          ) : null}
          <div aria-live="polite">
            {saved ? (
              <Alert variant="success">
                <p>{t('saved')}</p>
              </Alert>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="branding-display-name">{t('fields.displayName')}</Label>
            <Input
              id="branding-display-name"
              maxLength={DISPLAY_NAME_MAX + 20}
              autoComplete="off"
              aria-invalid={errors.displayName ? true : undefined}
              aria-describedby={
                errors.displayName ? 'branding-display-name-error' : 'branding-display-name-hint'
              }
              {...form.register('displayName')}
            />
            <p id="branding-display-name-hint" className="text-sm text-muted-foreground">
              {t('fields.displayNameHint', { max: DISPLAY_NAME_MAX })}
            </p>
            {errors.displayName ? (
              <p
                id="branding-display-name-error"
                className="text-sm font-semibold text-destructive"
              >
                {v(errors.displayName.message)}
              </p>
            ) : null}
          </div>

          <Controller
            control={form.control}
            name="brandColor"
            render={({ field }) => (
              <ColorField
                name={field.name}
                inputRef={field.ref}
                label={t('fields.brandColor')}
                pickerLabel={t('fields.brandColorPicker')}
                hint={t('fields.brandColorHint')}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={errors.brandColor ? v(errors.brandColor.message) : undefined}
              >
                {report ? (
                  <p className="text-sm" data-testid="functional-report">
                    {t('contrast.report', {
                      color: report.functionalColor,
                      ratio: ratioText(report.ratio),
                    })}
                    {report.adjusted ? ' ' + t('contrast.adjusted') : ''}
                  </p>
                ) : null}
              </ColorField>
            )}
          />

          <Controller
            control={form.control}
            name="functionalColor"
            render={({ field }) => (
              <ColorField
                name={field.name}
                inputRef={field.ref}
                optional
                label={t('fields.functionalColor')}
                pickerLabel={t('fields.functionalColorPicker')}
                hint={t('fields.functionalColorHint')}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={functionalMessage}
                suggestion={contrastError?.suggestion}
                onUseSuggestion={(hex) => field.onChange(hex)}
              />
            )}
          />

          <Controller
            control={form.control}
            name="secondaryColor"
            render={({ field }) => (
              <ColorField
                name={field.name}
                inputRef={field.ref}
                optional
                fallbackPicker="#e8c46b"
                label={t('fields.secondaryColor')}
                pickerLabel={t('fields.secondaryColorPicker')}
                hint={t('fields.secondaryColorHint')}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                error={errors.secondaryColor ? v(errors.secondaryColor.message) : undefined}
              />
            )}
          />

          <Button type="submit" loading={isSubmitting} className="self-start">
            {t('save')}
          </Button>
        </form>
      </Card>

      <LogoPanel
        logoUrl={logoUrl}
        displayName={displayName}
        uploadAction={uploadLogoAction}
        removeAction={removeLogoAction}
        onChanged={(next) => {
          setVersion(next.updatedAt);
          setLogoUrl(next.logoUrl);
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('preview.title')}</CardTitle>
          <CardDescription>{t('preview.description')}</CardDescription>
        </CardHeader>
        <BrandingPreview tokens={tokens} displayName={displayName} logoUrl={logoUrl} />
      </Card>
    </div>
  );
}
