'use client';

import { AlertCircle, Check, Loader2, PencilLine } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { AutosaveStatus } from './use-autosave';

/** Autosave status, announced politely (DESIGN_SYSTEM §6.4). Icon + text, never colour alone. */
export function SaveIndicator({
  status,
  savedAt,
  onRetry,
}: {
  status: AutosaveStatus;
  savedAt: Date | null;
  onRetry?: () => void;
}) {
  const t = useTranslations('clinical.editor');
  const format = useFormatter();
  const Icon =
    status === 'saving'
      ? Loader2
      : status === 'error'
        ? AlertCircle
        : status === 'dirty'
          ? PencilLine
          : Check;
  const text =
    status === 'saving'
      ? t('saving')
      : status === 'dirty'
        ? t('unsaved')
        : status === 'error'
          ? t('saveFailed')
          : status === 'saved' && savedAt
            ? t('savedAt', { time: format.dateTime(savedAt, { timeStyle: 'short' }) })
            : t('autosaveOn');
  return (
    <div className="flex items-center gap-2 text-sm" data-testid="save-indicator">
      <span role="status" aria-live="polite" className="flex items-center gap-1.5">
        <Icon
          className={
            status === 'saving' ? 'size-4 animate-spin motion-reduce:animate-none' : 'size-4'
          }
          aria-hidden
        />
        <span className={status === 'error' ? 'font-semibold text-destructive' : undefined}>
          {text}
        </span>
      </span>
      {status === 'error' && onRetry ? (
        <Button variant="link" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      ) : null}
    </div>
  );
}
