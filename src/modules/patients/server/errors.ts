import 'server-only';

/** `PRECONDITION:<key>` raised by the patient DB layer -> user-facing i18n key. */
export const PATIENT_PRECONDITION_KEYS = {
  activation_requirements_missing: 'patients.errors.activationRequirementsMissing',
  invalid_status_transition: 'patients.errors.invalidStatusTransition',
  patient_read_only: 'patients.errors.readOnly',
  self_assignment_reason_required: 'patients.errors.selfAssignmentReasonRequired',
  care_team_requires_psychologist: 'patients.errors.careTeamRequiresPsychologist',
  portal_mode_care_team_only: 'patients.errors.portalModeCareTeamOnly',
  staff_cannot_be_patient: 'patients.errors.staffCannotBePatient',
  end_reason_required: 'patients.errors.endReasonRequired',
  patient_not_invitable: 'patients.errors.notInvitable',
} as const;
