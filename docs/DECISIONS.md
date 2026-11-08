# Architecture Decision Records

> All ADRs below are **Status: Proposed** — pending approval by the client (SyV Solutions /
> Daniela Ortega) and security review where marked. Once accepted, an ADR is changed only
> by a new ADR that supersedes it.
> Related: [ARCHITECTURE.md](./ARCHITECTURE.md) · [DATABASE.md](./DATABASE.md) · [API_CONTRACTS.md](./API_CONTRACTS.md)

Template: **Context** · **Decision** · **Consequences** · **Status**.

## Index

| ADR | Title | Status |
|---|---|---|
| 001 | Technology stack | Proposed |
| 002 | Organization as the tenant | Proposed |
| 003 | Shared database, shared schema, RLS isolation | Proposed |
| 004 | Server-only DAL with RLS as defense in depth | Proposed (security review) |
| 005 | Guardians as profiles + relationship with granular permissions | Proposed (security review) |
| 006 | Immutable clinical note finalization with addenda | Proposed |
| 007 | Activity version pinning | Proposed |
| 008 | Block-based activity content, no arbitrary HTML/JS | Proposed (security review) |
| 009 | next-intl locale-prefixed routing | Proposed |
| 010 | CSS-variable white-label theming | Proposed |
| 011 | Private storage with signed URLs | Proposed (security review) |
| 012 | Append-only audit log | Proposed (security review) |
| 013 | Retention periods not hardcoded | Proposed (legal) |
| 014 | platform_admin without clinical access; break-glass | Proposed (security review) |
| 015 | Structured clinical data (no single JSON record) | Proposed |
| 016 | Care-team-based clinical access | Proposed (security review) |
| 017 | Host-based tenant resolution for white-label | Proposed |
| 018 | Atomic critical mutations as Postgres functions | Proposed |

---

## ADR-001 — Technology stack

**Context.** A small team (SyV + agents) must deliver a secure, bilingual, multi-tenant
clinical SaaS quickly, with strong typing and a managed backend. Native apps, payments and
video are out of MVP.

**Decision.** Next.js (App Router) + React + TypeScript (strict) + Tailwind CSS +
shadcn/ui + Lucide icons; Supabase (Postgres, Auth, Storage); Zod for validation;
React Hook Form for forms; next-intl for i18n; ESLint + Prettier; Vitest (unit,
integration), Playwright (E2E), pgTAP (RLS). Hosting recommendation: Vercel + Supabase
hosted, co-located regions. Node runtime for all data access.

**Consequences.**
- (+) One language end-to-end; Zod schemas shared between client forms and server.
- (+) Postgres gives real constraints, triggers and RLS for clinical integrity.
- (−) Supabase JS has no client transactions → ADR-018.
- (−) Vendor coupling to Supabase Auth; mitigated by keeping authz in our own tables and
  helpers, not in Auth metadata.
- Every additional dependency requires written justification and architect approval.
- Neither Vercel nor Supabase is assumed to make the product legally compliant;
  region/data transfer is a client + legal decision (Q-01).

**Status.** Proposed.

---

## ADR-002 — Organization as the tenant

**Context.** The product is white-label and sold to practices. The first tenant is a
single psychologist, but others may be clinics with several professionals.

**Decision.** The **organization** is the unit of tenancy, branding, configuration and
data ownership. Every tenant-owned row carries `organization_id`. A person (profile) can
belong to several organizations; patients and guardians are records **inside** an
organization (a person treated by two practices is two patient records, intentionally not
linked).

**Consequences.**
- (+) Clear data ownership and isolation; easy per-tenant export/offboarding.
- (+) A solo practice is just an org with one owner+psychologist membership.
- (−) No cross-org patient view (desired for privacy).
- (−) Composite FKs `(organization_id, id)` add verbosity, but make cross-tenant
  references impossible at the DB level.

**Status.** Proposed.

---

## ADR-003 — Shared database, shared schema, RLS isolation

**Context.** Options: database-per-tenant, schema-per-tenant, or shared schema with
row-level isolation. Expected tenant count: tens to hundreds of small practices.

**Decision.** One Supabase project per environment, one `public` schema, row-level
isolation by `organization_id` enforced by Postgres RLS (enabled **and forced** on every
table, default deny), plus composite FKs.

**Consequences.**
- (+) Single migration path; cheap onboarding; works with Supabase tooling.
- (+) RLS policies are testable (pgTAP + JWT-based tests).
- (−) A policy bug could leak across tenants → mitigated by ADR-004 (app checks), mandatory
  RLS tests per table and cross-tenant test personas.
- (−) Noisy neighbour risk; acceptable at expected scale. Re-evaluate if a large clinic
  requires dedicated infra (would be a new ADR, e.g. dedicated project).

**Status.** Proposed.

---

## ADR-004 — Server-only DAL with RLS as defense in depth

**Context.** Supabase allows browsers to query Postgres directly with RLS as the only
control. For clinical data, a single control layer is insufficient.

**Decision.**
1. Browsers never query domain tables. All data access happens in server-only modules
   (`import 'server-only'`) through a DAL whose functions require an `AuthzContext`.
2. The DAL uses the **user's JWT** so RLS applies to every query (second line).
3. Application-level `requirePermission()` runs before every query/mutation (first line).
4. The service-role key is wrapped in narrow functions in `src/server/db/admin.ts`, importable
   only from an allowlist (lint rule), each audited.

**Consequences.**
- (+) Two independent controls must both fail for a leak.
- (+) DTO mapping prevents over-fetching sensitive columns to the client.
- (−) More code than direct client queries; no realtime subscriptions in MVP (acceptable).
- (−) Permission logic exists in two places (TS + SQL) → permission matrix tests assert
  both agree.

**Status.** Proposed — requires security review.

---

## ADR-005 — Guardians as profiles + relationship with granular permissions

**Context.** Minors are patients; parents/legal representatives need portal access to
some things (assignments, consents) but not others (clinical notes, possibly the child's
private reflections). A guardian may have several children, may lose custody, or may
exist before having an account.

**Decision.**
- `guardians` is an org-scoped person record, optionally linked to a `profiles` row (login).
- Access is scoped by `patient_guardians` (relationship type, legal-representative flag,
  verification, validity dates, status).
- Capabilities are rows in `patient_guardian_permissions` from a closed enum; revocation
  sets `revoked_at`; re-grant inserts a new row.
- Resource-level flags (`guardian_visibility` on assignments, `guardian_visible` on shares)
  are set by the psychologist; defaults are restrictive.
- No guardian permission exists for clinical notes, record sections, diagnoses,
  assessments or treatment plans.

**Consequences.**
- (+) Least privilege, auditable, revocable; supports custody changes and multiple guardians.
- (+) Guardians are not memberships, so they never get staff capabilities.
- (−) More joins in RLS helpers → index `patient_guardians` and permission rows; cache per
  request in app.
- Open: behaviour when the patient becomes an adolescent/adult (Q-04),
  `[NEEDS LEGAL VERIFICATION]`.

**Status.** Proposed — requires security review.

---

## ADR-006 — Immutable clinical note finalization with addenda

**Context.** Clinical records must be trustworthy; corrections must be traceable and
never silently overwrite the original (expected by Resolución 1995/1999 —
`[NEEDS LEGAL VERIFICATION]`).

**Decision.**
- Notes have `draft` → `finalized`. Finalization (author only, `aal2`) runs
  `app.finalize_clinical_note()`, which stores `finalized_at`, `finalized_by`,
  `content_hash` and the audit row atomically.
- A trigger rejects UPDATE/DELETE of finalized notes for all application roles.
- Corrections are `clinical_note_addenda` rows (reason, author, timestamp, hash),
  themselves append-only, displayed inline with the note.
- Same pattern for assessments; record sections are living documents with full revision
  history instead.

**Consequences.**
- (+) Tamper-evident clinical history; clear authorship.
- (−) Typos after finalization require an addendum (by design). UI must make finalization
  deliberate (confirmation step).
- (−) Drafts left unfinalized are a clinical risk → dashboard reminder of open drafts
  (product requirement, not automatic finalization). Auto-finalize policy is open (Q-16).

**Status.** Proposed.

---

## ADR-007 — Activity version pinning

**Context.** Psychologists will edit activities over time. A patient mid-way through an
activity, or a historic response, must always refer to exactly what the patient saw.

**Decision.**
- `activities` (identity) → `activity_versions` (content) → `activity_blocks`.
- Versions are editable only as `draft`; publishing freezes them (trigger) and records a
  content hash. Only `published → retired` is allowed afterwards.
- `activity_assignments.activity_version_id` is required, must reference a published
  version at insert time, and cannot change.
- `activity_response_items` reference `(activity_version_id, activity_block_id)` via a
  composite FK, guaranteeing answers match the pinned version.

**Consequences.**
- (+) Responses are always interpretable against the exact content.
- (+) Editing never disrupts in-flight assignments.
- (−) Storage grows with versions (small; blocks are compact JSON).
- (−) To give a patient the newer version, a psychologist must reassign (explicit by design).

**Status.** Proposed.

---

## ADR-008 — Block-based activity content, no arbitrary HTML/JS

**Context.** Psychologists need a no-code builder. Arbitrary HTML/JS would create XSS risk
in a portal used by patients and children, and make content non-portable and untranslatable.

**Decision.**
- Content is a list of predefined blocks (`text`, `image`, `multiple_choice`,
  `open_response`, `scale`, `emotion_selector`, `audio`, `video`, `game`) validated by a
  Zod discriminated union with a per-block `schemaVersion`.
- Rich text is a restricted AST rendered by our components; `dangerouslySetInnerHTML` is
  banned by lint. Links limited to `https:`/`mailto:`.
- Video embeds only from an allowlisted provider, by provider + id (no raw iframe URLs).
- Games come from a fixed catalog implemented in code with typed configs.
- Renderer registry per block type with `adult`, `child` and `review` renderers; unknown
  or invalid blocks render a safe fallback.
- Schema evolution: in-memory upgraders; stored published blocks are never rewritten.

**Consequences.**
- (+) No script injection surface; consistent accessibility and child-mode rendering.
- (+) Blocks are translatable field-by-field (ADR-009, `content_translations`).
- (−) Less flexibility; new interaction types require development (a feature, not a bug).
- (−) Upgraders must be maintained for every schema version ever published.

**Status.** Proposed — requires security review (embed allowlist).

---

## ADR-009 — next-intl locale-prefixed routing

**Context.** Product is bilingual (es default, en). Users and orgs have default locales.
Clinical content must not be machine-translated; therapeutic content may have reviewed
translations.

**Decision.**
- next-intl with routes under `src/app/[locale]/...`, `localePrefix: 'always'`, locales
  `es` (default) and `en`.
- Locale precedence: URL → `profiles.locale` → `organizations.default_locale` →
  `Accept-Language` → `es`.
- UI strings in `messages/{es,en}.json` with CI key parity.
- Dates/numbers via next-intl formatters in org/user time zone; storage in UTC.
- Clinical content stored and shown in its authored language (`content_locale`).
- Therapeutic content translations in `content_translations` with
  `draft → in_review → approved` status; only approved translations shown to patients;
  stale translations detected via source content hash.

**Consequences.**
- (+) SEO-neutral (app is authenticated) but explicit, shareable, cache-friendly URLs.
- (+) Clear separation: UI i18n (files) vs. content i18n (DB with review).
- (−) Every link must be locale-aware (use next-intl `Link`/`redirect` helpers only; lint).
- (−) Translation workflow adds UI to the activity builder.

**Status.** Proposed.

---

## ADR-010 — CSS-variable white-label theming

**Context.** Each organization needs its own brand (logo, colors) in the portal and
dashboard, without code changes or per-tenant builds.

**Decision.**
- `organization_branding` stores a small set of semantic tokens (validated HSL colors,
  radius scale, allowlisted font, logos as file references).
- The root layout emits CSS variables for the resolved org; Tailwind/shadcn tokens map to
  those variables. Child mode derives variants from the brand tokens per designer rules.
- Contrast (WCAG AA) validated on save; arbitrary CSS never accepted.

**Consequences.**
- (+) Zero-build tenant onboarding; consistent components.
- (+) No CSS injection vector.
- (−) Brands limited to the token set (intentional). Richer theming = new ADR.
- (−) Pre-auth pages need branding before login → branding readable via a narrow public
  function; logos possibly in a public bucket (Q-09).

**Status.** Proposed.

---

## ADR-011 — Private storage with signed URLs

**Context.** Clinical documents, consent scans, activity media and exports are sensitive.
Public URLs are guessable/shareable and unauditable.

**Decision.**
- All buckets private (branding possibly excepted, Q-09).
- Path convention `org/<organization_id>/<domain>/<entity_id>/<file_object_id>.<ext>`;
  storage RLS on `storage.objects` checks the org segment and delegates to
  `app.can_read_file()`. No PHI in paths or file names.
- Every object has a `file_objects` row (mime, size, sha256, status).
- Access only via short-lived signed URLs issued server-side after authorization:
  clinical/exports 60 s, media/resources 10 min, uploads 2 min (constants, adjustable).
- Clinical URL issuance is audited.

**Consequences.**
- (+) Auditable, revocable-by-expiry access; tenant-scoped paths.
- (−) Signed URLs cannot be revoked before expiry → keep TTLs short.
- (−) Media playback for long videos may need re-issuance (renderer handles refresh).
- Antivirus scanning undecided (Q-10).

**Status.** Proposed — requires security review.

---

## ADR-012 — Append-only audit log

**Context.** We must be able to answer "who saw or changed this patient's data, when, and
under which authority", including platform staff.

**Decision.**
- Single `audit_logs` table, append-only: inserts only via `app.write_audit()`
  (`SECURITY DEFINER`), UPDATE/DELETE revoked and blocked by trigger.
- Written atomically with critical mutations (ADR-018), by triggers on clinical tables as
  a safety net, and by the DAL for clinical reads, signed URL issuance and denied attempts.
- Metadata never contains clinical text or direct identifiers beyond ids.
- Optional hash chain for tamper evidence (Q-15); monthly partitioning when needed.
- Operational logs (stdout/Sentry) are separate and PHI-free.

**Consequences.**
- (+) Traceability for clinical, legal and security reviews.
- (−) Volume from read auditing → indexes + partitioning; portal self-reads not audited.
- (−) Audit retention itself depends on ADR-013.

**Status.** Proposed — requires security review.

---

## ADR-013 — Retention periods not hardcoded

**Context.** Colombian clinical record retention and personal-data suppression rules
(e.g. Resolución 1995/1999, Resolución 839/2017, Ley 1581/2012) are pending legal
confirmation and may differ per data category.

**Decision.**
- No retention period appears in code, migrations or seeds.
- `retention_policies` stores per-org, per-category periods with legal basis reference and
  approval; purge/anonymization jobs read active policies and no-op without one.
- Lifecycle uses statuses/archival, not deletion, until a policy is active.

**Consequences.**
- (+) Legal changes are configuration, not deploys; no premature destruction of records.
- (−) Data accumulates until policies are approved → storage cost, larger breach surface.
- `[NEEDS LEGAL VERIFICATION]` for every category before activation.

**Status.** Proposed — pending legal input.

---

## ADR-014 — platform_admin without clinical access; break-glass

**Context.** SyV staff operate the platform (provisioning, support) but must not browse
patients' clinical information. Rare incidents may require controlled access.

**Decision.**
- `platform_admin` is a row in `platform_admins`, **not** an organization membership; it
  has no clinical, patient or portal permissions and no RLS path to clinical tables.
- Break-glass: `platform_access_grants` with scope `clinical_read_break_glass`, a specific
  `patient_id`, written reason (min length), ticket reference, max duration (proposed
  ≤ 24 h), optional org-owner approval (Q-06), read-only.
- `app.has_clinical_access()` honours only active, unexpired, unrevoked grants; every access
  under a grant is audited with `break_glass_grant_id`; the org owner is notified.
- Platform admin routes require MFA (`aal2`).

**Consequences.**
- (+) Strong separation between operator and clinical roles.
- (−) Support cases involving clinical data are slower (intentional).
- (−) Grant workflow must be built before production launch.

**Status.** Proposed — requires security review.

---

## ADR-015 — Structured clinical data (no single JSON record)

**Context.** A single JSON document per patient record is easy to build but prevents
constraints, granular history, partial access control and reporting.

**Decision.** Clinical data is split into typed tables: records, sections (keyed by
enum, with revisions), assessments, diagnoses (code system + code), treatment plans and
goals, sessions, notes and addenda, documents. Free text lives in per-field restricted
rich-text ASTs, never as whole-record JSON.

**Consequences.**
- (+) DB-level integrity, immutability per entity, fine-grained audit.
- (−) More tables/migrations; section keys must be agreed with the psychologist
  (`[NEEDS PSYCHOLOGIST INPUT]`).

**Status.** Proposed.

---

## ADR-016 — Care-team-based clinical access

**Context.** In multi-psychologist organizations, not every psychologist should see every
patient. Org ownership is an administrative role.

**Decision.** Clinical access requires a membership with role `psychologist` **and** an
active `care_team_members` row for that patient. Creating a patient makes the creator the
primary care team member. Owners assign/unassign (audited). Owners without care-team
membership see directory fields only (pending Q-03).

**Consequences.**
- (+) Need-to-know access; supports supervision via `care_role`.
- (−) Solo practices see an extra concept; UI auto-handles it.
- (−) Coverage/vacations require explicit assignment.

**Status.** Proposed — requires security review.

---

## ADR-017 — Host-based tenant resolution for white-label

**Context.** The portal must show the practice's brand, ideally on its own domain. URLs
must not be treated as authority.

**Decision.** Middleware maps host → organization via `organization_domains` and passes a
hint; the server validates against the user's memberships/links. Professional users with
multiple orgs use an `active_org` cookie (also a hint). The org id is never in the path.
Custom domains in MVP vs. subdomains only is open (Q-02).

**Consequences.**
- (+) Clean white-label URLs; same codebase for all tenants.
- (−) Custom domains require DNS verification, TLS provisioning (Vercel domains API) and
  per-domain auth redirect URLs in Supabase.

**Status.** Proposed.

---

## ADR-018 — Atomic critical mutations as Postgres functions

**Context.** Supabase JS has no client-side transactions; finalize+audit, publish+hash,
consent+evidence must be atomic.

**Decision.** Critical multi-step mutations are `SECURITY INVOKER` Postgres functions
called via RPC (RLS still applies), each writing its audit row in the same transaction.
Functions are versioned in migrations and covered by integration tests.

**Consequences.**
- (+) Integrity guaranteed at DB level.
- (−) Business logic split between TS and SQL; keep SQL functions small and focused on
  integrity, with validation in Zod first.

**Status.** Proposed.

---

## Open questions requiring client input

| Id | Question | Default proposal |
|---|---|---|
| Q-01 | Hosting region / international data transfer | Co-located Supabase + Vercel region chosen after legal advice `[NEEDS LEGAL VERIFICATION]` |
| Q-02 | Custom domains for the portal in MVP? | Subdomains in MVP, custom domains post-MVP |
| Q-03 | May an organization owner see clinical data of patients not on their care team? | No; directory fields only |
| Q-04 | Guardian access rules for adolescents and at age of majority | Psychologist-controlled per assignment; review flag at majority, no auto-revoke `[NEEDS LEGAL VERIFICATION]` |
| Q-05 | Retention periods per data category | None until legal confirms |
| Q-06 | Break-glass approval: org owner approval required, or post-hoc notification? | Owner approval when reachable; notification always |
| Q-07 | MFA for patients/guardians? | Optional, encouraged; mandatory for staff/platform |
| Q-08 | Platform-provided activity templates shared across orgs? | Post-MVP; via copy into org (no cross-tenant rows) |
| Q-09 | Branding bucket public-read? | Yes, logos only (no PHI) |
| Q-10 | Antivirus scanning of uploads | Recommended before production; vendor TBD |
| Q-11 | Storage backup replication | Scheduled encrypted replication of private buckets |
| Q-12 | Multiple clinical episodes per patient | Single record, closable/reopenable |
| Q-13 | Do patients see an activity's therapeutic objective? | No (professional field) |
| Q-14 | DSR intake from the portal? | Yes, simple request form |
| Q-15 | Audit hash chain in MVP? | Optional; recommend if low effort |
| Q-16 | Policy for long-open draft notes | Reminders only; no auto-finalization |
| Q-17 | Electronic consent validity (typed name vs checkbox) | Typed name + checkbox + evidence `[NEEDS LEGAL VERIFICATION]` |
