-- =============================================================================
-- Phase 2 — patients, care team, guardians (DATABASE.md §5.3, §8; SECURITY.md §4, §5;
-- ADR-005, ADR-016, ADR-018, ADR-019 Option A). Forward-only.
--
-- Tables: patients, patient_preferences, care_team_members, guardians, patient_guardians,
--         patient_guardian_caveats, patient_guardian_permissions.
--         portal_supervised_sessions is DEFERRED (AUTH-07 needs idle/absolute timeouts checked
--         on every request; not trivial — tracked in DATABASE.md §13).
-- Config: app.jurisdiction_settings (age of majority per country) [NEEDS LEGAL VERIFICATION].
-- Helpers (schema app, search_path = '', identity from app.request_uid() only, boolean):
--   is_on_care_team, is_primary_on_care_team, can_manage_patient, can_assign_care_team,
--   is_patient_self, guardian_can, is_active_guardian_of, is_my_guardian_record,
--   is_my_relationship, can_manage_guardian, can_manage_relationship, is_portal_identity,
--   is_minor, patient_is_minor, majority_date.
-- Projections for callers WITHOUT row access (DATABASE.md §1 rule 11; Q-03):
--   app.patient_directory(org)          -> any aal2 staff member: name + status only.
--   app.guardian_patient_summary(org)   -> guardian: relationship state, first/preferred name
--                                          only when the relationship is effective.
--   app.patient_privacy_view(org, pat)  -> patient (GRD-07): what each guardian can view.
-- Audit: audit_logs.patient_id (derived from metadata.patient_id), care-team read policy,
--        portal identities may write user audit rows (roles = capacity).
-- Q-03 default (provisional): an owner NOT on the care team has NO row access to patients;
-- only app.patient_directory. Q-04 default (provisional): guardian access requires the patient
-- to be a minor (date-based, fail closed) AND the relationship to be active; a system job also
-- sets relationships to `suspended (age_of_majority)` [NEEDS LEGAL VERIFICATION]
-- [NEEDS PSYCHOLOGIST INPUT].
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums (DATABASE.md §3)
-- -----------------------------------------------------------------------------
create type public.document_type as enum ('cc', 'ti', 'rc', 'ce', 'pa', 'ppt', 'nit', 'other');
create type public.patient_status as enum ('intake', 'active', 'paused', 'discharged', 'archived');
create type public.portal_mode as enum ('child', 'adolescent', 'adult');
create type public.care_role as enum ('primary', 'secondary', 'supervisor');
create type public.guardian_relationship as enum
  ('mother', 'father', 'legal_guardian', 'grandparent', 'other_relative', 'other');
create type public.relationship_status as enum ('pending_verification', 'active', 'suspended', 'revoked');
create type public.relationship_suspension_reason as enum
  ('age_of_majority', 'custody_review', 'safety_concern', 'other');
create type public.legal_representation_basis as enum
  ('parental_authority', 'legal_guardianship', 'court_order', 'other');
create type public.guardian_permission as enum (
  'view_assignments', 'complete_assignments', 'view_responses', 'view_shared_resources',
  'sign_consents', 'view_session_schedule', 'manage_portal_preferences', 'receive_notifications',
  'view_shared_documents', 'view_patient_facing_goals'
);
create type public.guardian_status as enum ('active', 'inactive');

-- -----------------------------------------------------------------------------
-- 2. Jurisdiction configuration (age of majority is configuration, never a literal in code)
-- -----------------------------------------------------------------------------
create table app.jurisdiction_settings (
  country_code char(2) primary key check (country_code ~ '^[A-Z]{2}$'),
  age_of_majority_years smallint not null check (age_of_majority_years between 14 and 25),
  legal_reference text not null check (char_length(legal_reference) between 1 and 200),
  updated_at timestamptz not null default now()
);
comment on table app.jurisdiction_settings is
  'Per-country legal parameters. Changed only by reviewed migrations. Values are [NEEDS LEGAL VERIFICATION].';
revoke all on app.jurisdiction_settings from public, anon, authenticated, service_role;
insert into app.jurisdiction_settings (country_code, age_of_majority_years, legal_reference)
values ('CO', 18, '[NEEDS LEGAL VERIFICATION] Colombia: age of majority (provisional default, Q-04)');

-- Date the patient reaches majority in the org's country; null when the country is not
-- configured (callers treat null as "unknown" and fail closed).
create function app.majority_date(p_date_of_birth date, p_country char(2)) returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (p_date_of_birth + make_interval(years => j.age_of_majority_years))::date
  from app.jurisdiction_settings j
  where j.country_code = p_country
$$;

-- true = minor, false = adult, null = jurisdiction not configured (fail closed by callers).
create function app.is_minor(p_date_of_birth date, p_country char(2)) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select current_date < app.majority_date(p_date_of_birth, p_country)
$$;
comment on function app.is_minor(date, char) is
  'Derived minor status (DATABASE.md §5.3). current_date of the DB session (UTC); org time zone not applied [NEEDS LEGAL VERIFICATION].';

-- Suggested portal mode from age (PAT-03: suggestion only, the psychologist confirms).
-- Thresholds are product placeholders [NEEDS PSYCHOLOGIST INPUT].
create function app.suggest_portal_mode(p_date_of_birth date, p_country char(2)) returns public.portal_mode
language sql
stable
set search_path = ''
as $$
  select case
    when app.is_minor(p_date_of_birth, p_country) is false then 'adult'::public.portal_mode
    when extract(year from age(current_date, p_date_of_birth)) >= 12 then 'adolescent'::public.portal_mode
    else 'child'::public.portal_mode
  end
$$;

-- Portal access per patient status (DATABASE.md §5.3 table, F-20).
--   onboarding: consents list, privacy, account  (intake, active, paused, discharged)
--   sign      : sign consents/assent            (intake, active, paused)
--   portal    : assignments, resources, ...     (active, paused)
create function app.patient_portal_status_allows(p_status public.patient_status, p_need text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_need
    when 'onboarding' then p_status in ('intake', 'active', 'paused', 'discharged')
    when 'sign' then p_status in ('intake', 'active', 'paused')
    when 'portal' then p_status in ('active', 'paused')
    else false
  end
$$;

-- -----------------------------------------------------------------------------
-- 3. Tables
-- -----------------------------------------------------------------------------

-- patients ---------------------------------------------------------------------
create table public.patients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  profile_id uuid null references public.profiles (id) on delete restrict,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 100),
  preferred_name text null check (char_length(btrim(preferred_name)) between 1 and 100),
  pronouns text null check (char_length(pronouns) between 1 and 40),
  date_of_birth date not null check (date_of_birth >= date '1900-01-01'),
  document_type public.document_type null,
  document_number text null check (document_number ~ '^[A-Za-z0-9-]{3,32}$'),
  email extensions.citext null check (
    char_length(email::text) <= 254 and email::text ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  phone text null check (phone ~ '^[0-9 +()-]{5,32}$'),
  sex text null check (char_length(sex) between 1 and 32),
  gender_identity text null check (char_length(gender_identity) between 1 and 64),
  preferred_locale text null check (preferred_locale in ('es', 'en')),
  emergency_contact_name text null check (char_length(btrim(emergency_contact_name)) between 1 and 120),
  emergency_contact_phone text null check (emergency_contact_phone ~ '^[0-9 +()-]{5,32}$'),
  status public.patient_status not null default 'intake',
  status_changed_at timestamptz not null default now(),
  archived_at timestamptz null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patients_org_id_key unique (organization_id, id),
  constraint patients_document_pair check (document_number is null or document_type is not null),
  constraint patients_archived_consistent check ((status = 'archived') = (archived_at is not null))
);
create unique index patients_org_document_key on public.patients (organization_id, document_type, document_number)
  where document_number is not null;
create unique index patients_org_profile_key on public.patients (organization_id, profile_id)
  where profile_id is not null;
create index patients_org_name_idx on public.patients (organization_id, last_name, first_name);
create index patients_org_status_idx on public.patients (organization_id, status);
create index patients_profile_idx on public.patients (profile_id) where profile_id is not null;
create index patients_created_by_idx on public.patients (created_by);
comment on table public.patients is
  'Patient identity per org. Minor status derived (app.is_minor). Care team reads/updates; owners off the care team use app.patient_directory only (Q-03); patient reads own row (DTO).';
comment on column public.patients.gender_identity is '[NEEDS PSYCHOLOGIST INPUT] field set and wording.';
create trigger patients_set_updated_at before update on public.patients
  for each row execute function app.set_updated_at();

-- patient_preferences (1:1) ------------------------------------------------------
create table public.patient_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  patient_id uuid not null,
  portal_mode public.portal_mode not null,
  portal_mode_set_by uuid null references public.profiles (id) on delete restrict,
  locale text null check (locale in ('es', 'en')),
  notify_email boolean not null default true,
  text_size smallint not null default 100 check (text_size in (100, 125, 150)),
  reduced_motion boolean not null default false,
  audio_instructions boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_preferences_patient_key unique (patient_id),
  constraint patient_preferences_org_id_key unique (organization_id, id),
  constraint patient_preferences_patient_fkey foreign key (organization_id, patient_id)
    references public.patients (organization_id, id) on delete restrict
);
create index patient_preferences_org_patient_idx on public.patient_preferences (organization_id, patient_id);
create index patient_preferences_set_by_idx on public.patient_preferences (portal_mode_set_by);
create trigger patient_preferences_set_updated_at before update on public.patient_preferences
  for each row execute function app.set_updated_at();

-- care_team_members ---------------------------------------------------------------
create table public.care_team_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  patient_id uuid not null,
  membership_id uuid not null,
  care_role public.care_role not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz null,
  assigned_by uuid not null references public.profiles (id) on delete restrict,
  assignment_reason text null check (char_length(btrim(assignment_reason)) between 10 and 500),
  ended_by uuid null references public.profiles (id) on delete restrict,
  end_reason text null check (char_length(btrim(end_reason)) between 3 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_team_members_org_id_key unique (organization_id, id),
  constraint care_team_members_patient_fkey foreign key (organization_id, patient_id)
    references public.patients (organization_id, id) on delete restrict,
  constraint care_team_members_membership_fkey foreign key (organization_id, membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint care_team_members_window check (ends_at is null or ends_at >= starts_at),
  constraint care_team_members_end_consistent check ((ends_at is null) = (ended_by is null))
);
create unique index care_team_members_active_key on public.care_team_members (patient_id, membership_id)
  where ends_at is null;
create unique index care_team_members_one_primary on public.care_team_members (patient_id)
  where care_role = 'primary' and ends_at is null;
create index care_team_members_lookup_idx on public.care_team_members (organization_id, patient_id, membership_id)
  where ends_at is null;
create index care_team_members_membership_idx on public.care_team_members (organization_id, membership_id)
  where ends_at is null;
create index care_team_members_assigned_by_idx on public.care_team_members (assigned_by);
create index care_team_members_ended_by_idx on public.care_team_members (ended_by);
comment on table public.care_team_members is
  'ADR-016 care team. Never deleted; ending stamps ends_at. Self-assignment to a patient with another primary requires a reason and is audited (F-06).';
create trigger care_team_members_set_updated_at before update on public.care_team_members
  for each row execute function app.set_updated_at();

-- guardians ----------------------------------------------------------------------
create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  profile_id uuid null references public.profiles (id) on delete restrict,
  first_name text not null check (char_length(btrim(first_name)) between 1 and 100),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 100),
  document_type public.document_type null,
  document_number text null check (document_number ~ '^[A-Za-z0-9-]{3,32}$'),
  email extensions.citext null check (
    char_length(email::text) <= 254 and email::text ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  phone text null check (phone ~ '^[0-9 +()-]{5,32}$'),
  status public.guardian_status not null default 'active',
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint guardians_org_id_key unique (organization_id, id),
  constraint guardians_document_pair check (document_number is null or document_type is not null)
);
create unique index guardians_org_profile_key on public.guardians (organization_id, profile_id)
  where profile_id is not null;
create unique index guardians_org_document_key on public.guardians (organization_id, document_type, document_number)
  where document_number is not null;
create index guardians_profile_idx on public.guardians (profile_id) where profile_id is not null;
create index guardians_created_by_idx on public.guardians (created_by);
comment on table public.guardians is
  'ADR-005 guardian person record (org-scoped, may exist before login). Guardians never read other guardians.';
create trigger guardians_set_updated_at before update on public.guardians
  for each row execute function app.set_updated_at();

-- patient_guardians -------------------------------------------------------------
create table public.patient_guardians (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  patient_id uuid not null,
  guardian_id uuid not null,
  relationship public.guardian_relationship not null,
  is_legal_representative boolean not null default false,
  legal_basis public.legal_representation_basis null,
  -- FK to file_objects (organization_id, id) arrives with the storage workstream (Phase 3).
  legal_basis_file_id uuid null,
  legal_basis_verified_by_membership_id uuid null,
  legal_basis_verified_at timestamptz null,
  is_primary_contact boolean not null default false,
  status public.relationship_status not null default 'pending_verification',
  suspension_reason public.relationship_suspension_reason null,
  valid_from date not null default current_date,
  valid_until date null,
  verified_by uuid null references public.profiles (id) on delete restrict,
  verified_at timestamptz null,
  verification_note text null check (char_length(verification_note) between 1 and 1000),
  revoked_by uuid null references public.profiles (id) on delete restrict,
  revoked_at timestamptz null,
  revoke_reason text null check (char_length(btrim(revoke_reason)) between 3 and 500),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_guardians_patient_guardian_key unique (patient_id, guardian_id),
  constraint patient_guardians_org_id_key unique (organization_id, id),
  constraint patient_guardians_patient_fkey foreign key (organization_id, patient_id)
    references public.patients (organization_id, id) on delete restrict,
  constraint patient_guardians_guardian_fkey foreign key (organization_id, guardian_id)
    references public.guardians (organization_id, id) on delete restrict,
  constraint patient_guardians_verifier_fkey foreign key (organization_id, legal_basis_verified_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint patient_guardians_validity check (valid_until is null or valid_until >= valid_from),
  constraint patient_guardians_active_verified check (status <> 'active' or verified_at is not null),
  constraint patient_guardians_legal_basis check (not is_legal_representative or legal_basis is not null),
  constraint patient_guardians_legal_verified check (
    legal_basis_verified_at is null or (is_legal_representative and legal_basis is not null)
  ),
  constraint patient_guardians_suspension check ((status = 'suspended') = (suspension_reason is not null)),
  constraint patient_guardians_revoked check (
    (status = 'revoked') = (revoked_at is not null) and (revoked_at is null) = (revoke_reason is null)
  )
);
create unique index patient_guardians_one_primary_contact on public.patient_guardians (patient_id)
  where is_primary_contact and status = 'active';
create index patient_guardians_guardian_idx on public.patient_guardians (organization_id, guardian_id, patient_id)
  where status = 'active';
create index patient_guardians_org_patient_idx on public.patient_guardians (organization_id, patient_id);
create index patient_guardians_org_guardian_all_idx on public.patient_guardians (organization_id, guardian_id);
create index patient_guardians_verifier_idx on public.patient_guardians (organization_id, legal_basis_verified_by_membership_id);
create index patient_guardians_verified_by_idx on public.patient_guardians (verified_by);
create index patient_guardians_revoked_by_idx on public.patient_guardians (revoked_by);
create index patient_guardians_created_by_idx on public.patient_guardians (created_by);
comment on table public.patient_guardians is
  'Relationship scoping all guardian access (ADR-005, §8). Transitions enforced by app.guard_patient_guardian.';
create trigger patient_guardians_set_updated_at before update on public.patient_guardians
  for each row execute function app.set_updated_at();

-- patient_guardian_caveats [split] (GRD-08) ---------------------------------------
create table public.patient_guardian_caveats (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  patient_guardian_id uuid not null,
  caveat text not null check (char_length(btrim(caveat)) between 3 and 1000),
  restrict_schedule boolean not null default false,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz null,
  ended_by_membership_id uuid null,
  constraint patient_guardian_caveats_org_id_key unique (organization_id, id),
  constraint patient_guardian_caveats_pg_fkey foreign key (organization_id, patient_guardian_id)
    references public.patient_guardians (organization_id, id) on delete restrict,
  constraint patient_guardian_caveats_creator_fkey foreign key (organization_id, created_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint patient_guardian_caveats_ender_fkey foreign key (organization_id, ended_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint patient_guardian_caveats_end_consistent check ((ended_at is null) = (ended_by_membership_id is null))
);
create unique index patient_guardian_caveats_one_active on public.patient_guardian_caveats (patient_guardian_id)
  where ended_at is null;
create index patient_guardian_caveats_org_pg_idx on public.patient_guardian_caveats (organization_id, patient_guardian_id);
create index patient_guardian_caveats_creator_idx on public.patient_guardian_caveats (organization_id, created_by_membership_id);
create index patient_guardian_caveats_ender_idx on public.patient_guardian_caveats (organization_id, ended_by_membership_id);
comment on table public.patient_guardian_caveats is 'GRD-08 safety caveat. Care team only; never visible to guardians or patients.';

-- patient_guardian_permissions ----------------------------------------------------
create table public.patient_guardian_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  patient_guardian_id uuid not null,
  permission public.guardian_permission not null,
  granted_by uuid not null references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_by uuid null references public.profiles (id) on delete restrict,
  revoked_at timestamptz null,
  constraint patient_guardian_permissions_org_id_key unique (organization_id, id),
  constraint patient_guardian_permissions_pg_fkey foreign key (organization_id, patient_guardian_id)
    references public.patient_guardians (organization_id, id) on delete restrict,
  constraint patient_guardian_permissions_revoked_consistent check ((revoked_at is null) = (revoked_by is null))
);
create unique index patient_guardian_permissions_active_key
  on public.patient_guardian_permissions (patient_guardian_id, permission) where revoked_at is null;
create index patient_guardian_permissions_org_pg_idx
  on public.patient_guardian_permissions (organization_id, patient_guardian_id) where revoked_at is null;
create index patient_guardian_permissions_pg_all_idx
  on public.patient_guardian_permissions (organization_id, patient_guardian_id);
create index patient_guardian_permissions_granted_by_idx on public.patient_guardian_permissions (granted_by);
create index patient_guardian_permissions_revoked_by_idx on public.patient_guardian_permissions (revoked_by);
comment on table public.patient_guardian_permissions is
  'Granular, revocable guardian grants (GRD-04). Default off. Never updated except one-time revoked_*; re-grant = new row.';

-- audit_logs.patient_id ("who accessed this patient", care-team audit view) ----------
alter table public.audit_logs add column patient_id uuid null;
create index audit_logs_org_patient_time_idx on public.audit_logs (organization_id, patient_id, occurred_at desc)
  where patient_id is not null;

-- -----------------------------------------------------------------------------
-- 4. Helpers (definer helpers are owned by app_definer, section 9)
-- -----------------------------------------------------------------------------

-- Caller is an active, aal2 psychologist with an ACTIVE care-team row (org active|read_only).
create function app.is_on_care_team(p_org uuid, p_patient uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.is_aal2()) and exists (
    select 1
    from public.care_team_members c
    join public.memberships m on m.organization_id = c.organization_id and m.id = c.membership_id
    join public.organizations o on o.id = c.organization_id
    join public.membership_roles r on r.organization_id = m.organization_id and r.membership_id = m.id
                                  and r.role = 'psychologist'
    where c.organization_id = p_org and c.patient_id = p_patient
      and m.profile_id = (select app.request_uid()) and m.status = 'active'
      and o.status in ('active', 'read_only')
      and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now())
  )
$$;
comment on function app.is_on_care_team(uuid, uuid) is
  'ADR-016: aal2 + active psychologist membership + active care_team_members row. Phase 3 clinical helpers build on it.';

create function app.is_primary_on_care_team(p_org uuid, p_patient uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.is_aal2()) and exists (
    select 1
    from public.care_team_members c
    join public.memberships m on m.organization_id = c.organization_id and m.id = c.membership_id
    join public.organizations o on o.id = c.organization_id
    join public.membership_roles r on r.organization_id = m.organization_id and r.membership_id = m.id
                                  and r.role = 'psychologist'
    where c.organization_id = p_org and c.patient_id = p_patient and c.care_role = 'primary'
      and m.profile_id = (select app.request_uid()) and m.status = 'active'
      and o.status in ('active', 'read_only')
      and c.starts_at <= now() and (c.ends_at is null or c.ends_at > now())
  )
$$;

-- Writes additionally need an active org (read_only orgs are read-only).
create function app.can_manage_patient(p_org uuid, p_patient uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select app.is_on_care_team(p_org, p_patient) and app.org_allows(p_org, 'staff_write')
$$;

create function app.can_assign_care_team(p_org uuid, p_patient uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select app.org_allows(p_org, 'staff_write')
     and (app.has_org_role(p_org, 'organization_owner') or app.is_primary_on_care_team(p_org, p_patient))
$$;

-- Patient self-access (F-20 status table, app.patient_portal_status_allows). No aal2 (Q-07).
create function app.is_patient_self(p_org uuid, p_patient uuid, p_need text default 'onboarding') returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.patients p
    join public.organizations o on o.id = p.organization_id
    where p.organization_id = p_org and p.id = p_patient
      and p.profile_id = (select app.request_uid())
      and o.status = 'active'
      and app.patient_portal_status_allows(p.status, p_need)
  )
$$;

-- Guardian access (DATABASE.md §8): guardian active ∧ relationship active, verified, within
-- validity ∧ unrevoked permission ∧ patient IS A MINOR (fail closed, F-08) ∧ patient status
-- allows the portal ∧ org active. No aal2 (Q-07).
create function app.guardian_can(p_org uuid, p_patient uuid, p_permission public.guardian_permission)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.guardians g
    join public.patient_guardians pg on pg.organization_id = g.organization_id and pg.guardian_id = g.id
    join public.patient_guardian_permissions pp on pp.organization_id = pg.organization_id
                                               and pp.patient_guardian_id = pg.id
                                               and pp.revoked_at is null
                                               and pp.permission = p_permission
    join public.patients p on p.organization_id = pg.organization_id and p.id = pg.patient_id
    join public.organizations o on o.id = g.organization_id
    where g.organization_id = p_org and pg.patient_id = p_patient
      and g.profile_id = (select app.request_uid()) and g.status = 'active'
      and o.status = 'active'
      and pg.status = 'active' and pg.verified_at is not null
      and current_date >= pg.valid_from and (pg.valid_until is null or current_date <= pg.valid_until)
      and app.is_minor(p.date_of_birth, o.country_code) is true
      and app.patient_portal_status_allows(
            p.status, case when p_permission = 'sign_consents' then 'sign' else 'portal' end)
  )
$$;

-- Effective relationship without a specific permission (consents the guardian signed).
create function app.is_active_guardian_of(p_org uuid, p_patient uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.guardians g
    join public.patient_guardians pg on pg.organization_id = g.organization_id and pg.guardian_id = g.id
    join public.patients p on p.organization_id = pg.organization_id and p.id = pg.patient_id
    join public.organizations o on o.id = g.organization_id
    where g.organization_id = p_org and pg.patient_id = p_patient
      and g.profile_id = (select app.request_uid()) and g.status = 'active'
      and o.status = 'active'
      and pg.status = 'active' and pg.verified_at is not null
      and current_date >= pg.valid_from and (pg.valid_until is null or current_date <= pg.valid_until)
      and app.is_minor(p.date_of_birth, o.country_code) is true
      and app.patient_portal_status_allows(p.status, 'onboarding')
  )
$$;

create function app.is_my_guardian_record(p_org uuid, p_guardian uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.guardians g
    join public.organizations o on o.id = g.organization_id
    where g.organization_id = p_org and g.id = p_guardian
      and g.profile_id = (select app.request_uid()) and g.status = 'active' and o.status = 'active'
  )
$$;

-- Guardian reads OWN relationships (pending: "awaiting verification", GRD-06). Revoked: hidden.
create function app.is_my_relationship(p_org uuid, p_patient_guardian uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.patient_guardians pg
    join public.guardians g on g.organization_id = pg.organization_id and g.id = pg.guardian_id
    join public.organizations o on o.id = pg.organization_id
    where pg.organization_id = p_org and pg.id = p_patient_guardian
      and g.profile_id = (select app.request_uid()) and g.status = 'active' and o.status = 'active'
      and pg.status in ('pending_verification', 'active', 'suspended')
  )
$$;

-- Care team of ANY patient linked to the guardian (any relationship state, for history).
create function app.can_manage_guardian(p_org uuid, p_guardian uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.patient_guardians pg
    where pg.organization_id = p_org and pg.guardian_id = p_guardian
      and app.is_on_care_team(p_org, pg.patient_id)
  )
$$;

create function app.can_manage_relationship(p_org uuid, p_patient_guardian uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.patient_guardians pg
    where pg.organization_id = p_org and pg.id = p_patient_guardian
      and app.is_on_care_team(p_org, pg.patient_id)
  )
$$;

-- Patient (not archived) or active guardian in an active org: portal identities of the org.
create function app.is_portal_identity(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_org and o.status = 'active'
      and (
        exists (select 1 from public.patients p
                where p.organization_id = p_org and p.profile_id = (select app.request_uid())
                  and p.status <> 'archived')
        or exists (select 1 from public.guardians g
                   where g.organization_id = p_org and g.profile_id = (select app.request_uid())
                     and g.status = 'active')
      )
  )
$$;

-- Minor flag for a patient row (null = unknown jurisdiction). Used by integrity triggers.
create function app.patient_is_minor(p_org uuid, p_patient uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_minor(p.date_of_birth, o.country_code)
  from public.patients p
  join public.organizations o on o.id = p.organization_id
  where p.organization_id = p_org and p.id = p_patient
$$;

-- Activation preconditions (PAT-02, CON-05). Phase 2 migration 20261109110000 replaces this
-- with the consent-aware version. Returns machine keys, never personal data. Care team or
-- system path only; anyone else gets null.
create function app.patient_activation_missing(p_org uuid, p_patient uuid) returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_minor boolean;
  v_missing text[] := '{}';
begin
  if (select app.request_uid()) is not null and not app.is_on_care_team(p_org, p_patient) then
    return null;
  end if;
  v_minor := app.patient_is_minor(p_org, p_patient);
  if v_minor is null then
    v_missing := array_append(v_missing, 'jurisdiction_not_configured');
  elsif v_minor and not exists (
    select 1 from public.patient_guardians pg
    where pg.organization_id = p_org and pg.patient_id = p_patient
      and pg.status = 'active' and pg.is_legal_representative and pg.legal_basis_verified_at is not null
      and current_date >= pg.valid_from and (pg.valid_until is null or current_date <= pg.valid_until)
  ) then
    v_missing := array_append(v_missing, 'legal_representative');
  end if;
  return v_missing;
end
$$;

-- Directory projection (Q-03): any aal2 staff member of the org; name + status only.
create function app.patient_directory(p_org uuid)
returns table (
  patient_id uuid,
  first_name text,
  last_name text,
  preferred_name text,
  status public.patient_status,
  on_my_care_team boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.first_name, p.last_name, p.preferred_name, p.status,
         app.is_on_care_team(p_org, p.id)
  from public.patients p
  where p.organization_id = p_org
    and (select app.is_org_member(p_org))
$$;
comment on function app.patient_directory(uuid) is
  'Q-03 (provisional): staff directory = name + status. No DOB, identifiers or contact. Psychologists off the care team: same view [NEEDS PSYCHOLOGIST INPUT].';

-- Guardian portal summary: own relationships; patient name only when effective
-- ("name only (any active perm)", SECURITY.md §4.1).
create function app.guardian_patient_summary(p_org uuid)
returns table (
  patient_guardian_id uuid,
  patient_id uuid,
  relationship public.guardian_relationship,
  relationship_status public.relationship_status,
  effective boolean,
  patient_display_name text,
  permissions public.guardian_permission[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.patient_id, m.relationship, m.status,
         (m.eff and cardinality(m.perms) > 0),
         case when m.eff and cardinality(m.perms) > 0 then m.display end,
         case when m.eff then m.perms else '{}'::public.guardian_permission[] end
  from (
    select pg.id, pg.patient_id, pg.relationship, pg.status,
           (pg.status = 'active' and pg.verified_at is not null
            and current_date >= pg.valid_from and (pg.valid_until is null or current_date <= pg.valid_until)
            and app.is_minor(p.date_of_birth, o.country_code) is true
            and app.patient_portal_status_allows(p.status, 'onboarding')) as eff,
           coalesce(p.preferred_name, p.first_name) as display,
           coalesce((select array_agg(pp.permission order by pp.permission)
                     from public.patient_guardian_permissions pp
                     where pp.organization_id = pg.organization_id and pp.patient_guardian_id = pg.id
                       and pp.revoked_at is null), '{}') as perms
    from public.guardians g
    join public.patient_guardians pg on pg.organization_id = g.organization_id and pg.guardian_id = g.id
    join public.patients p on p.organization_id = pg.organization_id and p.id = pg.patient_id
    join public.organizations o on o.id = g.organization_id
    where g.organization_id = p_org and g.profile_id = (select app.request_uid())
      and g.status = 'active' and o.status = 'active'
      and pg.status in ('pending_verification', 'active', 'suspended')
  ) as m
$$;

-- GRD-07 privacy view for the patient: what each ACTIVE guardian can see (live permissions).
create function app.patient_privacy_view(p_org uuid, p_patient uuid)
returns table (
  patient_guardian_id uuid,
  guardian_first_name text,
  relationship public.guardian_relationship,
  permissions public.guardian_permission[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select pg.id, g.first_name, pg.relationship,
         coalesce((select array_agg(pp.permission order by pp.permission)
                   from public.patient_guardian_permissions pp
                   where pp.organization_id = pg.organization_id and pp.patient_guardian_id = pg.id
                     and pp.revoked_at is null), '{}')
  from public.patient_guardians pg
  join public.guardians g on g.organization_id = pg.organization_id and g.id = pg.guardian_id
  where pg.organization_id = p_org and pg.patient_id = p_patient
    and pg.status = 'active' and g.status = 'active'
    and app.is_patient_self(p_org, p_patient, 'onboarding')
$$;

-- PAT-07 duplicate warning without revealing ids or other orgs. Psychologists (aal2) only.
create function app.find_patient_duplicates(
  p_org uuid,
  p_first_name text,
  p_last_name text,
  p_date_of_birth date,
  p_document_type public.document_type,
  p_document_number text
) returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case when not app.can_write_as_role(p_org, 'psychologist') then null else
    array_remove(array[
      case when p_document_number is not null and exists (
        select 1 from public.patients p
        where p.organization_id = p_org and p.document_type = p_document_type
          and p.document_number = p_document_number) then 'document' end,
      case when exists (
        select 1 from public.patients p
        where p.organization_id = p_org and p.date_of_birth = p_date_of_birth
          and lower(btrim(p.first_name)) = lower(btrim(p_first_name))
          and lower(btrim(p.last_name)) = lower(btrim(p_last_name))) then 'name_dob' end
    ], null)
  end
$$;

-- -----------------------------------------------------------------------------
-- 5. Atomic creation functions (ADR-018: definer because the creator has no row access to a
--    patient/guardian until the care-team / relationship row exists).
-- -----------------------------------------------------------------------------
create function app.create_patient(
  p_org uuid,
  p_first_name text,
  p_last_name text,
  p_preferred_name text,
  p_date_of_birth date,
  p_document_type public.document_type,
  p_document_number text,
  p_email text,
  p_phone text,
  p_preferred_locale text,
  p_request_id text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_membership uuid := app.my_membership_id(p_org);
  v_patient uuid := pg_catalog.gen_random_uuid();
  v_country char(2);
begin
  if v_actor is null or v_membership is null or not app.can_write_as_role(p_org, 'psychologist') then
    raise exception using errcode = '42501', message = 'FORBIDDEN:patient.create';
  end if;
  select o.country_code into v_country from public.organizations o where o.id = p_org;

  insert into public.patients (id, organization_id, first_name, last_name, preferred_name, date_of_birth,
                               document_type, document_number, email, phone, preferred_locale, status, created_by)
  values (v_patient, p_org, btrim(p_first_name), btrim(p_last_name), nullif(btrim(p_preferred_name), ''),
          p_date_of_birth, p_document_type, nullif(btrim(p_document_number), ''), nullif(btrim(p_email), ''),
          nullif(btrim(p_phone), ''), p_preferred_locale, 'intake', v_actor);

  insert into public.care_team_members (organization_id, patient_id, membership_id, care_role, assigned_by)
  values (p_org, v_patient, v_membership, 'primary', v_actor);

  insert into public.patient_preferences (organization_id, patient_id, portal_mode, locale)
  values (p_org, v_patient, app.suggest_portal_mode(p_date_of_birth, v_country), p_preferred_locale);

  perform app.insert_audit_row(
    'patient.created', 'user', 'user', v_actor, array['psychologist'], p_org, 'patient', v_patient,
    jsonb_build_object('patient_id', v_patient, 'care_team_membership_id', v_membership,
                       'is_minor', app.is_minor(p_date_of_birth, v_country)),
    p_request_id, null, null);
  return v_patient;
end
$$;

create function app.create_guardian(
  p_org uuid,
  p_patient uuid,
  p_first_name text,
  p_last_name text,
  p_document_type public.document_type,
  p_document_number text,
  p_email text,
  p_phone text,
  p_relationship public.guardian_relationship,
  p_is_legal_representative boolean,
  p_legal_basis public.legal_representation_basis,
  p_is_primary_contact boolean,
  p_request_id text
) returns table (guardian_id uuid, patient_guardian_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor uuid := (select app.request_uid());
  v_guardian uuid := pg_catalog.gen_random_uuid();
  v_link uuid := pg_catalog.gen_random_uuid();
begin
  if v_actor is null or not app.can_manage_patient(p_org, p_patient) then
    raise exception using errcode = '42501', message = 'FORBIDDEN:guardian.manage';
  end if;
  insert into public.guardians (id, organization_id, first_name, last_name, document_type, document_number,
                                email, phone, created_by)
  values (v_guardian, p_org, btrim(p_first_name), btrim(p_last_name), p_document_type,
          nullif(btrim(p_document_number), ''), nullif(btrim(p_email), ''), nullif(btrim(p_phone), ''), v_actor);
  insert into public.patient_guardians (id, organization_id, patient_id, guardian_id, relationship,
                                        is_legal_representative, legal_basis, is_primary_contact, created_by)
  values (v_link, p_org, p_patient, v_guardian, p_relationship, p_is_legal_representative,
          p_legal_basis, p_is_primary_contact, v_actor);

  perform app.insert_audit_row('guardian.created', 'user', 'user', v_actor, array['psychologist'], p_org,
    'guardian', v_guardian, jsonb_build_object('patient_id', p_patient, 'guardian_id', v_guardian), p_request_id, null, null);
  perform app.insert_audit_row('patient_guardian.created', 'user', 'user', v_actor, array['psychologist'], p_org,
    'patient_guardian', v_link,
    jsonb_build_object('patient_id', p_patient, 'guardian_id', v_guardian, 'patient_guardian_id', v_link,
                       'relationship', p_relationship, 'is_legal_representative', p_is_legal_representative),
    p_request_id, null, null);
  guardian_id := v_guardian;
  patient_guardian_id := v_link;
  return next;
end
$$;

-- -----------------------------------------------------------------------------
-- 6. Integrity triggers (F-10). Invoker unless noted; they run in the caller's context.
-- -----------------------------------------------------------------------------

-- A profile may not be staff and patient/guardian in the same org (F-21).
create function app.profile_is_staff_of(p_org uuid, p_profile uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.memberships m
                 where m.organization_id = p_org and m.profile_id = p_profile and m.status <> 'removed')
$$;

create function app.guard_patient() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_missing text[];
begin
  if new.date_of_birth > current_date then
    raise exception using errcode = '23514', message = 'patients_date_of_birth_future';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_actor, new.created_by);
    if v_actor is not null then
      -- User inserts (via app.create_patient) always start in intake. The system/seed path
      -- (no claims) may import a status; it has no user-reachable entry point.
      new.status := 'intake';
      new.archived_at := null;
      new.profile_id := null;
    end if;
    new.status_changed_at := now();
    if new.profile_id is not null and app.profile_is_staff_of(new.organization_id, new.profile_id) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:staff_cannot_be_patient';
    end if;
    return new;
  end if;

  new.organization_id := old.organization_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if new.profile_id is distinct from old.profile_id then
    if v_actor is not null then
      raise exception using errcode = 'P0001', message = 'IMMUTABLE:patients.profile_id';
    end if;
    if new.profile_id is not null and app.profile_is_staff_of(new.organization_id, new.profile_id) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:staff_cannot_be_patient';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'intake' and new.status in ('active', 'archived'))
      or (old.status = 'active' and new.status in ('paused', 'discharged'))
      or (old.status = 'paused' and new.status in ('active', 'discharged'))
      or (old.status = 'discharged' and new.status in ('active', 'archived'))
    ) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:invalid_status_transition';
    end if;
    if new.status = 'active' then
      v_missing := app.patient_activation_missing(new.organization_id, new.id);
      if v_missing is null or cardinality(v_missing) > 0 then
        raise exception using errcode = 'P0001', message = 'PRECONDITION:activation_requirements_missing';
      end if;
    end if;
    new.status_changed_at := now();
    new.archived_at := case when new.status = 'archived' then now() else null end;
  elsif old.status in ('discharged', 'archived')
        and row(new.first_name, new.last_name, new.preferred_name, new.pronouns, new.date_of_birth,
                new.document_type, new.document_number, new.email, new.phone, new.sex, new.gender_identity,
                new.preferred_locale, new.emergency_contact_name, new.emergency_contact_phone)
            is distinct from
            row(old.first_name, old.last_name, old.preferred_name, old.pronouns, old.date_of_birth,
                old.document_type, old.document_number, old.email, old.phone, old.sex, old.gender_identity,
                old.preferred_locale, old.emergency_contact_name, old.emergency_contact_phone)
        and v_actor is not null then
    -- PAT-05: discharged/archived records are read-only (DSR rectification path: Phase 3)
    -- [NEEDS LEGAL VERIFICATION].
    raise exception using errcode = 'P0001', message = 'PRECONDITION:patient_read_only';
  else
    new.status_changed_at := old.status_changed_at;
    new.archived_at := old.archived_at;
  end if;
  return new;
end
$$;
create trigger patients_guard before insert or update on public.patients
  for each row execute function app.guard_patient();
create trigger patients_no_delete before delete on public.patients
  for each row execute function app.reject_mutation();

-- patient_preferences: only the care team changes portal_mode (PAT-03).
create function app.guard_patient_preferences() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.organization_id := old.organization_id;
  new.patient_id := old.patient_id;
  if new.portal_mode is distinct from old.portal_mode then
    if not app.can_manage_patient(old.organization_id, old.patient_id) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:portal_mode_care_team_only';
    end if;
    new.portal_mode_set_by := (select app.request_uid());
  else
    new.portal_mode_set_by := old.portal_mode_set_by;
  end if;
  return new;
end
$$;
create trigger patient_preferences_guard before update on public.patient_preferences
  for each row execute function app.guard_patient_preferences();
create trigger patient_preferences_no_delete before delete on public.patient_preferences
  for each row execute function app.reject_mutation();

-- care_team_members: psychologist role required; F-06 self-assignment rule; end-only updates.
create function app.guard_care_team_member() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_other_primary boolean;
begin
  if tg_op = 'INSERT' then
    new.assigned_by := coalesce(v_actor, new.assigned_by);
    if v_actor is not null then
      new.starts_at := now();
    end if;
    new.ends_at := null;
    new.ended_by := null;
    new.end_reason := null;
    if not exists (
      select 1 from public.memberships m
      join public.membership_roles r on r.organization_id = m.organization_id and r.membership_id = m.id
      where m.organization_id = new.organization_id and m.id = new.membership_id
        and m.status = 'active' and r.role = 'psychologist'
    ) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:care_team_requires_psychologist';
    end if;
    if v_actor is not null and new.membership_id = app.my_membership_id(new.organization_id) then
      select exists (
        select 1 from public.care_team_members c
        where c.organization_id = new.organization_id and c.patient_id = new.patient_id
          and c.care_role = 'primary' and c.ends_at is null and c.membership_id <> new.membership_id
      ) into v_other_primary;
      if v_other_primary then
        if new.assignment_reason is null then
          raise exception using errcode = 'P0001', message = 'PRECONDITION:self_assignment_reason_required';
        end if;
        perform app.write_audit('care_team.self_assigned', new.organization_id, 'care_team_member', new.id,
          jsonb_build_object('patient_id', new.patient_id, 'membership_id', new.membership_id,
                             'care_role', new.care_role), null);
        -- TODO(notifications): notify the primary psychologist (F-06); acknowledgement before
        -- access starts is [NEEDS PSYCHOLOGIST INPUT] (default proposal: required).
      end if;
    end if;
    return new;
  end if;

  if old.ends_at is not null then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:care_team_members';
  end if;
  new.organization_id := old.organization_id;
  new.patient_id := old.patient_id;
  new.membership_id := old.membership_id;
  new.care_role := old.care_role;
  new.starts_at := old.starts_at;
  new.assigned_by := old.assigned_by;
  new.assignment_reason := old.assignment_reason;
  if new.ends_at is not null then
    if new.end_reason is null then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:end_reason_required';
    end if;
    new.ends_at := now();
    new.ended_by := coalesce(v_actor, new.ended_by);
  else
    new.ended_by := null;
    new.end_reason := null;
  end if;
  return new;
end
$$;
create trigger care_team_members_guard before insert or update on public.care_team_members
  for each row execute function app.guard_care_team_member();
create trigger care_team_members_no_delete before delete on public.care_team_members
  for each row execute function app.reject_mutation();

-- guardians: tenant/creator immutable; login link only on the system path; F-21.
create function app.guard_guardian() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_actor, new.created_by);
    if v_actor is not null then
      new.profile_id := null;
    end if;
  else
    new.organization_id := old.organization_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.profile_id is distinct from old.profile_id and v_actor is not null then
      raise exception using errcode = 'P0001', message = 'IMMUTABLE:guardians.profile_id';
    end if;
  end if;
  if new.profile_id is not null and (tg_op = 'INSERT' or new.profile_id is distinct from old.profile_id)
     and app.profile_is_staff_of(new.organization_id, new.profile_id) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:staff_cannot_be_guardian';
  end if;
  return new;
end
$$;
create trigger guardians_guard before insert or update on public.guardians
  for each row execute function app.guard_guardian();
create trigger guardians_no_delete before delete on public.guardians
  for each row execute function app.reject_mutation();

-- patient_guardians: state machine (GRD-02/03/05, F-08, F-12).
create function app.guard_patient_guardian() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_minor boolean;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_actor, new.created_by);
    if v_actor is not null then
      -- User inserts always start unverified (GRD-06, SECURITY.md §3.8 rule 6). The system/seed
      -- path (no claims) may import verified state.
      new.status := 'pending_verification';
      new.suspension_reason := null;
      new.verified_by := null;
      new.verified_at := null;
      new.legal_basis_verified_by_membership_id := null;
      new.legal_basis_verified_at := null;
      new.revoked_by := null;
      new.revoked_at := null;
      new.revoke_reason := null;
      v_minor := app.patient_is_minor(new.organization_id, new.patient_id);
      if v_minor is not true then
        raise exception using errcode = 'P0001', message = 'PRECONDITION:patient_not_minor';
      end if;
    end if;
    return new;
  end if;

  if old.status = 'revoked' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:patient_guardians';
  end if;
  new.organization_id := old.organization_id;
  new.patient_id := old.patient_id;
  new.guardian_id := old.guardian_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.verified_by := old.verified_by;
  new.verified_at := old.verified_at;
  new.revoked_by := old.revoked_by;
  new.revoked_at := old.revoked_at;

  -- Legal basis: changing it voids a previous verification; verifying stamps actor + time.
  if row(new.is_legal_representative, new.legal_basis, new.legal_basis_file_id)
     is distinct from row(old.is_legal_representative, old.legal_basis, old.legal_basis_file_id)
     and new.legal_basis_verified_at is not distinct from old.legal_basis_verified_at then
    new.legal_basis_verified_at := null;
    new.legal_basis_verified_by_membership_id := null;
  elsif new.legal_basis_verified_at is distinct from old.legal_basis_verified_at then
    if new.legal_basis_verified_at is null then
      new.legal_basis_verified_by_membership_id := null;
    else
      new.legal_basis_verified_at := now();
      new.legal_basis_verified_by_membership_id :=
        coalesce(app.my_membership_id(new.organization_id), new.legal_basis_verified_by_membership_id);
    end if;
  else
    new.legal_basis_verified_by_membership_id := old.legal_basis_verified_by_membership_id;
  end if;

  if new.status is distinct from old.status then
    if old.status = 'pending_verification' and new.status = 'active' then
      if app.patient_is_minor(new.organization_id, new.patient_id) is not true then
        raise exception using errcode = 'P0001', message = 'PRECONDITION:patient_not_minor';
      end if;
      new.verified_at := now();
      new.verified_by := coalesce(v_actor, old.verified_by);
      new.suspension_reason := null;
    elsif old.status in ('pending_verification', 'active') and new.status = 'suspended' then
      if new.suspension_reason is null then
        raise exception using errcode = 'P0001', message = 'PRECONDITION:suspension_reason_required';
      end if;
    elsif old.status = 'suspended' and new.status = 'active' then
      -- Reactivation after majority is not supported: app.guardian_can denies adults anyway,
      -- and the adult patient's own decision is a Phase 3+ workflow [NEEDS LEGAL VERIFICATION].
      if old.suspension_reason = 'age_of_majority' then
        raise exception using errcode = 'P0001', message = 'PRECONDITION:majority_reactivation_not_supported';
      end if;
      if old.verified_at is null then
        raise exception using errcode = 'P0001', message = 'PRECONDITION:relationship_not_verified';
      end if;
      if app.patient_is_minor(new.organization_id, new.patient_id) is not true then
        raise exception using errcode = 'P0001', message = 'PRECONDITION:patient_not_minor';
      end if;
      new.suspension_reason := null;
    elsif new.status = 'revoked' then
      if new.revoke_reason is null then
        raise exception using errcode = 'P0001', message = 'PRECONDITION:revoke_reason_required';
      end if;
      new.revoked_at := now();
      new.revoked_by := v_actor;
      new.suspension_reason := null;
      new.is_primary_contact := false;
      -- Revoke every active grant in the same transaction (GRD-05, SECURITY.md §5.4).
      update public.patient_guardian_permissions
         set revoked_at = now()
       where organization_id = new.organization_id and patient_guardian_id = new.id and revoked_at is null;
    else
      raise exception using errcode = 'P0001', message = 'PRECONDITION:invalid_relationship_transition';
    end if;
  else
    new.suspension_reason := old.suspension_reason;
    if new.revoke_reason is distinct from old.revoke_reason then
      new.revoke_reason := old.revoke_reason;
    end if;
  end if;
  return new;
end
$$;
create trigger patient_guardians_guard before insert or update on public.patient_guardians
  for each row execute function app.guard_patient_guardian();
create trigger patient_guardians_no_delete before delete on public.patient_guardians
  for each row execute function app.reject_mutation();

-- patient_guardian_caveats: creator stamped; only ending afterwards.
create function app.guard_guardian_caveat() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by_membership_id := coalesce(app.my_membership_id(new.organization_id), new.created_by_membership_id);
    new.created_at := now();
    new.ended_at := null;
    new.ended_by_membership_id := null;
    return new;
  end if;
  if old.ended_at is not null
     or row(new.organization_id, new.patient_guardian_id, new.caveat, new.restrict_schedule,
            new.created_by_membership_id, new.created_at)
        is distinct from row(old.organization_id, old.patient_guardian_id, old.caveat, old.restrict_schedule,
            old.created_by_membership_id, old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:patient_guardian_caveats';
  end if;
  if new.ended_at is not null then
    new.ended_at := now();
    new.ended_by_membership_id := coalesce(app.my_membership_id(new.organization_id), new.ended_by_membership_id);
  end if;
  return new;
end
$$;
create trigger patient_guardian_caveats_guard before insert or update on public.patient_guardian_caveats
  for each row execute function app.guard_guardian_caveat();
create trigger patient_guardian_caveats_no_delete before delete on public.patient_guardian_caveats
  for each row execute function app.reject_mutation();

-- patient_guardian_permissions: grant only on pending/active relationships; caveat blocks
-- view_session_schedule (GRD-08); revoke is one-time.
create function app.guard_guardian_permission() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_status public.relationship_status;
begin
  if tg_op = 'INSERT' then
    new.granted_by := coalesce(v_actor, new.granted_by);
    if v_actor is not null then
      new.granted_at := now();
    end if;
    new.revoked_at := null;
    new.revoked_by := null;
    select pg.status into v_status from public.patient_guardians pg
    where pg.organization_id = new.organization_id and pg.id = new.patient_guardian_id;
    if v_status is null or v_status not in ('pending_verification', 'active') then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:relationship_not_grantable';
    end if;
    if new.permission = 'view_session_schedule' and exists (
      select 1 from public.patient_guardian_caveats c
      where c.organization_id = new.organization_id and c.patient_guardian_id = new.patient_guardian_id
        and c.ended_at is null and c.restrict_schedule
    ) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:schedule_restricted_by_caveat';
    end if;
    return new;
  end if;
  if old.revoked_at is not null
     or row(new.organization_id, new.patient_guardian_id, new.permission, new.granted_by, new.granted_at)
        is distinct from row(old.organization_id, old.patient_guardian_id, old.permission, old.granted_by, old.granted_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:patient_guardian_permissions';
  end if;
  if new.revoked_at is not null then
    new.revoked_at := now();
    new.revoked_by := coalesce(v_actor, new.revoked_by, old.granted_by);
  end if;
  return new;
end
$$;
create trigger patient_guardian_permissions_guard before insert or update on public.patient_guardian_permissions
  for each row execute function app.guard_guardian_permission();
create trigger patient_guardian_permissions_no_delete before delete on public.patient_guardian_permissions
  for each row execute function app.reject_mutation();

-- Atomic permission diff + audit (ADR-018; invoker: RLS applies).
create function app.set_guardian_permissions(
  p_org uuid,
  p_patient_guardian uuid,
  p_permissions public.guardian_permission[],
  p_request_id text default null
) returns table (granted public.guardian_permission[], revoked public.guardian_permission[])
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_before public.guardian_permission[];
  v_after public.guardian_permission[];
  v_add public.guardian_permission[];
  v_remove public.guardian_permission[];
  v_patient uuid;
  v_mode public.portal_mode;
begin
  if not (app.can_manage_relationship(p_org, p_patient_guardian) and app.org_allows(p_org, 'staff_write')) then
    raise exception using errcode = '42501', message = 'FORBIDDEN:guardian.permissions.manage';
  end if;
  select pg.patient_id into v_patient from public.patient_guardians pg
  where pg.organization_id = p_org and pg.id = p_patient_guardian
  for update;
  select coalesce(array_agg(pp.permission order by pp.permission), '{}') into v_before
  from public.patient_guardian_permissions pp
  where pp.organization_id = p_org and pp.patient_guardian_id = p_patient_guardian and pp.revoked_at is null;
  select coalesce(array_agg(distinct x order by x), '{}') into v_after from unnest(coalesce(p_permissions, '{}')) x;
  select coalesce(array_agg(x order by x), '{}') into v_add from unnest(v_after) x where not (x = any (v_before));
  select coalesce(array_agg(x order by x), '{}') into v_remove from unnest(v_before) x where not (x = any (v_after));

  update public.patient_guardian_permissions pp set revoked_at = now()
  where pp.organization_id = p_org and pp.patient_guardian_id = p_patient_guardian
    and pp.revoked_at is null and pp.permission = any (v_remove);
  insert into public.patient_guardian_permissions (organization_id, patient_guardian_id, permission)
  select p_org, p_patient_guardian, x from unnest(v_add) x;

  select pp.portal_mode into v_mode from public.patient_preferences pp
  where pp.organization_id = p_org and pp.patient_id = v_patient;
  if cardinality(v_add) > 0 then
    perform app.write_audit('guardian_permission.granted', p_org, 'patient_guardian', p_patient_guardian,
      jsonb_build_object('patient_id', v_patient, 'patient_guardian_id', p_patient_guardian,
                         'permissions', to_jsonb(v_add), 'before', to_jsonb(v_before), 'after', to_jsonb(v_after),
                         -- SECURITY.md §5.3: enabling view_responses for an adolescent is flagged.
                         'adolescent_view_responses', (v_mode = 'adolescent' and 'view_responses' = any (v_add))),
      p_request_id);
  end if;
  if cardinality(v_remove) > 0 then
    perform app.write_audit('guardian_permission.revoked', p_org, 'patient_guardian', p_patient_guardian,
      jsonb_build_object('patient_id', v_patient, 'patient_guardian_id', p_patient_guardian,
                         'permissions', to_jsonb(v_remove), 'before', to_jsonb(v_before), 'after', to_jsonb(v_after)),
      p_request_id);
  end if;
  granted := v_add;
  revoked := v_remove;
  return next;
end
$$;

-- Age-of-majority job (F-08, PAT-06). System path only (app_server, no claims). Idempotent.
create function app.suspend_guardians_at_majority(p_request_id text default null) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  if (select app.request_uid()) is not null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:system_function_in_user_context';
  end if;
  for v_row in
    select pg.id, pg.organization_id, pg.patient_id
    from public.patient_guardians pg
    join public.patients p on p.organization_id = pg.organization_id and p.id = pg.patient_id
    join public.organizations o on o.id = pg.organization_id
    where pg.status in ('active', 'pending_verification')
      and app.is_minor(p.date_of_birth, o.country_code) is false
  loop
    update public.patient_guardians
       set status = 'suspended', suspension_reason = 'age_of_majority'
     where id = v_row.id and status in ('active', 'pending_verification');
    continue when not found;
    perform app.insert_audit_row('patient_guardian.suspended', 'system', 'system', null, '{}', v_row.organization_id,
      'patient_guardian', v_row.id,
      jsonb_build_object('patient_id', v_row.patient_id, 'patient_guardian_id', v_row.id,
                         'suspension', 'age_of_majority'), p_request_id, null, null);
    v_count := v_count + 1;
  end loop;
  -- TODO(notifications/tasks): care-team task 60 days before majority (PAT-06) — the DTO
  -- exposes majority_date so the UI can show the task until the jobs workstream exists.
  return v_count;
end
$$;

-- -----------------------------------------------------------------------------
-- 7. Audit: categories, events, patient_id, portal writers
-- -----------------------------------------------------------------------------
alter table app.audit_event_types drop constraint audit_event_types_category_check;
alter table app.audit_event_types add constraint audit_event_types_category_check check (category in
  ('auth', 'organization', 'membership', 'invitation', 'branding', 'profile', 'platform', 'security',
   'patient', 'care_team', 'guardian', 'consent'));

insert into app.audit_event_types (event_type, category, writer, org_optional, description) values
  ('patient.created', 'patient', 'user', false, 'Patient registered (creator becomes primary care team)'),
  ('patient.updated', 'patient', 'user', false, 'Patient demographics updated (field names only)'),
  ('patient.viewed', 'patient', 'user', false, 'Patient detail viewed by the care team'),
  ('patient.list_viewed', 'patient', 'user', false, 'Care-team patient list viewed'),
  ('patient.directory_viewed', 'patient', 'user', false, 'Staff patient directory viewed (name + status)'),
  ('patient.status_changed', 'patient', 'user', false, 'Patient status changed'),
  ('patient.portal_linked', 'patient', 'system', false, 'Patient portal login linked (invitation accepted)'),
  ('patient_preferences.updated', 'patient', 'user', false, 'Patient preferences updated'),
  ('care_team.assigned', 'care_team', 'user', false, 'Care-team member assigned'),
  ('care_team.self_assigned', 'care_team', 'user', false, 'Member assigned themselves to a patient with another primary (F-06)'),
  ('care_team.ended', 'care_team', 'user', false, 'Care-team assignment ended'),
  ('guardian.created', 'guardian', 'user', false, 'Guardian person record created'),
  ('guardian.updated', 'guardian', 'user', false, 'Guardian record updated (field names only)'),
  ('guardian.portal_linked', 'guardian', 'system', false, 'Guardian portal login linked (invitation accepted)'),
  ('patient_guardian.created', 'guardian', 'user', false, 'Guardian linked to a patient (pending verification)'),
  ('patient_guardian.updated', 'guardian', 'user', false, 'Relationship details updated (field names only)'),
  ('patient_guardian.verified', 'guardian', 'user', false, 'Relationship verified / legal basis verified'),
  ('patient_guardian.suspended', 'guardian', 'both', false, 'Relationship suspended (incl. age of majority job)'),
  ('patient_guardian.reactivated', 'guardian', 'user', false, 'Relationship reactivated'),
  ('patient_guardian.revoked', 'guardian', 'user', false, 'Relationship revoked (all permissions revoked)'),
  ('guardian_caveat.set', 'guardian', 'user', false, 'Safety caveat set on a relationship (GRD-08)'),
  ('guardian_caveat.ended', 'guardian', 'user', false, 'Safety caveat ended'),
  ('guardian_permission.granted', 'guardian', 'user', false, 'Guardian permissions granted (before/after sets)'),
  ('guardian_permission.revoked', 'guardian', 'user', false, 'Guardian permissions revoked (before/after sets)');

-- insert_audit_row: same contract; additionally derives audit_logs.patient_id from
-- metadata.patient_id (a uuid) so "who accessed this patient" needs no metadata scan.
create or replace function app.insert_audit_row(
  p_event_type text,
  p_writer text,
  p_actor_type public.actor_type,
  p_actor_profile_id uuid,
  p_actor_roles text[],
  p_organization_id uuid,
  p_resource_type text,
  p_resource_id uuid,
  p_metadata jsonb,
  p_request_id text,
  p_ip inet,
  p_user_agent text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type app.audit_event_types%rowtype;
  v_id uuid := pg_catalog.gen_random_uuid();
  v_patient uuid;
begin
  select * into v_type from app.audit_event_types where event_type = p_event_type;
  if not found then
    raise exception using errcode = 'P0001', message = 'AUDIT:unknown_event';
  end if;
  if v_type.writer <> 'both' and v_type.writer <> p_writer then
    raise exception using errcode = 'P0001', message = 'AUDIT:wrong_writer';
  end if;
  if p_organization_id is null and not v_type.org_optional then
    raise exception using errcode = 'P0001', message = 'AUDIT:organization_required';
  end if;
  if not app.audit_metadata_is_safe(coalesce(p_metadata, '{}'::jsonb)) then
    raise exception using errcode = 'P0001', message = 'AUDIT:unsafe_metadata';
  end if;
  if (p_metadata ->> 'patient_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_patient := (p_metadata ->> 'patient_id')::uuid;
  end if;
  insert into public.audit_logs (
    id, organization_id, actor_profile_id, actor_type, actor_roles, event_type, resource_type,
    resource_id, request_id, ip_address, user_agent, metadata, patient_id
  ) values (
    v_id, p_organization_id, p_actor_profile_id, p_actor_type, coalesce(p_actor_roles, '{}'), p_event_type,
    p_resource_type, p_resource_id, left(p_request_id, 64), p_ip, left(p_user_agent, 512),
    coalesce(p_metadata, '{}'::jsonb), v_patient
  );
  return v_id;
end
$$;
grant insert (patient_id) on public.audit_logs to app_definer;

-- write_audit: portal identities (patient / guardian of the org) may write user rows; their
-- roles are the capacities they hold in that org. Everything else unchanged.
create or replace function app.write_audit(
  p_event_type text,
  p_organization_id uuid default null,
  p_resource_type text default null,
  p_resource_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_request_id text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_roles text[] := '{}';
  v_actor_type public.actor_type := 'user';
  v_is_platform boolean := app.is_platform_admin();
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'AUDIT:no_actor';
  end if;

  if p_organization_id is not null then
    if app.is_org_member(p_organization_id) then
      select coalesce(array_agg(r.role::text order by r.role), '{}') into v_roles
      from public.memberships m
      join public.membership_roles r on r.organization_id = m.organization_id and r.membership_id = m.id
      where m.organization_id = p_organization_id and m.profile_id = v_actor and m.status = 'active';
    elsif v_is_platform and p_event_type like 'platform\_%' then
      v_actor_type := 'platform_admin';
    elsif app.is_portal_identity(p_organization_id) then
      v_roles := array_remove(array[
        case when exists (select 1 from public.patients p where p.organization_id = p_organization_id
                          and p.profile_id = v_actor and p.status <> 'archived') then 'patient' end,
        case when exists (select 1 from public.guardians g where g.organization_id = p_organization_id
                          and g.profile_id = v_actor and g.status = 'active') then 'guardian' end
      ], null);
    else
      raise exception using errcode = 'P0001', message = 'AUDIT:organization_not_allowed';
    end if;
  end if;
  if v_is_platform then
    v_roles := array_append(v_roles, 'platform_admin');
    if p_organization_id is null then
      v_actor_type := 'platform_admin';
    end if;
  end if;

  insert into public.rate_limit_counters as c (bucket_key, window_start, count)
  values (extensions.digest('audit:' || v_actor::text, 'sha256'), v_window, 1)
  on conflict (bucket_key, window_start) do update set count = c.count + 1
  returning c.count into v_count;
  if v_count > 300 then
    raise exception using errcode = 'P0001', message = 'RATE_LIMITED:audit';
  end if;

  return app.insert_audit_row(
    p_event_type, 'user', v_actor_type, v_actor, v_roles, p_organization_id,
    p_resource_type, p_resource_id, p_metadata, p_request_id, null, null
  );
end
$$;

-- Care team reads the audit rows of its own patients (SECURITY.md §4.1 "Own patients").
create policy audit_logs_select_care_team on public.audit_logs for select to authenticated
  using (patient_id is not null and organization_id is not null
         and app.is_on_care_team(organization_id, patient_id));

-- -----------------------------------------------------------------------------
-- 8. RLS, grants, policies (authenticated)
-- -----------------------------------------------------------------------------
alter table public.patients enable row level security;
alter table public.patients force row level security;
alter table public.patient_preferences enable row level security;
alter table public.patient_preferences force row level security;
alter table public.care_team_members enable row level security;
alter table public.care_team_members force row level security;
alter table public.guardians enable row level security;
alter table public.guardians force row level security;
alter table public.patient_guardians enable row level security;
alter table public.patient_guardians force row level security;
alter table public.patient_guardian_caveats enable row level security;
alter table public.patient_guardian_caveats force row level security;
alter table public.patient_guardian_permissions enable row level security;
alter table public.patient_guardian_permissions force row level security;

revoke all on public.patients, public.patient_preferences, public.care_team_members, public.guardians,
  public.patient_guardians, public.patient_guardian_caveats, public.patient_guardian_permissions
  from public, anon, authenticated, service_role;

-- patients: care team reads/updates (all columns, DTO in the DAL); patient reads own row
-- (status allows onboarding). Owners/psychologists off the care team: NO row access (Q-03).
-- Inserts only via app.create_patient. profile_id only via invitation acceptance (system).
grant select on public.patients to authenticated;
grant update (first_name, last_name, preferred_name, pronouns, date_of_birth, document_type, document_number,
              email, phone, sex, gender_identity, preferred_locale, emergency_contact_name,
              emergency_contact_phone, status)
  on public.patients to authenticated;
create policy patients_select_care_team on public.patients for select to authenticated
  using (app.is_on_care_team(organization_id, id));
create policy patients_select_self on public.patients for select to authenticated
  using (app.is_patient_self(organization_id, id, 'onboarding'));
create policy patients_update_care_team on public.patients for update to authenticated
  using (app.can_manage_patient(organization_id, id))
  with check (app.can_manage_patient(organization_id, id));

-- patient_preferences
grant select on public.patient_preferences to authenticated;
grant update (portal_mode, locale, notify_email, text_size, reduced_motion, audio_instructions)
  on public.patient_preferences to authenticated;
create policy patient_preferences_select on public.patient_preferences for select to authenticated
  using (app.is_on_care_team(organization_id, patient_id)
         or app.is_patient_self(organization_id, patient_id, 'onboarding')
         or app.guardian_can(organization_id, patient_id, 'manage_portal_preferences'));
create policy patient_preferences_update on public.patient_preferences for update to authenticated
  using (app.can_manage_patient(organization_id, patient_id)
         or app.is_patient_self(organization_id, patient_id, 'onboarding')
         or app.guardian_can(organization_id, patient_id, 'manage_portal_preferences'))
  with check (app.can_manage_patient(organization_id, patient_id)
         or app.is_patient_self(organization_id, patient_id, 'onboarding')
         or app.guardian_can(organization_id, patient_id, 'manage_portal_preferences'));

-- care_team_members: care team + owners read; owners / primary assign and end.
grant select on public.care_team_members to authenticated;
grant insert (organization_id, patient_id, membership_id, care_role, assignment_reason)
  on public.care_team_members to authenticated;
grant update (ends_at, end_reason) on public.care_team_members to authenticated;
create policy care_team_members_select on public.care_team_members for select to authenticated
  using (app.is_on_care_team(organization_id, patient_id)
         or app.has_org_role(organization_id, 'organization_owner'));
create policy care_team_members_insert on public.care_team_members for insert to authenticated
  with check (app.can_assign_care_team(organization_id, patient_id));
create policy care_team_members_update on public.care_team_members for update to authenticated
  using (app.can_assign_care_team(organization_id, patient_id))
  with check (app.can_assign_care_team(organization_id, patient_id));

-- guardians: care team of a linked patient reads/updates; guardian reads own record.
grant select on public.guardians to authenticated;
grant update (first_name, last_name, document_type, document_number, email, phone, status)
  on public.guardians to authenticated;
create policy guardians_select_care_team on public.guardians for select to authenticated
  using (app.can_manage_guardian(organization_id, id));
create policy guardians_select_self on public.guardians for select to authenticated
  using (app.is_my_guardian_record(organization_id, id));
create policy guardians_update_care_team on public.guardians for update to authenticated
  using (app.org_allows(organization_id, 'staff_write') and app.can_manage_guardian(organization_id, id))
  with check (app.org_allows(organization_id, 'staff_write') and app.can_manage_guardian(organization_id, id));

-- patient_guardians: care team manages; guardian reads OWN relationships (DTO hides notes).
grant select on public.patient_guardians to authenticated;
grant insert (organization_id, patient_id, guardian_id, relationship, is_legal_representative, legal_basis,
              legal_basis_file_id, is_primary_contact, valid_from, valid_until)
  on public.patient_guardians to authenticated;
grant update (relationship, is_legal_representative, legal_basis, legal_basis_file_id, legal_basis_verified_at,
              is_primary_contact, status, suspension_reason, valid_from, valid_until, verification_note,
              revoke_reason)
  on public.patient_guardians to authenticated;
create policy patient_guardians_select_care_team on public.patient_guardians for select to authenticated
  using (app.is_on_care_team(organization_id, patient_id));
create policy patient_guardians_select_self on public.patient_guardians for select to authenticated
  using (app.is_my_relationship(organization_id, id));
create policy patient_guardians_insert_care_team on public.patient_guardians for insert to authenticated
  with check (app.can_manage_patient(organization_id, patient_id)
              and app.can_manage_guardian(organization_id, guardian_id));
create policy patient_guardians_update_care_team on public.patient_guardians for update to authenticated
  using (app.can_manage_patient(organization_id, patient_id))
  with check (app.can_manage_patient(organization_id, patient_id));

-- patient_guardian_caveats: care team only.
grant select on public.patient_guardian_caveats to authenticated;
grant insert (organization_id, patient_guardian_id, caveat, restrict_schedule) on public.patient_guardian_caveats to authenticated;
grant update (ended_at) on public.patient_guardian_caveats to authenticated;
create policy patient_guardian_caveats_select on public.patient_guardian_caveats for select to authenticated
  using (app.can_manage_relationship(organization_id, patient_guardian_id));
create policy patient_guardian_caveats_insert on public.patient_guardian_caveats for insert to authenticated
  with check (app.org_allows(organization_id, 'staff_write')
              and app.can_manage_relationship(organization_id, patient_guardian_id));
create policy patient_guardian_caveats_update on public.patient_guardian_caveats for update to authenticated
  using (app.org_allows(organization_id, 'staff_write')
         and app.can_manage_relationship(organization_id, patient_guardian_id))
  with check (app.org_allows(organization_id, 'staff_write')
              and app.can_manage_relationship(organization_id, patient_guardian_id));

-- patient_guardian_permissions: care team manages; guardian reads own grants.
grant select on public.patient_guardian_permissions to authenticated;
grant insert (organization_id, patient_guardian_id, permission) on public.patient_guardian_permissions to authenticated;
grant update (revoked_at) on public.patient_guardian_permissions to authenticated;
create policy patient_guardian_permissions_select_care_team on public.patient_guardian_permissions
  for select to authenticated using (app.can_manage_relationship(organization_id, patient_guardian_id));
create policy patient_guardian_permissions_select_self on public.patient_guardian_permissions
  for select to authenticated using (app.is_my_relationship(organization_id, patient_guardian_id));
create policy patient_guardian_permissions_insert on public.patient_guardian_permissions for insert to authenticated
  with check (app.org_allows(organization_id, 'staff_write')
              and app.can_manage_relationship(organization_id, patient_guardian_id));
create policy patient_guardian_permissions_update on public.patient_guardian_permissions for update to authenticated
  using (app.org_allows(organization_id, 'staff_write')
         and app.can_manage_relationship(organization_id, patient_guardian_id))
  with check (app.org_allows(organization_id, 'staff_write')
              and app.can_manage_relationship(organization_id, patient_guardian_id));

-- -----------------------------------------------------------------------------
-- 9. app_definer: least-privilege grants + policies, ownership, execute grants
-- -----------------------------------------------------------------------------
grant select on app.jurisdiction_settings to app_definer;

-- Reads used by helpers (rows filtered inside the functions, same model as memberships).
grant select on public.patients to app_definer;
create policy patients_select_definer on public.patients for select to app_definer using (true);
grant select on public.care_team_members to app_definer;
create policy care_team_members_select_definer on public.care_team_members for select to app_definer using (true);
grant select on public.guardians to app_definer;
create policy guardians_select_definer on public.guardians for select to app_definer using (true);
grant select on public.patient_guardians to app_definer;
create policy patient_guardians_select_definer on public.patient_guardians for select to app_definer using (true);
grant select (organization_id, patient_guardian_id, permission, revoked_at) on public.patient_guardian_permissions to app_definer;
create policy patient_guardian_permissions_select_definer on public.patient_guardian_permissions
  for select to app_definer using (true);
grant select (organization_id, patient_id, portal_mode) on public.patient_preferences to app_definer;
create policy patient_preferences_select_definer on public.patient_preferences for select to app_definer using (true);

-- Writes: only from the creation functions (user context, re-checked here) and the
-- majority job (system path).
grant insert (id, organization_id, first_name, last_name, preferred_name, date_of_birth, document_type,
              document_number, email, phone, preferred_locale, status, created_by)
  on public.patients to app_definer;
create policy patients_insert_definer on public.patients for insert to app_definer
  with check (app.can_write_as_role(organization_id, 'psychologist') and status = 'intake'
              and created_by = (select app.request_uid()));
grant insert (organization_id, patient_id, membership_id, care_role, assigned_by)
  on public.care_team_members to app_definer;
create policy care_team_members_insert_definer on public.care_team_members for insert to app_definer
  with check (membership_id = app.my_membership_id(organization_id) and care_role = 'primary'
              and app.can_write_as_role(organization_id, 'psychologist'));
grant insert (organization_id, patient_id, portal_mode, locale) on public.patient_preferences to app_definer;
create policy patient_preferences_insert_definer on public.patient_preferences for insert to app_definer
  with check (app.can_write_as_role(organization_id, 'psychologist'));
grant insert (id, organization_id, first_name, last_name, document_type, document_number, email, phone, created_by)
  on public.guardians to app_definer;
create policy guardians_insert_definer on public.guardians for insert to app_definer
  with check (app.can_write_as_role(organization_id, 'psychologist') and created_by = (select app.request_uid()));
grant insert (id, organization_id, patient_id, guardian_id, relationship, is_legal_representative, legal_basis,
              is_primary_contact, created_by)
  on public.patient_guardians to app_definer;
create policy patient_guardians_insert_definer on public.patient_guardians for insert to app_definer
  with check (app.can_manage_patient(organization_id, patient_id) and created_by = (select app.request_uid()));
grant update (status, suspension_reason) on public.patient_guardians to app_definer;
create policy patient_guardians_update_definer_system on public.patient_guardians for update to app_definer
  using ((select app.request_uid()) is null and status in ('active', 'pending_verification'))
  with check (status = 'suspended' and suspension_reason = 'age_of_majority');

grant create on schema app to app_definer;
alter function app.majority_date(date, char) owner to app_definer;
alter function app.is_minor(date, char) owner to app_definer;
alter function app.is_on_care_team(uuid, uuid) owner to app_definer;
alter function app.is_primary_on_care_team(uuid, uuid) owner to app_definer;
alter function app.is_patient_self(uuid, uuid, text) owner to app_definer;
alter function app.guardian_can(uuid, uuid, public.guardian_permission) owner to app_definer;
alter function app.is_active_guardian_of(uuid, uuid) owner to app_definer;
alter function app.is_my_guardian_record(uuid, uuid) owner to app_definer;
alter function app.is_my_relationship(uuid, uuid) owner to app_definer;
alter function app.can_manage_guardian(uuid, uuid) owner to app_definer;
alter function app.can_manage_relationship(uuid, uuid) owner to app_definer;
alter function app.is_portal_identity(uuid) owner to app_definer;
alter function app.patient_is_minor(uuid, uuid) owner to app_definer;
alter function app.patient_activation_missing(uuid, uuid) owner to app_definer;
alter function app.patient_directory(uuid) owner to app_definer;
alter function app.guardian_patient_summary(uuid) owner to app_definer;
alter function app.patient_privacy_view(uuid, uuid) owner to app_definer;
alter function app.find_patient_duplicates(uuid, text, text, date, public.document_type, text) owner to app_definer;
alter function app.create_patient(uuid, text, text, text, date, public.document_type, text, text, text, text, text)
  owner to app_definer;
alter function app.create_guardian(uuid, uuid, text, text, public.document_type, text, text, text,
  public.guardian_relationship, boolean, public.legal_representation_basis, boolean, text) owner to app_definer;
alter function app.profile_is_staff_of(uuid, uuid) owner to app_definer;
alter function app.suspend_guardians_at_majority(text) owner to app_definer;
revoke create on schema app from app_definer;

-- Execute: no PUBLIC/anon anywhere; authenticated where policies/DAL need it.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in (
      'majority_date', 'is_minor', 'suggest_portal_mode', 'patient_portal_status_allows', 'is_on_care_team',
      'is_primary_on_care_team', 'can_manage_patient', 'can_assign_care_team', 'is_patient_self', 'guardian_can',
      'is_active_guardian_of', 'is_my_guardian_record', 'is_my_relationship', 'can_manage_guardian',
      'can_manage_relationship', 'is_portal_identity', 'patient_is_minor', 'patient_activation_missing',
      'patient_directory', 'guardian_patient_summary', 'patient_privacy_view', 'find_patient_duplicates',
      'create_patient', 'create_guardian', 'profile_is_staff_of', 'guard_patient', 'guard_patient_preferences',
      'guard_care_team_member', 'guard_guardian', 'guard_patient_guardian', 'guard_guardian_caveat',
      'guard_guardian_permission', 'set_guardian_permissions', 'suspend_guardians_at_majority')
  loop
    execute format('revoke all on function %s from public, anon, service_role', f.sig);
  end loop;
end
$$;
grant execute on function app.majority_date(date, char) to authenticated;
grant execute on function app.is_minor(date, char) to authenticated;
grant execute on function app.suggest_portal_mode(date, char) to authenticated, app_definer;
grant execute on function app.patient_portal_status_allows(public.patient_status, text) to authenticated, app_definer;
grant execute on function app.is_on_care_team(uuid, uuid) to authenticated;
grant execute on function app.is_primary_on_care_team(uuid, uuid) to authenticated;
grant execute on function app.can_manage_patient(uuid, uuid) to authenticated, app_definer;
grant execute on function app.can_assign_care_team(uuid, uuid) to authenticated, app_definer;
grant execute on function app.is_patient_self(uuid, uuid, text) to authenticated;
grant execute on function app.guardian_can(uuid, uuid, public.guardian_permission) to authenticated;
grant execute on function app.is_active_guardian_of(uuid, uuid) to authenticated;
grant execute on function app.is_my_guardian_record(uuid, uuid) to authenticated;
grant execute on function app.is_my_relationship(uuid, uuid) to authenticated;
grant execute on function app.can_manage_guardian(uuid, uuid) to authenticated;
grant execute on function app.can_manage_relationship(uuid, uuid) to authenticated;
grant execute on function app.is_portal_identity(uuid) to authenticated;
grant execute on function app.patient_is_minor(uuid, uuid) to authenticated;
grant execute on function app.patient_activation_missing(uuid, uuid) to authenticated;
grant execute on function app.patient_directory(uuid) to authenticated;
grant execute on function app.guardian_patient_summary(uuid) to authenticated;
grant execute on function app.patient_privacy_view(uuid, uuid) to authenticated;
grant execute on function app.find_patient_duplicates(uuid, text, text, date, public.document_type, text) to authenticated;
grant execute on function app.create_patient(uuid, text, text, text, date, public.document_type, text, text, text, text, text)
  to authenticated;
grant execute on function app.create_guardian(uuid, uuid, text, text, public.document_type, text, text, text,
  public.guardian_relationship, boolean, public.legal_representation_basis, boolean, text) to authenticated;
grant execute on function app.profile_is_staff_of(uuid, uuid) to authenticated;
grant execute on function app.set_guardian_permissions(uuid, uuid, public.guardian_permission[], text) to authenticated;
grant execute on function app.suspend_guardians_at_majority(text) to app_server;
-- Trigger functions are invoked by the trigger mechanism; no direct execute for API roles.
revoke all on function app.guard_patient() from authenticated;
revoke all on function app.guard_patient_preferences() from authenticated;
revoke all on function app.guard_care_team_member() from authenticated;
revoke all on function app.guard_guardian() from authenticated;
revoke all on function app.guard_patient_guardian() from authenticated;
revoke all on function app.guard_guardian_caveat() from authenticated;
revoke all on function app.guard_guardian_permission() from authenticated;

-- -----------------------------------------------------------------------------
-- 10. Invariants
-- -----------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where p.prosecdef and n.nspname in ('app', 'public')
    and (r.rolbypassrls or r.rolsuper)
    and p.oid::regprocedure::text not in ('app.auth_user_verified_email(uuid)', 'app.auth_user_id_by_email(text)');
  if v_bad is not null then
    raise exception 'SECURITY DEFINER functions owned by a BYPASSRLS/superuser role: %', v_bad;
  end if;
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef and n.nspname in ('app', 'public')
    and not coalesce(p.proconfig @> array['search_path=""'], false);
  if v_bad is not null then
    raise exception 'SECURITY DEFINER functions without search_path = '''': %', v_bad;
  end if;
end
$$;
