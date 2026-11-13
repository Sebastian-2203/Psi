import 'server-only';

export const GUARDIAN_PRECONDITION_KEYS = {
  patient_not_minor: 'guardians.errors.patientNotMinor',
  invalid_relationship_transition: 'guardians.errors.invalidTransition',
  majority_reactivation_not_supported: 'guardians.errors.majorityReactivationUnsupported',
  relationship_not_verified: 'guardians.errors.notVerified',
  relationship_not_grantable: 'guardians.errors.notGrantable',
  schedule_restricted_by_caveat: 'guardians.errors.scheduleRestricted',
  guardian_not_invitable: 'guardians.errors.notInvitable',
  staff_cannot_be_guardian: 'guardians.errors.staffCannotBeGuardian',
  suspension_reason_required: 'guardians.errors.suspensionReasonRequired',
  revoke_reason_required: 'guardians.errors.revokeReasonRequired',
} as const;
