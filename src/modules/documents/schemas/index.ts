import { z } from 'zod';
import { isoDateField, optionalText, requiredText, uuidField } from '@/lib/validation';

/**
 * Clinical documents (API_CONTRACTS §8.10, DOC-01..03). Files live in the PRIVATE
 * `clinical-documents` bucket; bytes are written by the server only and read through
 * short-lived signed URLs after `app.can_read_file`. Notes can never be shared (NOTE-04).
 */

export const CLINICAL_DOCUMENT_TYPES = [
  'referral',
  'report',
  'external_evaluation',
  'consent_scan',
  'certificate',
  'other',
] as const;
export const MAX_CLINICAL_FILE_BYTES = 20 * 1024 * 1024;

export const uploadClinicalDocumentSchema = z
  .object({
    recordId: uuidField,
    documentType: z.enum(CLINICAL_DOCUMENT_TYPES, 'choiceInvalid'),
    title: requiredText(200),
    documentDate: isoDateField.optional(),
    description: optionalText(1000),
    supersedesDocumentId: uuidField.optional(),
  })
  .strict();
export type UploadClinicalDocumentInput = z.input<typeof uploadClinicalDocumentSchema>;

export const archiveClinicalDocumentSchema = z
  .object({ documentId: uuidField, reason: requiredText(500, 3) })
  .strict();
export type ArchiveClinicalDocumentInput = z.input<typeof archiveClinicalDocumentSchema>;

export const shareClinicalDocumentSchema = z
  .object({ documentId: uuidField, guardianVisible: z.boolean().default(false) })
  .strict();
export type ShareClinicalDocumentInput = z.input<typeof shareClinicalDocumentSchema>;

export const unshareClinicalDocumentSchema = z.object({ shareId: uuidField }).strict();
export type UnshareClinicalDocumentInput = z.input<typeof unshareClinicalDocumentSchema>;

export const patientIdSchema = z.object({ patientId: uuidField }).strict();
export const fileIdSchema = z.object({ fileObjectId: uuidField }).strict();
export type FileIdInput = z.input<typeof fileIdSchema>;

export const portalDocumentsSchema = z.object({ patientId: uuidField.optional() }).strict();
export type PortalDocumentsInput = z.input<typeof portalDocumentsSchema>;
export const portalDocumentUrlSchema = z
  .object({ documentId: uuidField, patientId: uuidField.optional() })
  .strict();
export type PortalDocumentUrlInput = z.input<typeof portalDocumentUrlSchema>;
