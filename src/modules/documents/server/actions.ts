'use server';

import {
  archiveClinicalDocumentSchema,
  fileIdSchema,
  MAX_CLINICAL_FILE_BYTES,
  patientIdSchema,
  portalDocumentUrlSchema,
  portalDocumentsSchema,
  shareClinicalDocumentSchema,
  unshareClinicalDocumentSchema,
  uploadClinicalDocumentSchema,
  type ArchiveClinicalDocumentInput,
  type FileIdInput,
  type PortalDocumentUrlInput,
  type PortalDocumentsInput,
  type ShareClinicalDocumentInput,
  type UnshareClinicalDocumentInput,
} from '@/modules/documents/schemas';
import { runAction } from '@/server/actions/run';
import { AppError } from '@/server/errors';
import {
  archiveClinicalDocument,
  issueClinicalFileUrl,
  issuePortalDocumentUrl,
  listClinicalDocuments,
  listMySharedDocuments,
  shareClinicalDocument,
  unshareClinicalDocument,
  uploadClinicalDocument,
} from './service';

/** Clinical document actions (API_CONTRACTS §8.10). */

/**
 * Multipart upload: FormData fields recordId, documentType, title, documentDate?, description?,
 * supersedesDocumentId? and `file` (one File, <= 20 MiB, PDF / PNG / JPEG / WebP / audio).
 */
export async function uploadClinicalDocumentAction(formData: FormData) {
  const file = formData.get('file');
  const fields: Record<string, string> = {};
  for (const key of [
    'recordId',
    'documentType',
    'title',
    'documentDate',
    'description',
    'supersedesDocumentId',
  ]) {
    const value = formData.get(key);
    if (typeof value === 'string' && value !== '') fields[key] = value;
  }
  return runAction(uploadClinicalDocumentSchema, fields, async (ctx, d) => {
    if (!(file instanceof File) || file.size === 0 || file.size > MAX_CLINICAL_FILE_BYTES) {
      return {
        ok: false as const,
        error: new AppError('VALIDATION_FAILED', {
          messageKey:
            file instanceof File && file.size > 0
              ? 'clinical.errors.fileTooLarge'
              : 'clinical.errors.uploadFailed',
        }),
      };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return uploadClinicalDocument(ctx, d, { bytes, type: file.type, name: file.name });
  });
}
export async function archiveClinicalDocumentAction(input: ArchiveClinicalDocumentInput) {
  return runAction(archiveClinicalDocumentSchema, input, (ctx, d) =>
    archiveClinicalDocument(ctx, d),
  );
}
export async function listClinicalDocumentsAction(input: { patientId: string }) {
  return runAction(patientIdSchema, input, (ctx, d) => listClinicalDocuments(ctx, d.patientId));
}
export async function shareClinicalDocumentAction(input: ShareClinicalDocumentInput) {
  return runAction(shareClinicalDocumentSchema, input, (ctx, d) => shareClinicalDocument(ctx, d));
}
export async function unshareClinicalDocumentAction(input: UnshareClinicalDocumentInput) {
  return runAction(unshareClinicalDocumentSchema, input, (ctx, d) =>
    unshareClinicalDocument(ctx, d),
  );
}
export async function issueClinicalFileUrlAction(input: FileIdInput) {
  return runAction(fileIdSchema, input, (ctx, d) => issueClinicalFileUrl(ctx, d));
}
export async function listMySharedDocumentsAction(input: PortalDocumentsInput) {
  return runAction(portalDocumentsSchema, input, (ctx, d) =>
    listMySharedDocuments(ctx, d.patientId),
  );
}
export async function issuePortalDocumentUrlAction(input: PortalDocumentUrlInput) {
  return runAction(portalDocumentUrlSchema, input, (ctx, d) => issuePortalDocumentUrl(ctx, d));
}
