import 'server-only';

export const CONSENT_PRECONDITION_KEYS = {
  consent_version_not_signable: 'consents.errors.notSignable',
  consent_not_applicable: 'consents.errors.notApplicable',
  consent_text_mismatch: 'consents.errors.textMismatch',
  consent_evidence_incomplete: 'consents.errors.evidenceIncomplete',
  signer_not_allowed: 'consents.errors.signerNotAllowed',
  assent_requires_patient: 'consents.errors.assentRequiresPatient',
  legal_representative_not_verified: 'consents.errors.legalRepresentativeNotVerified',
  relationship_not_active: 'consents.errors.relationshipNotActive',
  jurisdiction_not_configured: 'consents.errors.jurisdictionNotConfigured',
  paper_scan_requires_file_storage: 'consents.errors.paperScanUnavailable',
  method_not_allowed: 'consents.errors.methodNotAllowed',
  decided_at_invalid: 'consents.errors.decidedAtInvalid',
  consent_not_withdrawable: 'consents.errors.notWithdrawable',
  withdrawal_reason_required: 'consents.errors.withdrawalReasonRequired',
  template_has_no_published_version: 'consents.errors.templateHasNoPublishedVersion',
  invalid_version_transition: 'consents.errors.invalidVersionTransition',
} as const;
