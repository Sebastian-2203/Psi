import 'server-only';
import type { z } from 'zod';
import type { RichText } from '@/lib/rich-text';
import {
  auditTarget,
  iso,
  memberNames,
  notFound,
  runClinical,
} from '@/modules/clinical-records/server/shared';
import type {
  createAddendumSchema,
  createNoteDraftSchema,
  discardNoteDraftSchema,
  listNotesSchema,
  updateNoteDraftSchema,
} from '@/modules/notes/schemas';
import { recordAudit } from '@/server/audit';
import type { AuthzContext } from '@/server/authz';
import { AppError, type Outcome } from '@/server/errors';

/**
 * Clinical notes (API_CONTRACTS §8.9, ADR-006). Drafts are author-only (RLS + trigger);
 * finalization runs app.finalize_clinical_note (self-validating trigger, audit in the same
 * transaction); finalized notes are immutable for every role; corrections are append-only
 * addenda. NEVER exposed to patients or guardians.
 */

type Out<S extends z.ZodType> = z.output<S>;

export type NoteRef = { noteId: string; updatedAt: string };

export async function createNoteDraft(
  ctx: AuthzContext,
  input: Out<typeof createNoteDraftSchema>,
): Promise<Outcome<NoteRef>> {
  return runClinical(ctx, 'clinical.note.write', async (tx, org) => {
    const [record] = await tx<{ patient_id: string }[]>`
      select patient_id from public.clinical_records where organization_id = ${org} and id = ${input.recordId}`;
    if (!record) return notFound();
    const [row] = await tx<{ id: string; updated_at: Date }[]>`
      insert into public.clinical_notes (organization_id, clinical_record_id, patient_id, therapy_session_id,
        note_type_id, body, content_locale, author_membership_id)
      values (${org}, ${input.recordId}, ${record.patient_id}, ${input.therapySessionId ?? null}, ${input.noteTypeId},
        ${tx.json(input.body as never)}, ${input.contentLocale}, app.my_membership_id(${org}::uuid))
      returning id, updated_at`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'clinical_note.created',
      {
        patient_id: record.patient_id,
        ...(input.therapySessionId ? { session_id: input.therapySessionId } : {}),
      },
      auditTarget(ctx, 'clinical_note', row.id),
    );
    return { noteId: row.id, updatedAt: iso(row.updated_at) as string };
  });
}

export async function updateNoteDraft(
  ctx: AuthzContext,
  input: Out<typeof updateNoteDraftSchema>,
): Promise<Outcome<NoteRef>> {
  return runClinical(ctx, 'clinical.note.write', async (tx, org) => {
    const [current] = await tx<{ patient_id: string; status: string; updated_at: Date }[]>`
      select patient_id, status, updated_at from public.clinical_notes
      where organization_id = ${org} and id = ${input.noteId} and discarded_at is null`;
    if (!current) return notFound();
    if (current.status === 'finalized') throw new AppError('IMMUTABLE_RECORD');
    if (iso(current.updated_at) !== input.expectedUpdatedAt) throw new AppError('CONFLICT');
    const values: Record<string, unknown> = {};
    if (input.body !== undefined) values.body = tx.json(input.body as never);
    if (input.noteTypeId !== undefined) values.note_type_id = input.noteTypeId;
    if (input.therapySessionId !== undefined) values.therapy_session_id = input.therapySessionId;
    if (input.contentLocale !== undefined) values.content_locale = input.contentLocale;
    const changed = Object.keys(values);
    if (changed.length === 0) return { noteId: input.noteId, updatedAt: input.expectedUpdatedAt };
    // RLS (own draft) decides; 0 rows = not the author's draft any more.
    const [row] = await tx<{ updated_at: Date }[]>`
      update public.clinical_notes set ${tx(values as Record<string, never>, ...changed)}
      where organization_id = ${org} and id = ${input.noteId}
      returning updated_at`;
    if (!row) throw new AppError('CONFLICT');
    // TODO(throttle): API_CONTRACTS marks draft_updated as throttled; one row per save for now.
    await recordAudit(
      tx,
      'clinical_note.draft_updated',
      { patient_id: current.patient_id, changed_fields: changed },
      auditTarget(ctx, 'clinical_note', input.noteId),
    );
    return { noteId: input.noteId, updatedAt: iso(row.updated_at) as string };
  });
}

export async function finalizeNote(
  ctx: AuthzContext,
  input: { noteId: string },
): Promise<Outcome<{ finalizedAt: string; contentHash: string }>> {
  return runClinical(ctx, 'clinical.note.finalize', async (tx, org) => {
    const [row] = await tx<{ finalized_at: Date; content_hash: string }[]>`
      select * from app.finalize_clinical_note(${org}::uuid, ${input.noteId}::uuid, ${ctx.requestId})`;
    if (!row) return notFound();
    return { finalizedAt: iso(row.finalized_at) as string, contentHash: row.content_hash };
  });
}

export async function discardNoteDraft(
  ctx: AuthzContext,
  input: Out<typeof discardNoteDraftSchema>,
): Promise<Outcome<{ ok: true }>> {
  return runClinical(ctx, 'clinical.note.write', async (tx, org) => {
    const [row] = await tx<{ patient_id: string }[]>`
      update public.clinical_notes set discarded_at = now(), discard_reason = ${input.reason}
      where organization_id = ${org} and id = ${input.noteId} and status = 'draft' and discarded_at is null
      returning patient_id`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'clinical_note.draft_discarded',
      { patient_id: row.patient_id },
      auditTarget(ctx, 'clinical_note', input.noteId),
    );
    return { ok: true as const };
  });
}

export type AddendumDto = {
  id: string;
  reason: 'correction' | 'clarification' | 'late_entry' | 'other';
  body: RichText;
  contentLocale: 'es' | 'en';
  authorMembershipId: string;
  /** Staff display name (org_member_directory); null when no longer listed. */
  authorName: string | null;
  contentHash: string;
  createdAt: string;
};

type AddendumRow = {
  id: string;
  reason: AddendumDto['reason'];
  body: RichText;
  content_locale: 'es' | 'en';
  author_membership_id: string;
  content_hash: string;
  created_at: Date;
};
const toAddendum = (a: AddendumRow, name: (id: string) => string | null): AddendumDto => ({
  id: a.id,
  reason: a.reason,
  body: a.body,
  contentLocale: a.content_locale,
  authorMembershipId: a.author_membership_id,
  authorName: name(a.author_membership_id),
  contentHash: a.content_hash,
  createdAt: iso(a.created_at) as string,
});

/** NOTE-03. Idempotent per (author, idempotencyKey): a retry returns the same addendum. */
export async function createAddendum(
  ctx: AuthzContext,
  input: Out<typeof createAddendumSchema>,
): Promise<Outcome<AddendumDto>> {
  return runClinical(ctx, 'clinical.note.addendum.create', async (tx, org) => {
    const [note] = await tx<{ patient_id: string; status: string }[]>`
      select patient_id, status from public.clinical_notes
      where organization_id = ${org} and id = ${input.noteId} and discarded_at is null`;
    if (!note) return notFound();
    const [existing] = await tx<AddendumRow[]>`
      select id, reason, body, content_locale, author_membership_id, encode(content_hash, 'hex') as content_hash, created_at
      from public.clinical_note_addenda
      where organization_id = ${org} and clinical_note_id = ${input.noteId}
        and author_membership_id = app.my_membership_id(${org}::uuid) and idempotency_key = ${input.idempotencyKey}`;
    const name = await memberNames(tx, org);
    if (existing) return toAddendum(existing, name);
    const [row] = await tx<AddendumRow[]>`
      insert into public.clinical_note_addenda (organization_id, clinical_note_id, patient_id, reason, body,
        content_locale, author_membership_id, content_hash, idempotency_key)
      values (${org}, ${input.noteId}, ${note.patient_id}, ${input.reason}::public.addendum_reason,
        ${tx.json(input.body as never)}, ${input.contentLocale}, app.my_membership_id(${org}::uuid), '\\x00'::bytea,
        ${input.idempotencyKey})
      returning id, reason, body, content_locale, author_membership_id, encode(content_hash, 'hex') as content_hash, created_at`;
    if (!row) return notFound();
    await recordAudit(
      tx,
      'clinical_note.addendum_created',
      { patient_id: note.patient_id, addendum_id: row.id, correction_kind: input.reason },
      auditTarget(ctx, 'clinical_note', input.noteId),
    );
    return toAddendum(row, name);
  });
}

export type NoteSummaryDto = {
  id: string;
  noteTypeId: string;
  therapySessionId: string | null;
  status: 'draft' | 'finalized';
  authorMembershipId: string;
  authorName: string | null;
  createdAt: string;
  updatedAt: string;
  finalizedAt: string | null;
  addendumCount: number;
};
export type NoteWithAddendaDto = NoteSummaryDto & {
  patientId: string;
  body: RichText;
  contentLocale: 'es' | 'en';
  contentHash: string | null;
  addenda: AddendumDto[];
};

type NoteRow = {
  id: string;
  patient_id: string;
  note_type_id: string;
  therapy_session_id: string | null;
  status: 'draft' | 'finalized';
  author_membership_id: string;
  created_at: Date;
  updated_at: Date;
  finalized_at: Date | null;
  addenda: number;
};
const toSummary = (n: NoteRow, name: (id: string) => string | null): NoteSummaryDto => ({
  id: n.id,
  noteTypeId: n.note_type_id,
  therapySessionId: n.therapy_session_id,
  status: n.status,
  authorMembershipId: n.author_membership_id,
  authorName: name(n.author_membership_id),
  createdAt: iso(n.created_at) as string,
  updatedAt: iso(n.updated_at) as string,
  finalizedAt: iso(n.finalized_at),
  addendumCount: n.addenda,
});

/** Finalized notes + the caller's own drafts (RLS), newest first. Bodies are not listed. */
export async function listNotes(
  ctx: AuthzContext,
  input: Out<typeof listNotesSchema>,
): Promise<Outcome<NoteSummaryDto[]>> {
  return runClinical(ctx, 'clinical.record.read', async (tx, org) => {
    const [visible] =
      await tx`select app.can_read_clinical(${org}::uuid, ${input.patientId}::uuid) as ok`;
    if (!visible?.ok) return notFound();
    const rows = await tx<NoteRow[]>`
      select n.id, n.patient_id, n.note_type_id, n.therapy_session_id, n.status, n.author_membership_id,
             n.created_at, n.updated_at, n.finalized_at,
             (select count(*)::int from public.clinical_note_addenda a
               where a.organization_id = n.organization_id and a.clinical_note_id = n.id) as addenda
      from public.clinical_notes n
      where n.organization_id = ${org} and n.patient_id = ${input.patientId} and n.discarded_at is null
        and (${input.before ?? null}::timestamptz is null or n.created_at < ${input.before ?? null}::timestamptz)
      order by n.created_at desc limit ${input.limit}`;
    await recordAudit(
      tx,
      'clinical_note.list_viewed',
      { patient_id: input.patientId, result_count: rows.length },
      auditTarget(ctx, 'patient', input.patientId),
    );
    const name = await memberNames(tx, org);
    return rows.map((r) => toSummary(r, name));
  });
}

/** CLR-05: the note and its addenda, displayed together. */
export async function getNote(
  ctx: AuthzContext,
  noteId: string,
): Promise<Outcome<NoteWithAddendaDto>> {
  return runClinical(ctx, 'clinical.record.read', async (tx, org) => {
    const [n] = await tx<
      (NoteRow & { body: RichText; content_locale: 'es' | 'en'; content_hash: string | null })[]
    >`
      select n.id, n.patient_id, n.note_type_id, n.therapy_session_id, n.status, n.author_membership_id,
             n.created_at, n.updated_at, n.finalized_at, 0 as addenda, n.body, n.content_locale,
             encode(n.content_hash, 'hex') as content_hash
      from public.clinical_notes n
      where n.organization_id = ${org} and n.id = ${noteId} and n.discarded_at is null`;
    if (!n) return notFound();
    const addenda = await tx<AddendumRow[]>`
      select id, reason, body, content_locale, author_membership_id, encode(content_hash, 'hex') as content_hash, created_at
      from public.clinical_note_addenda where organization_id = ${org} and clinical_note_id = ${noteId}
      order by created_at`;
    await recordAudit(
      tx,
      'clinical_note.viewed',
      { patient_id: n.patient_id },
      auditTarget(ctx, 'clinical_note', noteId),
    );
    const name = await memberNames(tx, org);
    return {
      ...toSummary({ ...n, addenda: addenda.length }, name),
      patientId: n.patient_id,
      body: n.body,
      contentLocale: n.content_locale,
      contentHash: n.content_hash,
      addenda: addenda.map((a) => toAddendum(a, name)),
    };
  });
}

export type MyDraftNoteDto = {
  noteId: string;
  patientId: string;
  therapySessionId: string | null;
  noteTypeId: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * NOTE-02/SES-04: the caller's OWN undiscarded drafts across patients (including drafts not
 * linked to a session). RLS (draft = author only + app.can_read_clinical) bounds the rows; the
 * explicit author filter is belt and braces. No body is returned.
 */
export async function listMyDraftNotes(ctx: AuthzContext): Promise<Outcome<MyDraftNoteDto[]>> {
  return runClinical(ctx, 'clinical.record.read', async (tx, org) => {
    const rows = await tx<
      {
        id: string;
        patient_id: string;
        therapy_session_id: string | null;
        note_type_id: string;
        created_at: Date;
        updated_at: Date;
      }[]
    >`
      select n.id, n.patient_id, n.therapy_session_id, n.note_type_id, n.created_at, n.updated_at
      from public.clinical_notes n
      where n.organization_id = ${org} and n.status = 'draft' and n.discarded_at is null
        and n.author_membership_id = app.my_membership_id(${org}::uuid)
      order by n.updated_at desc limit 100`;
    await recordAudit(
      tx,
      'clinical_note.list_viewed',
      { result_count: rows.length },
      auditTarget(ctx, 'clinical_note', null),
    );
    return rows.map((n) => ({
      noteId: n.id,
      patientId: n.patient_id,
      therapySessionId: n.therapy_session_id,
      noteTypeId: n.note_type_id,
      createdAt: iso(n.created_at) as string,
      updatedAt: iso(n.updated_at) as string,
    }));
  });
}
