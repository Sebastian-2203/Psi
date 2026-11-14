'use server';

import {
  createAddendumSchema,
  createNoteDraftSchema,
  discardNoteDraftSchema,
  listNotesSchema,
  noteIdSchema,
  updateNoteDraftSchema,
  type CreateAddendumInput,
  type CreateNoteDraftInput,
  type DiscardNoteDraftInput,
  type ListNotesInput,
  type NoteIdInput,
  type UpdateNoteDraftInput,
} from '@/modules/notes/schemas';
import { runAction } from '@/server/actions/run';
import {
  createAddendum,
  createNoteDraft,
  discardNoteDraft,
  finalizeNote,
  getNote,
  listNotes,
  updateNoteDraft,
} from './service';

/** Clinical note actions (API_CONTRACTS §8.9). Staff only; never reachable from the portal. */

export async function createNoteDraftAction(input: CreateNoteDraftInput) {
  return runAction(createNoteDraftSchema, input, (ctx, d) => createNoteDraft(ctx, d));
}
export async function updateNoteDraftAction(input: UpdateNoteDraftInput) {
  return runAction(updateNoteDraftSchema, input, (ctx, d) => updateNoteDraft(ctx, d));
}
/** Requires aal2 (registry); the UI must ask for an explicit confirmation first (ADR-006). */
export async function finalizeNoteAction(input: NoteIdInput) {
  return runAction(noteIdSchema, input, (ctx, d) => finalizeNote(ctx, d));
}
export async function discardNoteDraftAction(input: DiscardNoteDraftInput) {
  return runAction(discardNoteDraftSchema, input, (ctx, d) => discardNoteDraft(ctx, d));
}
export async function createAddendumAction(input: CreateAddendumInput) {
  return runAction(createAddendumSchema, input, (ctx, d) => createAddendum(ctx, d));
}
export async function getNoteAction(input: NoteIdInput) {
  return runAction(noteIdSchema, input, (ctx, d) => getNote(ctx, d.noteId));
}
export async function listNotesAction(input: ListNotesInput) {
  return runAction(listNotesSchema, input, (ctx, d) => listNotes(ctx, d));
}
