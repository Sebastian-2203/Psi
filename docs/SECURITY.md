# Security Architecture & Review — Psi (SyV Solutions)

> Status: **Phase 0 design (Review v0.1) + Phase 1 implementation review (§14, 2026-11-08)**.
> §1–§13 are the design baseline; §14 records what Phase 1 actually implements and the gate status.
> Owner: security agent. Reviewed: ARCHITECTURE.md, DATABASE.md, API_CONTRACTS.md, DECISIONS.md
> (ADR-001..018) against PRODUCT_REQUIREMENTS.md (§4, §5.1–5.3, §5.5, §5.6, §5.18, §5.20, §7)
> and SAAS_STRATEGY.md §8 (support access).
> All SQL in this document is a **DRAFT SKETCH, NOT A MIGRATION**. Backend writes migrations in
> Phase 1; security reviews them against this document.

Markers: `[NEEDS LEGAL VERIFICATION]` · `[NEEDS PSYCHOLOGIST INPUT]` · `→ architect` (doc change requested).

---

## 1. Scope, assumptions, legal disclaimer

**In scope:** authentication, authorization (app + RLS), tenant isolation, minors/guardians,
support access, audit, storage, application security, data protection, and a review of the
proposed architecture. **Out of scope:** physical/vendor infrastructure security, legal
interpretation, clinical protocol, billing/video (out of MVP).

**Assumptions**
1. A1 — Hosting is Supabase (Postgres, Auth, Storage) + Vercel (Node runtime), one Supabase project per environment.
2. A2 — Org = tenant; patients and guardians join only by invitation (PRD A2, AUTH-06).
3. A3 — Supabase-issued JWTs (with `aal` claim) are the only identity source; authorization data lives in our tables, never in `user_metadata` (user-editable).
4. A4 — Anything reachable with a user's JWT and the public anon/publishable key **is reachable by that user directly**, regardless of what our UI does (see F-01).
5. A5 — SyV staff with access to the Supabase/Vercel consoles are a distinct actor from `platform_admin` in the app (see F-11).

**Legal disclaimer.** Supabase, Vercel, any email/error-tracking vendor, encryption, RLS,
or this document **do not by themselves guarantee legal compliance**. Vendor certifications
(e.g. SOC 2, HIPAA BAAs offered by vendors) are not Colombian-law compliance. The following
are flagged for counsel and are **not interpreted here**:

| Instrument | Topics affected in this design |
|---|---|
| Ley 1581/2012 (and regulations) | sensitive data, consent/authorization, data-subject rights, cross-border transfer, processor duties, breach notice `[NEEDS LEGAL VERIFICATION]` |
| Resolución 1995/1999 | clinical record content, custody, confidentiality, retention, corrections `[NEEDS LEGAL VERIFICATION]` |
| Resolución 839/2017 | record retention periods and disposition `[NEEDS LEGAL VERIFICATION]` |
| Ley 1090/2006 | professional secrecy, who may access psychological records, disclosure to guardians `[NEEDS LEGAL VERIFICATION]` |
| Ley 1098/2006 | minors' rights, adolescent confidentiality, representation `[NEEDS LEGAL VERIFICATION]` |

Also flagged by architect/product: Ley 527/1999 (e-consent evidence) `[NEEDS LEGAL VERIFICATION]`.

---

## 2. Threat model

### 2.1 Assets (by sensitivity)
| Tier | Assets |
|---|---|
| S0 (highest) | Clinical notes + addenda, record sections, assessments, diagnoses, treatment plans, clinical documents, exports/DSR packages, minors' private reflections |
| S1 | Activity responses, consent evidence (incl. IP/UA), guardian relationships + safety caveats, session schedule, patient identifiers (document number, DOB, contact) |
| S2 | Audit logs (contain patient ids + actor behaviour), invitations, staff directory |
| S3 | Branding, activity library content, org settings |
| Secrets | Service-role / secret keys, JWT signing keys, SMTP creds, cron secret, MFA secrets (held by Supabase) |

### 2.2 Actors
| Actor | Capability / motivation |
|---|---|
| External attacker | Credential stuffing, phishing, invitation-link theft, XSS, CSRF, enumeration, dependency compromise |
| Malicious tenant member | Valid aal2 session in org A; tries org B ids, off-care-team patients, direct PostgREST/Storage calls with own JWT, forged audit entries |
| Curious owner | Administrative role; wants colleagues' patients' clinical content (self-assign, export, audit metadata inference) |
| Curious platform admin | SyV operator in the app; wants clinical data without consent; may self-approve grants |
| SyV infra operator | Supabase dashboard / SQL editor / backups access — bypasses all RLS (F-11) |
| Compromised guardian account | Attacker with guardian credentials; harvests minor's data within granted permissions |
| Ex-partner guardian | Legitimate but adversarial; seeks other guardian's contact/location, child's schedule, adolescent's reflections; disputes custody |
| Adolescent patient (privacy subject) | Needs confidentiality from guardians; may share device with guardian |
| Patient (adversarial) | Tampers with responses/submissions via direct API, probes for notes |

### 2.3 STRIDE table
| # | Threat | Example | Primary controls | Residual / finding |
|---|---|---|---|---|
| S1 | Spoofing | Stolen staff password | TOTP aal2 mandatory, rate limits, leaked-password check | MFA recovery path (F-14) |
| S2 | Spoofing | Invitation link forwarded/stolen | 256-bit token, hash at rest, email binding, single-use, expiry | §3.8 |
| S3 | Spoofing | Forged `x-org-hint` / `active_org` | Server re-validates membership; middleware strips inbound header | F-16 |
| T1 | Tampering | Edit finalized note via PostgREST | Immutability triggers, no UPDATE policy on finalized, DELETE revoked | Solid |
| T2 | Tampering | Patient writes invalid response items directly | DB-side invariants, render-time re-validation | F-10 |
| T3 | Tampering | Forged audit row via `app.write_audit` | Actor derived from `auth.uid()`, function not exposed | F-04 |
| R1 | Repudiation | "I never viewed this record" | Read audit in DAL, request id, actor roles | Direct API reads unaudited (F-01) |
| I1 | Info disclosure | Cross-tenant read | RLS + composite FKs + DAL org filter | Solid design; tests mandatory |
| I2 | Info disclosure | Guardian reads all `patients` columns via PostgREST | Vertical split of sensitive columns | F-01 |
| I3 | Info disclosure | Views bypass RLS | `security_invoker = true` | F-05 |
| I4 | Info disclosure | Ex-partner sees other guardian's IP/UA in consent evidence | Evidence columns care-team only | F-09 |
| I5 | Info disclosure | PHI in logs / Sentry / emails | Scrubber, no bodies, discreet emails, CI log scan | AUD-07 gate |
| I6 | Info disclosure | Shared Next.js data cache leaks user data | `no-store` for tenant data, per-request `cache()` only | F-17 |
| I7 | Info disclosure | Platform admin self-grants break-glass | Approval-gated activation in DB | F-02 |
| D1 | DoS | Upload floods, signed URL farming, auth floods | Size caps, rate limits, quotas | F-15 |
| E1 | Elevation | Owner self-grants `psychologist` + self-assigns care team | Approval/notify, audit, access history | F-06 |
| E2 | Elevation | Break-glass grant allows writes (shared helper) | Separate read/write helpers | F-02 |
| E3 | Elevation | aal1 session hits clinical tables directly | `aal2` check inside RLS helpers | F-03 |
| E4 | Elevation | SECURITY DEFINER helper with mutable `search_path` | `set search_path = ''`, schema-qualified names | §4.3 |

---

## 3. Authentication

### 3.1 Supabase Auth configuration (per environment)
| Setting | Value |
|---|---|
| Public sign-ups | **Disabled** in pilot (invite-only). Users created via Auth admin API from the invitation flow. Self-serve staff sign-up later only through a server action with CAPTCHA. |
| Anonymous sign-ins | Disabled |
| Providers | Email+password; magic link (portal only, AUTH-08 Could); no OAuth in MVP |
| Email confirmation | Required; OTP/link expiry ≤ 1 h; single use |
| Secure email change | Enabled (confirm on both addresses); staff email change also audited + notifies owner |
| JWT/access token expiry | 900 s (shortens revocation window; refresh tokens rotate, reuse detection on) |
| Redirect URLs | Exact per-environment allowlist; **no broad wildcards** (preview wildcard scoped to the SyV team domain only, staging project only) — F-19 |
| CAPTCHA | Cloudflare Turnstile or hCaptcha on sign-in, reset, invitation acceptance after N failures |
| SMTP | Custom provider; SPF/DKIM/DMARC on sending domain; templates contain no clinical content |
| Leaked password protection | Enabled (plan-dependent feature; verify availability) |
| Session controls | Time-boxed sessions + inactivity timeout (plan-dependent; verify); otherwise enforced app-side (§3.5) |

### 3.2 MFA
- TOTP **mandatory** for `organization_owner`, `psychologist`, `platform_admin` (AUTH-04).
- Enforcement in **three** places: (1) `getAuthzContext()` returns `MFA_REQUIRED` for any staff/platform route at `aal1`; (2) **RLS helpers** require `auth.jwt()->>'aal' = 'aal2'` for every staff, clinical and platform policy (F-03); (3) AAL re-check for high-risk actions: note finalization, exports, role changes, break-glass approval — require a fresh challenge if last MFA verification is older than 15 min (`amr` timestamp).
- Enrollment gate: a staff user with no verified factor can reach only the enrollment screen.
- Recovery: Supabase Auth does not (to our knowledge — verify at implementation) issue recovery codes. AUTH-04 requires them → options: (a) enroll **two** TOTP factors; (b) app-managed recovery codes (10 × 80-bit, hashed with Argon2id/bcrypt, single-use, audited). **Recommend (b) + (a) optional.** Lost-factor reset by SyV support requires identity verification by the org owner (or two-person SyV check for solo owners), revokes all sessions, audited `auth.mfa_reset`, and notifies the user — this is an account-takeover path and must be in the runbook.
- Portal (Q-07): MFA optional, offered to adult patients and guardians; recommended for guardians with `view_responses`.

### 3.3 Patient / guardian authentication
| Actor | Method | Notes |
|---|---|---|
| Adult patient | Email+password; optional magic link; optional TOTP | Invitation-only binding to one patient record |
| Adolescent (≈12–17) | Own login (email+password or magic link) | Must not share guardian's account; privacy page GRD-07 |
| Child (≈6–11) | **Guardian-started supervised session** (§3.4) | No child credentials in MVP |
| Guardian | Email+password; optional TOTP | Sees "awaiting verification" until relationship `active` (GRD-06) |

### 3.4 Child sign-in (AUTH-07) — evaluation and recommendation
| Option | Pros | Cons |
|---|---|---|
| A. Guardian-started supervised session | Uses existing guardian identity; no new credential type; clear attribution (PRT-10); requires `complete_assignments` | Child cannot use portal alone; anything the child writes is visible to the guardian present |
| B. Child PIN on guardian-trusted device | Child autonomy | Supabase has no PIN auth → custom token minting with the JWT secret (high-risk custom auth); 4–6 digit PINs are brute-forceable; device-binding and lockout must be built; shared devices |

**Recommendation: Option A for MVP; Option B deferred** (would need its own ADR + security review).
Design: guardian (authenticated) selects the child and "Start session" → server inserts
`portal_supervised_sessions(guardian_profile_id, patient_id, patient_guardian_id, started_at, expires_at, ended_at)`
after `app.guardian_can(..., 'complete_assignments')`; an httpOnly cookie references the row; idle
timeout 20 min, absolute 60 min (configurable). Each response records `submitted_by_profile_id =
guardian`, `submitted_by_actor ∈ {patient, guardian}` chosen per submission (PRT-10). Child-mode UI
states plainly that the adult present can see what is entered. Revocation of the permission ends
supervised sessions immediately (checked per request).

### 3.5 Passwords, recovery, sessions
- Password: min 12 characters, max ≥ 72 (bcrypt limit; reject longer rather than truncate silently), no composition rules beyond Supabase minimum, leaked-password check, no hints.
- Reset (AUTH-03): identical response for known/unknown email; single-use link ≤ 1 h; on success revoke all other sessions (`signOut({ scope: 'others' })` / admin) and audit `auth.password_reset`.
- Session lifetime: staff idle 15 min (PRD hypothesis), absolute 12 h; portal idle 30 min / absolute 7 days `[NEEDS PSYCHOLOGIST INPUT]` (configurable, not legal). Idle enforced server-side via `last_activity_at` on a server session record; drafts preserved (autosave).
- Cookies: Supabase SSR cookies `Secure`, `SameSite=Lax`, `HttpOnly` where the flow allows. **Recommend no browser-side Supabase client for domain data at all** and performing MFA challenge/verify through server actions so cookies can be `HttpOnly` (reduces XSS token theft) → architect.
- Member deactivation (ORG-05) and guardian revocation: effective on next request through DB checks; additionally revoke refresh tokens via admin API.

### 3.6 Rate limiting (SEC-05)
- Supabase Auth built-in limits configured (sign-in, OTP, verify, token refresh, email sends).
- App-level limiter required for: invitation acceptance, signed-URL issuance, uploads, export requests, consent signing, DSR creation, server actions generally (per profile + per IP). Mechanism not specified in architecture (F-15) → architect to choose (Postgres-backed counter table or managed KV) via ADR.
- Thresholds trigger `auth.rate_limited` / `access.rate_limited` audit events and AUD-06 alerts.

### 3.7 Account enumeration
Generic errors on sign-in, reset, invitation acceptance (AUTH-01/03). Invitation-acceptance
errors must not reveal whether the email has an existing account.

### 3.8 Invitation token security
1. 32 random bytes (CSPRNG), base64url; only `sha256(token)` stored (`invitations.token_hash`).
2. Expiry: staff 72 h, patient/guardian 7 days (product constants, configurable); re-sending revokes the previous token.
3. Single use: acceptance is one atomic `update … set status='accepted' where token_hash=$1 and status='pending' and expires_at>now() returning …` in the service-role function.
4. **Email binding:** the accepting auth user's verified email must equal `invitations.email` (case-insensitive). No "accept as different user".
5. Accept page: `Referrer-Policy: no-referrer`, no third-party scripts, token moved from URL to a POST body immediately; token never logged (logger deny-list).
6. Guardian invitation acceptance never activates a relationship; it stays `pending_verification` until a psychologist verifies (GRD-06).
7. Staff invitations: roles fixed at creation; acceptance cannot escalate; audit `invitation.accepted`.

---

## 4. Authorization

### 4.1 Permission matrix
Legend: **F** full · **R** read · **W** create/update · **D** directory/limited fields · **S** status only ·
**P:x** only with guardian permission `x` (+ resource flag) · **BG** read-only with approved break-glass grant · **—** none.
"Owner" = `organization_owner` without care-team membership for that patient (an owner who is also
on the care team gets the psychologist column). "Psy CT" = psychologist on active care team; "Psy ¬CT" = not on it.

| Resource | platform_admin | Owner | Psy CT | Psy ¬CT | Adult patient | Minor patient | Guardian |
|---|---|---|---|---|---|---|---|
| Org settings | R (metadata) | F | R | R | — | — | — |
| Branding | R | F | R | R | R (rendered) | R (rendered) | R (rendered) |
| Domains | R | F | — | — | — | — | — |
| Members / invitations (staff) | R metadata (T2 with ticket) | F | R directory | R directory | — | — | — |
| Patient directory (name, status) | — | D | F | D `[NEEDS PSYCHOLOGIST INPUT]` | Own | Own | Name only (any active perm) |
| Patient identifiers / contact | — | — (Q-03) | F | — | Own (R) | Own (R, limited) | — |
| Care team | — | F (assign/end, audited) | R; primary assigns | — | — | — | — |
| Guardians, relationships, permissions | — | — | F | — | — | Privacy view (GRD-07) | Own grants (R) |
| Clinical record / sections | — | — | F | — | — | — | — |
| Clinical notes (draft) | — | — | Author W; others R `[NEEDS PSYCHOLOGIST INPUT]` | — | — | — | — |
| Clinical notes (finalized) | BG | — | R | — | **Never** | **Never** | **Never** |
| Addenda | BG | — | R/W (create) | — | **Never** | **Never** | **Never** |
| Assessments, diagnoses | BG | — | F | — | — | — | — |
| Treatment plans (clinical) | BG | — | F | — | — | — | — |
| Patient-facing goals (TPL-03) | — | — | F | — | R | R | P:view_patient_facing_goals (F-08b) |
| Therapy sessions (detail) | — | — | F | — | — | — | — |
| Session schedule (date/time/status) | — | — | F | — | R | R | P:view_session_schedule |
| Clinical documents (private) | BG | — | F | — | — | — | — |
| Documents shared with patient | — | — | F | — | R (shared) | R (shared) | P:view_shared_documents + flag |
| Consent templates/versions | — | F | R (W `[NEEDS PSYCHOLOGIST INPUT]`) | R | R (to sign) | R (assent) | R (to sign) |
| Consent records | — | S | F | — | Own | Own assent | Own-signed, without others' evidence (F-09) |
| Sign consent | — | — | Record paper/verbal | — | Self | Assent | P:sign_consents ∧ legal rep (F-12) |
| Activities / versions (builder) | — | R | F | F (org library) | Pinned, via assignment | Pinned, via assignment | P:view_assignments |
| Assignments | — | — | F | — | Own | Own | P:view_assignments ∧ visibility ≠ none |
| Responses | — | — | R + review | — | Own R/W until submit | Own R/W until submit | P:view_responses ∧ visibility = responses; W: P:complete_assignments |
| Private reflections (PRT-05) | — | — | Only entries explicitly shared | — | Own | Own | **Never in MVP** `[NEEDS PSYCHOLOGIST INPUT]` |
| Resource library | — | R | F | F | Shared only | Shared only | P:view_shared_resources ∧ flag |
| Audit logs | Platform + break-glass events | Org-wide metadata | Own patients | — | On request (DSR) | On request | — |
| Exports (full record) | — | — (F-06) | W (aal2, re-auth) | — | — | — | — |
| DSRs | — | F (workflow) | F (own patients) | — | Create/read own | Create/read own `[NEEDS LEGAL VERIFICATION]` | Create/read own scope |
| Retention policies | R | F (draft→active needs legal ref) | — | — | — | — | — |
| Break-glass grants | Request | Approve/revoke/read | Approve if treating (SAAS §8.2) | — | — | — | — |

### 4.2 Defense in depth
1. **First line — server:** `withAction()`/DAL `requirePermission()` on every action, page and route handler. Authorization in a layout is **not** sufficient (layouts are not re-evaluated on every navigation and do not wrap server actions); middleware is never an auth boundary.
2. **Second line — Postgres:** RLS forced on every table, default deny; `anon` has no grants on domain tables; DELETE revoked on clinical/consent/audit/published tables.
3. **Integrity — Postgres:** composite tenant FKs, immutability triggers, state-transition checks in DB functions.
4. **Permission registry ↔ RLS parity** is tested (matrix tests run both the TS policy and real JWT queries).
5. Because of A4/F-01, **RLS + grants must be sufficient on their own** for confidentiality; app checks add audit, UX and least-data DTOs.

### 4.3 Helper SQL function guidelines
- Live in schema `app`, **not exposed** through the Data API; `revoke all on schema app from public`; `revoke execute … from public, anon`; grant execute to `authenticated` only where used by policies.
- `SECURITY DEFINER` only when a helper must read tables the caller cannot (membership, care team, grants) — and then: `set search_path = ''`, all names schema-qualified (`public.memberships`, `auth.uid()`), owner is the dedicated `app_definer` role (NOLOGIN, NOBYPASSRLS; implemented in Phase 1, §14.2) with explicit grants and `to app_definer` policies, no dynamic SQL.
- `STABLE`, `LANGUAGE sql` preferred (inlinable); wrap `auth.uid()`/`auth.jwt()` as `(select auth.uid())` for per-statement caching.
- Identity is **always** derived inside the helper (`auth.uid()`, `auth.jwt()`); helpers never accept a profile id parameter.
- Return `boolean` only; never return rows, names or reasons (no oracle beyond yes/no for ids the caller already supplied). Raise no errors that include data.
- Every helper checks `organizations.status = 'active'` and `memberships.status = 'active'` where relevant.
- Index paths: `care_team_members(organization_id, patient_id, membership_id) where ends_at is null`, `patient_guardians(guardian_id, patient_id) where status='active'`, permission rows partial on `revoked_at is null`.

### 4.4 RLS policy patterns (DRAFT SKETCHES — NOT MIGRATIONS)

**(a) Base helpers and tenant isolation**
```sql
-- DRAFT — NOT A MIGRATION
create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated;

create or replace function app.is_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
$$;

create or replace function app.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_aal2() and exists (
    select 1 from public.memberships m
    join public.organizations o on o.id = m.organization_id and o.status = 'active'
    where m.organization_id = p_org and m.status = 'active'
      and m.profile_id = (select auth.uid()))
$$;
revoke execute on function app.is_org_member(uuid) from public, anon;
grant  execute on function app.is_org_member(uuid) to authenticated;

alter table public.resources enable row level security;
alter table public.resources force row level security;
create policy resources_staff_select on public.resources
  for select to authenticated using (app.is_org_member(organization_id));
```

**(b) Care-team clinical access — read and write split (F-02)**
```sql
-- DRAFT — NOT A MIGRATION
create or replace function app.can_write_clinical(p_org uuid, p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_aal2() and exists (
    select 1 from public.care_team_members c
    join public.memberships m on m.id = c.membership_id and m.status = 'active'
    join public.organizations o on o.id = m.organization_id and o.status = 'active'
    join public.membership_roles r on r.membership_id = m.id and r.role = 'psychologist'
    where c.organization_id = p_org and c.patient_id = p_patient
      and m.profile_id = (select auth.uid())
      and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now()))
$$;

create or replace function app.can_read_clinical(p_org uuid, p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.can_write_clinical(p_org, p_patient) or (app.is_aal2() and exists (
    select 1 from public.platform_access_grants g
    join public.platform_admins pa on pa.profile_id = g.platform_admin_profile_id
                                   and pa.revoked_at is null
    where g.organization_id = p_org and g.patient_id = p_patient
      and g.scope = 'clinical_read_break_glass'
      and g.platform_admin_profile_id = (select auth.uid())
      and g.owner_approved_at is not null              -- tenant consent
      and g.second_approver_profile_id is not null     -- SyV four-eyes
      and g.second_approver_profile_id <> g.platform_admin_profile_id
      and g.revoked_at is null and now() >= g.starts_at and now() < g.expires_at))
$$;

create policy notes_select on public.clinical_notes for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id));
create policy notes_insert on public.clinical_notes for insert to authenticated
  with check (status = 'draft'
    and app.can_write_clinical(organization_id, patient_id)
    and author_membership_id = app.my_membership_id(organization_id));
create policy notes_update_own_draft on public.clinical_notes for update to authenticated
  using  (status = 'draft' and author_membership_id = app.my_membership_id(organization_id)
          and app.can_write_clinical(organization_id, patient_id))
  with check (author_membership_id = app.my_membership_id(organization_id)
          and app.can_write_clinical(organization_id, patient_id));
-- no DELETE policy; and: revoke delete on public.clinical_notes from authenticated;
```

**(c) Patient self-access**
```sql
-- DRAFT — NOT A MIGRATION
create or replace function app.is_patient_self(p_org uuid, p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.patients p
    join public.organizations o on o.id = p.organization_id and o.status = 'active'
    where p.organization_id = p_org and p.id = p_patient
      and p.profile_id = (select auth.uid()) and p.status in ('active'))  -- statuses: F-20
$$;
create policy assignments_patient_select on public.activity_assignments for select to authenticated
  using (status <> 'cancelled' and app.is_patient_self(organization_id, patient_id));
```

**(d) Guardian permission access**
```sql
-- DRAFT — NOT A MIGRATION
create or replace function app.guardian_can(p_org uuid, p_patient uuid, p_perm public.guardian_permission)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1
    from public.guardians g
    join public.patient_guardians pg on pg.guardian_id = g.id and pg.organization_id = g.organization_id
    join public.patient_guardian_permissions pp on pp.patient_guardian_id = pg.id and pp.revoked_at is null
    join public.organizations o on o.id = g.organization_id and o.status = 'active'
    where g.organization_id = p_org and pg.patient_id = p_patient
      and g.profile_id = (select auth.uid()) and g.status = 'active'
      and pg.status = 'active' and pg.verified_at is not null
      and current_date >= pg.valid_from and (pg.valid_until is null or current_date <= pg.valid_until)
      and pp.permission = p_perm)
$$;
create policy assignments_guardian_select on public.activity_assignments for select to authenticated
  using (guardian_visibility <> 'none'
         and app.guardian_can(organization_id, patient_id, 'view_assignments'));
```

**(e) Response visibility and private reflections**
```sql
-- DRAFT — NOT A MIGRATION
create policy responses_guardian_select on public.activity_responses for select to authenticated
  using (app.guardian_can(organization_id, patient_id, 'view_responses')
    and exists (select 1 from public.activity_assignments a
                where a.organization_id = activity_responses.organization_id
                  and a.id = activity_responses.activity_assignment_id
                  and a.guardian_visibility = 'assignment_and_responses'));

-- Proposed table for PRT-05 (F-07): patient_reflections(id, organization_id, patient_id,
--   body jsonb, shared_with_care_team_at timestamptz null, created_by_profile_id, ...)
create policy reflections_self on public.patient_reflections for all to authenticated
  using (app.is_patient_self(organization_id, patient_id))
  with check (app.is_patient_self(organization_id, patient_id));
create policy reflections_care_team_shared on public.patient_reflections for select to authenticated
  using (shared_with_care_team_at is not null and app.can_write_clinical(organization_id, patient_id));
-- Deliberately NO guardian policy in MVP. Un-sharing after share: [NEEDS PSYCHOLOGIST INPUT].
```

**(f) Immutability trigger (self-validating finalization)**
```sql
-- DRAFT — NOT A MIGRATION
create or replace function app.guard_clinical_note() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' or old.status = 'finalized' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_notes';
  end if;
  if new.status = 'finalized' then
    if new.finalized_by_membership_id is distinct from old.author_membership_id
       or new.finalized_by_membership_id is distinct from app.my_membership_id(old.organization_id)
       or new.content_hash is distinct from app.canonical_hash(new.body)
       or new.body is distinct from old.body then       -- finalize must not change content
      raise exception using errcode = 'P0001', message = 'PRECONDITION:finalize';
    end if;
    new.finalized_at := now();                          -- server time, never client
  end if;
  new.organization_id := old.organization_id;           -- tenant and subject never move
  new.patient_id := old.patient_id;
  new.author_membership_id := old.author_membership_id;
  return new;
end $$;
create trigger clinical_notes_guard before update or delete on public.clinical_notes
  for each row execute function app.guard_clinical_note();
```
The same pattern applies to addenda (insert-only), assessments, consent records (only one-time
`revoked_*`), published activity/consent versions, submitted responses, and `audit_logs`.

### 4.5 Response codes
Confirm API_CONTRACTS §3: cross-tenant, patient/guardian probing, and off-care-team clinical
ids → `NOT_FOUND`; `FORBIDDEN` only for same-org staff on resources visible in their directory.
Both are audited as `access.denied` for clinical scopes (RBAC-02).

---

## 5. Minors and guardians

### 5.1 Permission model
Access = relationship (`active`, verified, within validity) ∧ guardian record `active` ∧ unrevoked
permission ∧ resource flag (assignment `guardian_visibility`, share `guardian_visible`) ∧ org active.
All permissions default **off** (GRD-04). No permission can ever expose notes, record sections,
diagnoses, assessments, internal treatment plans, private documents, or private reflections.
Missing enum values vs PRD GRD-04: `view_shared_documents`, `view_patient_facing_goals` (F-08b).

### 5.2 Minor assent
Assent (`minor_assent`) is a distinct consent record signed by the patient (`signer_type = patient`),
adapted to portal mode; refusal is recorded (`decision = declined`) and surfaced to the psychologist,
who decides `[NEEDS PSYCHOLOGIST INPUT]`. Assent cannot be recorded by a guardian account.
Supervised sessions (§3.4) may display assent but must record who was present `[NEEDS PSYCHOLOGIST INPUT]`.

### 5.3 Adolescent confidentiality defaults (proposed)
`[NEEDS PSYCHOLOGIST INPUT]` `[NEEDS LEGAL VERIFICATION]` (Ley 1098/2006, Ley 1090/2006)
| Item | Proposed default for adolescents |
|---|---|
| `guardian_visibility` on new assignments | `none` (DB default; UI requires explicit choice) |
| `view_responses` | Off; enabling shows a warning and is audited |
| Private reflections | Never visible to guardians |
| Session schedule | Off |
| Notifications to guardians | Generic ("there is a new task"), never content |
| Privacy page (GRD-07) | Generated from live permissions; changes in permissions are shown to the adolescent |
| Change of a guardian permission | Optional notice to adolescent `[NEEDS PSYCHOLOGIST INPUT]` |

### 5.4 Guardian revocation
Revoking a relationship or permission takes effect on the next request (DB-checked). Additionally:
end supervised sessions, revoke pending guardian invitations, and accept that already-issued
signed URLs remain valid up to their TTL (≤ 10 min) — documented residual risk. Audit
before/after permission sets.

### 5.5 Custody disputes / ex-partner guardian
- Relationship statuses support `suspended` immediately (psychologist action) pending documentation; supporting document upload to `clinical-documents` (care-team only).
- GRD-08 safety caveat stored on `patient_guardians` in a **care-team-only** column/table; when set, UI blocks enabling `view_session_schedule` and warns before any share.
- Guardians never see other guardians, their contact data, or consent evidence (IP/UA/typed name) of other signers (F-09).
- Emails/notifications never reveal another guardian's actions.
- Whether one or both legal representatives must consent: `[NEEDS LEGAL VERIFICATION]`; data model already allows multiple guardian consent records.

### 5.6 Age-of-majority transition
Security recommends PRD PAT-06 behaviour (**fail-closed**): on the derived 18th birthday a job sets
all that patient's guardian relationships to `suspended` (reason `age_of_majority`) and notifies the
care team; reactivation requires the (now adult) patient's own consent and psychologist action.
DATABASE.md §8.6 / Q-04 "no automatic revocation" conflicts with this (F-08). Age threshold is
configuration `[NEEDS LEGAL VERIFICATION]`. `app.guardian_can` should additionally return false
when `app.is_minor(dob)` is false, so the job is not the only control.

---

## 6. Break-glass / support access design

Aligned with SAAS_STRATEGY §8 and PRD SEC-14; replaces the weaker DB/ADR-014 draft (F-02).

| Tier | Scope | Control |
|---|---|---|
| T1 | Operational metadata (counts, status, error ids) | platform_admin, aal2; views logged |
| T2 `org_support_non_clinical` | Settings, branding, staff directory | Ticket ref; owner notified; time-boxed |
| T3 `clinical_read_break_glass` | Specific patient (or object ids), read-only | Full flow below |

**T3 flow**
1. Request: platform_admin (aal2) submits org, patient, object scope, reason (≥ 20 chars), ticket ref, duration (default 4 h, hard max configurable, proposed ≤ 4 h per PRD) → `status = pending`.
2. Tenant consent: org owner approves in-app (aal2); if the patient has a treating psychologist other than the owner, that psychologist also approves `[NEEDS PSYCHOLOGIST INPUT]`. Patient notice `[NEEDS LEGAL VERIFICATION]`.
3. Four-eyes: a second, different platform_admin approves.
4. Activation: DB `check` / trigger — grant is usable only when owner approval, (treating psychologist approval if required), and second approver are present and distinct from the requester. `app.can_read_clinical` re-checks this at every query.
5. Access: read-only (only `can_read_clinical`, never `can_write_clinical`); no exports, no signed URLs for `exports`; clinical-document URLs allowed only if in scope; banner in UI.
6. Audit: every read audited with `break_glass_grant_id`, `actor_type = break_glass`; owner notified on approval, first use and closure; access report sent after expiry (SEC-14 AC).
7. Revocation: owner, treating psychologist or either SyV approver can revoke immediately.
8. Emergency exception (platform-wide incident, no owner reachable): executive approval + four-eyes, max 1 h, retroactive notification; documented in runbook `[NEEDS LEGAL VERIFICATION]`.
9. No impersonation ("log in as") in MVP (SAAS §8.3).

Schema changes requested (→ architect, DATABASE §5.1): add `status`, `owner_approved_by/at`,
`psychologist_approved_by/at`, `second_approver_profile_id/at`, `object_scope jsonb` (ids only);
make approval non-optional; default max 4 h.

**Infrastructure access (F-11).** Supabase dashboard/SQL editor, DB connection strings and
backups bypass RLS. Production console access: named SyV individuals only, MFA (hardware keys
preferred), least-privileged org roles, no routine SQL on production, any production data access
follows the T3 approval flow with a ticket, quarterly access review. Enable Postgres statement
logging/`pgaudit` for privileged roles where available.

---

## 7. Audit logging

### 7.1 Event catalog (minimum; names per API_CONTRACTS §9)
| Category | Events |
|---|---|
| Auth | `auth.signed_in`, `auth.sign_in_failed`, `auth.signed_out`, `auth.mfa_enrolled`, `auth.mfa_verified`, `auth.mfa_failed`, `auth.mfa_reset`, `auth.password_reset`, `auth.rate_limited`, `auth.org_switched`, `auth.session_revoked` |
| Membership/roles | `invitation.created/accepted/revoked/expired`, `membership.roles_changed/suspended/removed`, `care_team.assigned/ended`, `professional_profile.updated` |
| Guardians | `guardian.created`, `patient_guardian.created/verified/suspended/revoked`, `guardian_permission.granted/revoked`, `supervised_session.started/ended` |
| Clinical reads | `clinical_record.viewed`, `clinical_note.viewed`, `clinical_record_section.history_viewed`, `clinical_document.list_viewed`, `file.download_url_issued`, `activity_response.viewed` |
| Clinical writes | `clinical_note.created/finalized/addendum_created/draft_discarded`, `clinical_record_section.updated`, `clinical_assessment.*`, `clinical_diagnosis.*`, `treatment_plan.*` |
| Consents | `consent.requested/signed/declined/recorded/revoked`, `consent_template_version.published` |
| Sharing | `resource.shared/share_revoked`, `document.shared/unshared`, `activity_assignment.created/cancelled` |
| Privacy | `export.requested/generated/downloaded/expired`, `dsr.created/status_changed` |
| Platform | `organization.provisioned/suspended`, `platform_grant.requested/approved/activated/revoked/expired`, `break_glass.access` |
| Security | `access.denied`, `access.rate_limited`, `audit_log.viewed`, `retention_policy.*` |

### 7.2 Append-only enforcement
- `INSERT/UPDATE/DELETE/TRUNCATE` revoked from `anon`, `authenticated`; trigger rejects UPDATE/DELETE for all roles except a dedicated retention role whose use is itself logged.
- `app.write_audit()` (F-04): **not** exposed via the Data API; derives `actor_profile_id` from `auth.uid()` and `actor_roles` from DB, never from parameters; `organization_id` must be an org the caller belongs to (or system); event type must be in an allowlisted enum/table. Service-role writes (system, denied attempts) set `actor_type = system` and the initiating profile explicitly.
- Prefer a single source per event (function **or** trigger) to satisfy AUD-02 "exactly one event"; triggers act as safety net emitting a distinct `*.changed_untracked` event only when the function path was not used (F-21).

### 7.3 No PHI in payloads
Metadata: ids, enum values, changed column **names**, state transitions, grant id. Never: free
text, names, emails, document numbers, diagnosis codes/labels, response values, file names.
Zod schema for metadata per event type; CI test scans audit fixtures. Note that patient ids +
event types can still be sensitive (owner sees "diagnosis added for patient X") — accepted per
PRD §4 "org-wide metadata", `[NEEDS PSYCHOLOGIST INPUT]` whether owners see clinical event types.

### 7.4 Read-access logging
DAL logs every clinical read and signed-URL issuance (AUD-01). Residual: reads issued directly
against the Data API with a user's JWT are not DAL-audited (F-01) — closed by disabling Data API
(Option A) or mitigated by Postgres-side logging.

### 7.5 Integrity
Recommend for MVP a **daily signed digest** (sha256 Merkle/sequential hash over `seq` range,
stored in a separate bucket/account under SyV control) instead of a per-row hash chain (which
serializes inserts). Optional per-row `prev_hash` later (Q-15).

### 7.6 Retention
Audit retention period `[NEEDS LEGAL VERIFICATION]` via `retention_policies`; no purge until an
active policy exists. IP/UA in audit and consent evidence are personal data — disclosed in privacy notice.

---

## 8. Storage

| Bucket | Visibility | Signed URL TTL | Max size (proposal) | MIME allowlist |
|---|---|---|---|---|
| `clinical-documents` | Private, care team | 60 s | 25 MB | PDF, JPEG, PNG, WebP, M4A/MP3 |
| `exports` | Private, requester only, single-use | 60 s | n/a (generated) | ZIP/PDF/JSON |
| `activity-media` | Private | 10 min | 50 MB (video 200 MB) | JPEG, PNG, WebP, MP3, M4A, MP4 |
| `resources` | Private | 10 min | 50 MB | PDF, images, audio, MP4 |
| `branding` | Public-read (Q-09, approved with conditions) | n/a | 1 MB | PNG, WebP, ICO (**no SVG**) |
| `patient-uploads` (DOC-04, if adopted) | Private, quarantine until reviewed | 60 s | 25 MB | PDF, images |

- Paths: `org/<organization_id>/<domain>/<entity_id>/<file_object_id>.<ext>`; extension derived from validated MIME, never from user filename. Storage RLS checks `(storage.foldername(name))[2]::uuid` = org and delegates to `app.can_read_file()`; INSERT allowed only for a path with a matching `file_objects` row in `pending_upload` created by the same profile.
- Upload validation in `confirmUploadAction`: size from storage metadata, **magic-byte sniffing** server-side (do not trust client MIME), sha256 recomputed, image re-encoding to strip EXIF/GPS (recommended for patient-facing images), PDF: reject encrypted/JS-bearing PDFs if feasible.
- Files remain `pending_upload`/`quarantined` and **unreadable** until validation (and AV scan if enabled) passes → `ready`.
- AV (Q-10, SEC-04 is **Must**): required before production — e.g. ClamAV worker or vendor scan API; until available, clinical uploads limited to PDF/images and patient uploads disabled.
- Signed URL issuance rate-limited and audited; `Cache-Control: no-store`; download with `Content-Disposition: attachment` for documents, `X-Content-Type-Options: nosniff`.
- Branding bucket conditions: logos/favicons only, no staff or patient photos, no SVG, random object names, write only via server action for owners, object listing disabled.
- Export packages: generated asynchronously, single download, auto-deleted after TTL by job; optionally password-protected archive with password delivered out of band `[NEEDS PSYCHOLOGIST INPUT]`.

---

## 9. Application security

| Area | Requirement |
|---|---|
| Validation | Zod `strict()` on every action/route input; size limits on strings/arrays/AST depth & node count; organizationId never from input. Re-validate stored ASTs/blocks **at render time** (F-10). |
| CSP | Nonce-based: `default-src 'self'; script-src 'nonce-…' 'strict-dynamic'; style-src 'self' 'nonce-…'; img-src 'self' data: blob: <supabase-host>; media-src <supabase-host>; connect-src 'self' <supabase-host>; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`. Branding `<style>` emitted with nonce and only validated token values. |
| Headers | HSTS (2 y, includeSubDomains, preload after domain decision), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (no-referrer on invitation/reset pages), `Permissions-Policy` (camera/mic/geolocation off; mic on only if `allowAudio` responses ship), `Cross-Origin-Opener-Policy: same-origin`. |
| XSS | No `dangerouslySetInnerHTML` (lint error); restricted AST renderer; link `href` re-checked at render (`https:`/`mailto:` only), `rel="noopener noreferrer"`, external-link notice; no markdown/HTML renderers; user strings never into `style`/`href`/`src` unchecked. |
| CSRF | Server actions rely on Next.js Origin/Host check → configure `serverActions.allowedOrigins` explicitly for subdomains/custom domains (no wildcards beyond tenant subdomain pattern); route handlers with side effects verify `Origin` and use POST; cookies `SameSite=Lax`. |
| SSRF | Server never fetches user-supplied URLs (no link unfurling, no remote image import). Video embeds: provider enum + id regex (`youtube: ^[A-Za-z0-9_-]{11}$`, `vimeo: ^\d{6,12}$`); iframe URL built server-side from templates (youtube-nocookie). Allowlist: YouTube (nocookie), Vimeo — client to confirm. |
| Secrets | Vercel env per environment; service-role/secret key only in server env, never `NEXT_PUBLIC_*`; env schema in `src/server/env.ts`; preview deployments get staging keys only; rotation runbook; secret scanning in CI + push protection. |
| Service role | `src/server/db/service-role.ts` (Auth admin API, service-role key) exports narrow functions only; low-privilege `app_server` system functions live separately in `src/server/db/system.ts`; per-file lint allowlists for each (`eslint.config.mjs`); each call audited; scheduled jobs authenticate with `CRON_SECRET` (constant-time compare) or run as `pg_cron` functions without exposing the key. |
| Next.js specifics | Keep Next.js patched (middleware-bypass class of CVEs); never auth in middleware alone; tenant/clinical data rendered dynamically with no shared cache (`unstable_cache`/fetch cache forbidden for PHI; `cache()` per request only) (F-17); `server-only` imports enforced. |
| Dependencies | Lockfile, `npm audit --audit-level=high`, Dependabot/Renovate, review of new deps (ADR rule), SBOM at release; no third-party scripts/analytics in authenticated areas (SEC-06). |
| Logging | Structured logger with key deny-list + value redaction; no request bodies; Sentry `sendDefaultPii:false`, no replay, `beforeSend` scrubber; CI/staging log scan for synthetic PHI canaries (AUD-07). |
| Errors | `Result<T>` with i18n keys + requestId; never DB messages, stack traces, or existence hints; `NOT_FOUND` for cross-tenant. |
| Emails | No clinical words in subject/body; links only; tenant display name; no patient names in guardian emails beyond first name `[NEEDS PSYCHOLOGIST INPUT]`. |

---

## 10. Data protection

- **In transit:** TLS 1.2+ everywhere, HSTS; DB connections over TLS (`sslmode=verify-full` for any direct connection).
- **At rest:** provider-level disk encryption (Supabase/AWS) for DB, backups and storage — verify in deployment checks (SEC-01); this does not protect against console users or app compromise.
- **Field-level encryption (SEC-10) — recommendation: not in Phase 1; decide in a pre-GA ADR.** Rationale: app-level envelope encryption (KMS-held key outside Supabase) of `clinical_notes.body`, addenda, record sections and reflections would protect against DB-only exposure (SQL console, leaked backups, F-11) but not against application compromise; it costs key management, rotation, loss-of-key risk, no DB-side search/hash validation (hash computed app-side), and complicates DSR export and restore. Do now: keep clinical bodies opaque to DB logic (no SQL search on bodies), keep `canonical_hash` computable in app, so encryption can be added without schema redesign. Do **not** rely on deprecated pgsodium TCE. If F-11 controls cannot be met for the pilot, revisit and implement FLE for notes before real data.
- **Backups:** PITR + daily backups on production; storage objects are **not** in DB backups → scheduled encrypted replication to a separate account (Q-11); backup access restricted like production.
- **Restore testing:** quarterly drill into an isolated project with production-equivalent access controls, auth disabled for end users, destroyed after drill; audited; re-apply DSR suppression log; record duration vs RPO/RTO (PRD SEC-07 hypothesis RPO ≤ 24 h/RTO ≤ 8 h vs architecture RPO ≤ 5 min/RTO ≤ 4 h — reconcile, F-22).
- **Export / DSR:** exports generated by care-team psychologists only (aal2 + recent MFA), audited, single-use, auto-expiring; DSR access requests are fulfilled by the psychologist deciding what to disclose (PAT-09); owners manage DSR workflow but cannot themselves generate full-record exports (F-06).
- **Deletion vs retention conflict:** clinical records not deletable by tenants; suppression requests evaluated against retention duties `[NEEDS LEGAL VERIFICATION]` (Res. 1995/1999, Res. 839/2017, Ley 1581/2012); destruction only via privileged, audited job with an active policy; backups age out per backup retention; tenant offboarding needs a documented custody/handover procedure `[NEEDS LEGAL VERIFICATION]`.
- **Minimization:** document number, sex, gender identity optional; consent IP/UA retention per policy.

---

## 11. Review findings

| ID | Sev | Affected | Issue | Remediation |
|---|---|---|---|---|
| F-01 | **Critical** | ARCH §1/§6, ADR-004, DB §5.3/§5.5/§5.6 | "Browser never talks to Postgres" is not enforced: any user's JWT + public key can call the Data API (PostgREST) and Storage API directly. RLS is row-level, so designs relying on DTO column filtering leak: guardians "name only" on `patients` get document number/contact; owners "directory via view"; portal `activity_versions` "without therapeutic_objective"; consent evidence. Direct reads also skip DAL read-auditing and Zod. | Choose in a new ADR: **Option A (preferred)** — disable the Data API for domain schemas; server DAL connects via Postgres (pooler) and per transaction `set local role authenticated` + `set local request.jwt.claims` from the verified JWT, so RLS still applies and browsers have no query surface. **Option B** — keep PostgREST but vertically split sensitive columns into care-team-only tables (`patient_identifiers`, `consent_record_evidence`, `activity_version_professional_fields`), deny portal SELECT on base tables needing column filtering, and serve portal DTOs via audited functions. In both: storage RLS complete on its own. |
| F-02 | **Critical** | DB §5.1 `platform_access_grants`, DB §1 `has_clinical_access`, ADR-014, Q-06 | Break-glass grant is active once inserted by the platform admin; owner approval optional ("when reachable"); no four-eyes; 24 h max; one helper used for all clinical policies → grant also enables **writes**. Contradicts PRD SEC-14 and SAAS §8.2. | §6 design: approval-gated activation enforced in DB, owner (+ treating psychologist) consent, second SyV approver ≠ requester, default/max 4 h, split `can_read_clinical` / `can_write_clinical`, owner revocation, report on closure. Update ADR-014, DB §5.1, API §8.17, Q-06. |
| F-03 | High | ARCH §7 rule 2, DB §1 helpers | AAL2 enforced only at app routes; an aal1 session (password only) can hit clinical tables directly via F-01 surface. | `app.is_aal2()` inside every staff/clinical/platform helper; pgTAP test with aal1 JWT. |
| F-04 | High | DB §9, ADR-012 | `app.write_audit()` is SECURITY DEFINER; if exposed or parameterized by actor, any user can forge/flood audit events, defeating repudiation controls. | Not in exposed schema; actor/roles derived inside; org membership check; event allowlist; rate limit; service-role path for system events only. |
| F-05 | High | DB §5.2 `org_member_directory`, §5.3 owner directory view, §5.6 portal version view, §5.4 sessions restricted view | Postgres views run with owner rights by default and bypass RLS of underlying tables. | All views `with (security_invoker = true, security_barrier = true)`, or replace with SECURITY DEFINER functions doing explicit checks; lint/migration check rejects views without `security_invoker`. |
| F-06 | High | API §4 (`privacy.export.create` owner for DSR; `patient.care_team.manage` owner), DB §5.2 membership_roles app-only rule, ADR-016 | Owner paths to clinical content without treating role: (a) full-record export for DSR; (b) owner self-grants `psychologist` (rule is app-only; licence data self-entered) and self-assigns to care team. Undermines RBAC-06/Q-03. | (a) Only care team generates exports; owner tracks DSR. (b) Self-assignment to a patient with another primary requires that psychologist's acknowledgement or at minimum reason + notification + highlighted access-history entry; role self-grant enforced in DB, audited, notifies other owners/psychologists. Solo practice unaffected. `[NEEDS PSYCHOLOGIST INPUT]` |
| F-07 | High | DB (missing), PRD PRT-05 | Private reflections/journal (PRT-05 Must) have no entity; risk of implementing them as `activity_responses` where guardian `view_responses` could expose them. | Add `patient_reflections` (§4.4e) with per-entry share to care team, no guardian path; storage/retention `[NEEDS PSYCHOLOGIST INPUT]` `[NEEDS LEGAL VERIFICATION]`. |
| F-08 | High | DB §8.6, Q-04 vs PRD PAT-06 | Majority transition is fail-open in DB doc (no automatic revocation) but PRD requires suspension pending review. | Adopt PRD behaviour (§5.6); also check minority inside `guardian_can`. |
| F-09 | High | DB §5.5 consent_records RLS | Guardian with `sign_consents` reads consent records including other guardian's `ip_address`, `user_agent`, `typed_name` → location/identity leak in custody conflicts. | Guardians read only records they signed, via DTO without evidence columns; evidence columns care-team only (F-01 split). |
| F-10 | High | ARCH §11, API §8.14, DB §5.6 | Integrity rules (items validate against block, required blocks answered, submission only by allowed actor) live in app; direct writes bypass Zod; stored ASTs could contain `javascript:` hrefs rendered later in review renderers. | Revoke direct INSERT/UPDATE for portal actors on responses/items; submission via DB function enforcing invariants; jsonb size/depth checks; renderers re-parse with Zod and sanitize hrefs. |
| F-11 | High | ARCH §2/§16, ADR-014 | SyV staff with Supabase/Vercel console or backup access bypass the platform_admin model entirely; not addressed. Core to SAAS trust thesis. | §6 infrastructure-access controls in runbook; console MFA, named access, quarterly review, pgaudit; revisit FLE (§10) if not met. |
| F-12 | Medium | DB §5.5, PRD GRD-03 | Guardian consent signing checks `sign_consents` only, not `is_legal_representative` + verification basis; GRD-03 basis/document fields and primary-contact flag missing. | Require legal-rep flag + verification for `guardian_authorization`/treatment consents; add basis + supporting document ref + primary_contact. `[NEEDS LEGAL VERIFICATION]` |
| F-13 | Medium | DB §5.4 clinical tables | "RLS = has_clinical_access only" lets any care-team member update another's draft note (PRD NOTE-02 author only) and draft visibility to others is undefined. | Author-only draft update policy (§4.4b); draft read by others `[NEEDS PSYCHOLOGIST INPUT]`. |
| F-14 | Medium | PRD AUTH-04, ADR-001 | Recovery codes required by PRD; not natively provided by Supabase Auth (verify); MFA reset path undefined. | §3.2 app-managed recovery codes + identity-verified reset runbook. |
| F-15 | Medium | ARCH (missing), API §3 `RATE_LIMITED` | No rate-limit mechanism/store chosen for app-level limits. | ADR for limiter (Postgres or managed KV); limits listed in §3.6. |
| F-16 | Medium | ARCH §8, ADR-017 | `x-org-hint` set by middleware could be supplied by the client if not stripped; cookies/redirects across custom domains unspecified. | Middleware deletes inbound `x-org-*` headers; hint treated as untrusted; host-only cookies; subdomains only in MVP; per-host redirect URLs. |
| F-17 | Medium | ARCH §10, API §1 revalidation | `revalidateTag` implies Next.js data cache; caching PHI would risk cross-user leakage. | Forbid data cache for tenant/clinical data; only branding/static catalog cacheable; lint/review rule. |
| F-18 | Medium | ARCH §10, Q-09 | Logos via upload: SVG would allow script; public bucket listing. | No SVG; raster re-encode; listing disabled; §8 conditions. |
| F-19 | Medium | ARCH §16 | Preview deployments use staging Supabase; broad redirect wildcards can leak auth codes to attacker-controlled preview hosts. | Scope wildcard to the SyV team's Vercel domain; PKCE flow; no production redirect wildcards. |
| F-20 | Medium | DB §3 enums vs PRD PAT-05, SES-04, ASG-04, CON-04 | Status mismatches (patient `intake/paused` vs `inactive`; session `held`/cancel-by; assignment `withdrawn` vs `cancelled`; consent `withdrawn` vs revoked fields). Authorization depends on statuses (which patient statuses allow portal access?). | Reconcile enums with product; define per-status access table. |
| F-21 | Medium | API §4 `AuthzContext.actorKind` | Single `actorKind`; a profile may be guardian and patient (or staff and guardian) in the same org. Also staff being a patient in own org unaddressed. | Explicit "acting as" context chosen per session; forbid staff ↔ patient in same org or require explicit policy. |
| F-08b | Medium | DB §3 `guardian_permission`, §5.4 treatment, §5.4 documents vs PRD GRD-04, TPL-03, DOC-02, RSP-05 | Patient-facing goals, document sharing, response feedback visible to patient are not modeled; DB says plans have no portal access. | Add `treatment_goals.patient_facing_text` + flag (separate policy), `clinical_document_shares` (like `resource_shares`), response feedback field; add guardian permission values. |
| F-22 | Low | ARCH §17 vs PRD SEC-07 | RPO/RTO numbers differ. | Reconcile; client decision. |
| F-23 | Low | ADR-012, AUD-02 | Function + trigger audit may produce duplicate events. | One source per event (§7.2). |
| F-24 | Low | API §4 `consent.template.manage` | Owner only; PRD CON-01 says owner/psychologist. | Product decision; no security objection either way. |
| F-25 | Low | ARCH §12 | Signed URLs survive revocation until TTL. | Accept (documented); keep TTLs; no URL caching. |
| F-26 | Low | DB §5.1 org status | Suspended/closed org behaviour not defined for RLS. | Helpers deny when org not `active`; owner read-only export path for closed orgs `[NEEDS LEGAL VERIFICATION]`. |

**What is solid:** composite tenant FKs (DB §1.3) make cross-tenant references impossible; forced
RLS with default deny; tenant never taken from input; anti-enumeration `NOT_FOUND`; DB-enforced
immutability with hashes and addenda; activity version pinning with composite FK to blocks; no
guardian permission for clinical objects; restrictive guardian defaults; hashed invitation tokens;
no generic soft delete; retention not hardcoded; no PHI in logs/URLs; service-role allowlist; Node
runtime for data access; `getUser()` over `getSession()`; block-based content with no HTML.

---

## 12. Security approval status per ADR

| ADR | Status | Conditions / required changes |
|---|---|---|
| 001 Stack | Approved with conditions | §3.1 Auth hardening; F-11 console controls; region/transfer legal (Q-01) |
| 002 Org tenant | Approved | — |
| 003 Shared schema + RLS | Approved with conditions | Cross-tenant pgTAP + JWT tests are a release gate; forced RLS on every table incl. future ones (CI check) |
| 004 Server-only DAL | **Changes required** | F-01 (choose Option A or B in an ADR), F-03, F-05, F-17 |
| 005 Guardians | Approved with conditions | F-08, F-09, F-12, F-08b; §5 defaults |
| 006 Note immutability | Approved with conditions | F-13; self-validating finalize trigger (§4.4f); server timestamps |
| 007 Version pinning | Approved | — |
| 008 Blocks, no HTML/JS | Approved with conditions | F-10 render-time re-validation; embed allowlist YouTube-nocookie/Vimeo by id |
| 009 next-intl routing | Approved | Locale never used for authorization |
| 010 White-label CSS vars | Approved with conditions | F-18; nonce on style; strict token validation |
| 011 Private storage | Approved with conditions | §8 (magic bytes, AV before `ready`, pending unreadable, branding conditions) |
| 012 Audit log | Approved with conditions | F-04, F-23, daily digest (§7.5) |
| 013 Retention not hardcoded | Approved (security) | Legal pending |
| 014 platform_admin / break-glass | **Changes required** | F-02, F-11 |
| 015 Structured clinical data | Approved | — |
| 016 Care-team access | Approved with conditions | F-03, F-06, F-13; membership/org status in helpers |
| 017 Host-based tenancy | Approved with conditions | F-16, F-19; subdomains only in MVP recommended |
| 018 Postgres functions | Approved with conditions | `SECURITY INVOKER` default; `set search_path=''`; execute revoked from `public/anon`; no dynamic SQL; functions in non-exposed schema unless intended as RPC |

---

## 13. Security test plan and Phase 1 gate

### 13.1 Tests
| Suite | Content |
|---|---|
| Permission matrix (Vitest) | Generated from `permissions.ts` × personas (ARCH §14) × states: active/revoked/expired/suspended guardian, unverified guardian, off-care-team psychologist, ended care team, suspended member, suspended org, owner-only, owner+psychologist, platform_admin with none/pending/approved/expired/revoked grant, aal1 vs aal2, minor turned adult. Asserts TS policy result **equals** real-JWT DB result. |
| RLS pgTAP (`supabase/tests`) | Per table: RLS enabled+forced; allowed/denied SELECT/INSERT/UPDATE/DELETE per persona; `anon` no access; views have `security_invoker`; helper functions have `search_path` set and no `public` execute; break-glass cannot write; triggers reject finalized edits, re-pinning, published-version edits, audit updates. |
| Cross-tenant | Every id-accepting action, route handler, signed-URL request and storage path called with org B ids from org A personas → `NOT_FOUND` + `access.denied` audit; composite-FK insert attempts fail. |
| Direct API abuse | Using persona JWTs against Data API/Storage directly (or confirming Data API disabled): guardian selects all `patients` columns, patient selects notes, patient inserts submitted response, aal1 staff reads notes, forged `write_audit` call. |
| E2E abuse (Playwright) | Invitation reuse/expired/other-email acceptance; MFA bypass by URL; org switch to foreign org; guardian revoked mid-session; supervised session without `complete_assignments`; adolescent privacy page reflects permissions; XSS payloads in all text/AST fields and branding; CSRF from foreign origin; signed URL after expiry; SVG/polyglot upload; oversized upload; rate limits trigger. |
| Logging | PHI canary values in synthetic data must not appear in logs, Sentry events, audit metadata, emails (AUD-07). |
| Headers | Automated header/CSP scan per environment (SEC-09); ASVS L2 checklist pre-launch. |

### 13.2 Phase 1 security gate checklist
- [ ] ADR resolving F-01 (Option A or B) accepted; ADR-014 rewritten per §6.
- [ ] DATABASE.md updated for F-02, F-05, F-07, F-08, F-08b, F-09, F-12, F-13, F-20; API_CONTRACTS.md for F-06, F-21.
- [ ] Supabase Auth settings of §3.1 applied and recorded per environment (sign-ups off, redirect allowlist, token expiry, CAPTCHA, SMTP).
- [ ] MFA enforcement in app + RLS (`is_aal2`) with tests; recovery codes + reset runbook.
- [ ] Every table: RLS enabled + forced, policies + pgTAP tests in the same migration; CI fails otherwise.
- [ ] Helper functions: `app` schema not exposed, `search_path=''`, execute grants minimal.
- [ ] Immutability triggers + tests for notes, addenda, assessments, consents, versions, responses, audit.
- [ ] Audit writer non-forgeable; event catalog typed; metadata schemas; daily digest job.
- [ ] Storage RLS, path checks, magic-byte validation, pending-unreadable; AV decision made before real data.
- [ ] CSP/headers, CSRF `allowedOrigins`, no data cache for PHI, `dangerouslySetInnerHTML` lint, render-time AST validation.
- [ ] Service-role allowlist lint + audited calls; secrets scanning; dependency audit in CI.
- [ ] Infrastructure access policy (F-11) documented and applied to production project.
- [ ] Synthetic data only; PHI-canary log scan green.
- [ ] Legal items acknowledged by client with owner and date: Ley 1581/2012, Res. 1995/1999, Res. 839/2017, Ley 1090/2006, Ley 1098/2006, Ley 527/1999 `[NEEDS LEGAL VERIFICATION]`.
- [ ] Psychologist decisions recorded: adolescent defaults, draft visibility, owner clinical visibility, reflections storage, assent refusal handling `[NEEDS PSYCHOLOGIST INPUT]`.
- [ ] No real patient data until DPA accepted and `real_data_enabled` set (SAAS §7).

Tests run for this document: none (Phase 0, documentation only; no code exists).

---

## 14. Phase 1 implementation review (2026-11-08)

Reviewer: security agent. Scope: `supabase/migrations/*` (up to `20261108140000`), `supabase/tests/*`,
`src/server/{auth,db,authz,audit,tenancy}/**`, `src/proxy.ts`, `src/modules/auth/**`,
`eslint.config.mjs`, `supabase/config.toml`, `next.config.ts`. **Not reviewed:** the branding
workstream in progress (`20261108131000_branding_storage.sql`, `src/modules/branding/**`) — it
gets its own review when handed over (storage policy, magic bytes, SVG exclusion, F-18).
No statement here is a claim of legal compliance.

### 14.1 Summary
> Superseded by the final re-review in §14.7 (statuses in §14.3 updated; gate verdict there).

- One **High** found and **fixed** (P1-01: SECURITY DEFINER functions owned by a BYPASSRLS role).
- No Critical. Remaining findings are Medium/Low and assigned below; none blocks continuing
  Phase 1 work, but P1-02, P1-04, P1-05 and P1-10 must be closed before the Phase 1 gate (§14.4).
- Module status: **DB layer / RLS / helpers / audit writer — approved**; **auth flows
  (sign-in, MFA, recovery codes, invitations, password reset) — approved with conditions**
  (P1-02, P1-03, P1-05); **service-role boundary — approved with conditions** (P1-04);
  **HTTP hardening — blocked for the gate** (P1-10).

### 14.2 SECURITY DEFINER owner model (`20261108140000_definer_owner_hardening.sql`)
- Role `app_definer`: NOLOGIN, NOINHERIT, NOBYPASSRLS, no superuser/createrole/createdb/
  replication, member of no role, owns no relations. Only `postgres` (migration runner) is a
  member (needed for `create or replace`/`alter owner`). `authenticated`, `anon`,
  `service_role`, `app_server` cannot use it. RLS (forced) applies to it like any non-owner.
- It owns every SECURITY DEFINER function in `app` (24 in Phase 1). Its privileges are exactly
  what those bodies use, and every table it touches has `to app_definer` policies:

| Table | app_definer privileges | Policy scope |
|---|---|---|
| organizations, organization_branding | SELECT | all rows (status gate / pre-auth tokens; callers gate) |
| organization_domains | SELECT (organization_id, host, verified_at) | verified hosts only |
| platform_admins, platform_access_grants | SELECT | caller's own rows (`app.request_uid()`) |
| memberships | SELECT; INSERT/UPDATE(status) | read all (last-owner guards, directory); writes only with no user claims (invitation acceptance) |
| membership_roles, professional_profiles | SELECT (key columns); INSERT | read all; insert only with no user claims |
| profiles | SELECT (id, display_name); INSERT | insert only with no user claims (auth.users trigger) |
| invitations | SELECT; UPDATE(status, accepted_by_profile_id) | system path only, staff only, pending → accepted only |
| mfa_recovery_codes | SELECT; INSERT; UPDATE(used_at, revoked_at) | caller's own rows only |
| rate_limit_counters | SELECT/INSERT/UPDATE(count) | **all rows — bypass-equivalent by design** (hashed keys, no tenant data; must count denied/pre-auth attempts) |
| audit_logs | INSERT only (no SELECT/UPDATE/DELETE; hash-chain and break-glass columns not insertable) | **all inserts — bypass-equivalent by design** (denied/system events must be recorded; validation in `app.insert_audit_row`) |
| app.audit_event_types | SELECT | — |

- No DELETE/TRUNCATE/REFERENCES/TRIGGER anywhere; no access to `idempotency_keys`, `storage.*`
  or any future table unless a migration grants it (clinical tables will need explicit review).
- **Schema `auth` cannot be granted** by `postgres` (owner supabase_admin, USAGE without grant
  option). Therefore: `app.request_uid()` / `app.request_jwt()` re-implement `auth.uid()` /
  `auth.jwt()` from the same request GUCs (pgTAP 09 asserts equality in user/anon/system
  contexts and the same GUC precedence — vendor drift check), and **two functions stay owned by
  `postgres` (allowlisted)**: `app.auth_user_verified_email(uuid)` and
  `app.auth_user_id_by_email(text)` — single-row `auth.users` lookups, EXECUTE for
  `app_definer` only, used by invitation peek/accept.
- Every definer function: `search_path = ''`, schema-qualified relations, no dynamic SQL, no
  PUBLIC/anon/service_role EXECUTE. The migration ends with an assertion block (fails `db reset`
  and deploy on violation) and pgTAP `09_definer_hardening.sql` repeats it as a CI test.
- **Rule for new migrations:** every new SECURITY DEFINER function must be `alter function …
  owner to app_definer` (transient `grant create on schema app to app_definer` … `revoke`),
  with explicit grants + `to app_definer` policies for what it touches; anything else fails CI.

### 14.3 Findings

| ID | Sev | Location | Issue | Remediation | Status |
|---|---|---|---|---|---|
| P1-01 | **High** | migrations 120100/120200/120300/120400/130000 (all `security definer`) | All definer functions owned by `postgres` (BYPASSRLS + `pg_read_all_data`): any logic bug in a definer body could read/write any row, incl. future clinical tables. | §14.2 `app_definer` model. | **Fixed** (migration 20261108140000; pgTAP 09) |
| P1-02 | Medium | `src/lib/session-policy.ts:30-39`, `src/proxy.ts:69-71`, `src/proxy.ts:106-108`, `src/server/auth/claims.ts:126-132` | Idle timeout relies on an unsigned httpOnly `psi_activity` cookie: a client can edit it or simply omit it (missing = "not idle"). The proxy matcher skips `/api/*`, so idle/absolute limits are not checked for route handlers, and `getVerifiedClaims()` does not re-check them. Backstop: Supabase `[auth.sessions]` timebox 12 h / inactivity 30 min (local config; hosted availability is plan-dependent — verify). | Server-side `last_activity_at` keyed by `session_id` (§3.5), or an HMAC-signed cookie bound to `session_id`; treat a missing cookie on an existing session as idle; enforce idle/absolute in `getVerifiedClaims()` so every server entry point is covered. | **Fixed** (re-review §14.7: HMAC-SHA256 cookie bound to `session_id`, `src/lib/session-activity.ts`; missing/forged = idle except 120 s fresh-auth grace; re-checked in `getVerifiedClaims()`; proxy runs for `/api/*`; unit `session-activity.test.ts`, E2E idle-timeout) |
| P1-03 | Medium | `src/server/auth/request-meta.ts:21-30` | Client IP = first `x-forwarded-for` hop (fallback `x-real-ip`). Correct only where the edge overwrites the header (stated for Vercel — verify against current Vercel docs per environment). Elsewhere per-IP pre-auth limits are bypassable and audit IPs forgeable (per-subject limits still hold). | Explicit `TRUSTED_PROXY` mode in env (e.g. `vercel` → platform header only; `none` → no IP); fail startup in production if unset. | **Fixed with residual** (`TRUSTED_PROXY` vercel/xff/none + hops, rightmost-untrusted-hop parsing, `request-meta.ts`). Residual P1-21: unset in production off Vercel defaults to `xff` instead of failing startup |
| P1-04 | Medium | `eslint.config.mjs:11-21` (at review time) | Service-role import allowlist is directory-wide (`src/server/auth/**`, `src/server/audit/**`, `src/server/tenancy/**`) and includes the non-existent `src/modules/platform/server/**`: any new file there silently gets the Auth admin client. `src/server/db/admin.ts` (since split into `system.ts` + `service-role.ts`) mixed the low-privilege `app_server` system functions and the service-role Auth admin client behind one import. | File-level allowlist (actual importers: `audit/writer.ts`, `auth/{invitations,rate-limit,recovery-codes}.ts`, `tenancy/host.ts`); split `db/admin.ts` into `db/system.ts` (app_server) and a service-role module (narrower allowlist: invitations, recovery-codes); record architect approval. | **Fixed** (`src/server/db/system.ts` + `src/server/db/service-role.ts`, per-file `SYSTEM_DB_IMPORTERS`/`SERVICE_ROLE_IMPORTERS`, `tests/unit/lint-boundaries.test.ts`, ARCHITECTURE §6.4). Residual P1-20 |
| P1-05 | Medium | `src/server/auth/recovery-codes.ts`, `src/server/db/service-role.ts` (`adminDeleteAllMfaFactors`; was `db/admin.ts`) | Recovery code is consumed, then factors are deleted in a loop; a mid-loop failure leaves a partial reset with **no** `auth.mfa_reset` audit (the catch returns INTERNAL). If `signOut('global')` fails after factors were removed, sessions may survive while the user is told "error". Comments disagree on whether factor deletion already ends sessions (old admin.ts:247 vs recovery-codes.ts:89-91). | Audit `auth.mfa_reset` in every outcome (`outcome: ok/partial/failed`, `factors_removed`); retry/alert on partial; verify GoTrue session behaviour and fix the comment; keep the global sign-out. | **Fixed** (migration `20261108150000_recovery_reset_state.sql`: pending/completed state, retry 1 h/5 attempts, `auth.mfa_reset` started/ok/partial/failed; factors verified-last; global sign-out retried; comment corrected — factor deletion observed NOT to end sessions; pgTAP 08, integration auth-flows). Residual P1-22 |
| P1-06 | Low | `src/server/db/service-role.ts` (`adminCreateInvitedUser`; was `db/admin.ts:218-228`) | Invited users are created with `email_confirm: true`. Acceptable: possession of the 256-bit, single-use, 72 h, hashed, fragment-only (`#token`, `no-referrer`), rate-limited token sent to that address is the mailbox proof; existing accounts must present their current password. Residual: an owner's typo hands an account to whoever controls the typo address (inherent to invitations). | None required. Keep tokens out of logs (PHI/secret canary scan). | Accepted |
| P1-07 | Low | `src/server/auth/claims.ts:52-63` | `VerifiedClaims` branding via a process-local `WeakSet` + `Object.freeze`: forged or cast objects are rejected at the DB boundary, expiry re-checked. Residual: revocation (`getUser`) is checked at issuance only; a claims object reused beyond its request would stay usable until `exp` (≤ 900 s). | Never persist/cache claims beyond the request (`cache()` is per request today); review rule. | Accepted |
| P1-08 | Info | `src/server/authz/context.ts:165-172` | aal1 on a foreign tenant host: capacities are restricted to the host **before** the MFA check, so the result is `FORBIDDEN (noCapacity)`, not `MFA_REQUIRED`. Fail-closed; does not reveal memberships elsewhere. | — | Accepted (by design) |
| P1-09 | Info | `src/server/tenancy/request.ts:144-157`, `src/server/auth/password.ts:29` | Preview hosts (e.g. `*.vercel.app`) resolve to `unknown`: staff routes deny and no recovery link is issued. Fail-closed; consistent with F-19. Previews need `APP_BASE_DOMAIN` set per preview on the staging project only. | — | Accepted |
| P1-10 | Medium | `next.config.ts:6-9` | No security headers: CSP (nonce, ADR-010 style), HSTS, `frame-ancestors`/X-Frame-Options, `nosniff`, Referrer-Policy (global), Permissions-Policy. `serverActions.allowedOrigins` not set (Next's same-origin check applies; verified tenant custom domains will need it). | Add headers in `next.config.ts`/proxy; header scan in CI (§13.1 Headers). | **Fixed** (`src/lib/security-headers.ts`, `src/proxy.ts`, `next.config.ts`: nonce + `strict-dynamic` script CSP, nonce `style-src-elem`, documented `style-src-attr 'unsafe-inline'` exception, strict `/api` CSP, nosniff, XFO DENY, COOP, Permissions-Policy, HSTS prod, Referrer-Policy, `no-store`; unit + E2E `security-headers.spec.ts` in CI). `allowedOrigins` deferred to custom domains (Q-02) |
| P1-11 | Low | `src/proxy.ts:106-108` | Proxy matcher excludes `/api/*`: inbound `x-request-id`/`x-next-intl-locale` are not stripped for route handlers, so `request_id` in audit rows written from route handlers is client-chosen (format-validated). | Run header hygiene for `/api/*` too (without i18n routing) or generate the id in route handlers. | **Fixed** (matcher includes `/api/*`; inbound `x-request-id`/`x-org-*`/`x-nonce`/CSP stripped, fresh id set) |
| P1-12 | Low | `src/app/api/auth/confirm/[locale]/route.ts:13-31` | Single-use recovery token is consumed on GET; mail-scanner prefetch can burn it (availability, not confidentiality). | Interstitial page that confirms via POST. | **Fixed** (GET only validates shape and 303s to `/[locale]/confirm`; token consumed by `confirmRecoveryLinkAction` POST; E2E recovery flow) |
| P1-13 | Low | `src/server/auth/request-meta.ts:36-37` | `x-forwarded-proto` is client-influenced; when not overwritten by the edge, emailed invitation links could be downgraded to `http`. Host part is safe (both `Host` and `x-forwarded-host` must resolve to the app or the caller's verified tenant). | In production always `https`. | **Fixed** (`requestMetaFromHeaders`: `https` in production except loopback; unit `auth.test.ts`) |
| P1-14 | Low | `supabase/tests/_helpers.psql:44-49` | `tests.as_admin()` did not clear `request.jwt.claim` (test isolation; `auth.jwt()` reads it first). | Clear it. | **Fixed** |
| P1-15 | Info | `app.request_uid()` / `app.request_jwt()` | Duplicate of vendor `auth.uid()`/`auth.jwt()` semantics (required, §14.2). | pgTAP 09 drift test; re-check on Supabase upgrades. | Accepted |
| P1-16 | **Medium** | `src/modules/branding/server/service.ts` (`uploadToBucket`, 409 branch), `20261108131000_branding_storage.sql` (`branding_logos_insert_owner`) | The §8 condition "write only via server action" is not met: the INSERT policy accepts the owner's own aal2 JWT, and the owner can read that token from their cookies and call the Storage API directly, skipping magic-byte checks and metadata stripping. The server also treats `409` as success ("same name = same bytes"), which an owner can break by uploading other bytes first at the content-addressed name (the name is deterministic). **Verified locally 2026-11-08:** owner A pre-uploaded HTML bytes as `image/png`, then `saveLogo` returned ok, set `logo_path`, and the public URL served those HTML bytes. Not cross-tenant (the policy enforces the org path); the bucket allowlist keeps the type at PNG/JPEG/WebP, so no script runs in current browsers. Residual risk: unsanitized EXIF/GPS or other content published as the tenant logo, and owners can host any blob up to 512 KiB publicly. | Never trust a 409: download the existing object and compare its sha256 with the sanitized bytes; on mismatch refuse and audit it (or always verify after upload). Better: make the bucket writable only by a narrow audited server path, which means an allowlist change and architect approval. Add an integration test for the pre-seed case. | **Fixed** (migration `20261108160000_branding_server_only_writes.sql`: no user role can write the bucket; sanitized bytes uploaded only via `service-role.ts` after an RLS-bound owner check; 409 shortcut removed; pgTAP 10; probe now rejected) |
| P1-17 | Low | Supabase Storage public object responses | Local public objects are served with the uploader's `Content-Type` and no `X-Content-Type-Options: nosniff` or CSP (observed). | Verify hosted Storage/CDN headers per environment; if `nosniff` is missing, do not serve logos from the storage origin as documents (keep `<img>` only), or proxy them through the app with `nosniff`. | Open (verify on hosted) |
| P1-18 | **Medium** | branding bucket (no UPDATE/DELETE policy), `clearLogo` | Objects are immutable and have no delete path: removing a logo leaves it public at a known, long-cached URL indefinitely, so an image uploaded by mistake (for example a photo of a person) cannot be taken down. Orphans pile up, and there is no per-org upload rate limit, so storage can be abused. | Audited cleanup job (service role, allowlisted) that deletes unreferenced objects after a grace period; a support takedown runbook; a per-org upload limit through `app.consume_rate_limit`. | **Fixed** (owner "remove logo" with confirmation, object deletion + `organization_branding.logo_removed` audit, superseded objects deleted on publish, 10 uploads/hour per owner) |
| P1-19 | Low | `src/server/db/system.ts:16-18` (header comment), `docs/DECISIONS.md:127` | Stale references: the system.ts comment still says the service-role operations are "at the bottom of this file", and DECISIONS still names `src/server/db/admin.ts`. | Point both to `src/server/db/service-role.ts` (backend / architect). | **Fixed** (applied migrations keep historical comments) |
| P1-20 | Low | `src/server/env.ts` (exports `SUPABASE_SERVICE_ROLE_KEY`), `eslint.config.mjs` | The per-file allowlist restricts the module, not the key: any server file can build its own admin client from `env.SUPABASE_SERVICE_ROLE_KEY`. `no-restricted-imports` also does not cover dynamic `import()`. | `no-restricted-syntax` on `SUPABASE_SERVICE_ROLE_KEY` outside `src/server/db/service-role.ts` (or move the key to an env module only that file may import); forbid `ImportExpression` of both restricted modules. | **Fixed** (dynamic `import()`/`require()` and computed specifiers banned; only `service-role.ts` may read the key) |
| P1-21 | Low | `src/server/auth/request-meta.ts` (`trustedProxyFromEnv`) | Residual of P1-03: with `TRUSTED_PROXY` unset in production off Vercel, the default is `xff`/1 hop, which a client can control if no proxy actually appends the header. | Fail startup in production when `TRUSTED_PROXY` is unset and `VERCEL` is not `1`. | **Fixed** (`src/instrumentation.ts` stops `next start`; build exempt) |
| P1-22 | Low | `app.finish_recovery_reset`, `app.consume_recovery_code` (`20261108150000`) | Residual of P1-05: the caller chooses the outcome it records (it could record `ok` without factors being removed; reachable only through the server because the Data API is closed). If the final `ok` write fails, the code stays reusable for 1 h, so whoever holds the password and the code could delete a newly enrolled factor. | Alert when `auth.mfa_reset started` has no matching `ok` within 1 h (runbook); consider recording `factors_removed` from the server only. | Accepted with monitoring |
| P1-23 | Info | `src/proxy.ts` matcher | Paths that contain `.` skip the proxy (no document CSP, no activity refresh). `getVerifiedClaims()` still enforces session limits. | Keep pages and route handlers free of dotted paths, or extend the matcher. | Accepted |
| P1-24 | Info | `src/modules/branding/server/queries.ts` (tenant theme cache) | Reviewed: a process-local Map keyed by the host-resolved organization id, holding non-PHI only (colours, display name, logo path), 30 s TTL, 500-entry bound, invalidated on save; other instances can be up to 30 s stale. This matches F-17 (branding is the only cacheable data). | Never extend it to user, membership or clinical data. | Accepted |

### 14.4 Phase 1 gate checklist status (§13.2)

| Gate item | Status | Evidence / gap |
|---|---|---|
| ADR resolving F-01; ADR-014 rewritten | Partially | ADR-019 Option A accepted and implemented (`config.toml [api] enabled=false`, `pg_graphql` dropped, `app_server` role; `tests/integration/data-api-closed.test.ts`, pgTAP 01/09). ADR-014 rewritten; break-glass is deny-only stubs until Phase 3; formal re-review of ADR-014/020/021 still to be recorded in DECISIONS index. |
| DATABASE.md (F-02, F-05, F-07, F-08, F-08b, F-09, F-12, F-13, F-20); API_CONTRACTS (F-06, F-21) | Met (docs) | References present in DATABASE.md / API_CONTRACTS.md; implementation lands in Phase 2/3. |
| Supabase Auth §3.1 settings per environment | Partially | Local `config.toml`: sign-ups off, JWT 900 s, password ≥ 12, confirmations, exact redirect URLs, sessions backstop. Not done: CAPTCHA, custom SMTP, leaked-password protection, recorded settings for staging/production. |
| MFA in app + RLS with tests; recovery codes + reset runbook | Partially | App: `context.ts` MFA_REQUIRED; RLS: `is_aal2` in helpers (pgTAP 03); recovery codes (pgTAP 08, integration auth-flows). Missing: support MFA-reset runbook; P1-05. |
| Every table RLS enabled + forced, pgTAP, CI fails otherwise | Met | pgTAP 01 (all public tables forced RLS); CI `supabase` job runs `db:test`. |
| Helper functions: app not exposed, `search_path=''`, minimal execute | Met | pgTAP 01 + 09; P1-01 fixed. |
| Immutability triggers + tests (notes, addenda, assessments, consents, versions, responses, audit) | Partially | Audit append-only incl. TRUNCATE (pgTAP 06). Other tables are Phase 2/3. |
| Audit writer non-forgeable; typed catalog; metadata schemas; daily digest | Partially | Actor from claims, allowlist, writer kinds, metadata deny-list + Zod (pgTAP 06, integration audit). Daily digest job not implemented. |
| Storage RLS, path checks, magic bytes, pending-unreadable; AV decision | Not met (in progress) | Branding bucket in progress by frontend workstream, not yet reviewed; `file_objects` is Phase 2; AV decision open. |
| CSP/headers, CSRF `allowedOrigins`, no PHI data cache, no `dangerouslySetInnerHTML`, AST validation | Partially | `react/no-danger` lint on; no `unstable_cache`/`force-cache` in `src`; P1-10 open; AST N/A until Phase 2. |
| Service-role allowlist lint + audited calls; secrets scanning; dependency audit in CI | Partially | Lint allowlist exists (P1-04 too broad); no secret scanning or dependency audit step in `.github/workflows/ci.yml`. |
| Infrastructure access policy (F-11) | Not met | Runbook outside repo not provided. |
| Synthetic data only; PHI-canary log scan | Partially | Fictional seeds/tests only; canary scan not implemented. |
| Legal items acknowledged by client | Not met | Client action `[NEEDS LEGAL VERIFICATION]`. |
| Psychologist decisions recorded | Not met | `[NEEDS PSYCHOLOGIST INPUT]`. |
| No real patient data until DPA + `real_data_enabled` | Partially | No real data present; `real_data_enabled` flag not yet implemented. |

**Gate verdict at first review: not passed** (expected at this point of Phase 1; superseded by §14.7). Blocking for the gate:
P1-10, storage review, Auth settings per environment, MFA reset runbook, F-11, legal and
psychologist items. P1-02/P1-04/P1-05 should be fixed in the Phase 1 hardening pass.

### 14.5 Items needing legal review
- Whether session limits (idle/absolute) and audit retention for auth events satisfy applicable
  Colombian requirements `[NEEDS LEGAL VERIFICATION]` (values remain product constants).
- Storing client IP and user agent in `audit_logs` (personal data under Ley 1581/2012; purpose,
  retention, disclosure in privacy notice) `[NEEDS LEGAL VERIFICATION]`.
- Supabase/Vercel region and international transfer (Q-01) `[NEEDS LEGAL VERIFICATION]`.

### 14.6 Tests run for this review (2026-11-08, local stack)
`pnpm db:reset` (all migrations from scratch incl. branding 131000, seed OK) · `pnpm db:test` —
10 files, 206 assertions, PASS (09_definer_hardening: 43; 10_branding_storage from the branding
workstream also passes on top of the new owner model) · `pnpm test` — 15 files, 438 tests, PASS
(integration project: 6 files / 52 tests against the live stack, incl. real GoTrue user creation
and invitation acceptance) · `pnpm typecheck` — PASS · `pnpm lint` — PASS (final run) ·
`pnpm gen:types` regenerated `src/server/db/types.gen.ts` (it was already stale for 1.3/1.7).

### 14.7 Final Phase 1 re-review (2026-11-08)

Scope: everything since §14.1 (branding 1.7, the P1-02…P1-13 remediation, the cleanup commit
`07fe3df`). Each fix was checked in the code and the tests below were run; reports were not taken on trust.
The new finding IDs start at **P1-16** because P1-14/P1-15 were already used in §14.3.
No statement here is a claim of legal compliance.

**Remediation verification:** P1-02, P1-04, P1-05, P1-10, P1-11, P1-12, P1-13 are **fixed**. P1-03 is
**fixed with residual** (P1-21). Residuals P1-20 and P1-22 are Low. No Critical or High finding is open. No SQL or
test change was needed in this re-review.

**Branding storage (1.7):** bucket config, the policy (owner, aal2, active org, strict path regex), no
listing, no UPDATE/DELETE, no SVG, the strict PNG/JPEG/WebP re-writer and the theme cache are sound. Open:
**P1-16** (direct Storage API write plus 409-as-success lets an owner bypass sanitizing, verified),
**P1-18** (no takedown, orphans, no upload rate limit), P1-17 (nosniff on hosted storage).

**Module status:** 1.3 auth flows — approved · 1.4 authz/RLS — approved · 1.8 audit — approved ·
service-role boundary — approved (P1-19/P1-20 Low) · HTTP hardening — approved · **1.7 branding —
approved with conditions** (P1-16, P1-18 before pilot).

#### Engineering gate (§13.2, Phase 1 scope)

| Item | Status | Evidence |
|---|---|---|
| F-01 resolved (ADR-019 Option A) | Met | Data API off, `app_server` role; `data-api-closed.test.ts`; pgTAP 01/09 |
| Cross-tenant isolation | Met | pgTAP 02/10, integration `tenancy-context`/`branding` (A≠B), E2E cross-tenant host |
| MFA for staff, app + RLS; recovery codes | Met | `context.ts` MFA_REQUIRED, `is_aal2` (pgTAP 03), recovery reset (pgTAP 08, integration), E2E aal1 hold |
| RLS forced on every table; helpers `search_path=''`, minimal EXECUTE, definer owner model | Met | pgTAP 01, 09 |
| Audit writer non-forgeable, typed catalog | Met | pgTAP 06, integration `audit` |
| Session limits (idle/absolute) server-side | Met | P1-02 fix |
| CSP/headers, no PHI data cache, no `dangerouslySetInnerHTML` | Met | P1-10 fix; `react/no-danger`; P1-24 |
| Service-role per-file allowlist | Met (Low residuals) | P1-04 fix; P1-20 |
| Branding storage review | Met with conditions | P1-16, P1-18 open (Medium) |
| CI green | Met locally | Same commands as `ci.yml` run locally (below); the GitHub run from a clean clone was not observed by this reviewer |
| Daily audit digest; PHI-canary log scan; secret scanning + dependency audit in CI | **Not met — required before pilot** | Not in `ci.yml`; does not block an alpha with synthetic data |
| Hosted Auth §3.1 settings (CAPTCHA, custom SMTP, leaked-password protection) recorded per environment; MFA-reset support runbook | **Not met — required before pilot** | Only local `config.toml` |
| AV decision; `file_objects` storage path checks | Phase 2 (before any clinical upload) | — |
| Immutability triggers for clinical tables | Phase 2/3 | Audit append-only done (pgTAP 06) |
| `real_data_enabled` flag | **Required before pilot** | Not implemented |

#### Pilot-gate prerequisites (legal/organizational; code cannot meet them; DEVELOPMENT_ROADMAP §1)
- Legal acknowledgements: Ley 1581/2012, Res. 1995/1999, Res. 839/2017, Ley 1090/2006, Ley 1098/2006,
  Ley 527/1999 `[NEEDS LEGAL VERIFICATION]`; consent texts reviewed by counsel; DPA Daniela ↔ SyV signed.
- Hosting region / international transfer decided (Q-01) `[NEEDS LEGAL VERIFICATION]`.
- Psychologist decisions recorded (adolescent defaults, draft visibility, owner clinical visibility,
  reflections storage, assent refusal) `[NEEDS PSYCHOLOGIST INPUT]`.
- F-11 infrastructure-access policy applied to the production project (console MFA, named access,
  quarterly review); backup restore drill done; independent security audit (roadmap pilot gate).

**Phase 1 gate: PASSED for internal alpha with synthetic data.** This rests on: no open Critical or High
finding; Phase 1 exit criteria (isolation, staff MFA, approvals for 1.3/1.4/1.7/1.8) met with evidence.
It does **not** allow real data. Before the pilot: close P1-16 and P1-18, and complete the
engineering items marked "required before pilot" and every pilot-gate prerequisite above.

#### Tests run for this re-review (2026-11-08, local stack)
`pnpm db:test`: 10 files, 217 tests, PASS (run before and after the orchestrator's `db:reset`) ·
`pnpm test`: 19 files, 463 tests, PASS (integration project alone: 7 files, 66 tests, live stack,
none skipped) · `pnpm e2e -- security-headers.spec.ts branding.spec.ts auth.spec.ts`: 34 passed ·
`pnpm typecheck`: PASS · `pnpm lint`: PASS · ad-hoc probe for P1-16 (scratch file outside the repo,
reproduced the issue, then restored org A's `logo_path`).


### 14.8 Addendum — 2026-11-08, after the branding fixes

P1-16, P1-18, P1-19, P1-20 and P1-21 are **fixed** (see the table above). With these, **1.7 branding is
approved** and no Medium engineering finding is open. Remaining open: P1-17 (Low, verify `nosniff` on hosted
storage), P1-22 (Low, alerting on reused pending recovery codes), P1-23 (Info). Residual: logos planted
before migration `20261108160000` could persist in a CDN cache (none exist outside local dev).
The verdict is unchanged: **Phase 1 gate PASSED for internal alpha with synthetic data**; the pilot still
requires the non-engineering and pre-pilot engineering items in §14.7.

## 15. Phase 2 implementation review (2026-11-14)

Scope: migrations `20261109100000`..`20261113110000`, `supabase/tests/11_*`, `src/modules/{patients,guardians,consents}`, portal invitation / capacity code (`src/server/{auth,authz}`), Phase 2 pages. Checked against CLAUDE.md non-negotiables, §4–5 and the provisional Q-03/Q-04/Q-17 defaults.

| ID | Sev | Area | Finding | Status |
|---|---|---|---|---|
| S2-01 | High | `app.write_audit` (portal branch, 20261109100000) | Portal identities could write any user-writer event (e.g. `consent.recorded`, `patient_guardian.revoked`) with an arbitrary `metadata.patient_id`; `insert_audit_row` derives `audit_logs.patient_id` from it, so forged rows reached another patient's care-team audit view. | Fixed: `20261114100000_portal_audit_event_allowlist.sql` (portal: `auth.*` only, no `patient_id`); pgTAP in `11_*` (+3). |
| S2-02 | Low | Staff branch of `app.write_audit` | Staff can still attach any `patient_id` of the org to user events (Phase 1 design). Actor is recorded truthfully. | Open: Phase 3 should validate `patient_id` against `is_on_care_team` before clinical audit relies on it. |
| S2-03 | Low | `invitations_one_pending_per_email` | One pending invitation per email per org across kinds (staff/patient/guardian); a person who is both guardian and adult patient is invited sequentially. Fails safe. | Accepted (documented deviation). |
| S2-04 | Low | `app.my_portal_mode` | Active guardian (no permission required, caveats not consulted) learns the age band of the minor. No personal data. | Accepted; revisit if caveats must hide the patient entirely. |
| S2-05 | Info | Definer functions / `app_definer` read-all policies | All new definer functions have `search_path = ''`, owner `app_definer`, explicit grants; system-path functions (`peek_invitation`, `accept_portal_invitation`) reject user context and are `app_server`-only; link policies require `profile_id is null`. `record_consent` fix keeps checks and audit. Acceptance is single-use, email-bound to verified email, refuses staff of the org, never activates relationships. | OK. |
| S2-06 | Info | Deviations | Guardians only for minors, no reactivation after majority, seed status insert: all stricter than the spec (fail closed). Majority age / post-majority access remain `[NEEDS LEGAL VERIFICATION]`. | Accepted pending legal review. |
| S2-07 | Review pending | `app.submit_data_subject_request`, `app.update_data_subject_request`, `app.dsr_staff_scope`, table `data_subject_requests` (migration `20261114110000`), `app.majority_in_days` (`20261114120000`) | New definer functions + RLS added by the Phase 2 QA closure (PAT-09, PAT-06). Portal audit rows are written inside the definer function (portal identities cannot call `write_audit`); no free text in audit metadata; owners read requests (no clinical content); no direct table writes. | **Needs security review before merge.** |

Verdict: Phase 2 **approved for internal alpha with synthetic data** (patients, guardians, consents, portal identities) after S2-01 fix. Tests on 2026-11-14: `db:test` 274 pass (11 files), `npm test` 962 pass, `phase2.spec.ts` 6 pass / 1 skipped.
