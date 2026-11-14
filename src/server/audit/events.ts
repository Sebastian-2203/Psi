import 'server-only';
import { z } from 'zod';

/**
 * Audit event catalog (API_CONTRACTS §9, SECURITY.md §7.1) — Phase 1 + Phase 2 events.
 * Must match `app.audit_event_types` (20261108120300_audit.sql, 20261109100000_patients_guardians.sql,
 * 20261109110000_consents.sql); tests/integration/audit.test.ts asserts parity. Events written by
 * the DB itself (definer functions / triggers) are listed with the metadata the DB writes.
 *
 * Metadata rules (SECURITY.md §7.3): ids, enum values, changed field NAMES, status
 * transitions. NEVER names, emails, document numbers, free text, response values, file names.
 * Every schema is `.strict()` with snake_case keys (the DB also rejects risky key names).
 */

const id = z.uuid();
const role = z.enum(['organization_owner', 'psychologist']);
const fieldNames = z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(32);
const empty = z.object({}).strict();
const patientStatus = z.enum(['intake', 'active', 'paused', 'discharged', 'archived']);
const consentType = z.enum([
  'treatment_informed_consent',
  'personal_data_processing',
  'minor_assent',
  'guardian_authorization',
  'portal_use',
  'other',
]);
const guardianPermission = z.enum([
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
]);
const relationshipStatus = z.enum(['pending_verification', 'active', 'suspended', 'revoked']);
const consentRecordMeta = {
  patient_id: id,
  consent_record_id: id,
  consent_type: consentType,
};

const dsrStatus = z.enum(['received', 'in_review', 'fulfilled', 'partially_fulfilled', 'rejected']);
const dsrMeta = {
  data_subject_request_id: id,
  request_type: z.enum([
    'access',
    'rectification',
    'update',
    'suppression',
    'revoke_authorization',
    'other',
  ]),
  patient_id: id.optional(),
};

// Clinical (Phase 3). Ids, enum values, counts and field NAMES only — never note bodies,
// section content, diagnosis labels, titles or file names. The entity id is resource_id.
const pid = { patient_id: id };
const onlyPatient = z.object(pid).strict();
const counted = z.object({ ...pid, result_count: z.number().int().min(0) }).strict();
const changed = z.object({ ...pid, changed_fields: fieldNames }).strict();
const transition = <T extends readonly [string, ...string[]]>(values: T) =>
  z.object({ ...pid, from_status: z.enum(values), to_status: z.enum(values) }).strict();
const planStatus = ['draft', 'active', 'completed', 'superseded', 'discontinued'] as const;
const goalStatus = ['open', 'in_progress', 'achieved', 'discontinued'] as const;
const diagnosisStatus = ['provisional', 'confirmed', 'ruled_out', 'resolved'] as const;
const sessionStatus = [
  'scheduled',
  'held',
  'cancelled_by_patient',
  'cancelled_by_psychologist',
  'no_show',
] as const;

type Writer = 'user' | 'system' | 'both';
type Category =
  | 'auth'
  | 'organization'
  | 'membership'
  | 'invitation'
  | 'branding'
  | 'profile'
  | 'platform'
  | 'security'
  | 'patient'
  | 'care_team'
  | 'guardian'
  | 'consent'
  | 'privacy'
  | 'clinical'
  | 'file';

type EventSpec = {
  category: Category;
  writer: Writer;
  orgOptional: boolean;
  metadata: z.ZodType<Record<string, unknown>>;
};

function event<M extends z.ZodType<Record<string, unknown>>>(
  category: Category,
  writer: Writer,
  orgOptional: boolean,
  metadata: M,
) {
  return { category, writer, orgOptional, metadata } as const satisfies EventSpec;
}

export const AUDIT_EVENTS = {
  // auth
  'auth.signed_in': event(
    'auth',
    'both',
    true,
    z.object({ method: z.enum(['password', 'magic_link']).optional() }).strict(),
  ),
  'auth.sign_in_failed': event(
    'auth',
    'system',
    true,
    z.object({ method: z.enum(['password', 'magic_link']).optional() }).strict(),
  ),
  'auth.signed_out': event('auth', 'user', true, empty),
  'auth.mfa_enrolled': event('auth', 'user', true, z.object({ factor_id: id }).strict()),
  'auth.mfa_verified': event('auth', 'user', true, z.object({ factor_id: id }).strict()),
  'auth.mfa_failed': event('auth', 'both', true, z.object({ factor_id: id.optional() }).strict()),
  'auth.mfa_reset': event(
    'auth',
    'system',
    true,
    z
      .object({
        via: z.enum(['recovery_code', 'support']),
        outcome: z.enum(['started', 'ok', 'partial', 'failed']).optional(),
        attempt: z.number().int().min(1).optional(),
        factors_removed: z.number().int().min(0).optional(),
      })
      .strict(),
  ),
  'auth.password_reset': event('auth', 'both', true, empty),
  'auth.rate_limited': event(
    'auth',
    'system',
    true,
    z.object({ action: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/) }).strict(),
  ),
  'auth.org_switched': event(
    'auth',
    'user',
    false,
    z.object({ from_organization_id: id.nullable() }).strict(),
  ),
  'auth.capacity_switched': event(
    'auth',
    'user',
    false,
    z
      .object({
        from_acting_as: z.enum(['staff', 'patient', 'guardian', 'platform_admin']).nullable(),
        to_acting_as: z.enum(['staff', 'patient', 'guardian', 'platform_admin']),
      })
      .strict(),
  ),
  'auth.session_revoked': event(
    'auth',
    'system',
    true,
    z.object({ scope: z.enum(['others', 'global']) }).strict(),
  ),
  'auth.recovery_codes_generated': event('auth', 'user', true, z.object({ batch_id: id }).strict()),
  'auth.recovery_code_used': event('auth', 'system', true, z.object({ batch_id: id }).strict()),
  // organization
  'organization.provisioned': event(
    'organization',
    'system',
    false,
    z.object({ invitation_id: id.optional() }).strict(),
  ),
  'organization.updated': event(
    'organization',
    'user',
    false,
    z.object({ changed_fields: fieldNames }).strict(),
  ),
  'organization.suspended': event(
    'organization',
    'both',
    false,
    z.object({ from_status: z.enum(['active', 'read_only']) }).strict(),
  ),
  'organization_domain.added': event(
    'organization',
    'user',
    false,
    z.object({ domain_id: id, domain_type: z.enum(['subdomain', 'custom']) }).strict(),
  ),
  'organization_domain.verified': event(
    'organization',
    'system',
    false,
    z.object({ domain_id: id }).strict(),
  ),
  'organization_domain.removed': event(
    'organization',
    'user',
    false,
    z.object({ domain_id: id }).strict(),
  ),
  // branding
  'organization_branding.updated': event(
    'branding',
    'user',
    false,
    z.object({ changed_fields: fieldNames }).strict(),
  ),
  'organization_branding.logo_uploaded': event(
    'branding',
    'user',
    false,
    z
      .object({
        media_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
        size_bytes: z.number().int().min(1).max(1_048_576),
      })
      .strict(),
  ),
  'organization_branding.logo_removed': event(
    'branding',
    'user',
    false,
    z.object({ had_logo: z.boolean() }).strict(),
  ),
  // membership
  'membership.created': event(
    'membership',
    'system',
    false,
    z.object({ invitation_id: id }).strict(),
  ),
  'membership.roles_changed': event(
    'membership',
    'user',
    false,
    z.object({ added: z.array(role).max(2), removed: z.array(role).max(2) }).strict(),
  ),
  'membership.role_self_granted': event('membership', 'user', false, z.object({ role }).strict()),
  'membership.suspended': event('membership', 'user', false, empty),
  'membership.removed': event('membership', 'user', false, empty),
  'professional_profile.updated': event(
    'membership',
    'user',
    false,
    z.object({ changed_fields: fieldNames }).strict(),
  ),
  // invitation
  'invitation.created': event(
    'invitation',
    'user',
    false,
    z
      .object({
        // staff: roles; patient / guardian: the subject ids (never the invited email).
        roles: z.array(role).min(1).max(2).optional(),
        invitation_type: z.enum(['staff', 'patient', 'guardian']).optional(),
        patient_id: id.optional(),
        guardian_id: id.optional(),
        patient_guardian_id: id.optional(),
      })
      .strict(),
  ),
  'invitation.accepted': event(
    'invitation',
    'system',
    false,
    z
      .object({
        membership_id: id.optional(),
        patient_id: id.optional(),
        guardian_id: id.optional(),
      })
      .strict(),
  ),
  'invitation.revoked': event('invitation', 'user', false, empty),
  'invitation.expired': event('invitation', 'system', false, empty),
  // profile
  'profile.updated': event(
    'profile',
    'user',
    true,
    z.object({ changed_fields: fieldNames }).strict(),
  ),
  // platform
  'platform_grant.requested': event(
    'platform',
    'user',
    false,
    z
      .object({
        grant_id: id,
        scope: z.enum(['org_support_non_clinical', 'clinical_read_break_glass']),
      })
      .strict(),
  ),
  // patients (Phase 2)
  'patient.created': event(
    'patient',
    'user',
    false,
    z
      .object({ patient_id: id, care_team_membership_id: id, is_minor: z.boolean().nullable() })
      .strict(),
  ),
  'patient.updated': event(
    'patient',
    'user',
    false,
    z.object({ patient_id: id, changed_fields: fieldNames }).strict(),
  ),
  'patient.viewed': event('patient', 'user', false, z.object({ patient_id: id }).strict()),
  'patient.list_viewed': event(
    'patient',
    'user',
    false,
    z.object({ result_count: z.number().int().min(0) }).strict(),
  ),
  'patient.directory_viewed': event(
    'patient',
    'user',
    false,
    z.object({ result_count: z.number().int().min(0) }).strict(),
  ),
  'patient.status_changed': event(
    'patient',
    'user',
    false,
    z.object({ patient_id: id, from_status: patientStatus, to_status: patientStatus }).strict(),
  ),
  'patient.portal_linked': event(
    'patient',
    'system',
    false,
    z.object({ patient_id: id, invitation_id: id }).strict(),
  ),
  'patient_preferences.updated': event(
    'patient',
    'user',
    false,
    z.object({ patient_id: id, changed_fields: fieldNames }).strict(),
  ),
  // care team
  'care_team.assigned': event(
    'care_team',
    'user',
    false,
    z
      .object({
        patient_id: id,
        membership_id: id,
        care_role: z.enum(['primary', 'secondary', 'supervisor']),
      })
      .strict(),
  ),
  'care_team.self_assigned': event(
    'care_team',
    'user',
    false,
    z
      .object({
        patient_id: id,
        membership_id: id,
        care_role: z.enum(['primary', 'secondary', 'supervisor']),
      })
      .strict(),
  ),
  'care_team.ended': event(
    'care_team',
    'user',
    false,
    z.object({ patient_id: id, membership_id: id }).strict(),
  ),
  // guardians
  'guardian.created': event(
    'guardian',
    'user',
    false,
    z.object({ patient_id: id, guardian_id: id }).strict(),
  ),
  'guardian.updated': event(
    'guardian',
    'user',
    false,
    z.object({ guardian_id: id, changed_fields: fieldNames }).strict(),
  ),
  'guardian.portal_linked': event(
    'guardian',
    'system',
    false,
    z.object({ guardian_id: id, invitation_id: id }).strict(),
  ),
  'patient_guardian.created': event(
    'guardian',
    'user',
    false,
    z
      .object({
        patient_id: id,
        guardian_id: id,
        patient_guardian_id: id,
        relationship: z.string().regex(/^[a-z_]{1,32}$/),
        is_legal_representative: z.boolean(),
      })
      .strict(),
  ),
  'patient_guardian.updated': event(
    'guardian',
    'user',
    false,
    z.object({ patient_id: id, patient_guardian_id: id, changed_fields: fieldNames }).strict(),
  ),
  'patient_guardian.verified': event(
    'guardian',
    'user',
    false,
    z
      .object({
        patient_id: id,
        patient_guardian_id: id,
        legal_basis_verified: z.boolean(),
        from_status: relationshipStatus,
      })
      .strict(),
  ),
  'patient_guardian.suspended': event(
    'guardian',
    'both',
    false,
    z
      .object({
        patient_id: id,
        patient_guardian_id: id,
        suspension: z.enum(['age_of_majority', 'custody_review', 'safety_concern', 'other']),
      })
      .strict(),
  ),
  'patient_guardian.reactivated': event(
    'guardian',
    'user',
    false,
    z.object({ patient_id: id, patient_guardian_id: id }).strict(),
  ),
  'patient_guardian.revoked': event(
    'guardian',
    'user',
    false,
    z
      .object({
        patient_id: id,
        patient_guardian_id: id,
        from_status: relationshipStatus,
        permissions_revoked: z.number().int().min(0),
      })
      .strict(),
  ),
  'guardian_caveat.set': event(
    'guardian',
    'user',
    false,
    z.object({ patient_id: id, patient_guardian_id: id, restrict_schedule: z.boolean() }).strict(),
  ),
  'guardian_caveat.ended': event(
    'guardian',
    'user',
    false,
    z.object({ patient_id: id, patient_guardian_id: id }).strict(),
  ),
  'guardian_permission.granted': event(
    'guardian',
    'user',
    false,
    z
      .object({
        patient_id: id,
        patient_guardian_id: id,
        permissions: z.array(guardianPermission),
        before: z.array(guardianPermission),
        after: z.array(guardianPermission),
        adolescent_view_responses: z.boolean().nullable().optional(),
      })
      .strict(),
  ),
  'guardian_permission.revoked': event(
    'guardian',
    'user',
    false,
    z
      .object({
        patient_id: id,
        patient_guardian_id: id,
        permissions: z.array(guardianPermission),
        before: z.array(guardianPermission),
        after: z.array(guardianPermission),
      })
      .strict(),
  ),
  // consents
  'consent_template.created': event(
    'consent',
    'user',
    false,
    z.object({ consent_template_id: id, consent_type: consentType }).strict(),
  ),
  'consent_template.updated': event(
    'consent',
    'user',
    false,
    z.object({ consent_template_id: id, changed_fields: fieldNames }).strict(),
  ),
  'consent_template_version.draft_saved': event(
    'consent',
    'user',
    false,
    z.object({ consent_template_id: id, consent_template_version_id: id }).strict(),
  ),
  'consent_template_version.published': event(
    'consent',
    'user',
    false,
    z.object({ consent_template_id: id, consent_template_version_id: id }).strict(),
  ),
  'consent_template_version.retired': event(
    'consent',
    'user',
    false,
    z.object({ consent_template_id: id, consent_template_version_id: id }).strict(),
  ),
  'consent.signed': event(
    'consent',
    'user',
    false,
    z
      .object({
        ...consentRecordMeta,
        consent_template_version_id: id,
        signer_type: z.enum(['patient', 'guardian']),
        method: z.literal('portal_typed_name'),
      })
      .strict(),
  ),
  'consent.declined': event(
    'consent',
    'user',
    false,
    z
      .object({
        ...consentRecordMeta,
        consent_template_version_id: id,
        signer_type: z.enum(['patient', 'guardian']),
        method: z.literal('portal_typed_name'),
      })
      .strict(),
  ),
  'consent.recorded': event(
    'consent',
    'user',
    false,
    z
      .object({
        ...consentRecordMeta,
        consent_template_version_id: id,
        signer_type: z.enum(['patient', 'guardian', 'professional_recorded']),
        method: z.enum(['portal_checkbox', 'portal_typed_name', 'paper_scan', 'verbal_recorded']),
        decision: z.enum(['accepted', 'declined']),
      })
      .strict(),
  ),
  'consent.withdrawn': event(
    'consent',
    'user',
    false,
    z
      .object({ ...consentRecordMeta, withdrawn_by: z.enum(['staff', 'patient', 'guardian']) })
      .strict(),
  ),
  'consent.status_viewed': event('consent', 'user', false, z.object({ patient_id: id }).strict()),
  'consent.evidence_viewed': event(
    'consent',
    'user',
    false,
    z.object({ patient_id: id, consent_record_id: id }).strict(),
  ),
  // privacy (PAT-09). Written by the DB in definer functions; never any free text.
  'data_subject_request.submitted': event(
    'privacy',
    'user',
    false,
    z
      .object({
        ...dsrMeta,
        subject_type: z.enum(['patient', 'guardian']),
      })
      .strict(),
  ),
  'data_subject_request.status_changed': event(
    'privacy',
    'user',
    false,
    z
      .object({
        ...dsrMeta,
        from_status: dsrStatus,
        to_status: dsrStatus,
      })
      .strict(),
  ),
  'data_subject_request.due_date_set': event('privacy', 'user', false, z.object(dsrMeta).strict()),
  'data_subject_request.list_viewed': event(
    'privacy',
    'user',
    false,
    z.object({ result_count: z.number().int().min(0) }).strict(),
  ),
  // clinical (Phase 3)
  'clinical_config.updated': event(
    'clinical',
    'user',
    false,
    z
      .object({
        config_kind: z.enum(['section_definition', 'note_type']),
        changed_fields: fieldNames,
      })
      .strict(),
  ),
  'clinical_record.opened': event('clinical', 'user', false, onlyPatient),
  'clinical_record.viewed': event('clinical', 'user', false, onlyPatient),
  'clinical_record.closed': event('clinical', 'user', false, onlyPatient),
  'clinical_record.reopened': event('clinical', 'user', false, onlyPatient),
  'clinical_record_section.updated': event(
    'clinical',
    'user',
    false,
    z.object({ ...pid, section_definition_id: id, revision: z.number().int().min(1) }).strict(),
  ),
  'clinical_record_section.history_viewed': event('clinical', 'user', false, counted),
  'clinical_assessment.created': event('clinical', 'user', false, onlyPatient),
  'clinical_assessment.updated': event('clinical', 'user', false, changed),
  'clinical_assessment.finalized': event('clinical', 'user', false, onlyPatient),
  'clinical_assessment.discarded': event('clinical', 'user', false, onlyPatient),
  'clinical_assessment.list_viewed': event('clinical', 'user', false, counted),
  'clinical_diagnosis.added': event(
    'clinical',
    'user',
    false,
    z
      .object({
        ...pid,
        code_system: z.enum(['cie10', 'cie11', 'dsm5tr', 'other']),
        status: z.enum(diagnosisStatus),
      })
      .strict(),
  ),
  'clinical_diagnosis.status_changed': event(
    'clinical',
    'user',
    false,
    transition(diagnosisStatus),
  ),
  'treatment_plan.created': event(
    'clinical',
    'user',
    false,
    z.object({ ...pid, goal_count: z.number().int().min(0) }).strict(),
  ),
  'treatment_plan.updated': event('clinical', 'user', false, changed),
  'treatment_plan.activated': event('clinical', 'user', false, onlyPatient),
  'treatment_plan.revised': event(
    'clinical',
    'user',
    false,
    z.object({ ...pid, supersedes_plan_id: id }).strict(),
  ),
  'treatment_plan.status_changed': event('clinical', 'user', false, transition(planStatus)),
  'treatment_plan.viewed': event('clinical', 'user', false, onlyPatient),
  'treatment_goal.added': event(
    'clinical',
    'user',
    false,
    z.object({ ...pid, plan_id: id }).strict(),
  ),
  'treatment_goal.status_changed': event('clinical', 'user', false, transition(goalStatus)),
  'treatment_goal.patient_text_set': event(
    'clinical',
    'user',
    false,
    z.object({ ...pid, action: z.enum(['set', 'cleared', 'withdrawn']) }).strict(),
  ),
  'therapy_session.recorded': event(
    'clinical',
    'user',
    false,
    z
      .object({
        ...pid,
        status: z.enum(sessionStatus),
        modality: z.enum(['in_person', 'remote_external', 'phone']),
      })
      .strict(),
  ),
  'therapy_session.updated': event(
    'clinical',
    'user',
    false,
    z
      .object({
        ...pid,
        changed_fields: fieldNames,
        from_status: z.enum(sessionStatus).optional(),
        to_status: z.enum(sessionStatus).optional(),
      })
      .strict(),
  ),
  'therapy_session.list_viewed': event(
    'clinical',
    'user',
    false,
    z.object({ patient_id: id.optional(), result_count: z.number().int().min(0) }).strict(),
  ),
  'clinical_note.created': event(
    'clinical',
    'user',
    false,
    z.object({ ...pid, session_id: id.optional() }).strict(),
  ),
  'clinical_note.draft_updated': event('clinical', 'user', false, changed),
  'clinical_note.finalized': event('clinical', 'user', false, onlyPatient),
  'clinical_note.draft_discarded': event('clinical', 'user', false, onlyPatient),
  'clinical_note.addendum_created': event(
    'clinical',
    'user',
    false,
    z
      .object({
        ...pid,
        addendum_id: id,
        correction_kind: z.enum(['correction', 'clarification', 'late_entry', 'other']),
      })
      .strict(),
  ),
  'clinical_note.viewed': event('clinical', 'user', false, onlyPatient),
  'clinical_note.list_viewed': event(
    'clinical',
    'user',
    false,
    z.object({ patient_id: id.optional(), result_count: z.number().int().min(0) }).strict(),
  ),
  'clinical_document.attached': event(
    'clinical',
    'user',
    false,
    z.object({ ...pid, file_object_id: id, replaces_id: id.optional() }).strict(),
  ),
  'clinical_document.archived': event('clinical', 'user', false, onlyPatient),
  'clinical_document.list_viewed': event('clinical', 'user', false, counted),
  'document.shared': event(
    'clinical',
    'user',
    false,
    z.object({ ...pid, share_id: id, guardian_visible: z.boolean() }).strict(),
  ),
  'document.unshared': event(
    'clinical',
    'user',
    false,
    z.object({ ...pid, share_id: id }).strict(),
  ),
  'document.portal_list_viewed': event('clinical', 'user', false, counted),
  'document.portal_url_issued': event(
    'file',
    'user',
    false,
    z.object({ ...pid, file_object_id: id }).strict(),
  ),
  'file.download_url_issued': event(
    'file',
    'user',
    false,
    z
      .object({ ...pid, file_object_id: id, ttl_seconds: z.number().int().min(1).max(300) })
      .strict(),
  ),
  // security
  'access.denied': event(
    'security',
    'system',
    true,
    z
      .object({
        permission: z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/),
        code: z.enum(['FORBIDDEN', 'NOT_FOUND']),
        acting_as: z.enum(['staff', 'patient', 'guardian', 'platform_admin']).nullable(),
      })
      .strict(),
  ),
  'access.rate_limited': event(
    'security',
    'system',
    true,
    z.object({ action: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/) }).strict(),
  ),
} as const;

export type AuditEventType = keyof typeof AUDIT_EVENTS;
export type AuditMetadata<E extends AuditEventType> = z.input<(typeof AUDIT_EVENTS)[E]['metadata']>;

export type UserAuditEventType = {
  [E in AuditEventType]: (typeof AUDIT_EVENTS)[E]['writer'] extends 'system' ? never : E;
}[AuditEventType];

export type SystemAuditEventType = {
  [E in AuditEventType]: (typeof AUDIT_EVENTS)[E]['writer'] extends 'user' ? never : E;
}[AuditEventType];

export const AUDIT_EVENT_TYPES = Object.keys(AUDIT_EVENTS) as AuditEventType[];
