'use client';

import { ExternalLink, FileText } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import { FormError } from '@/components/shared/form-kit';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { ActionError } from '@/modules/auth/schemas/result';
import type {
  Action,
  PortalDocumentDto,
  SignedUrlDto,
} from '@/modules/clinical-records/components/types';
import { formatBytes } from './document-utils';

/** Portal "Documentos compartidos": only what the care team shared; opened via a signed URL. */
export function PortalDocuments({
  documents,
  patientId,
  openAction,
}: {
  documents: PortalDocumentDto[];
  /** Guardian: the selected relationship. Patient: omitted. */
  patientId?: string;
  openAction: Action<{ documentId: string; patientId?: string }, SignedUrlDto>;
}) {
  const t = useTranslations('clinical.portal.documents');
  const tt = useTranslations('clinical.documents.types');
  const format = useFormatter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);

  async function open(documentId: string) {
    setError(null);
    setFallback(null);
    setBusy(documentId);
    const result = await openAction({ documentId, ...(patientId ? { patientId } : {}) });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const win = window.open(result.data.url, '_blank', 'noopener,noreferrer');
    if (!win) setFallback(result.data.url);
  }

  if (documents.length === 0) {
    return (
      <Card>
        <EmptyState icon={FileText} title={t('empty')} />
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <FormError error={error} />
      {fallback ? (
        <a
          href={fallback}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-primary underline underline-offset-4"
        >
          {t('openLink')}
        </a>
      ) : null}
      <ul className="flex flex-col gap-3" data-testid="portal-documents">
        {documents.map((d) => (
          <li
            key={d.documentId}
            className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="font-semibold">{d.title}</span>
              <span className="text-sm text-muted-foreground">
                {tt(d.documentType)} ·{' '}
                {t('sharedOn', {
                  date: format.dateTime(new Date(d.sharedAt), { dateStyle: 'medium' }),
                })}{' '}
                · {formatBytes(d.sizeBytes)}
              </span>
            </div>
            <Button
              variant="outline"
              onClick={() => void open(d.documentId)}
              loading={busy === d.documentId}
            >
              <ExternalLink aria-hidden />
              {t('open')}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
