'use server';

import { emptyInput } from '@/lib/validation';
import {
  listSessionsSchema,
  portalPatientSchema,
  recordSessionSchema,
  updateSessionSchema,
  type ListSessionsInput,
  type PortalPatientInput,
  type RecordSessionInput,
  type UpdateSessionInput,
} from '@/modules/sessions/schemas';
import { runAction } from '@/server/actions/run';
import {
  listMyUpcomingSessions,
  listPendingNoteSessions,
  listSessions,
  recordSession,
  updateSession,
} from './service';

/** Session record actions (API_CONTRACTS §8.8). */

export async function recordSessionAction(input: RecordSessionInput) {
  return runAction(recordSessionSchema, input, (ctx, d) => recordSession(ctx, d));
}
export async function updateSessionAction(input: UpdateSessionInput) {
  return runAction(updateSessionSchema, input, (ctx, d) => updateSession(ctx, d));
}
export async function listSessionsAction(input: ListSessionsInput) {
  return runAction(listSessionsSchema, input, (ctx, d) => listSessions(ctx, d));
}
export async function listPendingNoteSessionsAction() {
  return runAction(emptyInput, {}, (ctx) => listPendingNoteSessions(ctx));
}
export async function listMyUpcomingSessionsAction(input: PortalPatientInput) {
  return runAction(portalPatientSchema, input, (ctx, d) =>
    listMyUpcomingSessions(ctx, d.patientId),
  );
}
