'use server';

import { getTranslations } from 'next-intl/server';
import { emptyInput } from '@/lib/validation';
import {
  createGuardianSchema,
  inviteGuardianSchema,
  listGuardiansSchema,
  relationshipIdSchema,
  revokeRelationshipSchema,
  setCaveatSchema,
  setPermissionsSchema,
  suspendRelationshipSchema,
  verifyRelationshipSchema,
  type CreateGuardianInput,
  type InviteGuardianInput,
  type ListGuardiansInput,
  type RelationshipIdInput,
  type RevokeRelationshipInput,
  type SetCaveatInput,
  type SetPermissionsInput,
  type SuspendRelationshipInput,
  type VerifyRelationshipInput,
} from '@/modules/guardians/schemas';
import { runAction } from '@/server/actions/run';
import { createPortalInvitation, PORTAL_INVITATION_TTL_HOURS } from '@/server/auth/invitations';
import { getRequestMeta } from '@/server/auth/request-meta';
import { failure } from '@/server/errors';
import { getMyRelationships, listGuardiansForPatient } from './queries';
import {
  createGuardian,
  endCaveat,
  reactivateRelationship,
  revokeRelationship,
  setCaveat,
  setPermissions,
  suspendRelationship,
  verifyRelationship,
} from './service';

/** Guardian server actions (API_CONTRACTS §8.5). Thin wrappers over ./service and ./queries. */

export async function createGuardianAction(input: CreateGuardianInput) {
  return runAction(createGuardianSchema, input, (ctx, d) => createGuardian(ctx, d));
}
export async function verifyGuardianRelationshipAction(input: VerifyRelationshipInput) {
  return runAction(verifyRelationshipSchema, input, (ctx, d) => verifyRelationship(ctx, d));
}
export async function suspendGuardianRelationshipAction(input: SuspendRelationshipInput) {
  return runAction(suspendRelationshipSchema, input, (ctx, d) => suspendRelationship(ctx, d));
}
export async function reactivateGuardianRelationshipAction(input: RelationshipIdInput) {
  return runAction(relationshipIdSchema, input, (ctx, d) => reactivateRelationship(ctx, d));
}
export async function revokeGuardianRelationshipAction(input: RevokeRelationshipInput) {
  return runAction(revokeRelationshipSchema, input, (ctx, d) => revokeRelationship(ctx, d));
}
export async function setGuardianCaveatAction(input: SetCaveatInput) {
  return runAction(setCaveatSchema, input, (ctx, d) => setCaveat(ctx, d));
}
export async function endGuardianCaveatAction(input: RelationshipIdInput) {
  return runAction(relationshipIdSchema, input, (ctx, d) => endCaveat(ctx, d));
}
export async function setGuardianPermissionsAction(input: SetPermissionsInput) {
  return runAction(setPermissionsSchema, input, (ctx, d) => setPermissions(ctx, d));
}

export async function inviteGuardianToPortalAction(input: InviteGuardianInput) {
  return runAction(inviteGuardianSchema, input, async (ctx, d) => {
    const meta = await getRequestMeta();
    if (!meta.origin) return failure('PRECONDITION_FAILED');
    const t = await getTranslations({ locale: d.emailLocale, namespace: 'auth.emails' });
    return createPortalInvitation(
      ctx,
      { kind: 'guardian', patientGuardianId: d.patientGuardianId },
      d.email,
      meta.origin,
      (link) => ({
        to: d.email,
        subject: t('portalInvitationSubject'),
        text: t('portalInvitationBody', { link, days: PORTAL_INVITATION_TTL_HOURS / 24 }),
      }),
      d.emailLocale,
    );
  });
}

export async function listGuardiansAction(input: ListGuardiansInput) {
  return runAction(listGuardiansSchema, input, (ctx, d) =>
    listGuardiansForPatient(ctx, d.patientId),
  );
}
export async function getMyRelationshipsAction() {
  return runAction(emptyInput, {}, (ctx) => getMyRelationships(ctx));
}
