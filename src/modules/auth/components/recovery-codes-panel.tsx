'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ActionError, ActionResult } from '@/modules/auth/schemas/result';
import { FormError, FormNotice } from './form-parts';

export function RecoveryCodesPanel({
  action,
  hasCodes,
}: {
  action: () => Promise<ActionResult<{ codes: string[] }>>;
  hasCodes: boolean;
}) {
  const t = useTranslations('auth.mfa');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (codes) listRef.current?.focus();
  }, [codes]);

  async function generate() {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (result.ok) setCodes(result.data.codes);
    else setError(result.error);
  }

  if (codes) {
    return (
      <div className="flex flex-col gap-3">
        <FormNotice variant="warning">{t('codesShownOnce')}</FormNotice>
        <ol
          ref={listRef}
          tabIndex={-1}
          aria-label={t('codesListLabel')}
          data-testid="recovery-codes"
          className="grid grid-cols-1 gap-2 rounded-md bg-muted p-4 font-mono text-sm outline-none sm:grid-cols-2"
        >
          {codes.map((code) => (
            <li key={code} className="select-all">
              {code}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <FormError error={error} />
      <Button
        type="button"
        variant={hasCodes ? 'outline' : 'default'}
        onClick={generate}
        loading={busy}
      >
        {hasCodes ? t('codesRegenerate') : t('codesGenerate')}
      </Button>
    </div>
  );
}
