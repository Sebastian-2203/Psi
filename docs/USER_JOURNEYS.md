# User Journeys

**Owner:** Product agent · **Status:** Draft v0.1 · Companion to `PRODUCT_REQUIREMENTS.md` (requirement IDs referenced in brackets).

Legend: `[NEEDS LEGAL VERIFICATION]` and `[NEEDS PSYCHOLOGIST INPUT]` as in the PRD. "PS" = psychologist, "OW" = organization owner, "PT" = patient, "GD" = guardian.

Cross-cutting rules for every journey:
- Private progress notes are never visible to patients or guardians.
- Patient responses never become clinical notes automatically.
- The system never produces diagnoses, risk scores or clinical recommendations.
- The psychologist chooses every assignment; age only adapts the interface.
- Every sensitive read/write creates an audit event (content-free).
- All patient-facing wording is neutral, non-alarming and available in es and en.

---

## J1 — Psychologist onboarding and organization setup

**Actor:** Daniela (PS + OW of a solo org) · **Goal:** Be ready to register a first patient safely in under 30 minutes of setup (hypothesis).
**Preconditions:** SyV has issued an invitation or Daniela signs up from the landing page.

| # | Step | Touchpoint | Permissions / system behavior | Reqs |
|---|---|---|---|---|
| 1 | Receives invitation or opens signup; chooses language (es default) | Web, email | Public route; language persists | I18N-01/02 |
| 2 | Creates account, verifies email | Signup, email link | Single-use link | AUTH-01/02 |
| 3 | Enrolls TOTP and stores recovery codes | Security wizard | Mandatory before any clinical area | AUTH-04 |
| 4 | Names her practice; declares she treats patients | Org wizard | Org created; she becomes OW + PS | ORG-01 |
| 5 | Sets timezone, default language, contact info | Org settings | OW only | ORG-03 |
| 6 | Uploads logo, picks colors; sees live preview in child/adolescent/adult modes | Branding | Contrast check; may auto-adjust text color | BRD-01/03 |
| 7 | Reviews starter consent templates (draft), edits wording, publishes versions in es/en | Consent templates | Templates marked "needs legal review" | CON-01 |
| 8 | Chooses which consents are required for adults and minors | Org settings | Gates activation | CON-05 |
| 9 | Configures portal safety text and emergency numbers | Portal settings | Default neutral text until approved | PRT-12 |
| 10 | Optionally explores starter resources/activities | Library | Copy-on-use | RES-04, ACT-10 |
| 11 | Sees a checklist "Ready to register your first patient" | Dashboard | Checklist state per org | — |

**Edge cases**
- Email verification link expires: resend; no account details leak.
- MFA device lost before recovery codes saved: identity re-verification path via SyV support without clinical access `[NEEDS LEGAL VERIFICATION on process]`.
- Logo with low-contrast color pair: system explains and proposes accessible alternatives rather than silently changing.
- She skips consent setup: the checklist stays incomplete; patient activation will be blocked later with a clear reason.
- Slug already taken: suggestion list.

**Emotional considerations:** Daniela is trusting the tool with other people's most private information. Tone: calm, professional, honest about what is a draft and what needs her legal review. Avoid dark patterns and long forms; show progress. Make the privacy model explicit early ("Nobody at SyV can read your clinical notes").

---

## J2 — Adult intake, record, sessions, notes, finalization and addendum

**Actors:** PS (Daniela), adult PT · **Goal:** Take a new adult patient from first contact to documented, finalized sessions.

| # | Step | Touchpoint | Permissions / behavior | Reqs |
|---|---|---|---|---|
| 1 | PS registers the patient (names, DOB, contact, language, accessibility needs) | Dashboard > New patient | Care team = PS; status `intake`; duplicate check | PAT-01/07 |
| 2 | PS sends portal invitation | Patient profile | Invite bound to this patient/org | AUTH-06, PAT-08 |
| 3 | PT accepts invitation, creates password, verifies email | Email, portal | PT account scoped to org | AUTH-02 |
| 4 | PT reads and accepts data-processing authorization and treatment consent (or PS records paper consent) | Portal consents | Evidence stored; copy available | CON-02/06/07 |
| 5 | Required consents satisfied; PS moves status to `active` | Profile | Blocked if missing | CON-05 |
| 6 | PS opens clinical record; completes intake and psychological history over one or more sittings | Clinical record | Only care team; autosave | CLR-01/02/03 |
| 7 | PS logs assessments applied (instrument, date, entered results) | Record > Assessments | No auto-interpretation | CLR-04 |
| 8 | PS writes a diagnostic impression if she judges appropriate | Record | No suggestions | CLR-06 |
| 9 | PS creates treatment plan; flags two objectives as patient-facing with her own wording | Plan | Versioned | TPL-01/03 |
| 10 | PS records session 1 (date, duration, modality) | Sessions | Record only | SES-01 |
| 11 | PS writes a progress note (draft, autosaved) in her format | Note editor | Private; author only until finalized | NOTE-01/06 |
| 12 | PS finalizes the note | Note editor | Read-only; hash stored | NOTE-02 |
| 13 | Later PS realizes a detail was wrong; adds an addendum with reason | Note view | Original preserved | NOTE-03 |
| 14 | Over time: further sessions, pending-notes list reminds PS of unfinished drafts | Dashboard | Held sessions without a finalized note listed | SES-04 |
| 15 | PS pauses or discharges; record becomes read-only | Profile | No hard delete | PAT-05, CLR-07 |

**Edge cases**
- Patient refuses portal use: patient remains fully manageable offline; consents recorded on paper (CON-07).
- Patient withdraws data-processing consent: PS alerted; new assignments blocked; PS decides handling with legal advice `[NEEDS LEGAL VERIFICATION]`.
- Patient is also a minor's guardian in the same org: separate person records/links; no data merged.
- PS is idle for 15 minutes mid-note: draft preserved; re-authentication required (AUTH-05).
- PS tries to edit a finalized note: blocked; offered "Add addendum".
- Patient disputes content of the record: handled via rectification journey (J10), correction by addendum.
- Two similar names: duplicate warning shows only same-org matches.
- Potential risk disclosed in session: the system has no automated detection; PS follows her own clinical protocol `[NEEDS PSYCHOLOGIST INPUT]`.

**Emotional considerations:** Patient: anxiety about stigma and confidentiality; first screens should explain who sees what in plain language. PS: documentation fatigue; speed and zero-surprise saving are trust factors. Words like "failed", "overdue", "non-compliant" are avoided.

---

## J3 — Minor intake with guardian(s), consent and assent

**Actors:** PS, one or two GD, minor PT (example: 10-year-old child; variant: 15-year-old adolescent) · **Goal:** Establish valid, documented authority and agreement before care and portal use.

| # | Step | Touchpoint | Permissions / behavior | Reqs |
|---|---|---|---|---|
| 1 | PS registers patient with DOB; system flags minor and requires guardian | New patient | Status stuck at `intake` until guardian + consents | PAT-02 |
| 2 | PS creates guardian profile(s); links with relationship type, primary-contact flag | Guardians tab | Separate person records | GRD-01/02 |
| 3 | PS records legal-representative info and verifies supporting document in person | Guardian detail | Verification fields required to sign | GRD-03 |
| 4 | PS sets granular permissions per guardian (default none) | Relationship permissions | Minimal by default | GRD-04/05 |
| 5 | PS invites each guardian | Email | GD portal locked until verified | GRD-06 |
| 6 | GD signs treatment and data consents (or paper recorded) | Guardian portal | Signer = GD with relationship stored | CON-02/06 |
| 7 | PS explains the process to the child/adolescent in session | In person | Outside system | — |
| 8 | Minor assent is recorded: child via PS-guided screen or adolescent in own login, wording adapted | Portal / dashboard | Separate from consent | CON-03 |
| 9 | PS sets portal experience mode (child/adolescent) | Profile | Override of default by age | PAT-03 |
| 10 | PS reviews adolescent privacy view with the adolescent | Portal > Privacy | Shows what each guardian can see | GRD-07 |
| 11 | Status moves to `active` | Profile | Requires all gating items | CON-05 |
| 12 | Developmental and school history completed | Record | Minor-specific sections | CLR-03 |

**Edge cases**
- Only one guardian signs, the other disagrees or is unreachable: system records who signed; whether this suffices is a legal matter `[NEEDS LEGAL VERIFICATION]` and a clinical-ethics matter `[NEEDS PSYCHOLOGIST INPUT]`; no logic infers validity.
- Separated parents with conflict: permissions are independent; PS can revoke one guardian instantly (GRD-05); a confidential caveat is visible only to the care team (GRD-08).
- Guardian is not a legal representative (e.g., aunt who brings the child): can be linked with zero legal flag and cannot sign consents.
- Minor refuses assent: recorded and flagged; PS decides next steps; the system does not block clinical judgment but does block portal assignments until PS resolves `[NEEDS PSYCHOLOGIST INPUT]`.
- Child under the portal age floor: guardian-driven only.
- Minor turns 18 during treatment: PAT-06 task; guardian permissions pause; adult consent obtained from the now-adult patient `[NEEDS LEGAL VERIFICATION]`.
- Colombian child-protection duties (Ley 1098/2006) and mandatory-reporting situations are flagged `[NEEDS LEGAL VERIFICATION]` and are not automated.

**Emotional considerations:** Guardians may feel judged or anxious; avoid blame wording. Adolescents need to feel the process is theirs: assent language is respectful, honest about limits to confidentiality (as defined by PS `[NEEDS PSYCHOLOGIST INPUT]`). Children: warm visuals, no legalese.

---

## J4 — Activity create, publish, assign, patient completes, psychologist reviews

**Actors:** PS, PT (adult or minor) · **Goal:** Deliver a tailored between-session exercise and review the outcome.

| # | Step | Touchpoint | Permissions / behavior | Reqs |
|---|---|---|---|---|
| 1 | PS opens Activities > New; names it, adds purpose note (private to PS), language(s), optional age-range tag | Builder | Draft visible to author | ACT-01 |
| 2 | Adds blocks: instruction text, image with alt text, emotion selector, 1–10 scale, open response, one game | Builder canvas | Block validation inline | ACT-02/03/04 |
| 3 | Writes text in es and en | Builder language toggle | No auto-translation | ACT-08 |
| 4 | Previews as child / adolescent / adult in both languages | Preview | No data saved | ACT-06 |
| 5 | Fixes validation errors (missing alt text), publishes version 1 | Publish dialog | Immutable version | ACT-05/07 |
| 6 | Later edits: changes wording; publishes version 2 | Builder | Existing assignments stay on v1 | ACT-05, ASG-01 |
| 7 | Assigns v2 to patient A with message and due date | Patient > Assign | Requires consents; care team only; PS-initiated | ASG-01/02/03 |
| 8 | PT receives a discreet notification ("You have something new from [Practice]") | Email, portal | No clinical words in subject | PRT-11 |
| 9 | PT opens, completes part, exits; returns and resumes | Portal player | Autosave | RSP-01, PRT-02 |
| 10 | PT submits; sees confirmation | Portal | Immutable after submit | RSP-02 |
| 11 | PS sees "submitted" in her dashboard; opens responses labeled "patient-generated, outside the clinical record" | Patient > Responses | Raw values only | RSP-03/04 |
| 12 | PS marks reviewed and writes optional feedback | Responses | Feedback visible to PT; not a note | RSP-05 |
| 13 | In next session, PS decides to cite one answer; uses "Reference in note" | Note editor | Explicit action only | NOTE-05 |
| 14 | PS views trend of scale values over weeks | Progress | No interpretation overlay | RSP-06 |

**Edge cases**
- Patient never opens: status remains "assigned"; PS may send a gentle reminder or withdraw; wording stays neutral (ASG-08).
- Patient loses connection mid-activity: answers cached/saved; resume path.
- PS unpublishes/archives the activity: existing assignments continue on their pinned version.
- PS assigns a child-oriented game to an adult: allowed; age tags are informational.
- Patient discloses distress in open response: no automated detection or alert; portal shows persistent safety information (PRT-12); PS's reviewing cadence is her responsibility, and this is communicated at onboarding `[NEEDS PSYCHOLOGIST INPUT]`.
- Guardian-assisted submission: tagged accordingly (PRT-10).
- Consent withdrawn between assignment and completion: submission remains stored; PS notified; further assignments blocked (CON-04).
- Image or audio file fails to load: block shows alternative text/transcript; submission still possible if not required.

**Emotional considerations:** PS: creative flow, fear of "breaking" published work (versioning removes it). Patient: avoid performance anxiety; no scores, no "wrong answers" framing; completion messages are warm and non-evaluative; skip and "prefer not to answer" options where clinically appropriate `[NEEDS PSYCHOLOGIST INPUT]`.

---

## J5 — Adult patient portal

**Actor:** Adult PT · **Goal:** Complete work between sessions privately and conveniently on a phone.

| # | Step | Touchpoint | Permissions / behavior | Reqs |
|---|---|---|---|---|
| 1 | Logs in (branded page, language remembered), MFA optional | Login | Org branding | AUTH-01, BRD-01 |
| 2 | Home shows 2 assigned items and 1 shared resource | Home | Only own items | PRT-01 |
| 3 | Opens an activity and completes it | Player | Save/resume | PRT-02 |
| 4 | Listens to an assigned relaxation audio; position remembered | Resources | Captions/transcripts when authored | PRT-04 |
| 5 | Writes a reflection; leaves it unshared; later shares another entry | Reflections | Default not shared; explicit per entry | PRT-05 |
| 6 | Reviews "My goals" (patient-facing wording) | Objectives | No clinical wording | PRT-06 |
| 7 | Downloads a shared document | Documents | Audited, short-lived link | PRT-07, DOC-03 |
| 8 | Changes language to English, raises text size | Preferences | Persists | PRT-08 |
| 9 | Views consents given and can withdraw one | Preferences > Consents | Triggers PS alert | CON-04 |
| 10 | Opens "Privacy": sees who can see what | Privacy | Plain language | PRT-09 |
| 11 | Taps "Need help now?" and sees emergency information | Persistent link | Configured by PS | PRT-12 |

**Edge cases**
- Shared phone/computer: session timeout, "log out" prominent, discreet notification text.
- Patient forgets password: reset flow without revealing account existence.
- Patient discharged: portal becomes read-only for shared documents for a configured period, then closes `[NEEDS PSYCHOLOGIST INPUT]`.
- Low-literacy or visual impairment: screen reader, large text, audio instructions.
- Browser autofill/back button after submit: no duplicate submissions (idempotent).

**Emotional considerations:** Feeling safe and unobserved; no streaks or guilt mechanics; clear who reads what; calm color use; brand voice of the practice.

---

## J6 — Adolescent patient portal

**Actor:** Adolescent PT (about 12–17) with linked GD · **Goal:** Use the portal autonomously with clear confidentiality boundaries.

| # | Step | Touchpoint | Permissions / behavior | Reqs |
|---|---|---|---|---|
| 1 | Receives invitation (own email or via GD per PS's choice) and sets own password | Email, portal | Account is the adolescent's own | AUTH-06, AUTH-07 |
| 2 | Sees assent screen in age-appropriate words; agrees or asks questions | Portal | Separate from guardian consent | CON-03 |
| 3 | Opens "Privacy" and sees what parents/guardians can see | Privacy | Generated from permissions | GRD-07 |
| 4 | Home shows assigned activities in adolescent mode (less playful, more autonomy) | Home | Mode chosen by PS | PRT-03 |
| 5 | Completes a mood-tracking activity with emotion selector and scale | Player | Raw values | ACT-03 |
| 6 | Writes a reflection; chooses "share with my psychologist" | Reflections | Never visible to GD by default | PRT-05, GRD-07 |
| 7 | Reads a shared resource on coping skills | Resources | Age label informational | RES-02 |
| 8 | Views objectives that PS phrased for them | Objectives | Patient-facing wording | TPL-03 |
| 9 | Adjusts preferences (language, notifications timing, dark mode) | Preferences | — | PRT-08 |

**Edge cases**
- Guardian asks to read the adolescent's reflections: only if PS enabled a permission; PS handles via clinical judgment `[NEEDS PSYCHOLOGIST INPUT]`.
- Adolescent wants to revoke assent: recorded; PS alerted; PS decides.
- Adolescent shares content indicating danger: no automated detection; persistent safety information; PS's protocol applies `[NEEDS PSYCHOLOGIST INPUT]`; legal duties flagged `[NEEDS LEGAL VERIFICATION]` (Ley 1098/2006, Ley 1090/2006).
- Notifications visible on a shared family device: discreet subjects, optional disabling.
- Adolescent turns 18: adult flow (J3 edge case, PAT-06).

**Emotional considerations:** Dignity and autonomy: no "kid" patronizing language, no surveillance feeling. Honesty about the limits of confidentiality. Avoid streaks, rankings, or anything that rewards "performing wellness".

---

## J7 — Child portal (with and without guardian help)

**Actors:** Child PT (about 6–11), GD · **Goal:** Let the child engage with playful, simple activities, with attribution of who answered.

**Variant A — with guardian help**

| # | Step | Touchpoint | Permissions / behavior | Reqs |
|---|---|---|---|---|
| 1 | GD logs in on own device/the family tablet and selects the child | Guardian portal | GD needs "help complete" permission | GRD-04, PRT-10 |
| 2 | GD taps "Start with [child name]" | Child mode | Session tagged "guardian-assisted" | PRT-10 |
| 3 | Audio reads instructions; large buttons; emotion selector uses faces + words | Player | Min target 44 px; non-timed | NFR-A11Y |
| 4 | Child plays a matching game; GD helps reading; some answers typed by GD | Game / open response | Attribution: child / guardian-entered | RSP-03 |
| 5 | Submits; celebratory but non-evaluative screen | Player | — | RSP-02 |
| 6 | PS sees submission with attribution per answer where captured | Dashboard | Label visible | RSP-03 |

**Variant B — child alone (supervised credential)**

| # | Step | Touchpoint | Permissions / behavior | Reqs |
|---|---|---|---|---|
| 1 | Child opens the portal on a guardian-trusted device with simple sign-in (PIN or guardian-started session) | Child login | Mechanism pending security review | AUTH-07 |
| 2 | Home shows 1–3 big tiles, no text-heavy lists | Child home | Only psychologist-assigned items | PRT-03 |
| 3 | Completes activity; session auto-closes after inactivity | Player | Short timeout | AUTH-05 |

**Edge cases**
- Guardian lacks "help complete" permission: cannot start a child session; sees an explanation to ask the psychologist.
- Two guardians use the same tablet: session shows which guardian is acting; switching requires login.
- Child cannot read: audio instructions; guardian-entered answers flagged.
- Child quits mid-game: progress saved.
- Child sees a sad-face answer and wants to talk: portal shows no interpretation; safety information (PRT-12) available to the guardian view.
- Guardian answers on the child's behalf entirely: tagged "guardian-entered" so PS can weigh it clinically.
- Rewards (PRT-13, Could): off unless PS enables `[NEEDS PSYCHOLOGIST INPUT]`.

**Emotional considerations:** Safe, playful, never shaming; no timers or failure sounds; avoid anything that resembles an exam. Guardian: reassurance that helping is okay and how.

---

## J8 — Guardian with limited permissions

**Actor:** GD (e.g., mother with view+help; father with minimal) · **Goal:** Support the child within the boundaries set by the psychologist.

| # | Step | Touchpoint | Permissions / behavior | Reqs |
|---|---|---|---|---|
| 1 | GD accepts invitation, verifies email | Email | Account bound to guardian profile | AUTH-06 |
| 2 | Sees "Awaiting verification by [PS]" until PS verifies identity | Portal | No child data | GRD-06 |
| 3 | After verification: sees only enabled areas (e.g., assigned activities, objectives, consent signing) | Portal | Per GRD-04 | GRD-04 |
| 4 | Signs consent; sees copy | Consents | Only if legal representative verified | CON-02, GRD-03 |
| 5 | Helps child with an activity | Child mode | Requires "help complete" | PRT-10 |
| 6 | Tries to open submitted responses | Portal | Hidden/denied if permission off; explanatory text | GRD-04 |
| 7 | Receives a notification that a new activity is available | Email | Only with "receive notifications"; discreet | PRT-11 |
| 8 | Asks psychologist (outside system) for more access | Real world | PS adjusts permission; audited | GRD-05 |
| 9 | Another guardian's permissions are revoked by PS: first guardian is unaffected | — | Independent relationships | GRD-05 |

**Edge cases**
- Guardian never sees private notes, clinical record, assessments, diagnostic field or PS feedback unless PS deliberately shares a document (DOC-02) and the guardian has permission.
- Guardian of two children: separate permission sets per child; switcher.
- Guardian's relationship ended (custody change): access cut immediately, even mid-session; past signed consents remain.
- Guardian is also an adult patient of the same PS: two separate contexts, no cross-visibility.
- Guardian tries guessing child's ID in URLs: denied and audited.
- Guardian asks "Is my child okay?": system gives no automated answer; PS communicates in person.

**Emotional considerations:** Guardians may feel excluded; wording explains that limits protect the child's therapeutic space, not a judgment of the guardian. Avoid exposing conflicts between guardians.

---

## J9 — Owner adds a second psychologist

**Actors:** OW (Daniela), invited psychologist (Marta) · **Goal:** Grow the practice without exposing patients' clinical data inappropriately.

| # | Step | Touchpoint | Permissions / behavior | Reqs |
|---|---|---|---|---|
| 1 | OW opens Members > Invite; enters email and role `psychologist` | Org settings | OW only | ORG-02 |
| 2 | Marta receives email; creates account (or signs in if she already has one), verifies, enrolls MFA | Email, security wizard | Membership scoped to org; existing user gets second membership | AUTH-02/04 |
| 3 | Marta sees empty patient list; sees org branding, resource library, shared activities | Dashboard | No access to Daniela's patients | RBAC-03 |
| 4 | OW shares a few activities and resources with the org | Library | Share, not patient data | ACT-11, RES-01 |
| 5 | Marta registers her own patient | Patients | Care team = Marta only; OW cannot read clinical content | RBAC-06 |
| 6 | Later, Daniela asks Marta to cover a patient: grants time-bound access, with reason, patient notice as required | Patient > Care team | Audited | RBAC-07 |
| 7 | Marta leaves: OW deactivates; patients flagged unassigned; OW reassigns with documented reason | Members | Authored notes stay attributed to Marta | ORG-04/05 |
| 8 | OW views org audit metadata (counts and access events), not clinical text | Audit view | Metadata only | AUD-01/04 |

**Edge cases**
- Marta works in two organizations: switcher; no data crossing (ORG-06).
- Invitee uses another email than invited: invitation tied to the invited address; mismatch denied.
- OW also treats patients: dual role; clinical access only via her own care-team membership.
- Marta deactivated mid-draft: drafts remain; reassigned psychologist cannot see Marta's drafts until finalized or released by policy `[NEEDS PSYCHOLOGIST INPUT]`.
- Patients' consent covers "Daniela's practice" vs. a named psychologist: consent text must state this `[NEEDS LEGAL VERIFICATION]`.
- Seat limits/plan enforcement: not enforced in MVP.

**Emotional considerations:** Owner wants control without snooping; associate wants autonomy and trust. Make the boundary explicit in UI copy ("You manage the practice; clinical content stays with the treating psychologist").

---

## J10 — Patient data-rights request (access / rectification)

**Actors:** PT (or GD for a minor), PS (controller's representative), OW · **Goal:** Honor access/rectification requests transparently with an auditable trail `[NEEDS LEGAL VERIFICATION]` (Ley 1581/2012; Res. 1995/1999 on record handling).

| # | Step | Touchpoint | Permissions / behavior | Reqs |
|---|---|---|---|---|
| 1 | PT opens Preferences > My data rights; chooses "Access my data" or "Correct my data"; describes request | Portal | Authenticated; GD may submit for minor only if permitted | PAT-09, PRT-08 |
| 2 | System creates a tracked request with due date configured by org; PS and OW notified | Dashboard inbox | Org-level setting; deadlines `[NEEDS LEGAL VERIFICATION]` | PAT-09 |
| 3 | Identity is verified (already authenticated; extra check if request is by email) | Process | Documented | PAT-09 |
| 4 | PS reviews scope; decides what to disclose (e.g., record copy, consents, access history) per legal and clinical criteria | Request detail | PS decision; no auto-export of notes | CLR-08, AUD-04 |
| 5 | PS delivers requested data as a shared document or in-person; system audits export | Documents / PDF | Shared-document mechanism | DOC-02 |
| 6 | For rectification, PS evaluates and corrects via addendum or profile change; original preserved | Record | Never overwrite finalized content | CLR-05, NOTE-03 |
| 7 | PS records outcome and rationale; PT receives notification | Request detail | Status closed | PAT-09 |
| 8 | PT may see access history for their record if PS includes it | Documents | Metadata | AUD-04 |

**Edge cases**
- Request for deletion/erasure or revocation of authorization: out of the two scoped types; system logs it, routes to PS/OW, and flags for legal handling since record retention duties may apply `[NEEDS LEGAL VERIFICATION]`.
- Request by a guardian for an adolescent's data: PS decides; guardian permission is a precondition, not an entitlement.
- Request from a third party claiming to be a representative: handled outside the portal with identity checks.
- Disclosure that may harm the patient or third parties: PS clinical judgment `[NEEDS PSYCHOLOGIST INPUT]`; decision and reasons are recorded.
- Overdue request: dashboard flags neutral reminder to PS/OW.
- Patient in a patient-only portal who has been discharged: request path stays available `[NEEDS LEGAL VERIFICATION]`.

**Emotional considerations:** Patients may feel anxious or distrustful; confirm receipt immediately, explain timeline and steps, avoid bureaucratic tone. Psychologists may feel defensive; the tool should present it as routine professional practice.

---

## Journey-to-requirements coverage

| Journey | Primary requirement groups |
|---|---|
| J1 | AUTH, ORG, BRD, CON, PRT-12, I18N |
| J2 | PAT, CON, CLR, TPL, SES, NOTE |
| J3 | PAT, GRD, CON, CLR |
| J4 | ACT, ASG, RSP, NOTE-05, PRT |
| J5 | PRT, RES, DOC, CON |
| J6 | PRT, GRD-07, CON-03, TPL-03 |
| J7 | PRT-03/10, RSP, AUTH-07, ACT-04 |
| J8 | GRD, CON, ASG-05, PRT-10 |
| J9 | ORG, RBAC, ACT-11, AUD |
| J10 | PAT-09, CLR, NOTE-03, AUD-04, DOC |

## Journey-level open questions

1. (J3) What is the policy when only one of two guardians consents? `[NEEDS LEGAL VERIFICATION]` `[NEEDS PSYCHOLOGIST INPUT]`
2. (J6) What are the exact confidentiality limits for adolescents, and how should the portal explain them?
3. (J7) Which child sign-in mechanism is acceptable (PIN, guardian-started session)? → architect/security.
4. (J4, J6) What is the psychologist's expected review cadence, and what must the portal promise or disclaim about monitoring?
5. (J5) How long does a discharged patient keep portal access?
6. (J9) Are drafts of a departing psychologist released to the successor?
7. (J10) Which request types and response deadlines should be configured by default? `[NEEDS LEGAL VERIFICATION]`
