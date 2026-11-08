# Product Requirements Document (PRD) — Psychological Practice Management SaaS

**Owner:** Product agent · **Product:** SyV Solutions multi-tenant, bilingual (es/en) practice-management SaaS · **First tenant:** Daniela Ortega, psychologist (Colombia) · **Phase:** 0 (documentation only) · **Status:** Draft v0.1 for client review

Legend: `[NEEDS LEGAL VERIFICATION]` = legal/regulatory item the product flags but does not interpret. `[NEEDS PSYCHOLOGIST INPUT]` = clinical-protocol item to be decided by Daniela / clinical agent. Items routed to the architect are marked `→ architect`.

---

## 1. Product vision and principles

A secure, white-labelable workspace where a psychologist runs her practice (patients, clinical records, sessions, notes, consents) **and** extends therapy between sessions through a patient portal with psychologist-authored activities, resources and reflections.

Non-negotiable principles (they drive acceptance criteria throughout):

1. **The psychologist decides.** Assignments are always an explicit professional action. Age may adapt the UX; it never prescribes content.
2. **Private clinical notes are never visible to patients or guardians.** No setting exposes them.
3. **Patient responses never auto-become clinical notes.** A psychologist may deliberately reference a response; the system never copies or summarizes on its own.
4. **No automated diagnoses, conclusions, risk scores or clinical recommendations.** Numbers entered by patients are displayed raw.
5. **Guardians do not get unrestricted access.** Access is relationship-based, granular, minimal by default, revocable.
6. **Tenant isolation is absolute.** `platform_admin` has no implicit clinical access.
7. **Flag, never interpret** law or clinical protocol.

## 2. Glossary

| Term | Meaning |
|---|---|
| Organization (org) | The tenant. A solo practice is an org of one member. |
| Membership | A user's role within an org. |
| Care team | The psychologist(s) explicitly assigned to a patient. |
| Clinical record | The patient's formal record (identification, history, assessments, plan, sessions, finalized notes, consents, documents). |
| Progress note | Psychologist-authored, private, per session; draft then finalized; amendable only by addendum. |
| Patient response | Content a patient (or guardian-assisted) submits in activities/reflections. Lives outside the clinical record unless referenced deliberately. |
| Activity / Activity version | Builder-authored exercise; publishing freezes an immutable version. |
| Assignment | A psychologist's act of giving a specific activity **version** (or resource) to a specific patient. |
| Guardian | Person linked to a minor via a guardian–patient relationship, with granular permissions. |
| Assent | The minor's own agreement, distinct from guardian consent. |

## 3. Personas

**P1 — Daniela Ortega, psychologist and practice owner (solo org).** Independent clinician; wants one place for records, notes, consents and between-session work. Pains: paper/Word/WhatsApp sprawl, no audit trail, no structured way to give homework. Needs: speed in session notes, trust that nothing leaks, content in Spanish, her own brand. Risk: abandons tool if note-taking is slower than Word.

**P2 — Clinic owner / administrator (organization_owner).** Runs a small group practice; manages members and branding; may or may not treat patients. Pains: onboarding psychologists safely, offboarding, knowing who accessed what. Needs: administration without default reading of colleagues' clinical content `[NEEDS PSYCHOLOGIST INPUT / LEGAL]`.

**P3 — Associate psychologist.** Joins an org; sees only own assigned patients; builds/uses shared activities and resources.

**P4 — Adult patient.** Uses phone mostly; moderate digital literacy; sensitive to privacy and stigma. Needs: clear tasks, low friction, reassurance about who sees what, control of preferences, ability to exercise data rights.

**P5 — Adolescent patient (about 12–17; thresholds configurable).** Values autonomy and confidentiality; distrusts "kid" UI. Needs: age-appropriate tone, clarity about what parents can see, own login, assent step.

**P6 — Child patient (about 6–11).** Limited reading, short attention. Needs: visual, tappable, large-target UI, audio instructions, games; frequently uses the portal with a guardian beside them or on a guardian's device.

**P7 — Guardian (parent/legal representative).** Wants to support the child and understand the process; may be one of several (separated parents, grandparent with custody). Needs: clear scope of what they can see/do; not to be confused with the patient. Risk: conflict between guardians; guardian vs adolescent confidentiality.

**P8 — SyV platform admin / support.** Operates the platform; must not read clinical content by default; uses break-glass only with consent and audit.

## 4. Visibility baseline (applies across modules)

| Object | Treating psychologist | Org owner (not treating) | Patient (adult / adolescent) | Guardian | platform_admin |
|---|---|---|---|---|---|
| Patient demographics | Full | Administrative subset `[NEEDS PSYCHOLOGIST INPUT]` | Own | Per permission | None (metadata only) |
| Clinical record / history / assessments | Full | None by default | None by default; access via data-rights request | None | None |
| Private progress notes | Full | None | **Never** | **Never** | None |
| Treatment plan | Full | None | Only objectives psychologist marks patient-facing | Per permission | None |
| Consents | Full | Status only | Own | Those they signed / per permission | None |
| Shared documents | Full | None | Only if shared | Only if shared + permitted | None |
| Assignments and activity content | Full | None | Own | Per permission | None |
| Patient responses | Full | None | Own | Per permission | None |
| Audit events about a patient | Full for own patients | Org-wide metadata | On request | No | Platform-level metadata |

---

## 5. Functional requirements

Priority = MoSCoW for **MVP**. Must items carry Given/When/Then acceptance criteria (AC). Should/Could/Won't items list the story only; AC are written when promoted.

### 5.1 AUTH — Authentication

- **AUTH-01 · Must** — As a user, I want to sign in with email and password, so that I can reach my workspace securely.
  **AC:** Given a verified account, when I submit valid credentials, then I am authenticated and routed to my experience (dashboard or portal) in my language. Given invalid credentials, when I submit, then I see a generic error that does not reveal whether the email exists.
- **AUTH-02 · Must** — As a new user, I want to verify my email, so that the system knows the address is mine.
  **AC:** Given I registered or was invited, when I open the single-use, time-limited link, then my email is marked verified. Given an expired or reused link, when I open it, then access is refused and I can request a new one.
- **AUTH-03 · Must** — As a user, I want to reset my password, so that I can regain access.
  **AC:** Given I request a reset, when I use the emailed single-use link within its validity, then I can set a new password meeting policy and all other sessions are revoked. Given the email is unknown, when I request, then the response is identical to a known email.
- **AUTH-04 · Must** — As a psychologist or owner, I must use multi-factor authentication (TOTP), so that clinical data is protected from credential theft.
  **AC:** Given I hold a professional role, when I sign in without a second factor enrolled, then I must enroll before accessing clinical data. Given MFA is enrolled, when I sign in, then a valid code is required. Recovery codes are issued at enrollment.
- **AUTH-05 · Must** — As an org owner, I want idle and absolute session timeouts, so that unattended devices do not expose data.
  **AC:** Given a professional session idle beyond the configured limit (hypothesis: 15 min), when I act, then I must re-authenticate and unsaved drafts are preserved locally or server-side. Patient portal timeout is longer and configurable `[NEEDS PSYCHOLOGIST INPUT]`.
- **AUTH-06 · Must** — As a psychologist, I want patients and guardians to join only by invitation, so that no stranger can create an account inside my org.
  **AC:** Given I invite a patient or guardian, when they open the invitation link, then the account is bound to that org and that person record only. Given there is no invitation, when anyone attempts to register as a patient, then it is not possible. Invitations expire and are revocable.
- **AUTH-07 · Should** — As a child or young adolescent, I want a simple supervised sign-in path (guardian-initiated session or PIN on a guardian-trusted device), so that I can use the portal without managing a password. `→ architect` (security trade-offs).
- **AUTH-08 · Could** — As a patient, I want a passwordless magic-link sign-in, so that I do not need to remember a password.
- **AUTH-09 · Won't (MVP)** — SSO/SAML/OIDC for enterprise orgs.

### 5.2 ORG — Organizations and memberships

- **ORG-01 · Must** — As a prospective customer, I want to create my organization during signup (solo practice = org of one), so that I own a tenant.
  **AC:** Given I complete signup and verify email, when I name my practice, then an org is created, I become `organization_owner` and also `psychologist` if I declare I treat patients, and a unique org slug is reserved.
- **ORG-02 · Must** — As an owner, I want to invite a psychologist to my org, so that I can grow the practice.
  **AC:** Given I enter an email and role, when the invitee accepts, then a membership is created with that role and an audit event is recorded. Given the invitee has an existing SyV account, when they accept, then the same login gains a second membership without data crossing orgs.
- **ORG-03 · Must** — As an owner, I want to configure org settings (name, default language, timezone default `America/Bogota`, contact details, consent set), so that the workspace fits my practice.
  **AC:** Given I save settings, when members next load, then defaults apply; changes are audited.
- **ORG-04 · Should** — As an owner, I want to reassign a patient from one psychologist to another with documented reason, so that continuity of care survives staff changes. Requires patient/guardian notification `[NEEDS LEGAL VERIFICATION]`.
- **ORG-05 · Must** — As an owner, I want to deactivate a member without deleting their authored clinical content, so that offboarding is safe.
  **AC:** Given a member is deactivated, when they try to sign in, then access to that org is denied immediately; their authored notes remain attributed to them; their patients are flagged "unassigned" until reassigned; no clinical content becomes visible to the owner by this action.
- **ORG-06 · Should** — As a user in several orgs, I want an org switcher, so that I can work in each tenant separately.
- **ORG-07 · Could** — As an owner, I want to export my organization's data, so that I can leave or back up (portability).

### 5.3 RBAC — Roles, permissions, isolation

- **RBAC-01 · Must** — As the platform, I need roles `platform_admin`, `organization_owner`, `psychologist`, `patient`, and a relationship-based `guardian` actor, so that permissions are explicit.
  **AC:** Given any request, when authorization is evaluated, then it uses the role of the membership in the requested org, or the patient/guardian relationship; no role grants more than the visibility baseline (§4).
- **RBAC-02 · Must** — As a tenant, I need hard isolation from other tenants.
  **AC:** Given user U in org A, when U requests any object of org B by any route (UI, API, file URL, search), then the result is "not found/forbidden" and an audit event is raised. Automated cross-tenant tests are part of the release gate.
- **RBAC-03 · Must** — As a psychologist, I only access patients where I am on the care team.
  **AC:** Given patient X is assigned to psychologist A only, when psychologist B of the same org opens X, then access is denied unless a documented grant exists (RBAC-07).
- **RBAC-04 · Must** — As a patient, I need confidence that SyV staff cannot browse my data.
  **AC:** Given a `platform_admin`, when they use any admin tool, then no clinical content (notes, history, responses, documents) is displayed; only operational metadata is. Exceptional access follows SEC-14.
- **RBAC-05 · Must** — As a psychologist, I need private notes to be structurally invisible to patients and guardians.
  **AC:** Given a progress note, when any patient or guardian session queries notes by any route, then zero note records or fields are returned. This is verified by automated authorization tests.
- **RBAC-06 · Must** — As an owner who is not the treating psychologist, I have administrative powers only.
  **AC:** Given I am `organization_owner` without care-team membership for patient X, when I open X, then I see only administrative fields and status, not clinical content `[NEEDS PSYCHOLOGIST INPUT — confirm owner policy]`.
- **RBAC-07 · Should** — As a psychologist, I want to grant a named colleague time-bound access to a patient (supervision, coverage), recorded and audited, with patient notice where required `[NEEDS LEGAL VERIFICATION]`.
- **RBAC-08 · Won't (MVP)** — Custom roles and per-org permission editor.

### 5.4 PAT — Patients

- **PAT-01 · Must** — As a psychologist, I want to register an adult patient, so that I can open their record.
  **AC:** Given I enter required fields (names, date of birth, contact, preferred language) and optional identification type/number, emergency contact, when I save, then a patient exists in my org, assigned to me, status `intake`, age category computed from DOB.
- **PAT-02 · Must** — As a psychologist, I want to register a minor patient, so that the guardian workflow is enforced.
  **AC:** Given DOB indicates under 18, when I save, then the patient is flagged minor, at least one guardian with legal-representative information is required before status can move beyond `intake` or any portal access/assignment is enabled (CON/GRD gating).
- **PAT-03 · Must** — As a psychologist, I want a patient profile (demographics, preferred name, pronouns, language, accessibility needs, portal experience mode), so that interactions are respectful and adapted.
  **AC:** Given I edit the profile, when I save, then changes are versioned in audit; "experience mode" (child/adolescent/adult) defaults from age but I can override it.
- **PAT-04 · Must** — As a psychologist, I want to list, search and filter my patients, so that I find them fast.
  **AC:** Given I search by name or ID, when results render, then only patients on my care team appear; search never exposes clinical text in logs or URLs.
- **PAT-05 · Must** — As a psychologist, I want patient status lifecycle (intake, active, paused, discharged, archived), so that my caseload is accurate.
  **AC:** Given I discharge a patient, when I confirm, then portal assignments stop, the record becomes read-only, nothing is hard-deleted, and the change is audited.
- **PAT-06 · Must** — As a psychologist, I want the system to alert me when a minor approaches 18, so that I can transition consent and guardian access deliberately.
  **AC:** Given a minor's 18th birthday is within 60 days, when I open the profile or dashboard, then I see a task. Given the birthday passes, then guardian permissions are suspended pending my review and the patient must give their own consent `[NEEDS LEGAL VERIFICATION]` `[NEEDS PSYCHOLOGIST INPUT]`.
- **PAT-07 · Must** — As a psychologist, I want duplicate warnings, so that I do not create two records for one person.
  **AC:** Given identification or name+DOB matches an existing patient in my org, when I save, then I am warned and must confirm; matching never reveals other orgs' data.
- **PAT-08 · Should** — As a psychologist, I want to send the portal invitation from the profile and see invitation status.
- **PAT-09 · Must** — As a patient or guardian, I want to request access to or rectification of my data (Ley 1581/2012 rights) `[NEEDS LEGAL VERIFICATION]`, so that I can exercise my rights.
  **AC:** Given I submit a request from the portal or by contacting my psychologist, when it is received, then a tracked request exists with type, requester identity check, due date configured by org (legal deadlines `[NEEDS LEGAL VERIFICATION]`), and status; the psychologist decides what to disclose or correct; rectification of clinical content is by addendum, never overwrite; every step is audited.
- **PAT-10 · Could** — As a psychologist, I want to import patients from CSV.

### 5.5 GRD — Guardians

- **GRD-01 · Must** — As a psychologist, I want guardian profiles as separate person records, so that one guardian can be linked to several minors and the minor's record is not polluted.
  **AC:** Given I create a guardian with name, contact and ID, when I link them to two siblings, then one guardian profile exists with two relationships.
- **GRD-02 · Must** — As a psychologist, I want explicit guardian–patient relationships (type: mother, father, grandparent, legal tutor, other; legal-representative flag; primary-contact flag; start/end dates), so that authority is documented.
  **AC:** Given a minor with two guardians, when I view the relationship list, then each shows type, legal status, verification state, and permissions; ending a relationship stamps an end date and suspends access immediately.
- **GRD-03 · Must** — As a psychologist, I want to record legal-representative information (basis of representation, supporting document reference/upload, verification by me, date), so that consent validity is documented `[NEEDS LEGAL VERIFICATION]`.
  **AC:** Given a guardian marked legal representative, when saving, then basis and verification fields are required; a missing verification blocks that guardian from signing consents.
- **GRD-04 · Must** — As a psychologist, I want granular permissions per relationship (e.g., view assigned activities, help complete, view responses, view shared documents, sign consents, receive notifications, view patient-facing objectives, view schedule/session dates), minimal by default, so that guardians see only what is appropriate.
  **AC:** Given a new relationship, when created, then all permissions default to off except those I explicitly enable; the guardian's portal shows only enabled areas; no permission ever exposes private notes or clinical record.
- **GRD-05 · Must** — As a psychologist, I want to set different permissions for different guardians and revoke at once, so that I can handle separated parents or safety concerns.
  **AC:** Given I revoke a guardian's permission, when they next make a request (including mid-session), then it is denied and audited; the other guardian is unaffected.
- **GRD-06 · Must** — As a guardian, I access the portal through invitation after the psychologist verifies my identity, so that only legitimate guardians gain access.
  **AC:** Given an invited guardian not yet verified, when they sign in, then they see only an "awaiting verification" screen with no child data.
- **GRD-07 · Must** — As an adolescent, I want clarity on what my guardian can see, so that I can trust the process.
  **AC:** Given an adolescent portal session, when they open "Privacy", then they see a plain-language list of what each linked guardian can view, generated from current permissions. Guardian visibility of an adolescent's reflections defaults to **off** `[NEEDS PSYCHOLOGIST INPUT]`.
- **GRD-08 · Should** — As a psychologist, I want to record a safety/confidentiality caveat on a relationship (e.g., restricted contact) visible only to me, with warning prompts before sharing.
- **GRD-09 · Could** — As a guardian, I want a simple progress overview chosen by the psychologist (e.g., completion counts only), without response content.

### 5.6 CON — Consents and assent

- **CON-01 · Must** — As an owner/psychologist, I want versioned consent templates in es and en (treatment, personal-data processing, guardian consent for minor, information release, portal use), so that wording is controlled.
  **AC:** Given I publish a template version, when assigned, then the exact text and version id are fixed; editing creates a new version; past acceptances keep their original version. SyV supplies starter templates marked draft for legal review `[NEEDS LEGAL VERIFICATION]`.
- **CON-02 · Must** — As a psychologist, I want to record who consented to what, when, version, method, so that I can demonstrate it.
  **AC:** Given a consent is accepted, when stored, then it records subject patient, signer (patient or guardian + relationship), template version, language, timestamp, method (portal e-acceptance / paper uploaded / in-person recorded), and status.
- **CON-03 · Must** — As a minor, I want my assent requested separately in language I understand, so that my view is respected.
  **AC:** Given a minor patient, when intake starts, then guardian consent and minor assent are distinct items; assent text adapts to the experience mode; a refusal of assent is recorded and surfaced to the psychologist, who decides next steps `[NEEDS PSYCHOLOGIST INPUT]`.
- **CON-04 · Must** — As a signer, I want to withdraw consent, so that I stay in control.
  **AC:** Given a consent is withdrawn in the portal or recorded by the psychologist, when saved, then status becomes `withdrawn` with timestamp, the psychologist is alerted, and dependent features (e.g., new assignments) are blocked until the psychologist resolves; history is preserved. Legal effects `[NEEDS LEGAL VERIFICATION]`.
- **CON-05 · Must** — As an owner, I want required consents to gate activation, so that no care starts without them.
  **AC:** Given required consent types are configured for adults and minors, when any is missing, then patient status cannot become `active`, portal activities cannot be assigned, and the UI shows exactly what is missing.
- **CON-06 · Must** — As a signer, I want to accept consent electronically in the portal with an evidence trail.
  **AC:** Given I open a consent, when I read and confirm (plus any required typed name), then evidence is stored (user id, timestamp, version hash, IP/user-agent per privacy policy) and a copy is available to me; the validity of this method for each consent type `[NEEDS LEGAL VERIFICATION]` (e.g., Ley 527/1999 context).
- **CON-07 · Should** — As a psychologist, I want to upload a scanned paper consent and record it as accepted, for in-person signing.
- **CON-08 · Should** — As a psychologist, I want renewal reminders for consents with periodic review.
- **CON-09 · Won't (MVP)** — Integration with certified e-signature providers.

### 5.7 CLR — Clinical records

- **CLR-01 · Must** — As a psychologist, I want one clinical record per patient, so that care is documented formally.
  **AC:** Given a patient exists with required consents, when I open the record, then it is created once per patient per org, linked to the care team; the record structure supports the minimum content elements required by Res. 1995/1999 and Res. 839/2017 `[NEEDS LEGAL VERIFICATION]`.
- **CLR-02 · Must** — As a psychologist, I want intake data (reason for consultation, referral source, expectations, current situation), so that the case starts documented.
  **AC:** Given I complete intake sections, when I save, then each is stored with author and timestamp; required sections are configurable per org `[NEEDS PSYCHOLOGIST INPUT]`.
- **CLR-03 · Must** — As a psychologist, I want a psychological history (personal, family, medical, developmental and school sections for minors), structured fields plus free text.
  **AC:** Given a minor patient, when I open history, then developmental and school sections appear; adult patients do not see them unless enabled. Sections are tailored with Daniela `[NEEDS PSYCHOLOGIST INPUT]`.
- **CLR-04 · Must** — As a psychologist, I want to log assessments (instrument name, date, administered by, results as I enter them, attachments), so that evaluations are traceable.
  **AC:** Given I record an assessment, when saved, then the system stores only what I enter; it never computes interpretations, categories or diagnoses.
- **CLR-05 · Must** — As a psychologist, I want finalized entries to be immutable, with corrections by dated addendum.
  **AC:** Given a finalized record entry, when anyone attempts to edit or delete it, then it is refused; an addendum links to the original, shows author and time, and both are displayed together.
- **CLR-06 · Must** — As a psychologist, I want a diagnostic impression field that I fill myself (free text and optional code from a catalogue chosen by me), so that the record reflects my judgment.
  **AC:** Given the field, when I view or edit, then no suggestions, autocompletion by symptoms, or system-generated impressions appear. Code catalogue (e.g., CIE-10/DSM-5-TR) `[NEEDS PSYCHOLOGIST INPUT]`.
- **CLR-07 · Must** — As an owner, I want records never hard-deleted and retained per legal period, with a legal-hold flag.
  **AC:** Given a deletion attempt on record content, when requested by any tenant user, then it is refused; archival is allowed; retention period is configurable defaulting to the legal minimum once confirmed `[NEEDS LEGAL VERIFICATION]` (Res. 1995/1999 retention and custody).
- **CLR-08 · Should** — As a psychologist, I want to export the record to PDF (audited), e.g., for transfer or patient request.
- **CLR-09 · Should** — As a psychologist, I want to set manual alert flags on a patient (visible only to me/care team), with no automated risk scoring `[NEEDS PSYCHOLOGIST INPUT]`.
- **CLR-10 · Could** — As a psychologist, I want record templates per therapeutic approach.

### 5.8 SES — Sessions

- **SES-01 · Must** — As a psychologist, I want to record a session (date, time, duration, modality: in-person / external online, status), so that attendance and care are documented.
  **AC:** Given I record a session for a patient on my care team, when saved, then it appears in the patient timeline; no video or calendar functionality is invoked.
- **SES-02 · Must** — As a psychologist, I want sessions linked to patient, author and (optionally) treatment plan/objectives.
  **AC:** Given I link objectives, when viewing the plan, then linked sessions are listed.
- **SES-03 · Must** — As a psychologist, I want a chronological session timeline per patient.
  **AC:** Given a patient with sessions, when I open the timeline, then sessions sort newest first with note state (none/draft/finalized).
- **SES-04 · Must** — As a psychologist, I want session statuses (scheduled, held, cancelled by patient, cancelled by psychologist, no-show), as records only.
  **AC:** Given I set a status, when saved, then it is audited and held sessions without a finalized note appear in my "pending notes" list.
- **SES-05 · Should** — As a psychologist, I want to record who attended (patient, guardian, others).
- **SES-06 · Should** — As a psychologist, I want a free-text field for an external meeting link or location.
- **SES-07 · Won't (MVP)** — Calendar sync, recurring availability, patient self-booking, reminders for sessions.

### 5.9 NOTE — Progress notes

- **NOTE-01 · Must** — As a psychologist, I want one or more progress notes per session, in a format I choose (free text, SOAP, DAP or custom sections), so that documentation matches my method.
  **AC:** Given a session, when I create a note, then I pick a format; the note stores sections as written. Format catalogue `[NEEDS PSYCHOLOGIST INPUT]`.
- **NOTE-02 · Must** — As a psychologist, I want draft → finalized states.
  **AC:** Given a draft, when I finalize, then author, timestamp and content hash are stored and the note becomes read-only; drafts are editable only by their author.
- **NOTE-03 · Must** — As a psychologist, I want to add addenda to finalized notes.
  **AC:** Given a finalized note, when I add an addendum, then the original is unchanged, the addendum shows reason, author, time; notifications are not sent to patients.
- **NOTE-04 · Must** — As a psychologist, I want notes private by default and non-shareable.
  **AC:** Given a note, when any sharing/visibility control is looked for, then none exists to expose the note to a patient or guardian; document sharing (DOC) is a separate mechanism with deliberately authored documents.
- **NOTE-05 · Must** — As a psychologist, I want to deliberately reference a patient response from a note, without automatic copying.
  **AC:** Given a patient response, when I choose "reference in note", then a visible link/snapshot with attribution "patient-generated" is inserted only on my action; no response ever appears in a note without it.
- **NOTE-06 · Should** — As a psychologist, I want autosaved drafts to avoid losing work.
- **NOTE-07 · Should** — As a psychologist, I want personal note templates.
- **NOTE-08 · Could** — As a psychologist, I want a separate "personal working notes" space excluded from the formal record `[NEEDS PSYCHOLOGIST INPUT]` `[NEEDS LEGAL VERIFICATION]`.

### 5.10 TPL — Treatment plans

- **TPL-01 · Must** — As a psychologist, I want a treatment plan (case formulation text I write, goals/objectives, interventions, frequency, review date).
  **AC:** Given I save a plan, when viewing, then fields appear as written; the system produces no suggested goals or interventions.
- **TPL-02 · Must** — As a psychologist, I want plan revisions with history.
  **AC:** Given I revise a plan, when saved, then a new version is stored with author/time and prior versions remain readable.
- **TPL-03 · Must** — As a psychologist, I want objective status (open, in progress, achieved, discontinued) and the option to mark chosen objectives as patient-facing with wording I write.
  **AC:** Given an objective flagged patient-facing, when the patient opens "My objectives", then they see only the patient-facing wording and status I set, not the clinical wording.
- **TPL-04 · Should** — As a psychologist, I want to link activities and sessions to objectives.
- **TPL-05 · Should** — As a psychologist, I want manual progress marks on objectives with dates.
- **TPL-06 · Could** — As a psychologist, I want a timeline view of objective progress.

### 5.11 DOC — Clinical documents

- **DOC-01 · Must** — As a psychologist, I want to upload documents to a patient's record (PDF, images, audio; category; description).
  **AC:** Given I upload an allowed file, when validated and scanned, then it is stored in a private bucket tied to patient and org, with category and uploader; blocked types/sizes show a clear error.
- **DOC-02 · Must** — As a psychologist, I want per-document visibility: private (default) or shared with the patient (and optionally a guardian with permission).
  **AC:** Given a private document, when the patient or guardian lists documents, then it is absent. Given I share it, when they list, then it appears; unsharing removes access immediately.
- **DOC-03 · Must** — As an owner, I want document access via short-lived authorized links only, with every view audited.
  **AC:** Given a document URL older than its validity or requested by an unauthorized user, when opened, then it is denied; each authorized access creates an audit event.
- **DOC-04 · Should** — As a patient, I want to upload a document for my psychologist (e.g., school report), landing in a review area before it enters the record.
- **DOC-05 · Could** — As a psychologist, I want to generate a document (certificate, report) from a template that I review and finalize; the system never drafts clinical conclusions.

### 5.12 RES — Resource library

- **RES-01 · Must** — As a psychologist, I want an org library of resources (text/article, PDF, link, image, audio, video), so that I can reuse material.
  **AC:** Given I add a resource with title, type, language (es/en/both) and tags, when saved, then it appears in my org library only.
- **RES-02 · Must** — As a psychologist, I want to categorize and search by tag, language, type, age-appropriateness label (informational, set by me).
  **AC:** Given filters, when I search, then results narrow accordingly; the label never restricts who I may share with.
- **RES-03 · Must** — As a psychologist, I want to share a resource with a specific patient, so that it appears in their portal.
  **AC:** Given I share a resource, when the patient opens "Resources", then it appears with my optional message; viewing is recorded (opened/not opened); I can unshare.
- **RES-04 · Should** — As a psychologist, I want a SyV-curated starter library, clearly labeled and editable as copies `[NEEDS PSYCHOLOGIST INPUT]` on content.
- **RES-05 · Should** — As a psychologist, I want to host audio/video uploads with streaming playback, captions and transcripts.
- **RES-06 · Should** — As a psychologist, I want to bundle resources into collections to share at once.
- **RES-07 · Could** — As a psychologist, I want to share resources across orgs I belong to via copy (never by link-through).

### 5.13 ACT — Activities and no-code builder

- **ACT-01 · Must** — As a psychologist, I want to create an activity with metadata (title, description, language(s), purpose note for me, optional age-range tag, estimated duration), so that I can organize my library.
  **AC:** Given I create an activity, when saved as draft, then it is visible only to me (and to org if I share, ACT-11) and not assignable.
- **ACT-02 · Must** — As a psychologist, I want content blocks (text/instructions, image with required alt text, audio with optional transcript), so that I can explain tasks.
  **AC:** Given an image block without alt text, when I try to publish, then validation blocks publishing and highlights the block.
- **ACT-03 · Must** — As a psychologist, I want response blocks: multiple choice (single/multi), open response, scale (configurable range and labels), emotion selector (configurable emotion set with icons and words), so that I can capture patient input.
  **AC:** Given each block type, when previewed and published, then the patient can answer it with keyboard, touch, and screen reader; required/optional can be set per block.
- **ACT-04 · Must** — As a psychologist, I want a small set of interactive game blocks (initial candidates: matching pairs, drag-to-sort, simple choice-based scenario) with configurable content, so that children and adolescents can engage.
  **AC:** Given a game block, when published, then it works on mobile/touch and keyboard, has non-color-only cues and a non-timed mode by default. Final game list `[NEEDS PSYCHOLOGIST INPUT]`; engineering feasibility `→ architect`.
- **ACT-05 · Must** — As a psychologist, I want draft vs published states where publishing freezes an immutable version.
  **AC:** Given I publish, when saved, then version N is created and cannot be altered; subsequent edits create draft for version N+1; existing assignments stay on their original version.
- **ACT-06 · Must** — As a psychologist, I want to preview the activity as a patient in child, adolescent and adult modes and in es/en.
  **AC:** Given preview, when opened, then no data is saved, and the rendering matches the portal player.
- **ACT-07 · Must** — As a psychologist, I want pre-publish validation (required titles, options, alt text, language completeness warnings).
  **AC:** Given validation errors, when I publish, then it is blocked with actionable messages; warnings (e.g., missing English) may be overridden.
- **ACT-08 · Must** — As a psychologist, I want to author block text in es and en, so that I can serve bilingual patients.
  **AC:** Given a patient with preferred language en and an activity with en content, when they open it, then en shows; with only es, then es shows with a notice; no automatic machine translation.
- **ACT-09 · Should** — As a psychologist, I want to duplicate and archive activities.
- **ACT-10 · Should** — As a psychologist, I want SyV starter activity templates (copy-on-use) `[NEEDS PSYCHOLOGIST INPUT]`.
- **ACT-11 · Should** — As a psychologist, I want to share an activity with colleagues in my org (read/use, or edit).
- **ACT-12 · Won't (MVP)** — Conditional logic and branching. The activity definition format must not preclude it `→ architect`.
- **ACT-13 · Won't (MVP)** — Cross-tenant activity marketplace.

### 5.14 ASG — Assignments

- **ASG-01 · Must** — As a psychologist, I want to assign a published activity version to a patient, so that the exercise is delivered.
  **AC:** Given a published activity and a patient with required consents on my care team, when I assign, then an assignment is created pinned to version N; later versions never change it.
- **ASG-02 · Must** — As a psychologist, I want to set optional due date and message.
  **AC:** Given due date and message, when the patient opens the assignment, then both are shown; overdue state is neutral in tone, never punitive.
- **ASG-03 · Must** — As a psychologist, I decide every assignment; the system does not auto-assign.
  **AC:** Given any patient, age or response data, when no psychologist action occurs, then no assignment is created. Age tags are informational only.
- **ASG-04 · Must** — As a psychologist, I want assignment statuses (assigned, in progress, submitted, reviewed, withdrawn).
  **AC:** Given status transitions, when they occur, then they are timestamped and audited; withdrawing hides the item from the patient and preserves any submitted response.
- **ASG-05 · Must** — As a psychologist, I want guardian visibility of a minor's assignments governed by guardian permissions.
  **AC:** Given a guardian without "view assigned activities", when they open the portal, then no assignments are listed.
- **ASG-06 · Should** — As a psychologist, I want to offer a newer version as a new assignment while the old remains.
- **ASG-07 · Should** — As a psychologist, I want recurring assignments (e.g., weekly mood log).
- **ASG-08 · Should** — As a patient, I want gentle reminders (email/in-app) with psychologist-configurable frequency and neutral wording.
- **ASG-09 · Could** — As a psychologist, I want to assign to several patients at once (each an individual assignment).

### 5.15 RSP — Patient responses and progress

- **RSP-01 · Must** — As a patient, I want to save progress and resume, then submit.
  **AC:** Given partial answers, when I leave, then they are saved; on return I resume at the same place; submit shows a confirmation.
- **RSP-02 · Must** — As a psychologist, I need responses tied to assignment and version and immutable after submit.
  **AC:** Given a submitted response, when anyone edits it, then it is refused; the psychologist may reopen the assignment, creating a new submission while keeping the first.
- **RSP-03 · Must** — As a psychologist, I want to view responses per patient, labeled "patient-generated, outside the clinical record".
  **AC:** Given responses, when I open them, then each shows who answered (patient or guardian-assisted), when, and the version; the label is always visible.
- **RSP-04 · Must** — As a patient, I need assurance that nothing is auto-diagnosed.
  **AC:** Given any response, when displayed to anyone, then no system-generated interpretation, score classification or recommendation appears; scale/emotion values are shown raw.
- **RSP-05 · Must** — As a psychologist, I want to mark responses reviewed and optionally leave feedback visible to the patient.
  **AC:** Given feedback, when saved, then the patient sees it in the assignment; the feedback is separate from private notes.
- **RSP-06 · Should** — As a psychologist, I want trend charts of raw scale/emotion values over time with no interpretation overlay.
- **RSP-07 · Should** — As a psychologist, I want to export a patient's responses (PDF/CSV), audited.
- **RSP-08 · Could** — As a psychologist, I want to compare two submissions side by side.

### 5.16 PRT — Patient portal

- **PRT-01 · Must** — As a patient, I want a home screen of what is assigned (activities, resources, due dates) in one calm view.
  **AC:** Given assignments exist, when I log in, then I see them ordered by due date or recency with clear primary action; empty state is friendly.
- **PRT-02 · Must** — As a patient, I want an activity player that renders all blocks accessibly on mobile first.
  **AC:** Given an activity, when I open it, then progress is visible, I can go back, I can save and exit, and all interactions work by keyboard, touch and screen reader.
- **PRT-03 · Must** — As a patient, I want an interface adapted to my age, with the mode set by my psychologist. Client decision (2026-11-08): two visual modes — **child portal** (children *and* adolescents) and **adult portal**; the adolescent *profile* category is kept for privacy rules and copy.
  **AC:** Given an experience mode, when I use the portal, then typography, imagery, tone, and navigation density adapt; the mode never changes which content I am assigned.
- **PRT-04 · Must** — As a patient, I want to watch/listen to assigned resources with captions/transcripts where provided.
  **AC:** Given a video/audio, when played, then controls are accessible, playback never autostarts with sound, and position is remembered.
- **PRT-05 · Must** — As a patient, I want a reflections/journal area; each entry I choose to share with my psychologist or keep as a draft/private.
  **AC:** Given a new entry, when saved, then default is "not shared"; sharing is an explicit per-entry action; the portal explains who sees what. Whether wholly private entries are stored at all and their retention `[NEEDS PSYCHOLOGIST INPUT]` `[NEEDS LEGAL VERIFICATION]`.
- **PRT-06 · Must** — As a patient, I want to see my patient-facing objectives.
  **AC:** Given TPL-03 objectives, when I open "My goals", then only patient-facing wording appears.
- **PRT-07 · Must** — As a patient, I want to read documents shared with me.
  **AC:** Given shared documents, when I open the list, then only shared ones appear and access is audited.
- **PRT-08 · Must** — As a patient, I want account and preferences (language, display, text size, notifications, password/MFA, consents list, data-rights request).
  **AC:** Given preferences, when saved, then they apply on next load; the language choice persists.
- **PRT-09 · Must** — As a patient, I must never see private clinical content.
  **AC:** Given any portal route or API, when probed, then no private note, history, diagnosis field, assessment, or unshared document is reachable.
- **PRT-10 · Must** — As a child, I want a guardian-assisted mode where the portal records who is answering.
  **AC:** Given a child session started by a guardian with "help complete" permission, when answers are saved, then each submission is tagged patient, guardian-assisted, or guardian-entered; a guardian without that permission cannot start it.
- **PRT-11 · Should** — As a patient, I want in-app and email notifications with discreet subject lines (no clinical words).
- **PRT-12 · Must** — As a patient, I want visible, psychologist-configured safety information (emergency numbers, how to reach my psychologist, "this portal is not monitored in real time"), so that I know what to do if in distress `[NEEDS PSYCHOLOGIST INPUT]` `[NEEDS LEGAL VERIFICATION]` on wording.
  **AC:** Given configured text, when I use any portal page, then a persistent link to it is available in my language; default text is neutral until Daniela approves.
- **PRT-13 · Could** — As a child, I want light rewards (stickers) for completing activities `[NEEDS PSYCHOLOGIST INPUT]`.
- **PRT-14 · Could** — As a patient, I want to install the portal as a PWA.

### 5.17 I18N — Internationalization

- **I18N-01 · Must** — As a user, I want the full UI in Spanish (default, Colombian register) and English.
  **AC:** Given language set to es or en, when I navigate any screen or email, then no untranslated keys appear; the CI blocks missing keys.
- **I18N-02 · Must** — As a user, I want to set my language; org sets default.
  **AC:** Given user preference, org default, and browser hint, when choosing, then precedence is user > org > browser > es.
- **I18N-03 · Must** — As a psychologist, I want content (consents, activities, resources, patient-facing text) authored per language with no automatic translation of clinical or patient content.
  **AC:** Given missing translations, when viewing, then the fallback is shown with a visible notice to authors.
- **I18N-04 · Must** — As a user, I want dates, times and numbers formatted by locale and timezone (default America/Bogota).
  **AC:** Given a session at 15:00 Bogota, when viewed from another timezone, then the displayed time is converted and the timezone is visible.
- **I18N-05 · Should** — As an author, I want a translation-completeness indicator per activity/consent.
- **I18N-06 · Could** — As a business, I want additional locales (e.g., pt-BR) addable without code rewrites.

### 5.18 AUD — Audit logging

- **AUD-01 · Must** — As an owner, I want an audit trail of reads and writes of sensitive data (record, notes, documents, responses, exports).
  **AC:** Given a user views a patient's record, when it loads, then an event stores actor, org, patient, object type/id, action, time, and request origin — not content.
- **AUD-02 · Must** — As an owner, I want security events logged (sign-in, MFA, failures, role/permission changes, consent changes, break-glass, exports, shares).
  **AC:** Given each event type, when it occurs, then exactly one event is written.
- **AUD-03 · Must** — As a regulator-minded owner, I want the audit log append-only.
  **AC:** Given a tenant user (any role), when trying to edit or delete audit events, then no UI/API allows it; platform operators cannot alter without leaving a higher-level evidence trail `→ architect`.
- **AUD-04 · Must** — As a psychologist/owner, I want to view access history for a patient (who accessed what, when) and provide it to the patient on a rights request.
  **AC:** Given a patient, when I open "Access history", then events show for that patient filtered by role-appropriate visibility.
- **AUD-05 · Should** — As an owner, I want audit export and configurable retention (not below legal minimum `[NEEDS LEGAL VERIFICATION]`).
- **AUD-06 · Should** — As an owner, I want alerts on unusual access (bulk viewing, off-hours, repeated denials).
- **AUD-07 · Must** — As a patient, I need logs not to leak clinical content.
  **AC:** Given application/error logs, when sampled, then no names, notes, responses or document content appear; automated scanning of logs in CI/staging is part of release gate.

### 5.19 BRD — Branding (white-label)

- **BRD-01 · Must** — As an owner, I want to configure branding (display name, logo, favicon, primary/secondary/accent colors, welcome text), so that the portal feels like my practice.
  **AC:** Given I save branding, when a member or patient of my org loads the login and portal, then my branding applies and another org's does not.
- **BRD-02 · Must** — As an owner, I want branding applied to login, portal, emails and PDFs.
  **AC:** Given a notification email, when received, then sender display name, logo and colors reflect the org; the technical sender may remain SyV-controlled.
- **BRD-03 · Must** — As a user, I need brand colors validated for contrast, so that accessibility is not broken.
  **AC:** Given a color pair below WCAG 2.2 AA contrast for text/UI, when I save, then it is rejected or auto-adjusted for text use with an explanation.
- **BRD-04 · Should** — As an owner, I want a branded subdomain (slug.platform-domain).
- **BRD-05 · Should** — As an owner, I want email footer and legal text per org.
- **BRD-06 · Could** — As an owner, I want a custom domain with managed TLS.

### 5.20 SEC — Security controls (functional)

- **SEC-01 · Must** — As a patient, I want my data encrypted in transit (TLS 1.2+) and at rest.
  **AC:** Given any endpoint, when scanned, then only TLS is served with HSTS; storage encryption is verified in deployment checks.
- **SEC-02 · Must** — As a tenant, I want isolation enforced at the data layer (not only the UI), with automated tests.
  **AC:** Given crafted requests with another org's ids, when run in CI, then all return denied; a release is blocked on failure.
- **SEC-03 · Must** — As a platform owner, I want server-side authorization on every request; client claims are never trusted.
  **AC:** Given a tampered client request, when processed, then authorization is re-evaluated server-side.
- **SEC-04 · Must** — As a psychologist, I want uploads restricted by type/size, malware-scanned, and stored privately.
  **AC:** Given an infected or disallowed file, when uploaded, then it is rejected/quarantined and never served.
- **SEC-05 · Must** — As an owner, I want brute-force and abuse protection (rate limits, lockout/backoff).
  **AC:** Given repeated failures, when thresholds are hit, then further attempts are delayed or challenged and an audit event is created.
- **SEC-06 · Must** — As the platform, secrets are managed outside code; no sensitive data in analytics/telemetry.
  **AC:** Given repo and logs, when scanned, then no secrets or health data are present; third-party scripts in authenticated areas are prohibited unless approved.
- **SEC-07 · Must** — As an owner, I want backups with tested restores and documented RPO/RTO (hypothesis: RPO ≤ 24 h, RTO ≤ 8 h `→ architect`).
  **AC:** Given quarterly drills, when a restore is run, then success and duration are recorded.
- **SEC-08 · Must** — As an owner, I need the hosting region and cross-border transfer implications decided and disclosed `[NEEDS LEGAL VERIFICATION]` (Ley 1581/2012 on transfers).
  **AC:** Given production launch, when reviewed, then the region, subprocessors and transfer basis are documented and shown in the privacy notice.
- **SEC-09 · Must** — As a user, I want standard web protections (CSRF, XSS/CSP, secure cookies, clickjacking, input validation with Zod).
  **AC:** Given a security-header scan and OWASP ASVS L2 checklist, when run pre-launch, then no high findings remain open.
- **SEC-10 · Should** — As an owner, I want application-level encryption of especially sensitive fields (notes, history) `→ architect`.
- **SEC-11 · Should** — As the platform, I want dependency scanning and an external penetration test before general availability.
- **SEC-12 · Must** — As the platform, I need an incident-response and breach-notification procedure.
  **AC:** Given a suspected incident, when triggered, then a runbook assigns roles, assesses scope using audit logs, and drafts notices to controllers; regulator/patient notification duties `[NEEDS LEGAL VERIFICATION]`.
- **SEC-13 · Should** — As an owner, I want retention and anonymization workflows for non-record data (e.g., expired invitations, abandoned signups).
- **SEC-14 · Must** — As a patient/controller, I want support access to clinical data only by break-glass: requested with reason, consented by the org owner (and where applicable the treating psychologist), time-boxed, read-scoped, fully audited and visible to the tenant.
  **AC:** Given a support ticket, when no consent is granted, then support sees no clinical data; when consent is granted, then access expires automatically (hypothesis: 4 h) and a report of actions is sent to the tenant.

---

## 6. Requirement counts (MVP priorities)

| Module | Must | Should | Could | Won't |
|---|---|---|---|---|
| AUTH | 6 | 1 | 1 | 1 |
| ORG | 4 | 2 | 1 | 0 |
| RBAC | 6 | 1 | 0 | 1 |
| PAT | 8 | 1 | 1 | 0 |
| GRD | 7 | 1 | 1 | 0 |
| CON | 6 | 2 | 0 | 1 |
| CLR | 7 | 2 | 1 | 0 |
| SES | 4 | 2 | 0 | 1 |
| NOTE | 5 | 2 | 1 | 0 |
| TPL | 3 | 2 | 1 | 0 |
| DOC | 3 | 1 | 1 | 0 |
| RES | 3 | 3 | 1 | 0 |
| ACT | 8 | 3 | 0 | 2 |
| ASG | 5 | 3 | 1 | 0 |
| RSP | 5 | 2 | 1 | 0 |
| PRT | 11 | 1 | 2 | 0 |
| I18N | 4 | 1 | 1 | 0 |
| AUD | 5 | 2 | 0 | 0 |
| BRD | 3 | 2 | 1 | 0 |
| SEC | 11 | 3 | 0 | 0 |
| **Total (172)** | **114** | **37** | **15** | **6** |

Note: the Must count is large because this is a clinical-data product; a thin-slice release plan (which Musts land in alpha with Daniela vs. beta) is delegated to `DEVELOPMENT_ROADMAP.md` (product with architect).

## 7. Non-functional requirements

**NFR-SEC (security).** OWASP ASVS Level 2 target; MFA for professionals; least privilege; deny-by-default; secrets outside code; encryption in transit and at rest; signed short-lived file URLs; no third-party trackers in authenticated areas; dependency scanning in CI; pre-GA penetration test; incident runbook (SEC-12).

**NFR-PRIV (privacy and data protection).** Data minimization (collect only fields needed; most identity fields optional). Purpose limitation: patient data is never used for product analytics, model training or marketing. Health data treated as sensitive `[NEEDS LEGAL VERIFICATION]`. Privacy notice and data-processing authorization texts supplied as drafts. Data-rights workflow (PAT-09). Retention rules configurable but no hard deletion of clinical records. Cross-border transfer and subprocessor register (SEC-08). Telemetry limited to non-content, non-identifying operational metrics.

**NFR-A11Y (accessibility).** WCAG 2.2 AA across dashboard and portal: keyboard operability, visible focus, target size (min 24x24 CSS px; child mode min 44x44), contrast 4.5:1 text / 3:1 UI, no color-only meaning, labels and error identification, reduced motion, text resize to 200%, captions/transcripts for authored media where provided, screen-reader tested flows (login, activity player, consent). Builder-authored content is validated (alt text). Accessible authentication (no cognitive-test-only login, WCAG 3.3.8). Plain-language reading level for patient-facing UI (target grade 6–8 for adults, simpler for child mode).

**NFR-PERF (performance).** Hypotheses, to be validated on realistic devices/networks in Colombia: portal LCP ≤ 2.5 s on mid-range Android over 4G; INP ≤ 200 ms; dashboard list views p95 ≤ 1 s server time; note autosave ≤ 500 ms and never blocks typing; activity player works with intermittent connectivity (progress cached, resumed); media streaming adaptive; supports a single tenant of 500 active patients and a platform of 100 tenants at MVP scale `→ architect`.

**NFR-I18N.** es-CO default, en supported; ICU message formatting and pluralization; no concatenated strings; timezones stored in UTC with display conversion; content language is data, not code; right-to-left not required.

**NFR-RESP (responsiveness).** Portal is mobile-first (360 px up); dashboard is desktop-first but usable on tablet; session notes usable on tablet; no horizontal scroll at 320 px for portal; touch-friendly in child mode; works on current and previous major versions of Chrome, Safari, Edge, Firefox, Samsung Internet.

**NFR-OBS (observability).** Structured logs without PHI; error tracking with PII scrubbing; metrics and traces per tenant id (pseudonymous); uptime target 99.5% for MVP (hypothesis); status page; alerts for auth anomalies and cross-tenant denial spikes; audit log (AUD) distinct from operational logs.

**NFR-REL (reliability).** Draft autosave; idempotent submits for patient responses; graceful degradation offline in the activity player; backups and restore drills (SEC-07).

**NFR-MAINT.** Feature flags per tenant; migrations reversible; activity definition schema versioned and forward compatible with branching (ACT-12).

## 8. Out of scope for MVP

Video conferencing; online payments; invoicing/billing and plan enforcement in code; native mobile apps; AI diagnosis, AI summarization of sessions or responses, automated clinical recommendations or risk scoring; advanced scheduling (availability, calendar sync, self-booking, reminders for sessions); SSO/SAML; certified e-signature providers; cross-tenant marketplace; conditional logic/branching in activities; custom roles; EHR/insurance interoperability (RIPS, HL7/FHIR); telehealth session recording; real-time chat/messaging between patient and psychologist (to avoid an unmonitored crisis channel; reconsider with Daniela).

## 9. Assumptions

1. A1 — Org = tenant; solo practice = org of one; the first tenant is Daniela Ortega's practice.
2. A2 — Patients and guardians never self-register; only invitation.
3. A3 — Owner who is not treating has no clinical access by default (RBAC-06); a solo psychologist is both roles.
4. A4 — Age threshold for "minor" is under 18 (Colombia, adulthood at 18) `[NEEDS LEGAL VERIFICATION]`; adolescent UX band configurable (default 12–17), child band 6–11; under 6 is not supported in portal (guardian-driven only) `[NEEDS PSYCHOLOGIST INPUT]`.
5. A5 — Patient responses are patient-generated content outside the clinical record unless the psychologist explicitly references them.
6. A6 — Session recording is a record only; sessions happen outside the platform.
7. A7 — Clinical records are retained and never hard-deleted by tenants; deletion/erasure requests are handled via legal assessment `[NEEDS LEGAL VERIFICATION]`.
8. A8 — The psychologist (or org) is the data controller; SyV is the data processor (see SAAS_STRATEGY) `[NEEDS LEGAL VERIFICATION]`.
9. A9 — All consent/privacy texts delivered by SyV are drafts for the client's legal review.
10. A10 — Patients use mid-range smartphones, mostly mobile browsers; email is the primary notification channel (no SMS/WhatsApp in MVP).
11. A11 — Email addresses for children are not required; the child's access is mediated by a guardian or a supervised credential.
12. A12 — Starter content (templates, resources) is optional and does not block MVP.

## 10. Open questions

### For Daniela Ortega (clinical and practice)
1. Which record sections do you need at intake and in the psychological history, for adults and for minors? Can you share your current forms?
2. Which note formats do you use (free, SOAP, DAP, other)? Do you keep separate personal working notes `[NEEDS PSYCHOLOGIST INPUT]`?
3. Should journal/reflection entries that the patient does not share be stored at all, and who can ever see them?
4. Adolescent confidentiality: what should guardians see by default? Which age bands define child/adolescent/adult UX in your practice?
5. Which interactive games and emotion sets are clinically useful and appropriate? Which therapeutic approaches should activity templates serve?
6. What must happen when a patient refuses assent, or a guardian withdraws consent, mid-treatment?
7. What safety/crisis information must appear in the portal, and how should the "not monitored in real time" message read?
8. Which diagnostic catalogue(s) do you use (CIE-10, DSM-5-TR)?
9. Do you want to work with other psychologists soon (second-psychologist journey), and should the owner see anything clinical?
10. Which documents do you issue (certificates, reports) and in what format?
11. Which consent documents do you currently use, and who is your legal reviewer?
12. What is your current patient volume, and do you need to migrate existing records?
13. Do you want any reminder emails, and what tone/wording is acceptable for discreet notifications?

### For SyV Solutions (business, legal, architecture)
1. Who is formally the controller/processor, and who signs the DPA? Is a legal review budget approved `[NEEDS LEGAL VERIFICATION]`?
2. Hosting region and cross-border transfer approach (Supabase region, subprocessors) `[NEEDS LEGAL VERIFICATION]`.
3. Is SyV branding mandatory on white-labeled surfaces (e.g., "powered by")?
4. Is Daniela a design partner (free/discounted) and what are the commitments in return?
5. Retention periods and erasure policy to ship by default `[NEEDS LEGAL VERIFICATION]`.
6. Support model and SLA for the first tenant; who holds break-glass authority?
7. Sequencing: which of the 114 Musts are required for Daniela's first real patient (alpha)? Proposed to be resolved in the roadmap.
8. Is outbound email from a SyV domain or per-tenant domain at launch?
9. Do we need professional-liability, cyber insurance, or certification (e.g., ISO 27001) before general availability?
10. Child sign-in mechanism acceptable trade-offs (AUTH-07) → architect and security review.
