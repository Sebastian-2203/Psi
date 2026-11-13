'use server';

import { getTranslations } from 'next-intl/server';
import { emptyInput } from '@/lib/validation';
import {
  assignCareTeamMemberSchema,
  changePatientStatusSchema,
  createPatientSchema,
  endCareTeamMemberSchema,
  invitePatientSchema,
  listMyPatientsSchema,
  patientIdSchema,
  updatePatientPreferencesSchema,
  updatePatientSchema,
  type AssignCareTeamMemberInput,
  type ChangePatientStatusInput,
  type CreatePatientInput,
  type EndCareTeamMemberInput,
  type InvitePatientInput,
  type ListMyPatientsInput,
  type PatientIdInput,
  type UpdatePatientInput,
  type UpdatePatientPreferencesInput,
} from '@/modules/patients/schemas';
import { runAction } from '@/server/actions/run';
import {
  createPortalInvitation,
  PORTAL_INVITATION_TTL_HOURS,
  type CreatedInvitation,
} from '@/server/auth/invitations';
import { getRequestMeta } from '@/server/auth/request-meta';
import { failure } from '@/server/errors';
import {
  getPatient,
  getPrivacyView,
  listDirectory,
  listMyPatients,
  type DirectoryEntry,
  type PatientDetail,
  type PatientSummary,
  type PrivacyViewEntry,
} from './queries';
import {
  assignCareTeamMember,
  changePatientStatus,
  createPatient,
  endCareTeamMember,
  updatePatient,
  updatePatientPreferences,
} from './service';

/**
 * Patient server actions (API_CONTRACTS §8.4). Thin: Zod `.strict()` -> getAuthzContext ->
 * use case in ./service or ./queries (permission + one user transaction + audit) -> Result.
 */

export async function createPatientAction(input: CreatePatientInput) {
  return runAction(createPatientSchema, input, (ctx, data) => createPatient(ctx, data));
}

export async function updatePatientAction(input: UpdatePatientInput) {
  return runAction(updatePatientSchema, input, (ctx, data) => updatePatient(ctx, data));
}

export async function changePatientStatusAction(input: ChangePatientStatusInput) {
  return runAction(changePatientStatusSchema, input, (ctx, data) => changePatientStatus(ctx, data));
}

export async function assignCareTeamMemberAction(input: AssignCareTeamMemberInput) {
  return runAction(assignCareTeamMemberSchema, input, (ctx, data) =>
    assignCareTeamMember(ctx, data),
  );
}

export async function endCareTeamMemberAction(input: EndCareTeamMemberInput) {
  return runAction(endCareTeamMemberSchema, input, (ctx, data) => endCareTeamMember(ctx, data));
}

export async function updatePatientPreferencesAction(input: UpdatePatientPreferencesInput) {
  return runAction(updatePatientPreferencesSchema, input, (ctx, data) =>
    updatePatientPreferences(ctx, data),
  );
}

export async function invitePatientToPortalAction(input: InvitePatientInput) {
  return runAction(invitePatientSchema, input, async (ctx, data) => {
    const meta = await getRequestMeta();
    if (!meta.origin) return failure('PRECONDITION_FAILED');
    const t = await getTranslations({ locale: data.emailLocale, namespace: 'auth.emails' });
    return createPortalInvitation(
      ctx,
      { kind: 'patient', patientId: data.patientId },
      data.email,
      meta.origin,
      (link) => ({
        to: data.email,
        subject: t('portalInvitationSubject'),
        text: t('portalInvitationBody', { link, days: PORTAL_INVITATION_TTL_HOURS / 24 }),
      }),
      data.emailLocale,
    );
  });
}

// Reads exposed as actions for client-side refresh; pages call the queries directly.
export async function listDirectoryAction() {
  return runAction(emptyInput, {}, (ctx) => listDirectory(ctx));
}

export async function listMyPatientsAction(input: ListMyPatientsInput = {}) {
  return runAction(listMyPatientsSchema, input, (ctx, data) => listMyPatients(ctx, data));
}

export async function getPatientAction(input: PatientIdInput) {
  return runAction(patientIdSchema, input, (ctx, data) => getPatient(ctx, data.patientId));
}

export async function getPrivacyViewAction() {
  return runAction(emptyInput, {}, (ctx) => getPrivacyView(ctx));
}

export type { CreatedInvitation, DirectoryEntry, PatientDetail, PatientSummary, PrivacyViewEntry };
