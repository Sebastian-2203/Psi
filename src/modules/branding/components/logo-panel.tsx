'use client';

import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { PracticeName } from '@/components/shared/practice-name';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { LOGO_ACCEPT } from '@/modules/branding/schemas';
import type { ActionResult, SavedBranding } from './types';
import { useMessage } from './use-message';

/** Mirrors server/logo.ts limits for instant feedback only; the server is the authority. */
const MAX_BYTES = 512 * 1024;
const ALLOWED = new Set(LOGO_ACCEPT.split(','));

export function LogoPanel({
  logoUrl,
  displayName,
  uploadAction,
  removeAction,
  onChanged,
}: {
  logoUrl: string | null;
  displayName: string;
  uploadAction: (formData: FormData) => Promise<ActionResult<SavedBranding>>;
  removeAction: () => Promise<ActionResult<SavedBranding>>;
  onChanged: (next: SavedBranding) => void;
}) {
  const t = useTranslations('branding.logo');
  const message = useMessage();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'uploaded' | 'removed' | null>(null);

  async function run(kind: 'upload' | 'remove', call: () => Promise<ActionResult<SavedBranding>>) {
    setBusy(kind);
    setError(null);
    setStatus(null);
    try {
      const result = await call();
      if (result.ok) {
        onChanged(result.data);
        setStatus(kind === 'upload' ? 'uploaded' : 'removed');
        if (input.current) input.current.value = '';
        setFileName(null);
      } else {
        setError(message(result.error.messageKey));
      }
    } catch {
      setError(message('errors.internal'));
    } finally {
      setBusy(null);
    }
  }

  function onUpload() {
    const file = input.current?.files?.[0];
    if (!file) return setError(t('chooseFirst'));
    if (file.size > MAX_BYTES) return setError(message('branding.errors.logoTooLarge'));
    if (!ALLOWED.has(file.type)) return setError(message('branding.errors.logoUnsupported'));
    const data = new FormData();
    data.append('file', file);
    void run('upload', () => uploadAction(data));
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <div className="flex items-center gap-4" data-testid="logo-current">
        {logoUrl ? (
          <PracticeName name={displayName} logoUrl={logoUrl} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="branding-logo-file">{t('file')}</Label>
        <div className="flex flex-wrap items-center gap-3">
          {/* Native input visually hidden (still focusable/labelled); the visible control is its
              label, styled as a button, so the browser's untranslated text never shows. */}
          <input
            ref={input}
            id="branding-logo-file"
            type="file"
            accept={LOGO_ACCEPT}
            aria-describedby="branding-logo-hint branding-logo-name"
            onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
            className="peer sr-only"
          />
          <label
            htmlFor="branding-logo-file"
            className={cn(
              buttonVariants({ variant: 'outline' }),
              'cursor-pointer peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid peer-disabled:opacity-50',
            )}
          >
            {t('choose')}
          </label>
          <span
            id="branding-logo-name"
            className="min-w-0 truncate text-sm text-muted-foreground"
            data-testid="logo-file-name"
          >
            {fileName ?? t('noFile')}
          </span>
        </div>
        <p id="branding-logo-hint" className="text-sm text-muted-foreground">
          {t('hint')}
        </p>
      </div>
      <div aria-live="polite">
        {error ? (
          <Alert variant="error">
            <p>{error}</p>
          </Alert>
        ) : status ? (
          <Alert variant="success">
            <p>{t(status)}</p>
          </Alert>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          onClick={onUpload}
          loading={busy === 'upload'}
          disabled={busy !== null}
        >
          {t('upload')}
        </Button>
        {logoUrl ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void run('remove', removeAction)}
            loading={busy === 'remove'}
            disabled={busy !== null}
          >
            {t('remove')}
          </Button>
        ) : null}
      </div>
    </Card>
  );
}
