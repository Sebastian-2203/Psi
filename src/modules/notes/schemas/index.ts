import { z } from 'zod';
import { richTextDraftSchema, richTextSchema } from '@/lib/rich-text';
import { localeField, requiredText, uuidField } from '@/lib/validation';

/**
 * Clinical note schemas (API_CONTRACTS §8.9). Notes are private professional documentation:
 * no contract exposes them to patients or guardians, and nothing converts a patient response
 * into a note (non-negotiable rules 3 and 4). Drafts may be empty; finalization requires content
 * (DB-enforced).
 */

export const ADDENDUM_REASONS = ['correction', 'clarification', 'late_entry', 'other'] as const;

export const createNoteDraftSchema = z
  .object({
    recordId: uuidField,
    noteTypeId: uuidField,
    therapySessionId: uuidField.optional(),
    body: richTextDraftSchema,
    contentLocale: localeField.default('es'),
  })
  .strict();
export type CreateNoteDraftInput = z.input<typeof createNoteDraftSchema>;

export const updateNoteDraftSchema = z
  .object({
    noteId: uuidField,
    body: richTextDraftSchema.optional(),
    noteTypeId: uuidField.optional(),
    therapySessionId: uuidField.nullable().optional(),
    contentLocale: localeField.optional(),
    expectedUpdatedAt: z.string().min(1).max(64),
  })
  .strict();
export type UpdateNoteDraftInput = z.input<typeof updateNoteDraftSchema>;

export const noteIdSchema = z.object({ noteId: uuidField }).strict();
export type NoteIdInput = z.input<typeof noteIdSchema>;

export const discardNoteDraftSchema = z
  .object({ noteId: uuidField, reason: requiredText(500, 3) })
  .strict();
export type DiscardNoteDraftInput = z.input<typeof discardNoteDraftSchema>;

export const createAddendumSchema = z
  .object({
    noteId: uuidField,
    reason: z.enum(ADDENDUM_REASONS, 'choiceInvalid'),
    body: richTextSchema,
    contentLocale: localeField.default('es'),
    idempotencyKey: uuidField,
  })
  .strict();
export type CreateAddendumInput = z.input<typeof createAddendumSchema>;

export const listNotesSchema = z
  .object({
    patientId: uuidField,
    limit: z.number().int().min(1).max(100).default(50),
    before: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type ListNotesInput = z.input<typeof listNotesSchema>;
