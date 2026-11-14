'use client';

import { Archive, ExternalLink, FileText, Share2, Upload } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmptyState } from '@/components/shared/empty-state';
import {
  CheckField,
  FormError,
  FormField,
  SelectField,
  TextAreaField,
  useValidationMessage,
} from '@/components/shared/form-kit';
import { ReasonDialog } from '@/components/shared/reason-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useRouter } from '@/i18n/navigation';
import type { ActionError, ActionResult } from '@/modules/auth/schemas/result';
import { ConfirmDialog } from '@/modules/clinical-records/components/confirm-dialog';
import type {
  Action,
  ClinicalDocumentDto,
  DocumentType,
  SignedUrlDto,
} from '@/modules/clinical-records/components/types';
import { ACCEPT, DOCUMENT_TYPES, MAX_BYTES, formatBytes } from './document-utils';

export type DocumentsActions = {
  upload: (
    formData: FormData,
  ) => Promise<ActionResult<{ documentId: string; fileObjectId: string }>>;
  archive: Action<{ documentId: string; reason: string }>;
  share: Action<{ documentId: string; guardianVisible: boolean }, unknown>;
  unshare: Action<{ shareId: string }>;
  url: Action<{ fileObjectId: string }, SignedUrlDto>;
};

function UploadDialog({
  recordId,
  replaceable,
  actions,
  onClose,
}: {
  recordId: string;
  /** Active (non-archived) documents of this record that the new file may supersede. */
  replaceable: ClinicalDocumentDto[];
  actions: DocumentsActions;
  onClose: () => void;
}) {
  const t = useTranslations('clinical.documents.upload');
  const tc = useTranslations('common');
  const tt = useTranslations('clinical.documents.types');
  const te = useTranslations('clinical.errors');
  const v = useValidationMessage();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<DocumentType>('report');
  const [date, setDate] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [supersedes, setSupersedes] = useState('');
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next: Record<string, string | undefined> = {};
    if (title.trim() === '') next.title = v('fieldRequired');
    if (!file) next.file = v('fieldRequired');
    else if (file.size > MAX_BYTES) next.file = te('fileTooLarge');
    setErrors(next);
    if (Object.keys(next).length > 0 || !file) return;
    setError(null);
    setBusy(true);
    const form = new FormData();
    form.set('recordId', recordId);
    form.set('documentType', type);
    form.set('title', title.trim());
    if (date) form.set('documentDate', date);
    if (description.trim()) form.set('description', description.trim());
    if (supersedes) form.set('supersedesDocumentId', supersedes);
    form.set('file', file);
    const result = await actions.upload(form);
    setBusy(false);
    if (result.ok) {
      onClose();
      router.refresh();
    } else setError(result.error);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        <FormField
          label={t('name')}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          error={errors.title}
        />
        <SelectField
          label={t('type')}
          value={type}
          onChange={(e) => setType(e.target.value as DocumentType)}
        >
          {DOCUMENT_TYPES.map((d) => (
            <option key={d} value={d}>
              {tt(d)}
            </option>
          ))}
        </SelectField>
        <FormField
          label={t('date')}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <TextAreaField
          label={t('notes')}
          value={description}
          maxLength={1000}
          onChange={(e) => setDescription(e.target.value)}
        />
        {replaceable.length > 0 ? (
          <SelectField
            label={t('supersedes')}
            hint={t('supersedesHint')}
            value={supersedes}
            onChange={(e) => setSupersedes(e.target.value)}
          >
            <option value="">{t('supersedesNone')}</option>
            {replaceable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </SelectField>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="document-file">{t('file')}</Label>
          <input
            id="document-file"
            type="file"
            accept={ACCEPT}
            aria-invalid={errors.file ? true : undefined}
            aria-describedby="document-file-hint"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-base file:mr-3 file:min-h-(--target-min) file:rounded-md file:border file:border-input file:bg-card file:px-4 file:font-bold"
          />
          <p id="document-file-hint" className="text-sm text-muted-foreground">
            {t('fileHint')}
          </p>
          {errors.file ? (
            <p className="text-sm font-semibold text-destructive">{errors.file}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({
  doc,
  isMinor,
  actions,
  onClose,
}: {
  doc: ClinicalDocumentDto;
  isMinor: boolean;
  actions: DocumentsActions;
  onClose: () => void;
}) {
  const t = useTranslations('clinical.documents.share');
  const tc = useTranslations('common');
  const router = useRouter();
  const [guardians, setGuardians] = useState(false);
  const [error, setError] = useState<ActionError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    const result = await actions.share({ documentId: doc.id, guardianVisible: guardians });
    setBusy(false);
    if (result.ok) {
      onClose();
      router.refresh();
    } else setError(result.error);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title', { name: doc.title })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <FormError error={error} />
        {isMinor ? (
          <CheckField
            label={t('guardianVisible')}
            hint={t('guardianHint')}
            checked={guardians}
            onCheckedChange={setGuardians}
          />
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {tc('cancel')}
          </Button>
          <Button onClick={submit} loading={busy}>
            {t('confirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Documentos tab (DOC-01..03): upload (private bucket, server-validated), list, archive with a
 * reason, share / unshare with the patient (never notes), and open through a short-lived signed URL.
 */
export function DocumentsTab({
  recordId,
  isMinor,
  documents,
  loadFailed,
  actions,
}: {
  recordId: string;
  isMinor: boolean;
  documents: ClinicalDocumentDto[];
  loadFailed: boolean;
  actions: DocumentsActions;
}) {
  const t = useTranslations('clinical.documents');
  const tt = useTranslations('clinical.documents.types');
  const format = useFormatter();
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [sharing, setSharing] = useState<ClinicalDocumentDto | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [error, setError] = useState<ActionError | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const active = documents.filter((d) => !d.archivedAt);
  const archived = documents.filter((d) => d.archivedAt);

  async function openDoc(doc: ClinicalDocumentDto) {
    setError(null);
    setFallbackUrl(null);
    setOpening(doc.id);
    const result = await actions.url({ fileObjectId: doc.fileObjectId });
    setOpening(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const win = window.open(result.data.url, '_blank', 'noopener,noreferrer');
    if (!win) setFallbackUrl(result.data.url);
  }

  const row = (d: ClinicalDocumentDto) => (
    <li
      key={d.id}
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      data-testid={`document-${d.archivedAt ? 'archived' : 'active'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{d.title}</span>
        <Badge variant="neutral">{tt(d.documentType)}</Badge>
        {d.activeShare ? (
          <Badge variant="info">
            <Share2 aria-hidden />
            {d.activeShare.guardianVisible ? t('sharedWithGuardians') : t('sharedWithPatient')}
          </Badge>
        ) : null}
        {d.archivedAt ? <Badge variant="outline">{t('archivedBadge')}</Badge> : null}
      </div>
      <p className="text-sm text-muted-foreground">
        {d.documentDate
          ? format.dateTime(new Date(`${d.documentDate}T12:00:00`), { dateStyle: 'medium' })
          : format.dateTime(new Date(d.createdAt), { dateStyle: 'medium' })}
        {' · '}
        {formatBytes(d.sizeBytes)}
        {d.description ? ` · ${d.description}` : ''}
      </p>
      {d.supersedesDocumentId ? (
        <p className="text-sm text-muted-foreground" data-testid="document-supersedes">
          {t('replaces', {
            name:
              documents.find((x) => x.id === d.supersedesDocumentId)?.title ?? t('replacesUnknown'),
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openDoc(d)}
          loading={opening === d.id}
        >
          <ExternalLink aria-hidden />
          {t('open')}
        </Button>
        {!d.archivedAt ? (
          <>
            {d.activeShare ? (
              <ConfirmDialog
                trigger={
                  <Button variant="outline" size="sm">
                    {t('unshare')}
                  </Button>
                }
                title={t('unshareTitle', { name: d.title })}
                description={t('unshareDescription')}
                confirmLabel={t('unshareConfirm')}
                action={() =>
                  actions.unshare({ shareId: (d.activeShare as { shareId: string }).shareId })
                }
                onDone={() => router.refresh()}
              />
            ) : (
              <Button variant="outline" size="sm" onClick={() => setSharing(d)}>
                <Share2 aria-hidden />
                {t('shareAction')}
              </Button>
            )}
            <ReasonDialog
              trigger={
                <Button variant="destructive" size="sm">
                  <Archive aria-hidden />
                  {t('archive')}
                </Button>
              }
              title={t('archiveTitle', { name: d.title })}
              description={t('archiveDescription')}
              confirmLabel={t('archiveConfirm')}
              destructive
              reasonLabel={t('archiveReason')}
              action={(reason) => actions.archive({ documentId: d.id, reason })}
              onDone={() => router.refresh()}
            />
          </>
        ) : null}
      </div>
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        {loadFailed ? (
          <Alert variant="error">
            <AlertDescription>{t('loadFailed')}</AlertDescription>
          </Alert>
        ) : null}
        <FormError error={error} />
        {fallbackUrl ? (
          <p>
            <a
              href={fallbackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-primary underline underline-offset-4"
            >
              {t('openLink')}
            </a>
          </p>
        ) : null}
        <Button className="self-start" onClick={() => setUploading(true)}>
          <Upload aria-hidden />
          {t('uploadAction')}
        </Button>
      </Card>

      {active.length === 0 && !loadFailed ? (
        <Card>
          <EmptyState icon={FileText} title={t('emptyTitle')} description={t('emptyDescription')} />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="documents-list">
          {active.map(row)}
        </ul>
      )}

      {archived.length > 0 ? (
        <section aria-labelledby="archived-docs" className="flex flex-col gap-3">
          <h3 id="archived-docs">{t('archivedTitle')}</h3>
          <ul className="flex flex-col gap-3">{archived.map(row)}</ul>
        </section>
      ) : null}

      {uploading ? (
        <UploadDialog
          recordId={recordId}
          replaceable={active}
          actions={actions}
          onClose={() => setUploading(false)}
        />
      ) : null}
      {sharing ? (
        <ShareDialog
          doc={sharing}
          isMinor={isMinor}
          actions={actions}
          onClose={() => setSharing(null)}
        />
      ) : null}
    </div>
  );
}
