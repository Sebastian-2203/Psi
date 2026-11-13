'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { CheckField, FormError, SelectField } from '@/components/shared/form-kit';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useRouter } from '@/i18n/navigation';
import type { ActionError } from '@/modules/auth/schemas/result';
import type { Action, PatientDetailDto } from './types';

export type PreferencesInput = {
  patientId: string;
  portalMode?: 'child' | 'adolescent' | 'adult';
  locale?: 'es' | 'en' | null;
  notifyEmail?: boolean;
  textSize?: 100 | 125 | 150;
  reducedMotion?: boolean;
  audioInstructions?: boolean;
};

export function PreferencesTab({
  patient,
  action,
  readOnly,
}: {
  patient: PatientDetailDto;
  action: Action<PreferencesInput, unknown>;
  readOnly: boolean;
}) {
  const t = useTranslations('patients.preferences');
  const tl = useTranslations('locale');
  const router = useRouter();
  const p = patient.preferences;
  const [mode, setMode] = useState(p?.portalMode ?? 'adult');
  const [locale, setLocale] = useState(p?.locale ?? '');
  const [notifyEmail, setNotifyEmail] = useState(p?.notifyEmail ?? true);
  const [textSize, setTextSize] = useState(String(p?.textSize ?? 100));
  const [reducedMotion, setReducedMotion] = useState(p?.reducedMotion ?? false);
  const [audio, setAudio] = useState(p?.audioInstructions ?? false);
  const [error, setError] = useState<ActionError | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setSaved(false);
    setBusy(true);
    const result = await action({
      patientId: patient.patientId,
      portalMode: mode,
      locale: locale === '' ? null : (locale as 'es' | 'en'),
      notifyEmail,
      textSize: Number(textSize) as 100 | 125 | 150,
      reducedMotion,
      audioInstructions: audio,
    });
    setBusy(false);
    if (result.ok) {
      setSaved(true);
      router.refresh();
    } else setError(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <div className="flex max-w-xl flex-col gap-4">
        <FormError error={error} />
        {saved ? <Alert variant="success">{t('saved')}</Alert> : null}
        <fieldset disabled={readOnly} className="flex flex-col gap-4">
          <SelectField
            label={t('portalMode')}
            hint={t('portalModeHint')}
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            {(['adult', 'adolescent', 'child'] as const).map((m) => (
              <option key={m} value={m}>
                {t(`modes.${m}`)}
              </option>
            ))}
          </SelectField>
          <SelectField
            label={t('locale')}
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
          >
            <option value="">{t('localeDefault')}</option>
            <option value="es">{tl('es')}</option>
            <option value="en">{tl('en')}</option>
          </SelectField>
          <SelectField
            label={t('textSize')}
            value={textSize}
            onChange={(e) => setTextSize(e.target.value)}
          >
            {['100', '125', '150'].map((s) => (
              <option key={s} value={s}>
                {s}%
              </option>
            ))}
          </SelectField>
          <CheckField
            label={t('notifyEmail')}
            checked={notifyEmail}
            onCheckedChange={setNotifyEmail}
          />
          <CheckField
            label={t('reducedMotion')}
            checked={reducedMotion}
            onCheckedChange={setReducedMotion}
          />
          <CheckField label={t('audioInstructions')} checked={audio} onCheckedChange={setAudio} />
        </fieldset>
        {!readOnly ? (
          <Button onClick={save} loading={busy} className="self-start">
            {t('save')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
