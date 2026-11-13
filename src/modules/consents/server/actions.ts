'use server';

import {
  createConsentTemplateSchema,
  patientConsentStatusSchema,
  publishConsentVersionSchema,
  recordConsentSchema,
  saveConsentVersionDraftSchema,
  signableConsentsSchema,
  signConsentSchema,
  withdrawConsentSchema,
  type CreateConsentTemplateInput,
  type PatientConsentStatusInput,
  type PublishConsentVersionInput,
  type RecordConsentInput,
  type SaveConsentVersionDraftInput,
  type SignableConsentsInput,
  type SignConsentInput,
  type WithdrawConsentInput,
} from '@/modules/consents/schemas';
import { runAction } from '@/server/actions/run';
import { getRequestMeta } from '@/server/auth/request-meta';
import { getPatientConsentStatus, listSignableConsents } from './queries';
import {
  createConsentTemplate,
  publishConsentVersion,
  recordConsent,
  saveConsentVersionDraft,
  signConsent,
  withdrawConsent,
} from './service';

/** Consent server actions (API_CONTRACTS §8.11). Evidence is captured server-side only. */

export async function createConsentTemplateAction(input: CreateConsentTemplateInput) {
  return runAction(createConsentTemplateSchema, input, (ctx, d) => createConsentTemplate(ctx, d));
}
export async function saveConsentVersionDraftAction(input: SaveConsentVersionDraftInput) {
  return runAction(saveConsentVersionDraftSchema, input, (ctx, d) =>
    saveConsentVersionDraft(ctx, d),
  );
}
export async function publishConsentVersionAction(input: PublishConsentVersionInput) {
  return runAction(publishConsentVersionSchema, input, (ctx, d) => publishConsentVersion(ctx, d));
}
export async function recordConsentAction(input: RecordConsentInput) {
  return runAction(recordConsentSchema, input, (ctx, d) => recordConsent(ctx, d));
}
export async function withdrawConsentAction(input: WithdrawConsentInput) {
  return runAction(withdrawConsentSchema, input, (ctx, d) => withdrawConsent(ctx, d));
}

/** Portal. IP / user agent come from the request, never from the client. */
export async function signConsentAction(input: SignConsentInput) {
  return runAction(signConsentSchema, input, async (ctx, d) => {
    const meta = await getRequestMeta();
    return signConsent(ctx, d, { ip: meta.ip, userAgent: meta.userAgent });
  });
}

export async function getPatientConsentStatusAction(input: PatientConsentStatusInput) {
  return runAction(patientConsentStatusSchema, input, (ctx, d) =>
    getPatientConsentStatus(ctx, d.patientId),
  );
}
export async function listSignableConsentsAction(input: SignableConsentsInput = {}) {
  return runAction(signableConsentsSchema, input, (ctx, d) =>
    listSignableConsents(ctx, d.patientId),
  );
}
