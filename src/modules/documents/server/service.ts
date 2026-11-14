import 'server-only';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  auditTarget,
  iso,
  notFound,
  runClinical,
  runPortal,
} from '@/modules/clinical-records/server/shared';
import type {
  archiveClinicalDocumentSchema,
  shareClinicalDocumentSchema,
  uploadClinicalDocumentSchema,
} from '@/modules/documents/schemas';
import { recordAudit } from '@/server/audit';
import type { AuthzContext } from '@/server/authz';
import {
  CLINICAL_SIGNED_URL_TTL_SECONDS,
  serviceRoleRemoveClinicalObject,
  serviceRoleSignClinicalObject,
  serviceRoleUploadClinicalObject,
} from '@/server/db/service-role';
import { AppError, failure, type Outcome } from '@/server/errors';
import { validateClinicalFile } from './file-validation';

/**
 * Clinical documents (API_CONTRACTS §8.10). The service-role Storage client is used ONLY after
 * the caller's RLS-bound transaction authorized the action:
 *   upload: file_objects INSERT (policy app.can_write_clinical) -> service-role upload ->
 *           ready + clinical_documents INSERT + audit (second user transaction);
 *   URL:    app.can_read_file in the user transaction -> audit -> service-role signed URL
 *           (TTL CLINICAL_SIGNED_URL_TTL_SECONDS).
 * The bucket is private and has no authenticated policy, so no other path to the bytes exists.
 */

type Out<S extends z.ZodType> = z.output<S>;
type DocumentType = Out<typeof uploadClinicalDocumentSchema>['documentType'];

export type ClinicalDocumentDto = {
  id: string;
  patientId: string;
  recordId: string;
  fileObjectId: string;
  documentType: DocumentType;
  title: string;
  documentDate: string | null;
  description: string | null;
  supersedesDocumentId: string | null;
  mimeType: string;
  sizeBytes: number;
  displayName: string;
  uploadedByMembershipId: string;
  createdAt: string;
  archivedAt: string | null;
  activeShare: { shareId: string; guardianVisible: boolean; sharedAt: string } | null;
};

export type UploadedFile = { bytes: Uint8Array; type: string; name: string };

export async function uploadClinicalDocument(
  ctx: AuthzContext,
  input: Out<typeof uploadClinicalDocumentSchema>,
  upload: UploadedFile,
): Promise<Outcome<{ documentId: string; fileObjectId: string }>> {
  const checked = validateClinicalFile(upload.bytes, upload.type, upload.name);
  if (!checked.ok) {
    return failure('VALIDATION_FAILED', {
      messageKey: `clinical.errors.${checked.reason === 'fieldRequired' ? 'uploadFailed' : checked.reason}`,
      fieldErrors: { file: [checked.reason] },
    });
  }
  const file = checked.file;
  const fileId = randomUUID();

  // 1. Authorize + reserve the metadata row (RLS: care team, org active).
  const reserved = await runClinical(ctx, 'clinical.document.upload', async (tx, org) => {
    const [record] = await tx<{ patient_id: string; status: string }[]>`
      select patient_id, status from public.clinical_records where organization_id = ${org} and id = ${input.recordId}`;
    if (!record) return notFound();
    if (record.status !== 'open')
      throw new AppError('PRECONDITION_FAILED', { messageKey: 'clinical.errors.recordClosed' });
    const path = `org/${org}/patient/${record.patient_id}/${fileId}`;
    await tx`
      insert into public.file_objects (id, organization_id, patient_id, bucket, storage_path, mime_type, size_bytes,
        display_name, uploaded_by)
      values (${fileId}, ${org}, ${record.patient_id}, 'clinical-documents', ${path}, ${file.mimeType},
        ${file.sizeBytes}, ${file.displayName}, ${ctx.profileId})`;
    return { patientId: record.patient_id, path };
  });
  if (!reserved.ok) return reserved;

  // 2. Bytes (service role; only after step 1 succeeded).
  try {
    await serviceRoleUploadClinicalObject(reserved.data.path, file.bytes, file.mimeType);
  } catch {
    await runClinical(ctx, 'clinical.document.upload', async (tx, org) => {
      await tx`update public.file_objects set status = 'deleted' where organization_id = ${org} and id = ${fileId}`;
    });
    return failure('INTERNAL', { messageKey: 'clinical.errors.uploadFailed' });
  }

  // 3. Ready + document + audit.
  const attached = await runClinical(ctx, 'clinical.document.upload', async (tx, org) => {
    await tx`
      update public.file_objects set status = 'ready', sha256 = decode(${file.sha256Hex}, 'hex')
      where organization_id = ${org} and id = ${fileId}`;
    const [doc] = await tx<{ id: string }[]>`
      insert into public.clinical_documents (organization_id, clinical_record_id, patient_id, file_object_id,
        document_type, title, document_date, description, supersedes_document_id, uploaded_by_membership_id)
      values (${org}, ${input.recordId}, ${reserved.data.patientId}, ${fileId},
        ${input.documentType}::public.clinical_document_type, ${input.title}, ${input.documentDate ?? null}::date,
        ${input.description ?? null}, ${input.supersedesDocumentId ?? null}, app.my_membership_id(${org}::uuid))
      returning id`;
    if (!doc) return notFound();
    await recordAudit(
      tx,
      'clinical_document.attached',
      {
        patient_id: reserved.data.patientId,
        file_object_id: fileId,
        ...(input.supersedesDocumentId ? { replaces_id: input.supersedesDocumentId } : {}),
      },
      auditTarget(ctx, 'clinical_document', doc.id),
    );
    return { documentId: doc.id, fileObjectId: fileId };
  });
  if (!attached.ok) {
    try {
      await serviceRoleRemoveClinicalObject(reserved.data.path);
      await runClinical(ctx, 'clinical.document.upload', async (tx, org) => {
        await tx`update public.file_objects set status = 'deleted' where organization_id = ${org} and id = ${fileId}`;
      });
    } catch {
      // Orphan pending row / object: harmless (no read path), swept by a later job (pending).
    }
  }
  return attached;
}

export async function archiveClinicalDocument(
  ctx: AuthzContext,
  input: Out<typeof archiveClinicalDocumentSchema>,
): Promise<Outcome<{ ok: true }>> {
  return runClinical(ctx, 'clinical.document.upload', async (tx, org) => {
    const [row] = await tx<{ patient_id: string }[]>`
      update public.clinical_documents set archived_at = now(), archive_reason = ${input.reason}
      where organization_id = ${org} and id = ${input.documentId} and archived_at is null
      returning patient_id`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'clinical_document.archived',
      { patient_id: row.patient_id },
      auditTarget(ctx, 'clinical_document', input.documentId),
    );
    return { ok: true as const };
  });
}

export async function listClinicalDocuments(
  ctx: AuthzContext,
  patientId: string,
): Promise<Outcome<ClinicalDocumentDto[]>> {
  return runClinical(ctx, 'clinical.document.read', async (tx, org) => {
    const [visible] =
      await tx`select app.can_read_clinical(${org}::uuid, ${patientId}::uuid) as ok`;
    if (!visible?.ok) return notFound();
    const rows = await tx<
      {
        id: string;
        patient_id: string;
        clinical_record_id: string;
        file_object_id: string;
        document_type: DocumentType;
        title: string;
        document_date: string | null;
        description: string | null;
        supersedes_document_id: string | null;
        mime_type: string;
        size_bytes: string;
        display_name: string;
        uploaded_by_membership_id: string;
        created_at: Date;
        archived_at: Date | null;
        share_id: string | null;
        guardian_visible: boolean | null;
        shared_at: Date | null;
      }[]
    >`select d.id, d.patient_id, d.clinical_record_id, d.file_object_id, d.document_type, d.title,
             d.document_date::text, d.description, d.supersedes_document_id, f.mime_type, f.size_bytes::text,
             f.display_name, d.uploaded_by_membership_id, d.created_at, d.archived_at,
             s.id as share_id, s.guardian_visible, s.shared_at
      from public.clinical_documents d
      join public.file_objects f on f.organization_id = d.organization_id and f.id = d.file_object_id
      left join public.clinical_document_shares s
        on s.organization_id = d.organization_id and s.clinical_document_id = d.id and s.revoked_at is null
      where d.organization_id = ${org} and d.patient_id = ${patientId}
      order by d.created_at desc limit 500`;
    await recordAudit(
      tx,
      'clinical_document.list_viewed',
      { patient_id: patientId, result_count: rows.length },
      auditTarget(ctx, 'patient', patientId),
    );
    return rows.map((d) => ({
      id: d.id,
      patientId: d.patient_id,
      recordId: d.clinical_record_id,
      fileObjectId: d.file_object_id,
      documentType: d.document_type,
      title: d.title,
      documentDate: d.document_date,
      description: d.description,
      supersedesDocumentId: d.supersedes_document_id,
      mimeType: d.mime_type,
      sizeBytes: Number(d.size_bytes),
      displayName: d.display_name,
      uploadedByMembershipId: d.uploaded_by_membership_id,
      createdAt: iso(d.created_at) as string,
      archivedAt: iso(d.archived_at),
      activeShare:
        d.share_id && d.shared_at
          ? {
              shareId: d.share_id,
              guardianVisible: d.guardian_visible ?? false,
              sharedAt: iso(d.shared_at) as string,
            }
          : null,
    }));
  });
}

/** DOC-02. One active share per document; re-sharing with another guardian flag = unshare first. */
export async function shareClinicalDocument(
  ctx: AuthzContext,
  input: Out<typeof shareClinicalDocumentSchema>,
): Promise<Outcome<{ shareId: string; guardianVisible: boolean; guardianCaveatActive: boolean }>> {
  return runClinical(ctx, 'clinical.document.share', async (tx, org) => {
    const [doc] = await tx<{ patient_id: string }[]>`
      select patient_id from public.clinical_documents where organization_id = ${org} and id = ${input.documentId}`;
    if (!doc) return notFound();
    const [row] = await tx<{ id: string }[]>`
      insert into public.clinical_document_shares (organization_id, clinical_document_id, patient_id,
        shared_by_membership_id, guardian_visible)
      values (${org}, ${input.documentId}, ${doc.patient_id}, app.my_membership_id(${org}::uuid), ${input.guardianVisible})
      returning id`;
    if (!row) return notFound();
    // API_CONTRACTS: warn (not block) when a guardian relationship carries an active caveat.
    const [caveat] = await tx<{ active: boolean }[]>`
      select exists (select 1 from public.patient_guardian_caveats c
        join public.patient_guardians pg on pg.organization_id = c.organization_id and pg.id = c.patient_guardian_id
        where c.organization_id = ${org} and pg.patient_id = ${doc.patient_id} and c.ended_at is null) as active`;
    await recordAudit(
      tx,
      'document.shared',
      { patient_id: doc.patient_id, share_id: row.id, guardian_visible: input.guardianVisible },
      auditTarget(ctx, 'clinical_document', input.documentId),
    );
    return {
      shareId: row.id,
      guardianVisible: input.guardianVisible,
      guardianCaveatActive: input.guardianVisible && (caveat?.active ?? false),
    };
  });
}

export async function unshareClinicalDocument(
  ctx: AuthzContext,
  input: { shareId: string },
): Promise<Outcome<{ ok: true }>> {
  return runClinical(ctx, 'clinical.document.share', async (tx, org) => {
    const [row] = await tx<{ patient_id: string; clinical_document_id: string }[]>`
      update public.clinical_document_shares set revoked_at = now()
      where organization_id = ${org} and id = ${input.shareId} and revoked_at is null
      returning patient_id, clinical_document_id`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'document.unshared',
      { patient_id: row.patient_id, share_id: input.shareId },
      auditTarget(ctx, 'clinical_document', row.clinical_document_id),
    );
    return { ok: true as const };
  });
}

export type SignedUrlDto = { url: string; expiresInSeconds: number };

/** DOC-03 (staff): RLS-bound check, audit, then a short-lived signed URL. */
export async function issueClinicalFileUrl(
  ctx: AuthzContext,
  input: { fileObjectId: string },
): Promise<Outcome<SignedUrlDto>> {
  return runClinical(ctx, 'clinical.document.read', async (tx, org) => {
    const [f] = await tx<{ storage_path: string; patient_id: string; readable: boolean }[]>`
      select storage_path, patient_id, app.can_read_file(id) as readable from public.file_objects
      where organization_id = ${org} and id = ${input.fileObjectId} and bucket = 'clinical-documents'`;
    if (
      !f ||
      !f.readable ||
      !(await tx`select app.can_read_clinical(${org}::uuid, ${f.patient_id}::uuid) as ok`)[0]?.ok
    ) {
      return notFound();
    }
    await recordAudit(
      tx,
      'file.download_url_issued',
      {
        patient_id: f.patient_id,
        file_object_id: input.fileObjectId,
        ttl_seconds: CLINICAL_SIGNED_URL_TTL_SECONDS,
      },
      auditTarget(ctx, 'file_object', input.fileObjectId),
    );
    const url = await serviceRoleSignClinicalObject(f.storage_path);
    return { url, expiresInSeconds: CLINICAL_SIGNED_URL_TTL_SECONDS };
  });
}

export type PortalDocumentDto = {
  documentId: string;
  title: string;
  documentType: DocumentType;
  documentDate: string | null;
  mimeType: string;
  sizeBytes: number;
  sharedAt: string;
};

/** PRT-07: documents shared with the patient (guardian: guardian_visible + permission). Audited. */
export async function listMySharedDocuments(
  ctx: AuthzContext,
  patientId?: string,
): Promise<Outcome<PortalDocumentDto[]>> {
  return runPortal(ctx, 'portal.document.read', patientId, async (tx, org, patient) => {
    const rows = await tx<
      {
        document_id: string;
        title: string;
        document_type: DocumentType;
        document_date: string | null;
        mime_type: string;
        size_bytes: string;
        shared_at: Date;
      }[]
    >`select document_id, title, document_type, document_date::text, mime_type, size_bytes::text, shared_at
      from app.portal_shared_documents(${org}::uuid, ${patient}::uuid)`;
    await tx`select app.audit_portal_document_access(${org}::uuid, ${patient}::uuid, null, ${rows.length}, ${ctx.requestId})`;
    return rows.map((r) => ({
      documentId: r.document_id,
      title: r.title,
      documentType: r.document_type,
      documentDate: r.document_date,
      mimeType: r.mime_type,
      sizeBytes: Number(r.size_bytes),
      sharedAt: iso(r.shared_at) as string,
    }));
  });
}

/** Portal signed URL: the definer audit function re-checks the active share first. */
export async function issuePortalDocumentUrl(
  ctx: AuthzContext,
  input: { documentId: string; patientId?: string },
): Promise<Outcome<SignedUrlDto>> {
  return runPortal(ctx, 'portal.document.read', input.patientId, async (tx, org, patient) => {
    const [shared] = await tx<{ file_object_id: string }[]>`
      select file_object_id from app.portal_shared_documents(${org}::uuid, ${patient}::uuid)
      where document_id = ${input.documentId}`;
    if (!shared) throw new AppError('NOT_FOUND');
    const [f] = await tx<{ storage_path: string }[]>`
      select storage_path from public.file_objects where organization_id = ${org} and id = ${shared.file_object_id}`;
    if (!f) throw new AppError('NOT_FOUND');
    await tx`select app.audit_portal_document_access(${org}::uuid, ${patient}::uuid, ${input.documentId}::uuid, null, ${ctx.requestId})`;
    const url = await serviceRoleSignClinicalObject(f.storage_path);
    return { url, expiresInSeconds: CLINICAL_SIGNED_URL_TTL_SECONDS };
  });
}
