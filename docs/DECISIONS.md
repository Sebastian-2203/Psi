# Architecture Decision Records

> All ADRs below are **Status: Proposed** — pending approval by the client (SyV Solutions /
> Daniela Ortega) and security review where marked. Once accepted, an ADR is changed only
> by a new ADR that supersedes it.
> Related: [ARCHITECTURE.md](./ARCHITECTURE.md) · [DATABASE.md](./DATABASE.md) · [API_CONTRACTS.md](./API_CONTRACTS.md)

Template: **Context** · **Decision** · **Consequences** · **Status**.

## Index

Security column = verdict in SECURITY.md §12 (review v0.1) and how this revision responds.

| ADR | Title | Status | Security |
|---|---|---|---|
| 001 | Technology stack | Proposed | Approved w/ conditions (Auth hardening, F-11) |
| 002 | Organization as the tenant | Proposed | Approved |
| 003 | Shared database, shared schema, RLS isolation | Proposed | Approved w/ conditions |
| 004 | Server-only DAL with RLS as defense in depth | Proposed — revised; depends on ADR-019 | Changes required → revised |
| 005 | Guardians as profiles + relationship with granular permissions | Proposed — revised | Approved w/ conditions |
| 006 | Immutable clinical note finalization with addenda | Proposed — revised | Approved w/ conditions |
| 007 | Activity version pinning | Proposed | Approved |
| 008 | Block-based activity content, no arbitrary HTML/JS | Proposed | Approved w/ conditions |
| 009 | next-intl locale-prefixed routing | Proposed | Approved |
| 010 | CSS-variable white-label theming | Proposed — revised | Approved w/ conditions |
| 011 | Private storage with signed URLs | Proposed | Approved w/ conditions |
| 012 | Append-only audit log | Proposed — revised | Approved w/ conditions |
| 013 | Retention periods not hardcoded | Proposed (legal) | Approved (security) |
| 014 | platform_admin without clinical access; approval-gated break-glass | Proposed — rewritten | Changes required → rewritten, re-review |
| 015 | Structured clinical data (no single JSON record) | Proposed | Approved |
| 016 | Care-team-based clinical access | Proposed — revised | Approved w/ conditions |
| 017 | Host-based tenant resolution for white-label | Proposed — revised | Approved w/ conditions |
| 018 | Atomic critical mutations as Postgres functions | Proposed — revised | Approved w/ conditions |
| 019 | Database access path for authenticated users | **Proposed — awaiting client approval** | New (F-01) — needs review |
| 020 | Application rate limiting | Proposed | New (F-15) — needs review |
| 021 | MFA recovery | Proposed | New (F-14) — needs review |

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
control. For clinical data, a single control layer is insufficient. Security review F-01
showed that "browsers never query domain tables" is only a convention unless the Data API
surface is actually closed: any user JWT + the public key reaches PostgREST and Storage.

**Decision.**
1. Browsers never query domain tables. All data access happens in server-only modules
   (`import 'server-only'`) through a DAL whose functions require an `AuthzContext`.
2. **How this is enforced is ADR-019** (Proposed; Option A recommended). Until it is
   accepted, RLS + grants are designed to be sufficient on their own for confidentiality.
3. Every DAL query runs as the user (role `authenticated` + verified claims) so RLS applies
   (second line); RLS helpers require `aal2` for staff/clinical/platform access (F-03).
4. Application-level `requirePermission()` runs before every query/mutation (first line).
5. Views are `security_invoker`; restricted projections are explicit `SECURITY DEFINER`
   functions (F-05). Tenant/clinical data is never put in a shared Next.js cache (F-17).
6. The service-role key is wrapped in narrow functions in `src/server/db/admin.ts`,
   importable only from an allowlist (lint rule), each audited.

**Consequences.**
- (+) Two independent controls must both fail for a leak.
- (+) DTO mapping limits over-fetching (a confidentiality control only under ADR-019 Option A).
- (−) More code than direct client queries; no realtime subscriptions in MVP (acceptable).
- (−) Permission logic exists in two places (TS + SQL) → permission matrix tests assert
  both agree, including real-JWT direct-API abuse tests.

**Status.** Proposed — revised after security review; cannot be accepted before ADR-019.

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
  assessments, internal treatment plans, private documents or patient reflections. Added
  permissions `view_shared_documents`, `view_patient_facing_goals` (PRD GRD-04).
- Consent signing requires a verified legal representative (basis + verification, GRD-03);
  guardians read only consents they signed, never other signers' evidence (F-09, F-12).
- `app.guardian_can` also requires the patient to be a minor; at majority relationships are
  suspended automatically pending review (PRD PAT-06, fail-closed, F-08).

**Consequences.**
- (+) Least privilege, auditable, revocable; supports custody changes and multiple guardians.
- (+) Guardians are not memberships, so they never get staff capabilities.
- (−) More joins in RLS helpers → index `patient_guardians` and permission rows; cache per
  request in app.
- Open: adolescent defaults (Q-04) `[NEEDS PSYCHOLOGIST INPUT]` `[NEEDS LEGAL VERIFICATION]`.

**Status.** Proposed — revised per security conditions.

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
- Drafts are created, updated and finalized by their author only (RLS + trigger, F-13);
  the finalize trigger is self-validating (server timestamp, recomputed hash, unchanged body).
- Same pattern for assessments; record sections are living documents with full revision
  history instead.

**Consequences.**
- (+) Tamper-evident clinical history; clear authorship.
- (−) Typos after finalization require an addendum (by design). UI must make finalization
  deliberate (confirmation step).
- (−) Drafts left unfinalized are a clinical risk → dashboard reminder of open drafts
  (product requirement, not automatic finalization). Auto-finalize policy is open (Q-16).

**Status.** Proposed — revised per security conditions.

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
- Contrast (WCAG AA) validated on save; arbitrary CSS never accepted; the `<style>` block
  carries the CSP nonce and only validated token values.
- Logos/favicons: PNG/WebP/ICO only, **no SVG**, re-encoded server-side (F-18).

**Consequences.**
- (+) Zero-build tenant onboarding; consistent components.
- (+) No CSS injection vector.
- (−) Brands limited to the token set (intentional). Richer theming = new ADR.
- (−) Pre-auth pages need branding before login → branding readable via a narrow public
  function; logos in a public-read, non-listable bucket (Q-09).

**Status.** Proposed — revised per security conditions.

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
  (`SECURITY DEFINER`, non-exposed schema), UPDATE/DELETE revoked and blocked by trigger.
- The writer derives the actor from `auth.uid()` and roles from the DB — never from
  parameters; checks org membership; accepts only allowlisted event types; is rate-limited.
  System/denied events use a separate service-role-only writer (F-04).
- **One source per event** (F-23): the mutating Postgres function (ADR-018) writes it;
  triggers on clinical tables emit only a distinct `*.changed_untracked` safety-net event
  when the function path was bypassed; the DAL writes clinical reads and signed URL issuance.
- Daily signed digest of the log stored outside the Supabase project (tamper evidence).
- Metadata never contains clinical text or direct identifiers beyond ids.
- Optional hash chain for tamper evidence (Q-15); monthly partitioning when needed.
- Operational logs (stdout/Sentry) are separate and PHI-free.

**Consequences.**
- (+) Traceability for clinical, legal and security reviews.
- (−) Volume from read auditing → indexes + partitioning; portal self-reads not audited.
- (−) Audit retention itself depends on ADR-013.
- (−) Under ADR-019 Option B, direct Data API reads are not DAL-audited (residual).

**Status.** Proposed — revised per security conditions.

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

## ADR-014 — platform_admin without clinical access; approval-gated break-glass

**Context.** SyV staff operate the platform (provisioning, support) but must not browse
patients' clinical information. Rare incidents may require controlled access. PRD SEC-14
and SAAS_STRATEGY §8 require tenant consent, time-boxing, read scope, full audit and a
report to the tenant. The earlier draft (grant active on insert, optional owner approval,
24 h, shared read/write helper) did not meet that (F-02).

**Decision.** (Design: SECURITY.md §6; schema: DATABASE.md §5.1.)
- `platform_admin` is a row in `platform_admins`, **not** an organization membership; it
  has no clinical, patient or portal permissions and no RLS path to clinical tables except
  through an approved grant. Platform routes and helpers require `aal2`.
- Tiers: T1 operational metadata; T2 `org_support_non_clinical` (ticket, owner notified,
  time-boxed); T3 `clinical_read_break_glass` (below).
- T3 flow: (1) request with patient (and optional object ids), reason ≥ 20 chars, ticket,
  duration → `pending`; (2) org owner approves in-app (aal2); the treating psychologist also
  approves when they are not the owner `[NEEDS PSYCHOLOGIST INPUT]`; (3) a **second, different**
  platform_admin approves; (4) **the database activates the grant** (sets `approved`,
  `starts_at`, `expires_at`) only when all required approvals are present and distinct from
  the requester — the requester cannot activate or self-approve.
- Duration: **default and maximum 4 h** (PRD SEC-14 hypothesis); lowering is configuration,
  raising requires a new ADR.
- **Read-only by construction**: separate helpers `app.can_read_clinical` (care team ∨
  approved grant) and `app.can_write_clinical` (care team only). No exports, no `exports`
  signed URLs; clinical-document URLs only within `object_scope`.
- Every read under a grant is audited with `break_glass_grant_id` and `actor_type =
  break_glass`; the owner is notified on approval, first use and closure; an access report is
  sent after expiry. Owner, treating psychologist or either SyV approver can revoke at once.
- Emergency exception (platform incident, owner unreachable): executive + four-eyes, max 1 h,
  retroactive notification — runbook only `[NEEDS LEGAL VERIFICATION]`. No impersonation.
- Infrastructure access (Supabase/Vercel consoles, backups) bypasses all of this and is
  governed by the operational controls of SECURITY.md §6 (F-11).

**Consequences.**
- (+) Matches SEC-14: no clinical data without tenant consent; enforced in the DB, not only UI.
- (−) Support cases involving clinical data are slower and need an owner online (intentional).
- (−) Approval workflow, notifications and access report must be built before production.

**Status.** Proposed — rewritten after security review; requires security re-review.

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
- Helpers require `aal2`, active membership and an allowed org status (F-03, F-26).
- Owner self-grant of `psychologist` is enforced in the DB (licence data required, audited,
  other owners/psychologists notified). Self-assignment to a patient who has another primary
  requires a reason, notifies the primary and is highlighted in access history; whether the
  primary must acknowledge first is `[NEEDS PSYCHOLOGIST INPUT]` (F-06).
- Owners never generate full-record exports; only care-team psychologists do (F-06).
- Draft notes are author-only (F-13).

**Consequences.**
- (+) Need-to-know access; supports supervision via `care_role`.
- (−) Solo practices see an extra concept; UI auto-handles it.
- (−) Coverage/vacations require explicit assignment.

**Status.** Proposed — revised per security conditions.

---

## ADR-017 — Host-based tenant resolution for white-label

**Context.** The portal must show the practice's brand, ideally on its own domain. URLs
must not be treated as authority.

**Decision.** Middleware maps host → organization via `organization_domains` and passes a
hint; the server validates against the user's memberships/links. Professional users with
multiple orgs use an `active_org` cookie (also a hint). The org id is never in the path.
Custom domains in MVP vs. subdomains only is open (Q-02; recommendation: subdomains only).
Middleware strips inbound `x-org-*` headers before setting the hint; cookies are host-only;
redirect URLs are exact per host; `serverActions.allowedOrigins` is explicit (F-16, F-19).

**Consequences.**
- (+) Clean white-label URLs; same codebase for all tenants.
- (−) Custom domains require DNS verification, TLS provisioning (Vercel domains API) and
  per-domain auth redirect URLs in Supabase.

**Status.** Proposed — revised per security conditions.

---

## ADR-018 — Atomic critical mutations as Postgres functions

**Context.** Supabase JS has no client-side transactions; finalize+audit, publish+hash,
consent+evidence must be atomic.

**Decision.** Critical multi-step mutations are Postgres functions, `SECURITY INVOKER` by
default (RLS still applies), each writing its audit row in the same transaction. They also
enforce the integrity rules that must not depend on Zod (response submission, consent
signing, status transitions — F-10). `SECURITY DEFINER` only where an invariant needs rows the
caller cannot read; always `set search_path = ''`, schema-qualified names, no dynamic SQL,
`execute` revoked from `public`/`anon`, living in the non-exposed `app` schema unless
deliberately an RPC. Called inside the request transaction (ADR-019 Option A) or via `rpc()`
(Option B). Versioned in migrations and covered by integration tests.

**Consequences.**
- (+) Integrity guaranteed at DB level.
- (−) Business logic split between TS and SQL; keep SQL functions small and focused on
  integrity, with validation in Zod first.

**Status.** Proposed — revised per security conditions.

---

## ADR-019 — Database access path for authenticated users

**Context.** ADR-004 says browsers never query domain tables, but with Supabase any signed-in
user's JWT plus the public (anon/publishable) key can call the Data API (PostgREST, and
GraphQL if enabled) and the Storage API directly (SECURITY.md A4, F-01, Critical). RLS is
row-level, so any design that relies on the DAL choosing columns leaks through that surface:
guardians reading all `patients` columns, owners bypassing the directory projection, portal
users reading professional activity fields, guardians reading other signers' consent
evidence. Direct reads also skip DAL read-auditing and Zod.

**Options.**

*Option A — close the Data API; server queries Postgres as the user.*
- Disable the Data API for domain schemas (no exposed schema, or Data API off) and keep
  `pg_graphql` disabled. Exact dashboard/config switches to be **verified** at implementation.
- The server connects through the Supabase pooler (transaction mode) as a dedicated login role
  that owns nothing, has no `BYPASSRLS` and may only `set role authenticated`. Each request
  runs in a transaction: `set local role authenticated` and
  `set_config('request.jwt.claims', <claims of the server-verified JWT>, true)`, so
  `auth.uid()`, `auth.jwt()` (incl. `aal`) and every RLS policy behave as they would under
  PostgREST. Claims are taken **only** from a token verified server-side, in one small module.
- Supabase Auth is unchanged (still via supabase-js). Storage API stays reachable with user
  JWTs, so storage RLS denies direct reads and the server issues signed URLs after an
  RLS-bound `app.can_read_file()` check. Realtime: not used in MVP; no table is added to the
  `supabase_realtime` publication (Postgres Changes would otherwise authorize via RLS
  independently of the Data API).
- New dependency: a Postgres driver (e.g. `postgres`) and optionally a typed query builder —
  justified in Phase 1; DB types still generated from the schema.

*Option B — keep the Data API; make every table safe to read directly.*
- Vertically split sensitive columns into care-team-only tables (`patient_identifiers`,
  `consent_record_evidence`, `activity_version_professional_fields`, …); deny portal SELECT on
  any base table that would need column filtering; serve portal/owner projections through
  audited `SECURITY DEFINER` functions. Column GRANTs do not help: all users share the
  `authenticated` role.
- supabase-js with the user's JWT for all queries; RPC for atomic writes.

**Trade-offs.**

| | Option A | Option B |
|---|---|---|
| Browser query surface | None (Auth + signed-URL Storage only) | Every table/function the role can reach |
| Column confidentiality | DTOs + RLS rows; few splits | Depends on every new column being classified correctly, forever |
| Read audit completeness | Complete | Gap for direct reads (Postgres-side logging only) |
| Transactions | Real request transactions | RPC functions only |
| Supabase idiom | Diverges: no `supabase.from()`, no auto REST docs; Studio/SQL/migrations/Auth/Storage unaffected | Native |
| New risk | Claim-setting code could impersonate if buggy (single module, tests, verified token only); pooler/connection limits on serverless | Schema drift reopening a leak; larger RLS surface |
| Future Realtime / mobile clients | Needs a new ADR (e.g. narrow exposed `api` schema or Broadcast with private channels) | Easier |
| Effort now | Connection layer + driver | Many extra tables/functions now and for every feature |

**Recommendation.** **Option A.** It removes the attack surface instead of hardening every
table against it, makes read-auditing (AUD-01) complete, and keeps the model simpler. Its
main costs — a non-idiomatic data layer and a security-critical claims module — are
concentrated in one place and testable. Regardless of the option, three splits are adopted
because they are cheap and also guard against DAL mistakes: `consent_record_evidence`,
`patient_guardian_caveats`, `treatment_goal_patient_texts`. Under A, a CI/deploy check asserts
that PostgREST rejects persona JWTs for domain tables; under B, the **[B]** splits in
DATABASE.md become mandatory.

**Consequences.** ADR-004 and ARCHITECTURE §6 depend on this ADR; Phase 1 DAL work is blocked
until it is accepted. Under A, ADR-018 functions run inside the request transaction.

**Status.** **Proposed — awaiting client approval** (and security re-review).

---

## ADR-020 — Application rate limiting

**Context.** SEC-05 requires brute-force and abuse protection; Supabase Auth limits cover
only Auth endpoints. Invitation acceptance, signed URLs, uploads, exports, consent signing,
DSR creation and server actions need app-level limits (F-15).

**Decision.**
- Supabase Auth built-in limits configured per environment (SECURITY.md §3.1, §3.6).
- App limiter backed by **Postgres** (`rate_limit_counters`, fixed window, via
  `app.consume_rate_limit`), keyed by sha256 of `action:profile` and `action:ip` (no raw IPs).
  Fail **closed** for auth-adjacent actions (invitation acceptance, recovery-code use), fail
  open with an alert elsewhere.
- Coarse IP rules at the hosting edge where the plan supports them (verify availability).
- Hits return `RATE_LIMITED`, audit `access.rate_limited` / `auth.rate_limited`, feed AUD-06 alerts.

**Consequences.**
- (+) No new subprocessor or cross-border data flow; transactional with the action.
- (−) Extra DB writes per limited action; revisit a managed KV (new vendor, DPA) if load requires.

**Status.** Proposed — requires security review.

---

## ADR-021 — MFA recovery

**Context.** AUTH-04 makes TOTP mandatory for staff and requires recovery codes. To our
knowledge Supabase Auth does not issue recovery codes natively — **verify at implementation**;
if native support exists, prefer it and supersede this ADR. The app also cannot mint an
`aal2` session itself (F-14).

**Decision.**
- App-managed recovery codes: 10 codes, ≥ 80 bits each, generated server-side, shown once,
  stored hashed (Argon2id or bcrypt) in `mfa_recovery_codes`, single use; regeneration
  requires recent MFA and revokes the previous batch.
- Using a code (password already verified, `aal1`): rate-limited verification → mark used →
  Auth admin API removes the user's TOTP factors and revokes other sessions → the user must
  enroll and verify a new factor to reach `aal2`. Audited (`auth.recovery_code_used`,
  `auth.mfa_reset`) and the user is notified by email.
- Optional second TOTP factor (verify multi-factor support in Supabase Auth).
- Support-assisted reset (no codes left): identity verified by the org owner, or a two-person
  SyV check for solo owners; revokes sessions; audited; runbook entry (account-takeover path).

**Consequences.**
- (+) Meets AUTH-04 without weakening the `aal2` model.
- (−) Password + stolen code allows factor reset → mitigated by notifications and audit.

**Status.** Proposed — requires security review.

---

## Open questions requiring client input

| Id | Question | Default proposal |
|---|---|---|
| Q-01 | Hosting region / international data transfer | Co-located Supabase + Vercel region chosen after legal advice `[NEEDS LEGAL VERIFICATION]` |
| Q-02 | Custom domains for the portal in MVP? | Subdomains in MVP, custom domains post-MVP |
| Q-03 | May an organization owner see clinical data of patients not on their care team? | No; directory fields only; no full-record exports by owners |
| Q-04 | Guardian access defaults for adolescents | Restrictive defaults (SECURITY.md §5.3). At majority: automatic suspension pending review per PRD PAT-06 (changed from "no auto-revoke") `[NEEDS LEGAL VERIFICATION]` `[NEEDS PSYCHOLOGIST INPUT]` |
| Q-05 | Retention periods per data category | None until legal confirms |
| Q-06 | Break-glass approval | **Superseded by ADR-014 rewrite:** owner approval mandatory (+ treating psychologist), second SyV approver, ≤ 4 h; emergency exception runbook only |
| Q-07 | MFA for patients/guardians? | Optional, encouraged; mandatory for staff/platform |
| Q-08 | Platform-provided activity templates shared across orgs? | Post-MVP; via copy into org (no cross-tenant rows) |
| Q-09 | Branding bucket public-read? | Yes, logos/favicons only, no SVG, no listing (security: approved with conditions) |
| Q-10 | Antivirus scanning of uploads | Recommended before production; vendor TBD |
| Q-11 | Storage backup replication | Scheduled encrypted replication of private buckets |
| Q-12 | Multiple clinical episodes per patient | Single record, closable/reopenable |
| Q-13 | Do patients see an activity's therapeutic objective? | No (professional field) |
| Q-14 | DSR intake from the portal? | Yes, simple request form |
| Q-15 | Audit hash chain in MVP? | Optional; recommend if low effort |
| Q-16 | Policy for long-open draft notes | Reminders only; no auto-finalization |
| Q-17 | Electronic consent validity (typed name vs checkbox) | Typed name + checkbox + evidence `[NEEDS LEGAL VERIFICATION]` |
| Q-18 | RPO/RTO commitment | PRD baseline RPO ≤ 24 h / RTO ≤ 8 h committed; PITR target measured in drills |
| Q-19 | ADR-019 database access path | Option A (Data API disabled, server queries as `authenticated` with verified claims) |
| Q-20 | Org `read_only` state and closed-org record custody | `read_only` for non-payment/offboarding; custody procedure `[NEEDS LEGAL VERIFICATION]` |

---

## Security review resolution (SECURITY.md v0.1 §11)

| Finding | Sev | Where addressed | State |
|---|---|---|---|
| F-01 Data API bypasses DAL | Critical | ADR-019 (new), ADR-004, ARCH §1/§6.0, DB §1 rule 10 + [B] markers | **Open** — awaiting client choice (Option A recommended) |
| F-02 Break-glass not approval-gated | Critical | ADR-014 rewrite, DB §5.1 `platform_access_grants`, DB §1 read/write helpers, API §8.17, Q-06 | Addressed (needs re-review) |
| F-03 aal2 only in app | High | DB §1 helpers, ARCH §6.2/§7, ADR-004/016 | Addressed |
| F-04 Forgeable audit writer | High | DB §9, ADR-012, API §9 | Addressed |
| F-05 Views bypass RLS | High | DB §1 rule 11, §5.2/§5.3/§5.4/§5.6 functions, migration lint (DB §11) | Addressed |
| F-06 Owner export / self-grant / self-assign | High | API §4 + §8.4/§8.15, DB §5.2 `membership_roles`, §5.3 `care_team_members`, ADR-016 | Addressed; acknowledgement rule `[NEEDS PSYCHOLOGIST INPUT]` |
| F-07 No reflections entity | High | DB `patient_reflections`, API §8.14a | Addressed; storage/retention of private entries open (psych/legal) |
| F-08 Majority fail-open | High | DB §5.3 `patient_guardians`, §8, ADR-005, Q-04 | Addressed (PRD PAT-06); threshold legal |
| F-09 Consent evidence exposed | High | DB `consent_record_evidence`, `consent_records` RLS, API §8.11 | Addressed |
| F-10 Integrity only in Zod | High | DB §1 rule 12, §5.3 `app.activate_patient`, §5.5, §5.6 response functions, ADR-018 | Addressed; render-time re-validation is a Phase 1 frontend task |
| F-11 Infrastructure operator access | High | ADR-014, ARCH §16 (refers to SECURITY.md §6) | Partially — operational runbook outside these docs; FLE revisit pre-GA |
| F-12 Legal-rep basis missing | Medium | DB `patient_guardians`, `consent_records`, API §4/§8.5 | Addressed; bases `[NEEDS LEGAL VERIFICATION]` |
| F-13 Non-author draft edits | Medium | DB `clinical_notes`, ADR-006/016 | Addressed; draft visibility `[NEEDS PSYCHOLOGIST INPUT]` |
| F-14 MFA recovery | Medium | ADR-021 (new), API §8.1 | Addressed pending verification of Supabase capabilities |
| F-15 No rate-limit mechanism | Medium | ADR-020 (new), DB `rate_limit_counters`, ARCH §13, API §1 | Addressed |
| F-16 `x-org-hint` spoofing / cookies | Medium | ARCH §7/§8, ADR-017 | Addressed |
| F-17 PHI in data cache | Medium | ARCH §13 Caching, API §1 | Addressed |
| F-18 SVG logos / listing | Medium | ARCH §10/§12, ADR-010 | Addressed |
| F-19 Preview redirect wildcards | Medium | ARCH §16, ADR-017 | Addressed |
| F-20 Status enum mismatches | Medium | DB §3, §5.3 portal-status table, API §8.4/§8.7/§8.8/§8.11/§8.14 | Addressed; `paused` portal behaviour `[NEEDS PSYCHOLOGIST INPUT]` |
| F-21 Single `actorKind` | Medium | API §4 acting-as, ARCH §5, DB triggers on `patients`/`guardians` | Addressed; staff↔guardian same-org ban `[NEEDS PSYCHOLOGIST INPUT]` |
| F-08b Goals / doc shares / feedback missing | Medium | DB enums, `treatment_goal_patient_texts`, `clinical_document_shares`, `activity_response_feedback`, API §8.7/§8.10/§8.14 | Addressed |
| F-22 RPO/RTO mismatch | Low | ARCH §17, Q-18 | Reconciled to PRD baseline; client to confirm |
| F-23 Duplicate audit events | Low | DB §9, ADR-012 | Addressed |
| F-24 Consent template permission | Low | API §4 note | **Open** — product decision |
| F-25 Signed URLs survive revocation | Low | ARCH §12 | Accepted residual risk |
| F-26 Suspended org behaviour | Low | DB §5.1 status table, ARCH §8, ADR-016 | Addressed; adds `read_only` status (re-review) |
