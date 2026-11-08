'use client';

import { useTranslations } from 'next-intl';
import { VALIDATION_KEYS } from '@/modules/branding/schemas';

/** Translates an i18n key coming from the server's closed set (unknown keys -> errors.internal). */
export function useMessage() {
  const t = useTranslations();
  return (key: string, values?: Record<string, string | number>) =>
    t.has(key as never) ? t(key as never, values as never) : t('errors.internal');
}

export function useValidationMessage() {
  const t = useTranslations('branding.validation');
  return (key: string | undefined): string | undefined => {
    if (!key) return undefined;
    return (VALIDATION_KEYS as readonly string[]).includes(key)
      ? t(key as (typeof VALIDATION_KEYS)[number])
      : t('colorInvalid');
  };
}
