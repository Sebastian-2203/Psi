import type { ActionResult } from '@/modules/auth/schemas/result';
import type { CreateGuardianInput, SetPermissionsInput } from '@/modules/guardians/schemas';

export type RelationshipStatus = 'pending_verification' | 'active' | 'suspended' | 'revoked';

/** Client-safe mirror of the care-team guardian DTO. */
export type GuardianRelationshipDto = {
  patientGuardianId: string;
  guardianId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  relationship: string;
  status: RelationshipStatus;
  suspensionReason: string | null;
  isLegalRepresentative: boolean;
  legalBasis: string | null;
  legalBasisVerified: boolean;
  isPrimaryContact: boolean;
  validFrom: string;
  validUntil: string | null;
  hasPortalLogin: boolean;
  permissions: string[];
  caveat: { text: string; restrictSchedule: boolean } | null;
};

type A<I, O = unknown> = (input: I) => Promise<ActionResult<O>>;

export type GuardianActions = {
  create: A<CreateGuardianInput, { guardianId: string; patientGuardianId: string }>;
  verify: A<{
    patientGuardianId: string;
    verificationNote?: string;
    validFrom?: string;
    validUntil?: string;
    verifyLegalBasis: boolean;
  }>;
  suspend: A<{ patientGuardianId: string; reason: 'custody_review' | 'safety_concern' | 'other' }>;
  reactivate: A<{ patientGuardianId: string }>;
  revoke: A<{ patientGuardianId: string; reason: string }>;
  setCaveat: A<{ patientGuardianId: string; caveat: string; restrictSchedule: boolean }>;
  endCaveat: A<{ patientGuardianId: string }>;
  setPermissions: A<SetPermissionsInput>;
  invite: A<{ patientGuardianId: string; email: string; emailLocale: 'es' | 'en' }>;
};

export const PERMISSION_KEYS = [
  'view_assignments',
  'complete_assignments',
  'view_responses',
  'view_shared_resources',
  'sign_consents',
  'view_session_schedule',
  'manage_portal_preferences',
  'receive_notifications',
  'view_shared_documents',
  'view_patient_facing_goals',
] as const;
