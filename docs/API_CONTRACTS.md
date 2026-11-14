# API Contracts

> Status: **Phase 0 — Proposed.** Contracts are design targets; nothing is implemented.
> Related: [ARCHITECTURE.md](./ARCHITECTURE.md) · [DATABASE.md](./DATABASE.md) · [DECISIONS.md](./DECISIONS.md)
> Permission names and the role matrix require security review before Phase 1.

---

## 1. Conventions

| Concern | Convention |
|---|---|
| Mutations | **Server Actions** (`'use server'`) in `modules/<domain>/server/actions.ts`, named `verbNounAction`. |
| Reads for pages | React Server Components call DAL query functions (`getX`, `listX`) directly; no public HTTP API. |
| Route Handlers (`src/app/api/...`) | Only for: signed URL issuance (download/upload), exports/downloads (file streams), auth callbacks, health check, future webhooks. |
| Public REST/GraphQL API | **None in MVP.** If needed later, it is a separate ADR. |
| Input | Always a single object validated by a Zod schema exported from `modules/<domain>/schemas`. Same schema used by React Hook Form on the client (`zodResolver`). |
| Output | Server actions return `Result<T>` (never throw to client). Route handlers return JSON envelope or a stream. |
| IDs | UUID strings. Never expose sequential ids. |
| Dates | ISO 8601 strings in UTC for timestamps; `YYYY-MM-DD` for dates. Formatting happens in UI with org/user time zone. |
| Locale | Taken from the request (next-intl), never from input, except explicit content-locale fields. |
| Organization | Taken from `AuthzContext`, **never** from client input. Inputs never contain `organizationId`. |
| Caching | **No shared caching of tenant/patient/clinical data** (F-17): no `unstable_cache`, fetch cache or `revalidateTag` for them; pages render dynamically, responses `Cache-Control: private, no-store`. Only branding and static catalogs use tags (`org:<id>:branding`). Actions refresh views with `revalidatePath`/`router.refresh()` of dynamic routes. |
| Data path | Per ADR-019 (Proposed). Contracts below are independent of Option A/B. |
| Rate limits | `withAction` applies the ADR-020 limiter (per profile + IP, per action class) before the handler. |
| PHI in URLs | Forbidden in query strings (no names, documents). Only opaque ids in paths. |

---

## 2. Result type

```ts
// src/server/errors/result.ts
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppErrorPayload };

export type AppErrorPayload = {
  code: ErrorCode;
  messageKey: string;            // i18n key, e.g. "errors.forbidden"
  fieldErrors?: Record<string, string[]>; // i18n keys per field (VALIDATION_FAILED)
  requestId: string;
  retryable: boolean;
};
```

Route handler error envelope: `{ "error": AppErrorPayload }` with HTTP status per §3.

Helpers: `ok(data)`, `fail(code, opts)`, `withAction(schema, permission, handler)` — a
wrapper every action uses that performs: context resolution (incl. acting-as and AAL) →
rate limit → Zod parse (`.strict()`) → permission check → idempotency → handler → audit →
error mapping.

```ts
export const finalizeNoteAction = withAction({
  name: 'notes.finalize',
  input: finalizeNoteInputSchema,
  permission: 'clinical.note.finalize',
  scope: (input) => ({ noteId: input.noteId }),
  audit: 'clinical_note.finalized',
  handler: async (ctx, input) => finalizeNote(ctx, input),
});
```

---

## 3. Error codes

| Code | HTTP | Meaning | Retryable |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | No valid session | no |
| `MFA_REQUIRED` | 401 | Session is `aal1`; route requires `aal2` | no (after MFA) |
| `FORBIDDEN` | 403 | Authenticated, in correct tenant, lacks permission on a resource it may know about | no |
| `NOT_FOUND` | 404 | Does not exist **or** exists in another tenant / outside care team (anti-enumeration) | no |
| `VALIDATION_FAILED` | 422 | Zod or business validation failed; `fieldErrors` set | no |
| `CONFLICT` | 409 | Unique constraint / concurrent modification (`expectedUpdatedAt` mismatch) | no |
| `IMMUTABLE_RECORD` | 409 | Attempt to modify finalized/published/submitted data | no |
| `PRECONDITION_FAILED` | 412 | State transition not allowed (e.g. assign a draft version, finalize empty note) | no |
| `IDEMPOTENCY_MISMATCH` | 422 | Same idempotency key with different payload | no |
| `RATE_LIMITED` | 429 | Too many requests (auth, uploads, signed URLs) | yes |
| `PAYLOAD_TOO_LARGE` | 413 | File or body above limit | no |
| `UNSUPPORTED_MEDIA` | 415 | Mime not in bucket allowlist | no |
| `INTERNAL` | 500 | Unexpected; logged with requestId, no details to client | yes |

Choosing `FORBIDDEN` vs `NOT_FOUND`: if the caller could legitimately know the resource
exists (e.g. a psychologist in the same org viewing a patient not on their care team, in a
directory listing), return `FORBIDDEN`; for anything cross-tenant or patient/guardian
probing, return `NOT_FOUND` (confirmed in SECURITY.md §4.5; both audited as `access.denied` on clinical scopes).

---

## 4. Authorization context

```ts
// src/server/authz/context.ts
export type AuthzContext = {
  requestId: string;
  locale: 'es' | 'en';
  profileId: string;                 // = auth.uid()
  aal: 'aal1' | 'aal2';
  organizationId: string | null;     // resolved + validated tenant
  actingAs: 'staff' | 'patient' | 'guardian' | 'platform_admin'; // exactly one per request
  availableCapacities: Array<{ organizationId: string; actingAs: AuthzContext['actingAs'] }>;
  membership?: { id: string; roles: Array<'organization_owner' | 'psychologist'> }; // actingAs = staff
  patientId?: string;                // actingAs = patient
  guardian?: { guardianId: string; relationships: Array<{   // actingAs = guardian
    patientId: string; patientGuardianId: string; permissions: GuardianPermission[];
  }>; supervisedSessionId?: string };
  platform?: { grants: Array<{ id: string; scope: GrantScope; patientId?: string; expiresAt: string }> }; // approved only
  mfaVerifiedAt?: string;            // for "recent MFA" checks on high-risk actions
};
```

- Built once per request (`cache()`), from verified `auth.getUser()` + DB lookups.
- **Acting-as (F-21).** A profile may hold several capacities (e.g. guardian and patient in one
  org; staff in org A, guardian in org B). The capacity is chosen explicitly
  (`selectCapacityAction`, stored in an httpOnly `acting_as` cookie as a *hint*) and
  re-validated on every request; permissions are evaluated **only** for the active capacity —
  never the union. With a single capacity it is selected automatically. Switching is audited
  (`auth.capacity_switched`). Staff ↔ patient/guardian in the same org is rejected by the DB (MVP).
- `requirePermission(ctx, permission, scope)` resolves resource scope (e.g. loads the
  note's `patient_id`) and checks role + care team / guardian permission / grant.
- Permission registry (`src/server/authz/permissions.ts`) maps each permission to
  allowed actor kinds, roles and scope rules; the matrix test is generated from it.

### Permission catalog (draft)

| Permission | Granted to (draft) |
|---|---|
| `org.settings.manage`, `org.branding.manage`, `org.domains.manage` | organization_owner |
| `org.members.read` | any staff member |
| `org.members.manage`, `org.invitations.manage` | organization_owner |
| `org.audit.read` | organization_owner (org-wide); psychologist (own patients) |
| `org.retention.manage` | organization_owner |
| `patient.create` | psychologist |
| `patient.directory.read` | staff (limited fields) |
| `patient.read`, `patient.update` | psychologist on care team |
| `patient.care_team.manage` | organization_owner, primary psychologist (self-assignment rules: §8.4) |
| `patient.status.manage` | psychologist on care team (activation gated by consents/guardians, DB-enforced) |
| `patient.portal.invite` | psychologist on care team |
| `guardian.manage`, `guardian.permissions.manage`, `guardian.caveat.manage` | psychologist on care team |
| `clinical.record.read` | psychologist on care team; approved break-glass grant (read only) |
| `clinical.record.write` | psychologist on care team (never break-glass) |
| `clinical.note.write`, `clinical.note.finalize`, `clinical.note.addendum.create` | psychologist on care team (draft update + finalize: author only, DB-enforced) |
| `clinical.assessment.*`, `clinical.diagnosis.*`, `clinical.plan.*` | psychologist on care team |
| `clinical.document.read`, `clinical.document.upload`, `clinical.document.share` | psychologist on care team |
| `consent.withdraw`, `consent.withdraw.own` | care team psychologist / signer (patient, guardian) — own record |
| `patient.preferences.manage`, `portal.consent.read`, `portal.mode.read`, `portal.privacy.read`, `portal.guardian.read` | care team / patient or guardian (own data only) |
| `consent.template.manage` | organization_owner (PRD CON-01 also lists psychologist — product decision, F-24) |
| `consent.request`, `consent.record.read` | psychologist on care team |
| `consent.sign.self` | patient (own) |
| `consent.sign.guardian` | guardian with `sign_consents` ∧ verified legal representative (F-12) |
| `consent.sign.assent` | minor patient (own; never a guardian account) |
| `resource.manage`, `activity.manage`, `activity.publish` | psychologist |
| `resource.share`, `assignment.manage`, `response.review`, `response.feedback.write` | psychologist on care team |
| `portal.assignment.read` | patient (own); guardian with `view_assignments` |
| `portal.assignment.respond` | patient (own); guardian with `complete_assignments` |
| `portal.response.read` | patient (own); guardian with `view_responses` + assignment visibility |
| `portal.resource.read` | patient (shared); guardian with `view_shared_resources` + share flag |
| `portal.preferences.update` | patient; guardian with `manage_portal_preferences` |
| `portal.goal.read` | patient (own); guardian with `view_patient_facing_goals` |
| `portal.document.read` | patient (shared); guardian with `view_shared_documents` + share flag |
| `portal.reflection.write`, `portal.reflection.share` | patient (own; not in a guardian supervised session) — **no guardian permission exists** |
| `portal.supervised_session.start` | guardian with `complete_assignments` |
| `privacy.dsr.create` | patient, guardian (own scope); staff |
| `privacy.dsr.manage` | organization_owner, psychologist on care team |
| `privacy.export.create` | psychologist on care team only (aal2 + recent MFA). Owners track DSRs but never generate full-record exports (F-06) |
| `platform.org.provision`, `platform.org.suspend` | platform_admin |
| `platform.grant.request` | platform_admin |
| `platform.grant.approve_tenant` | organization_owner of target org; treating psychologist when required |
| `platform.grant.approve_second` | a platform_admin **other than** the requester |
| `platform.grant.revoke` | owner, treating psychologist, either SyV approver |

`platform_admin` holds **no** `clinical.*`, `patient.*` or `portal.*` permission. With an
**approved, active** `clinical_read_break_glass` grant it gains `clinical.record.read` (and
in-scope `clinical.document.read`) for the grant's patient only — never write, export or
`exports` URLs; every access audited with the grant id.

---

## 5. Pagination, filtering, sorting

- **Keyset (cursor) pagination** for all lists:
  `input: { cursor?: string; limit?: number (1..100, default 25); sort?: SortKey; filters?: {...} }`
  `output: { items: T[]; nextCursor: string | null }`.
- Cursor = base64url of `{ sortValue, id }`; opaque to clients; tamper → `VALIDATION_FAILED`.
- Sort keys are an allowlisted enum per list (e.g. `created_at_desc`, `last_name_asc`).
- Filters are typed Zod objects; free-text search only on non-sensitive fields
  (patient name for care team; never note bodies in MVP).

---

## 6. Idempotency & concurrency

- Actions that create records from user submissions accept `idempotencyKey: uuid`
  (generated client-side per form instance). Stored in `idempotency_keys` with
  `(actor, action, key)` + request hash; replays return the original `result_ref`;
  different payload → `IDEMPOTENCY_MISMATCH`. TTL 24 h.
- **Required** for: `submitActivityResponseAction`, `signConsentAction`,
  `recordConsentAction`, `createAddendumAction`, `confirmUploadAction`,
  `createPatientAction`, `createInvitationAction`, `requestExportAction`.
- Naturally idempotent transitions (finalize, publish, revoke) return success if already in
  the target state with the same actor, otherwise `PRECONDITION_FAILED`.
- **Optimistic concurrency** for editable drafts: inputs include `expectedUpdatedAt`; a
  mismatch returns `CONFLICT` (prevents lost updates from two tabs).
- Autosave of drafts (notes, response items) is debounced client-side and uses the same
  concurrency token.

---

## 7. Route handlers

| Route | Method | Purpose | Permission | Audit |
|---|---|---|---|---|
| `/api/files/[fileId]/download-url` | POST | Issue signed download URL (TTL per bucket); rate-limited; `Origin` checked | `app.can_read_file` (RLS-bound) + domain permission; never `exports` under break-glass | `file.download_url_issued` (clinical buckets) |
| `/api/files/upload-url` | POST `{ bucket, purpose, entityId, mime, size }` | Issue signed upload URL (2 min) + pending `file_objects` row | domain upload permission | `file.upload_url_issued` |
| `/api/exports/[exportId]` | GET | Stream a generated export (single use, short TTL) | requester of export | `export.downloaded` |
| `/api/auth/callback` | GET | Supabase auth code exchange | — | `auth.signed_in` |
| `/api/health` | GET | Liveness (no DB details) | — | — |

Signed URLs are returned as `{ url, expiresAt }`, never cached by the browser beyond TTL
(`Cache-Control: no-store`).

---

## 8. Per-module contracts

Format: **Name** — input summary → output · permission · audit event.
All inputs exclude `organizationId` (from context). `Id` = uuid.

### 8.1 auth / onboarding
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `acceptInvitationAction` | `{ token, password?, displayName, locale }` → `{ redirectTo }` | public (token) | `invitation.accepted` |
| `enrollMfaAction` / `verifyMfaAction` | `{ factorId, code }` → `{ aal }` (server-side, so cookies stay httpOnly) | authenticated | `auth.mfa_enrolled` / `auth.mfa_verified` |
| `generateRecoveryCodesAction` | `{}` → `{ codes: string[] }` (shown once; requires recent MFA) | self, aal2 | `auth.recovery_codes_generated` |
| `useRecoveryCodeAction` | `{ code }` → `{ redirectTo: enrollment }` (ADR-021: unenrolls factors, revokes other sessions) | self, aal1, rate-limited | `auth.recovery_code_used`, `auth.mfa_reset` |
| `selectCapacityAction` | `{ organizationId, actingAs }` → `{ organizationId, actingAs, href }` (validated against the DB capacities of this host; aal2 for staff; sets host-only httpOnly hint cookies) | authenticated | `auth.org_switched` / `auth.capacity_switched` |
| `startSupervisedSessionAction` / `endSupervisedSessionAction` | `{ patientId }` / `{}` → `{ expiresAt }` / `{ ok }` | `portal.supervised_session.start` | `supervised_session.started` / `.ended` |
| `updateMyProfileAction` | `{ displayName?, locale?, timeZone? }` → `Profile` | self | `profile.updated` |

### 8.2 organizations
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `getOrganizationSettings` | — → `OrgSettings` | staff | — |
| `updateOrganizationSettingsAction` | `{ displayName?, defaultLocale?, timeZone? }` → `OrgSettings` | `org.settings.manage` | `organization.updated` |
| `updateBrandingAction` | `{ displayName, brandColor, functionalColor?, secondaryColor?, expectedUpdatedAt }` → `{ updatedAt, logoUrl }`. Contrast guard: an explicit `functionalColor` < 4.5:1 is rejected (`VALIDATION_FAILED`, field error `contrast:<nearest passing shade>:<ratio>`); `brandColor` is decorative and auto-adjusted for text use; stale `expectedUpdatedAt` → `CONFLICT`. Font/radius are not tenant-configurable (no allow-list in DESIGN_SYSTEM). | `org.branding.manage` | `organization_branding.updated` |
| `uploadLogoAction` | `FormData{ file }` (PNG/JPEG/WebP ≤ 512 KiB, 16–2048 px; magic-byte sniffed, metadata/trailing bytes stripped, no SVG) → `{ updatedAt, logoUrl }`. Server-only write (service role after the RLS owner check, P1-16); superseded objects deleted; `RATE_LIMITED` (`branding.errors.logoRateLimited`) after 10 uploads/hour per owner (product constant) | `org.branding.manage` | `organization_branding.logo_uploaded` (`media_type`, `size_bytes`) |
| `removeLogoAction` | — → `{ updatedAt, logoUrl: null }`. Clears `logo_path` and deletes the organization's logo objects from the public bucket in the same transaction (rollback + error if the deletion fails); UI asks for confirmation (P1-18) | `org.branding.manage` | `organization_branding.logo_removed` (`had_logo`) |
| `addDomainAction` / `verifyDomainAction` | `{ host }` / `{ domainId }` → `Domain` | `org.domains.manage` | `organization_domain.added` / `.verified` |
| `setRetentionPolicyAction` | `{ dataCategory, retentionPeriod, triggerEvent, legalBasisReference }` → `RetentionPolicy` (draft) | `org.retention.manage` | `retention_policy.created` |

### 8.3 members
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `listMembers` | pagination → `Member[]` | `org.members.read` | — |
| `createStaffInvitationAction` | `{ email, roles[], idempotencyKey }` → `{ invitationId, expiresAt }` | `org.invitations.manage` | `invitation.created` |
| `revokeInvitationAction` | `{ invitationId }` → `{ ok }` | `org.invitations.manage` | `invitation.revoked` |
| `updateMemberRolesAction` | `{ membershipId, roles[] }` → `Member` (last-owner guard) | `org.members.manage` | `membership.roles_changed` |
| `suspendMemberAction` | `{ membershipId, reason }` → `Member` | `org.members.manage` | `membership.suspended` |
| `upsertProfessionalProfileAction` | `{ membershipId, title, licenseNumber, licenseIssuer, specialties[] }` → `ProfessionalProfile` | self or owner | `professional_profile.updated` |

### 8.4 patients
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `listMyPatients` | filters (status), pagination → `PatientSummary[]` | care team | `patient.list_viewed` |
| `searchPatientsAction` | `{ search? }` (<= 100, literal substring; sent in the body, never the URL) → `{ mine, directory }` (care team: name, preferred name, document number; directory rows: name only) (PAT-04) | `patient.read` / `patient.directory.read` | `patient.list_viewed`, `patient.directory_viewed` (count only, never the term) |
| `listUpcomingMajorityAction` | `{}` → `{ windowDays, entries[] }` minors of MY care team turning 18 within `MAJORITY_NOTICE_DAYS` (default 60) (PAT-06; `PatientSummary.majorityInDays` drives the badge) | `patient.read` | `patient.list_viewed` |
| `getPatient` | `{ patientId }` → `PatientDetail` | `patient.read` | `patient.viewed` |
| `createPatientAction` | `{ firstName, lastName, preferredName?, dateOfBirth, documentType?, documentNumber?, email?, phone?, preferredLocale?, confirmDuplicate? }` → `{ patientId }` (`CONFLICT` + `fieldErrors.duplicate` = `document`\|`name_dob` until `confirmDuplicate`, PAT-07; `idempotencyKey` pending) (status `intake`; creator becomes primary care team, record opened) | `patient.create` | `patient.created`, `clinical_record.opened` |
| `changePatientStatusAction` | `{ patientId, status: 'active'\|'paused'\|'discharged'\|'archived' }` → `{ status }` (no `reason`: no column, audit has no free text) (`PRECONDITION_FAILED` with missing items when consents/legal representative are missing) | `patient.status.manage` | `patient.status_changed` |
| `updatePatientAction` | `{ patientId, expectedUpdatedAt, ...fields }` → `PatientDetail` | `patient.update` | `patient.updated` (field names) |
| `assignCareTeamMemberAction` | `{ patientId, membershipId, careRole, reason? }` → `CareTeamMember` (`reason` required and primary notified when self-assigning to a patient with another primary, F-06) | `patient.care_team.manage` | `care_team.assigned` / `care_team.self_assigned` |
| `endCareTeamMemberAction` | `{ careTeamMemberId, reason }` → `{ ok }` | `patient.care_team.manage` | `care_team.ended` |
| `invitePatientToPortalAction` | `{ patientId, email, emailLocale }` → `{ invitationId }` | `patient.portal.invite` | `invitation.created` |
| `updatePatientPreferencesAction` | `{ patientId, portalMode?, locale?, notifyEmail?, textSize?, reducedMotion?, audioInstructions? }` → `{ changedFields }` | `patient.preferences.manage` (care team); patient/guardian self-service pending | `patient_preferences.updated` |

### 8.4b data requests (PAT-09, Q-14)
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `submitDataRequestAction` | `{ requestType: 'access'\|'rectification', note? (<= 1000) }` → `{ requestId }` (patient: herself; guardian: her own record; one open request per type: `PRECONDITION_FAILED` `dataRequests.errors.alreadyOpen`) | `dsr.submit.self` / `dsr.submit.guardian` | `data_subject_request.submitted` |
| `listMyDataRequestsAction` | `{}` → own requests | `dsr.read.own` | none |
| `listDataRequestsAction` | `{}` → requests (owner: all; psychologist: care-team patients and their linked guardians) | `dsr.read` | `data_subject_request.list_viewed` |
| `updateDataRequestAction` | `{ requestId, status, resolutionSummary? (required for final statuses), dueDate? }` → `{ requestId }` (forward-only; resolved is final) | `dsr.manage` | `data_subject_request.status_changed`, `.due_date_set` |

Deadlines, identity verification and what may be disclosed are NOT encoded `[NEEDS LEGAL VERIFICATION]`.

### 8.5 guardians
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `createGuardianAction` | `{ patientId, firstName, lastName, documentType, documentNumber?, email?, phone?, relationship, isLegalRepresentative, legalBasis?, isPrimaryContact }` → `{ guardianId, patientGuardianId }` (`legalBasis` required if legal representative) | `guardian.manage` | `guardian.created`, `patient_guardian.created` |
| `verifyGuardianRelationshipAction` | `{ patientGuardianId, verificationNote?, validFrom?, validUntil?, verifyLegalBasis: boolean }` (`legalBasisFileId` pending file storage) → `Relationship` | `guardian.manage` | `patient_guardian.verified` |
| `suspendGuardianRelationshipAction` / `reactivate…` | `{ patientGuardianId, reason: 'custody_review'\|'safety_concern'\|'other' }` / `{ patientGuardianId }` (`age_of_majority` is system-only; reactivation after majority unsupported) → `Relationship` (reactivation after majority requires the adult patient's consent) | `guardian.manage` | `patient_guardian.suspended` / `.reactivated` |
| `setGuardianCaveatAction` | `{ patientGuardianId, caveat, restrictSchedule }` → `{ ok }` | `guardian.caveat.manage` | `guardian_caveat.set` |
| `setGuardianPermissionsAction` | `{ patientGuardianId, permissions: GuardianPermission[] }` → `{ granted[], revoked[] }` (diff) | `guardian.permissions.manage` | `guardian_permission.granted` / `.revoked` |
| `revokeGuardianRelationshipAction` | `{ patientGuardianId, reason }` → `{ ok }` (revokes all permissions) | `guardian.manage` | `patient_guardian.revoked` |
| `inviteGuardianToPortalAction` | `{ patientGuardianId, email, emailLocale }` → `{ invitationId }` | `guardian.manage` | `invitation.created` |

### 8.6 clinical-records
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `getClinicalRecordAction` | `{ patientId }` → `RecordOverview` (record, `isMinor`, sections per org catalogue + age band, diagnoses, active plan summary, draft plan id) | `clinical.record.read` | `clinical_record.viewed` |
| `openClinicalRecordAction` | `{ patientId }` → `{ recordId, recordNumber, status, created }` (idempotent get-or-create) | `clinical.record.write` | `clinical_record.opened` |
| `listClinicalConfigAction` / `upsertSectionDefinitionAction` / `upsertNoteTypeAction` | `{}` / `{ id?, key, title, description?, audience, isRequired, position, isActive }` / `{ id?, key, label, description?, position, isActive }` → catalogue / `{ id }` | `clinical.config.read` / `clinical.config.manage` | — / `clinical_config.updated` |
| `updateRecordSectionAction` | `{ recordId, sectionDefinitionId, content: RichTextAst, contentLocale, expectedRevision }` (0 = first save; mismatch `CONFLICT`) → `{ sectionId, revision, updatedAt }` | `clinical.record.write` | `clinical_record_section.updated` |
| `listSectionRevisionsAction` | `{ sectionId }` → `Revision[]` | `clinical.record.read` | `clinical_record_section.history_viewed` |
| `closeClinicalRecordAction` / `reopenClinicalRecordAction` | `{ recordId, closureSummary }` / `{ recordId }` → `{ recordId, recordNumber, status }` (closed record is read-only) | `clinical.record.write` | `clinical_record.closed` / `.reopened` |
| `createAssessmentAction` / `updateAssessmentDraftAction` / `finalizeAssessmentAction` / `discardAssessmentDraftAction` / `listAssessmentsAction` | `{ recordId, assessedOn, instrumentName, instrumentReference?, administeredBy?, results, interpretation?, attachmentFileId?, correctsAssessmentId? }` / `{ assessmentId, expectedUpdatedAt, ...fields }` / `{ assessmentId }` / `{ patientId }` → `{ assessmentId, updatedAt }` / `{ finalizedAt, contentHash }` / `Assessment[]` | `clinical.assessment.write` / `clinical.record.read` | `clinical_assessment.created` / `.updated` / `.finalized` / `.discarded` / `.list_viewed` |
| `addDiagnosisAction` | `{ recordId, codeSystem, code, label, status, diagnosedOn }` → `Diagnosis` | `clinical.diagnosis.write` | `clinical_diagnosis.added` |
| `updateDiagnosisStatusAction` | `{ diagnosisId, status, resolvedOn? }` → `Diagnosis` | `clinical.diagnosis.write` | `clinical_diagnosis.status_changed` |

### 8.7 treatment
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `createTreatmentPlanDraftAction` | `{ recordId, summary, startDate, reviewDate?, goals[] }` → `Plan` | `clinical.plan.write` | `treatment_plan.created` |
| `activateTreatmentPlanAction` | `{ planId }` → `Plan` (supersedes current active) | `clinical.plan.write` | `treatment_plan.activated` |
| `reviseTreatmentPlanAction` | `{ planId }` → `Plan` (new draft copy, version+1) | `clinical.plan.write` | `treatment_plan.revised` |
| `updateGoalStatusAction` | `{ goalId, status: 'open'\|'in_progress'\|'achieved'\|'discontinued' }` → `Goal` | `clinical.plan.write` | `treatment_goal.status_changed` |
| `setPatientFacingGoalTextAction` | `{ goalId, patientFacingText: RichTextAst \| null }` → `Goal` (draft plans only) | `clinical.plan.write` | `treatment_goal.patient_text_set` |
| `updateTreatmentPlanDraftAction` / `addGoalAction` / `endTreatmentPlanAction` / `withdrawPatientFacingGoalTextAction` | `{ planId, summary?, interventions?, frequency?, startDate?, reviewDate? }` / `{ planId, position, description, targetDate? }` / `{ planId, status: 'completed'\|'discontinued' }` / `{ goalId }` | `clinical.plan.write` | `treatment_plan.updated` / `treatment_goal.added` / `treatment_plan.status_changed` / `treatment_goal.patient_text_set` (`withdrawn`) |
| `getTreatmentPlanAction` / `listTreatmentPlansAction` | `{ planId }` / `{ patientId }` → `Plan` (goals + patient-facing texts) / `PlanSummary[]` (all versions) | `clinical.record.read` | `treatment_plan.viewed` |
| `listMyGoalsAction` (portal) | `{ patientId? (guardian) }` → `PortalGoal[]` (`goalId, patientFacingText, status`; active plan only) | `portal.goals.read` | — |

### 8.8 sessions
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `recordSessionAction` | `{ patientId, start, end, status (default held), modality, treatmentPlanId?, locationOrLink?, cancelledReason? }` → `{ sessionId }` (record only) | `clinical.session.write` | `therapy_session.recorded` |
| `updateSessionAction` | `{ sessionId, status?, start?, end?, modality?, treatmentPlanId?, locationOrLink?, cancelledReason? }` → `{ sessionId, status }` | `clinical.session.write` | `therapy_session.updated` (from/to status) |
| `listPendingNoteSessionsAction` | `{}` → `Session[]` (caller's held sessions without a finalized note, SES-04) | `clinical.session.read` | `therapy_session.list_viewed` |
| `listSessionsAction` | `{ patientId?, from?, to?, limit? }` → `Session[]` (with `noteState`) | `clinical.session.read` | `therapy_session.list_viewed` |
| `listMyUpcomingSessionsAction` (portal) | `{ patientId? (guardian) }` → `PortalSession[]` (`sessionId, start, end, status, modality`) | `portal.sessions.read` (patient; guardian `view_session_schedule`, no schedule caveat) | — |

### 8.9 notes
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `createNoteDraftAction` | `{ recordId, noteType, therapySessionId?, body }` → `Note` | `clinical.note.write` | `clinical_note.created` |
| `updateNoteDraftAction` | `{ noteId, body, expectedUpdatedAt }` → `Note` (`IMMUTABLE_RECORD` if finalized) | `clinical.note.write` (author) | `clinical_note.draft_updated` (throttled) |
| `finalizeNoteAction` | `{ noteId }` → `{ finalizedAt, contentHash }` (requires `aal2`, confirmation in UI) | `clinical.note.finalize` | `clinical_note.finalized` |
| `discardNoteDraftAction` | `{ noteId, reason }` → `{ ok }` | author | `clinical_note.draft_discarded` |
| `createAddendumAction` | `{ noteId, reason: AddendumReason, body, idempotencyKey }` → `Addendum` | `clinical.note.addendum.create` | `clinical_note.addendum_created` |
| `getNoteAction` / `listNotesAction` | `{ noteId }` / `{ patientId, limit?, before? }` → `NoteWithAddenda` / `NoteSummary[]` (finalized + own drafts) | `clinical.record.read` | `clinical_note.viewed` / `clinical_note.list_viewed` |

### 8.10 documents & files
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `uploadClinicalDocumentAction` | `FormData { recordId, documentType, title, documentDate?, description?, supersedesDocumentId?, file }` (≤ 20 MiB; MIME allowlist + magic bytes; server uploads with the service role after the RLS insert) → `{ documentId, fileObjectId }` (replaces `confirmUploadAction` + `attachClinicalDocumentAction`) | `clinical.document.upload` | `clinical_document.attached` |
| `issueClinicalFileUrlAction` | `{ fileObjectId }` → `{ url, expiresInSeconds: 60 }` (`app.can_read_file`) | `clinical.document.read` | `file.download_url_issued` |
| `archiveClinicalDocumentAction` | `{ documentId, reason }` → `{ ok }` | `clinical.document.upload` | `clinical_document.archived` |
| `listClinicalDocumentsAction` | `{ patientId }` → `ClinicalDocument[]` (with `activeShare`) | `clinical.document.read` | `clinical_document.list_viewed` |
| `shareClinicalDocumentAction` / `unshareClinicalDocumentAction` | `{ documentId, guardianVisible }` / `{ shareId }` → `{ shareId, guardianVisible, guardianCaveatActive }` / `{ ok }` | `clinical.document.share` | `document.shared` / `document.unshared` |
| `listMySharedDocumentsAction` / `issuePortalDocumentUrlAction` (portal) | `{ patientId? (guardian) }` / `{ documentId, patientId? }` → `PortalDocument[]` / `{ url, expiresInSeconds }` | `portal.document.read` | `document.portal_list_viewed` / `document.portal_url_issued` (DB-written) |

### 8.11 consents
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `createConsentTemplateAction` | `{ key, consentType, title, signerRequirement, appliesToMinors }` → `Template` | `consent.template.manage` | `consent_template.created` |
| `saveConsentVersionDraftAction` | `{ templateId, locale, body }` → `Version` | `consent.template.manage` | `consent_template_version.draft_saved` |
| `publishConsentVersionAction` | `{ versionId, legalReviewReference? }` → `{ bodyHash, publishedAt }` | `consent.template.manage` | `consent_template_version.published` |
| `requestConsentAction` | `{ patientId, templateId, signer: 'patient'\|'guardian', patientGuardianId? }` → `ConsentRequest` (portal task) | `consent.request` | `consent.requested` |
| `signConsentAction` (portal) | `{ versionId, patientId, decision, typedName, checkboxConfirmed: true, textHash (hex sha256 of the shown body) }` → `{ consentRecordId }` → `ConsentConfirmation` (server recomputes hash, captures IP/UA server-side; evidence never returned) | `consent.sign.self` / `consent.sign.guardian` / `consent.sign.assent` | `consent.signed` / `consent.declined` |
| `recordConsentAction` (professional, verbal) | `{ patientId, versionId, signerType: 'patient'\|'guardian', patientGuardianId?, method: 'verbal_recorded', decision, decidedAt }` → `{ consentRecordId }` (`paper_scan` pending file storage) → `ConsentRecord` | `consent.request` | `consent.recorded` |
| `withdrawConsentAction` | `{ consentRecordId, reason }` → `{ ok }` (status `withdrawn`; alerts psychologist; blocks new assignments, CON-04) | signer or care team | `consent.withdrawn` |
| `getPatientConsentStatus` | `{ patientId }` → `ConsentStatus[]` (latest per template) | `consent.record.read` | `consent.status_viewed` |

### 8.12 resources
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `createResourceAction` / `updateResourceAction` / `archiveResourceAction` | `{ title, description, resourceType, fileObjectId? \| url? \| embed?, audience, contentLocale }` → `Resource` | `resource.manage` | `resource.created` / `.updated` / `.archived` |
| `shareResourceAction` | `{ resourceId, patientId, guardianVisible, message? }` → `ResourceShare` | `resource.share` | `resource.shared` |
| `revokeResourceShareAction` | `{ shareId }` → `{ ok }` | `resource.share` | `resource.share_revoked` |
| `listMySharedResources` (portal) | pagination → `PortalResource[]` | `portal.resource.read` | — |

### 8.13 activities (builder)
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `createActivityAction` | `{ internalName, categoryId? }` → `{ activityId, draftVersionId }` | `activity.manage` | `activity.created` |
| `saveActivityDraftAction` | `{ versionId, expectedUpdatedAt, metadata{title, description, therapeuticObjective, instructions, audience, ageMin?, ageMax?, contentLocale}, blocks: Block[] }` → `VersionDraft` (blocks validated by discriminated union; replaces draft blocks atomically via RPC) | `activity.manage` | `activity_version.draft_saved` |
| `publishActivityVersionAction` | `{ versionId }` → `{ versionNumber, contentHash, publishedAt }` | `activity.publish` | `activity_version.published` |
| `createNewVersionDraftAction` | `{ activityId, fromVersionId }` → `{ draftVersionId }` | `activity.manage` | `activity_version.draft_created` |
| `retireActivityVersionAction` | `{ versionId }` → `{ ok }` (existing assignments unaffected) | `activity.publish` | `activity_version.retired` |
| `previewActivityVersion` | `{ versionId, mode: 'adult'\|'child' }` → `RenderableActivity` | `activity.manage` | — |
| `manageCategoriesAction` | `{ op, slug, nameEs, nameEn }` → `Category` | `activity.manage` | `activity_category.changed` |
| `saveContentTranslationAction` / `reviewContentTranslationAction` | `{ entityType, entityId, fieldPath, targetLocale, value }` / `{ translationId, decision }` → `Translation` | `activity.manage` | `content_translation.saved` / `.reviewed` |

`Block` = Zod discriminated union on `type` (see ARCHITECTURE.md §11). Example:

```ts
type Block =
  | { type: 'text'; schemaVersion: 1; clientKey: string; content: RichTextAst }
  | { type: 'multiple_choice'; schemaVersion: 1; clientKey: string; prompt: RichTextAst;
      options: { key: string; label: string; imageFileId?: string }[];
      allowMultiple: boolean; required: boolean }
  | { type: 'scale'; schemaVersion: 1; clientKey: string; prompt: RichTextAst;
      min: number; max: number; step: number; minLabel?: string; maxLabel?: string; required: boolean }
  | { type: 'emotion_selector'; schemaVersion: 1; clientKey: string; prompt: RichTextAst;
      emotionSet: 'basic_6' | 'child_8' | 'custom'; emotions?: string[]; allowIntensity: boolean; required: boolean }
  | { type: 'open_response'; schemaVersion: 1; clientKey: string; prompt: RichTextAst;
      maxLength: number; allowAudio: boolean; required: boolean }
  | { type: 'image'; schemaVersion: 1; clientKey: string; fileId: string; altText: string }
  | { type: 'audio'; schemaVersion: 1; clientKey: string; fileId: string; transcript?: string }
  | { type: 'video'; schemaVersion: 1; clientKey: string;
      source: { kind: 'file'; fileId: string } | { kind: 'embed'; provider: AllowedProvider; videoId: string } }
  | { type: 'game'; schemaVersion: 1; clientKey: string; gameType: GameType; config: GameConfig /* per gameType */ };
```

Exact block fields are owned by the activities agent and require architect approval.

### 8.14 assignments & responses
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `assignActivityAction` | `{ patientId, activityVersionId, availableFrom?, dueAt?, guardianVisibility, allowMultipleAttempts, messageToPatient? }` → `Assignment` (version must be published) | `assignment.manage` | `activity_assignment.created` |
| `withdrawAssignmentAction` | `{ assignmentId, reason }` → `{ ok }` (hides from portal, keeps responses, ASG-04) | `assignment.manage` | `activity_assignment.withdrawn` |
| `reopenAssignmentAction` | `{ assignmentId }` → `{ ok }` (next submission is a new attempt, RSP-02) | `assignment.manage` | `activity_assignment.reopened` |
| `listMyAssignments` (portal) | `{ status?, patientId? (guardian) }` → `PortalAssignment[]` | `portal.assignment.read` | — |
| `getAssignmentForCompletion` (portal) | `{ assignmentId }` → `{ version: RenderableActivity, draftResponse? }` (pinned version, approved translations, no psychologist-only fields) | `portal.assignment.read` | `activity_assignment.opened` |
| `saveResponseProgressAction` (portal) | `{ assignmentId, items: { blockClientKey, value }[], expectedUpdatedAt? }` → `{ responseId, savedAt }` | `portal.assignment.respond` | — (throttled `activity_response.progress_saved`) |
| `submitActivityResponseAction` (portal) | `{ assignmentId, responseId, idempotencyKey }` → `{ submittedAt }` (validates every item vs pinned block, required blocks answered) | `portal.assignment.respond` | `activity_response.submitted` |
| `getResponseForReview` | `{ responseId }` → `ResponseReview` (blocks + items, review renderers) | `response.review` | `activity_response.viewed` |
| `markResponseReviewedAction` | `{ responseId }` → `{ reviewedAt }` | `response.review` | `activity_response.reviewed` |
| `leaveResponseFeedbackAction` | `{ responseId, body: RichTextAst }` → `Feedback` (visible to patient, RSP-05) | `response.feedback.write` | `activity_response.feedback_added` |

Response saving and submission execute the DB functions of DATABASE.md §5.6, which re-check
actor, state and item validity (F-10); Zod validation in the action is the first layer only.
No contract converts a response into a clinical note. A psychologist may write a note
manually while viewing a response (separate `createNoteDraftAction`).

### 8.14a reflections (portal, PRT-05)
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `saveReflectionAction` | `{ reflectionId?, body: RichTextAst, expectedUpdatedAt? }` → `Reflection` (unshared only) | `portal.reflection.write` | — |
| `shareReflectionAction` | `{ reflectionId }` → `{ sharedAt }` (explicit, per entry) | `portal.reflection.share` | `reflection.shared` |
| `listMyReflections` | pagination → `Reflection[]` | `portal.reflection.write` | — |
| `listSharedReflections` (professional) | `{ patientId }` → `Reflection[]` (shared only) | `clinical.record.read` | `reflection.list_viewed` |

### 8.15 privacy
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `createDataSubjectRequestAction` | `{ subject: { patientId } \| { guardianId }, requestType, description, channel }` → `DSR` | `privacy.dsr.create` | `dsr.created` |
| `updateDataSubjectRequestAction` | `{ dsrId, status, resolutionSummary? }` → `DSR` | `privacy.dsr.manage` | `dsr.status_changed` |
| `requestExportAction` | `{ patientId, scope: 'full_record' \| 'portal_data', reason, dsrId?, idempotencyKey }` → `{ exportId }` (async job, `exports` bucket; requester-only single-use download) | `privacy.export.create` (care team only; owner cannot) | `export.requested` |

### 8.16 audit
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `listAuditEvents` | `{ patientId?, actorProfileId?, eventType?, from?, to?, pagination }` → `AuditEvent[]` | `org.audit.read` | `audit_log.viewed` |

### 8.17 platform
| Contract | Input → Output | Permission | Audit |
|---|---|---|---|
| `provisionOrganizationAction` | `{ slug, legalName, displayName, ownerEmail, defaultLocale, timeZone }` → `{ organizationId, invitationId }` | `platform.org.provision` (aal2) | `organization.provisioned` |
| `suspendOrganizationAction` | `{ organizationId, reason }` → `{ ok }` | `platform.org.suspend` | `organization.suspended` |
| `requestAccessGrantAction` | `{ organizationId, scope, patientId?, objectScope?, reason (≥ 20), ticketReference, durationMinutes (≤ 240) }` → `Grant` (always `pending`) | `platform.grant.request` (aal2) | `platform_grant.requested` |
| `approveAccessGrantAsTenantAction` | `{ grantId, decision: 'approve'\|'reject' }` → `Grant` | `platform.grant.approve_tenant` (aal2, recent MFA) | `platform_grant.approved` / `.rejected` |
| `secondApproveAccessGrantAction` | `{ grantId }` → `Grant` (refused if caller = requester) | `platform.grant.approve_second` (aal2) | `platform_grant.approved` |
| `revokeAccessGrantAction` | `{ grantId, reason }` → `{ ok }` | `platform.grant.revoke` | `platform_grant.revoked` |
| `listOrgAccessGrants` | `{ status? }` → `Grant[]` (tenant view incl. access report after expiry) | organization_owner | — |

Activation (`status = approved`, `starts_at`, `expires_at`) is set **by the database** when the
last required approval arrives (DATABASE.md §5.1); no contract sets it directly. The owner is
notified on request, approval, first use and closure; `platform_grant.activated` and
`.expired` are system events.

---

## 9. Audit event catalog rules

- Name: `<resource>.<past_tense_verb>`; catalog is a TS const union in
  `src/server/audit/events.ts`; unknown events fail typecheck.
- Metadata contains ids, enum values, changed **field names**, and status transitions.
  Never: note bodies, response values, names, document numbers, emails, free text.
- Reads of clinical data (`*.viewed`, `*.list_viewed`, signed URLs for clinical buckets)
  are always audited; portal reads of own data are not (volume), except opening an
  assignment.
- Denied attempts (`FORBIDDEN`/`NOT_FOUND` on clinical scopes) are audited as
  `access.denied` with the attempted permission (via the service-role system writer).
- The audit writer is never callable from the browser and never accepts an actor: the actor is
  `auth.uid()` inside `app.write_audit` (DATABASE.md §9). Each event has exactly one source.
