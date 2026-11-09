-- =============================================================================
-- Phase 2 — consents (DATABASE.md §5.5, §10; PRD CON-01..06; SECURITY.md §5.2; F-09, F-10, F-12;
-- ADR-018). Forward-only.
--
-- Tables: consent_templates, consent_template_versions, consent_records,
--         consent_record_evidence [split, care team only].
-- Writes to consent_records / evidence ONLY through SECURITY DEFINER functions:
--   app.sign_consent      (portal: patient self, guardian with sign_consents, minor assent)
--   app.record_consent    (care team: verbal record; paper scan waits for file_objects)
--   app.withdraw_consent  (signer or care team; one-time, history preserved)
-- Q-17 default (provisional): portal signature = typed name + checkbox + stored evidence
-- (server time, version hash, IP, user agent) [NEEDS LEGAL VERIFICATION] (Ley 527/1999,
-- Ley 1581/2012). Evidence is visible to the care team only; signers get a confirmation.
-- Also replaces app.patient_activation_missing with the consent-aware version (CON-05).
-- =============================================================================

create type public.consent_type as enum (
  'treatment_informed_consent', 'personal_data_processing', 'minor_assent', 'guardian_authorization',
  'portal_use', 'other'
);
create type public.consent_signer_requirement as enum ('patient', 'guardian', 'patient_and_guardian');
create type public.content_status as enum ('draft', 'published', 'archived');
create type public.publish_status as enum ('draft', 'published', 'retired');
create type public.signer_type as enum ('patient', 'guardian', 'professional_recorded');
create type public.consent_method as enum ('portal_checkbox', 'portal_typed_name', 'paper_scan', 'verbal_recorded');
create type public.consent_decision as enum ('accepted', 'declined');
create type public.consent_record_status as enum ('accepted', 'declined', 'withdrawn');

-- -----------------------------------------------------------------------------
-- consent_templates
-- -----------------------------------------------------------------------------
create table public.consent_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,47}$'),
  consent_type public.consent_type not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  signer_requirement public.consent_signer_requirement not null,
  applies_to_minors boolean not null default true,
  applies_to_adults boolean not null default true,
  required_for_activation boolean not null default false,
  status public.content_status not null default 'draft',
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consent_templates_org_key unique (organization_id, key),
  constraint consent_templates_org_id_key unique (organization_id, id),
  constraint consent_templates_audience check (applies_to_minors or applies_to_adults),
  -- SECURITY.md §5.2: assent is the minor's own record.
  constraint consent_templates_assent check (
    consent_type <> 'minor_assent' or (signer_requirement = 'patient' and applies_to_minors and not applies_to_adults)
  ),
  constraint consent_templates_guardian_authorization check (
    consent_type <> 'guardian_authorization'
    or (signer_requirement = 'guardian' and applies_to_minors and not applies_to_adults)
  ),
  constraint consent_templates_guardian_minors check (signer_requirement <> 'guardian' or not applies_to_adults)
);
create index consent_templates_created_by_idx on public.consent_templates (created_by);
comment on table public.consent_templates is
  'CON-01 consent definitions per org. Owners manage (psychologist write: [NEEDS PSYCHOLOGIST INPUT]). Starter texts are drafts for legal review [NEEDS LEGAL VERIFICATION].';
comment on column public.consent_templates.required_for_activation is
  'CON-05: required before the patient can become active (for the audiences it applies to).';
create trigger consent_templates_set_updated_at before update on public.consent_templates
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- consent_template_versions (immutable after publish; published -> retired only)
-- -----------------------------------------------------------------------------
create table public.consent_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  consent_template_id uuid not null,
  version_number integer not null check (version_number >= 1),
  locale text not null check (locale in ('es', 'en')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  -- Restricted rich-text AST validated by Zod (src/modules/consents/schemas). No HTML.
  body jsonb not null check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 65536),
  body_hash bytea null check (body_hash is null or octet_length(body_hash) = 32),
  status public.publish_status not null default 'draft',
  published_at timestamptz null,
  published_by uuid null references public.profiles (id) on delete restrict,
  retired_at timestamptz null,
  legal_review_reference text null check (char_length(btrim(legal_review_reference)) between 1 and 200),
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consent_template_versions_number_key unique (consent_template_id, version_number, locale),
  constraint consent_template_versions_org_id_key unique (organization_id, id),
  constraint consent_template_versions_template_fkey foreign key (organization_id, consent_template_id)
    references public.consent_templates (organization_id, id) on delete restrict,
  constraint consent_template_versions_published check (
    status = 'draft' or (body_hash is not null and published_at is not null and published_by is not null)
  ),
  constraint consent_template_versions_draft_unhashed check (status <> 'draft' or body_hash is null),
  constraint consent_template_versions_retired check ((status = 'retired') = (retired_at is not null))
);
create unique index consent_template_versions_one_draft on public.consent_template_versions (consent_template_id, locale)
  where status = 'draft';
create index consent_template_versions_org_template_idx on public.consent_template_versions (organization_id, consent_template_id);
create index consent_template_versions_published_by_idx on public.consent_template_versions (published_by);
create index consent_template_versions_created_by_idx on public.consent_template_versions (created_by);
create trigger consent_template_versions_set_updated_at before update on public.consent_template_versions
  for each row execute function app.set_updated_at();

-- Canonical hash of a version body: sha256 of the jsonb text form (jsonb normalizes key order
-- and whitespace, so the serialization is deterministic).
create function app.consent_body_hash(p_body jsonb) returns bytea
language sql
immutable
set search_path = ''
as $$ select extensions.digest(p_body::text, 'sha256') $$;

-- -----------------------------------------------------------------------------
-- consent_records (append-only except one-time withdrawal)
-- -----------------------------------------------------------------------------
create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  patient_id uuid not null,
  consent_template_id uuid not null,
  consent_template_version_id uuid not null,
  -- Snapshot of the template type at decision time ("record kind": minor_assent is its own kind).
  consent_type public.consent_type not null,
  signer_type public.signer_type not null,
  signer_profile_id uuid null references public.profiles (id) on delete restrict,
  signer_guardian_id uuid null,
  patient_guardian_id uuid null,
  recorded_by_profile_id uuid not null references public.profiles (id) on delete restrict,
  decision public.consent_decision not null,
  method public.consent_method not null,
  locale text not null check (locale in ('es', 'en')),
  text_hash bytea not null check (octet_length(text_hash) = 32),
  accepted_at timestamptz not null,
  -- FK to file_objects arrives with the storage workstream (paper_scan is rejected until then).
  evidence_file_id uuid null,
  withdrawn_at timestamptz null,
  withdrawn_by_profile_id uuid null references public.profiles (id) on delete restrict,
  withdrawal_reason text null check (char_length(btrim(withdrawal_reason)) between 3 and 1000),
  status public.consent_record_status generated always as (
    case when withdrawn_at is not null then 'withdrawn'::public.consent_record_status
         when decision = 'declined' then 'declined'::public.consent_record_status
         else 'accepted'::public.consent_record_status end
  ) stored,
  created_at timestamptz not null default now(),
  constraint consent_records_org_id_key unique (organization_id, id),
  constraint consent_records_patient_fkey foreign key (organization_id, patient_id)
    references public.patients (organization_id, id) on delete restrict,
  constraint consent_records_template_fkey foreign key (organization_id, consent_template_id)
    references public.consent_templates (organization_id, id) on delete restrict,
  constraint consent_records_version_fkey foreign key (organization_id, consent_template_version_id)
    references public.consent_template_versions (organization_id, id) on delete restrict,
  constraint consent_records_guardian_fkey foreign key (organization_id, signer_guardian_id)
    references public.guardians (organization_id, id) on delete restrict,
  constraint consent_records_pg_fkey foreign key (organization_id, patient_guardian_id)
    references public.patient_guardians (organization_id, id) on delete restrict,
  constraint consent_records_guardian_signer check (
    (signer_type = 'guardian') = (signer_guardian_id is not null and patient_guardian_id is not null)
  ),
  constraint consent_records_assent_patient check (consent_type <> 'minor_assent' or signer_type = 'patient'),
  constraint consent_records_paper_evidence check (method <> 'paper_scan' or evidence_file_id is not null),
  constraint consent_records_withdrawn_consistent check (
    (withdrawn_at is null) = (withdrawn_by_profile_id is null)
    and (withdrawn_at is null) = (withdrawal_reason is null)
  ),
  constraint consent_records_withdraw_accepted check (withdrawn_at is null or decision = 'accepted')
);
create index consent_records_patient_version_idx on public.consent_records (organization_id, patient_id, consent_template_version_id);
create index consent_records_patient_template_idx on public.consent_records (organization_id, patient_id, consent_template_id);
create index consent_records_template_idx on public.consent_records (organization_id, consent_template_id);
create index consent_records_version_idx on public.consent_records (organization_id, consent_template_version_id);
create index consent_records_guardian_idx on public.consent_records (organization_id, signer_guardian_id)
  where signer_guardian_id is not null;
create index consent_records_pg_idx on public.consent_records (organization_id, patient_guardian_id)
  where patient_guardian_id is not null;
create index consent_records_signer_profile_idx on public.consent_records (signer_profile_id);
create index consent_records_recorded_by_idx on public.consent_records (recorded_by_profile_id);
create index consent_records_withdrawn_by_idx on public.consent_records (withdrawn_by_profile_id);
comment on table public.consent_records is
  'CON-02 decisions. Writes only via app.sign_consent / app.record_consent / app.withdraw_consent. Re-consent = new row.';

-- -----------------------------------------------------------------------------
-- consent_record_evidence [split] (F-09): care team only, insert-only
-- -----------------------------------------------------------------------------
create table public.consent_record_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  consent_record_id uuid not null,
  typed_name text null check (char_length(btrim(typed_name)) between 1 and 200),
  checkbox_confirmed boolean not null,
  ip_address inet null,
  user_agent text null check (char_length(user_agent) <= 512),
  created_at timestamptz not null default now(),
  constraint consent_record_evidence_record_key unique (consent_record_id),
  constraint consent_record_evidence_org_id_key unique (organization_id, id),
  constraint consent_record_evidence_record_fkey foreign key (organization_id, consent_record_id)
    references public.consent_records (organization_id, id) on delete restrict
);
comment on table public.consent_record_evidence is
  'Typed name, IP, user agent of a portal decision. Care team only; never visible to other guardians (F-09). Retention [NEEDS LEGAL VERIFICATION].';

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------
create function app.guard_consent_template() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select app.request_uid()), new.created_by);
    if (select app.request_uid()) is not null then
      new.status := 'draft';
    end if;
    return new;
  end if;
  -- Meaning-defining fields never change (create a new template instead).
  if row(new.organization_id, new.key, new.consent_type, new.signer_requirement, new.applies_to_minors,
         new.applies_to_adults, new.created_by, new.created_at)
     is distinct from row(old.organization_id, old.key, old.consent_type, old.signer_requirement,
         old.applies_to_minors, old.applies_to_adults, old.created_by, old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:consent_templates';
  end if;
  if new.status is distinct from old.status and new.status = 'published' and not exists (
    select 1 from public.consent_template_versions v
    where v.organization_id = new.organization_id and v.consent_template_id = new.id and v.status = 'published'
  ) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:template_has_no_published_version';
  end if;
  return new;
end
$$;
create trigger consent_templates_guard before insert or update on public.consent_templates
  for each row execute function app.guard_consent_template();
create trigger consent_templates_no_delete before delete on public.consent_templates
  for each row execute function app.reject_mutation();

create function app.guard_consent_template_version() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(v_actor, new.created_by);
    if v_actor is not null then
      new.status := 'draft';
      new.body_hash := null;
      new.published_at := null;
      new.published_by := null;
      new.retired_at := null;
    end if;
    select coalesce(max(v.version_number), 0) + 1 into new.version_number
    from public.consent_template_versions v
    where v.consent_template_id = new.consent_template_id and v.locale = new.locale;
    if new.status = 'published' then
      new.body_hash := app.consent_body_hash(new.body);
      new.published_at := coalesce(new.published_at, now());
      new.published_by := coalesce(new.published_by, new.created_by);
    end if;
    return new;
  end if;

  if old.status = 'retired' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:consent_template_versions';
  end if;
  if row(new.organization_id, new.consent_template_id, new.version_number, new.locale, new.created_by, new.created_at)
     is distinct from row(old.organization_id, old.consent_template_id, old.version_number, old.locale,
                          old.created_by, old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:consent_template_versions';
  end if;
  if old.status = 'published' then
    -- Published text is immutable (CON-01): the only change is retirement.
    if new.status <> 'retired'
       or row(new.title, new.body, new.body_hash, new.published_at, new.published_by, new.legal_review_reference)
          is distinct from row(old.title, old.body, old.body_hash, old.published_at, old.published_by,
                               old.legal_review_reference) then
      raise exception using errcode = 'P0001', message = 'IMMUTABLE:consent_template_versions';
    end if;
    new.retired_at := now();
    return new;
  end if;
  -- draft
  if new.status = 'retired' then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invalid_version_transition';
  end if;
  if new.status = 'published' then
    new.body_hash := app.consent_body_hash(new.body);
    new.published_at := now();
    new.published_by := coalesce(v_actor, new.published_by, old.created_by);
  else
    new.body_hash := null;
    new.published_at := null;
    new.published_by := null;
  end if;
  return new;
end
$$;
create trigger consent_template_versions_guard before insert or update on public.consent_template_versions
  for each row execute function app.guard_consent_template_version();
create trigger consent_template_versions_no_delete before delete on public.consent_template_versions
  for each row execute function app.reject_mutation();

-- consent_records: insert invariants (F-10, F-12) + one-time withdrawal.
create function app.guard_consent_record() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_version public.consent_template_versions%rowtype;
  v_type public.consent_type;
begin
  if tg_op = 'INSERT' then
    select * into v_version from public.consent_template_versions v
    where v.organization_id = new.organization_id and v.id = new.consent_template_version_id;
    select t.consent_type into v_type from public.consent_templates t
    where t.organization_id = new.organization_id and t.id = v_version.consent_template_id;
    if v_version.id is null or v_version.status <> 'published'
       or v_version.consent_template_id <> new.consent_template_id then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:consent_version_not_signable';
    end if;
    if new.text_hash is distinct from v_version.body_hash then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:consent_text_mismatch';
    end if;
    new.consent_type := v_type;
    new.locale := v_version.locale;
    new.created_at := now();
    new.withdrawn_at := null;
    new.withdrawn_by_profile_id := null;
    new.withdrawal_reason := null;
    if new.signer_type = 'guardian' and not exists (
      select 1 from public.patient_guardians pg
      where pg.organization_id = new.organization_id and pg.id = new.patient_guardian_id
        and pg.patient_id = new.patient_id and pg.guardian_id = new.signer_guardian_id
    ) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:relationship_mismatch';
    end if;
    return new;
  end if;
  if old.withdrawn_at is not null
     or new.withdrawn_at is null
     or row(new.organization_id, new.patient_id, new.consent_template_id, new.consent_template_version_id,
            new.consent_type, new.signer_type, new.signer_profile_id, new.signer_guardian_id,
            new.patient_guardian_id, new.recorded_by_profile_id, new.decision, new.method, new.locale,
            new.text_hash, new.accepted_at, new.evidence_file_id, new.created_at)
        is distinct from row(old.organization_id, old.patient_id, old.consent_template_id,
            old.consent_template_version_id, old.consent_type, old.signer_type, old.signer_profile_id,
            old.signer_guardian_id, old.patient_guardian_id, old.recorded_by_profile_id, old.decision,
            old.method, old.locale, old.text_hash, old.accepted_at, old.evidence_file_id, old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:consent_records';
  end if;
  new.withdrawn_at := now();
  return new;
end
$$;
create trigger consent_records_guard before insert or update on public.consent_records
  for each row execute function app.guard_consent_record();
create trigger consent_records_no_delete before delete on public.consent_records
  for each row execute function app.reject_mutation();
create trigger consent_records_no_truncate before truncate on public.consent_records
  for each statement execute function app.reject_mutation();
create trigger consent_record_evidence_no_update before update or delete on public.consent_record_evidence
  for each row execute function app.reject_mutation();
create trigger consent_record_evidence_no_truncate before truncate on public.consent_record_evidence
  for each statement execute function app.reject_mutation();

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create function app.can_read_consent_evidence(p_org uuid, p_record uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.consent_records r
    where r.organization_id = p_org and r.id = p_record and app.is_on_care_team(p_org, r.patient_id)
  )
$$;

-- Consent-aware activation preconditions (PAT-02, CON-05). Machine keys only:
--   jurisdiction_not_configured | legal_representative | consent:<template_key>:<patient|guardian>
create or replace function app.patient_activation_missing(p_org uuid, p_patient uuid) returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_minor boolean;
  v_missing text[] := '{}';
  v_t record;
begin
  if (select app.request_uid()) is not null and not app.is_on_care_team(p_org, p_patient) then
    return null;
  end if;
  v_minor := app.patient_is_minor(p_org, p_patient);
  if v_minor is null then
    return array['jurisdiction_not_configured'];
  end if;
  if v_minor and not exists (
    select 1 from public.patient_guardians pg
    where pg.organization_id = p_org and pg.patient_id = p_patient
      and pg.status = 'active' and pg.is_legal_representative and pg.legal_basis_verified_at is not null
      and current_date >= pg.valid_from and (pg.valid_until is null or current_date <= pg.valid_until)
  ) then
    v_missing := array_append(v_missing, 'legal_representative');
  end if;
  for v_t in
    select t.id, t.key, t.signer_requirement
    from public.consent_templates t
    where t.organization_id = p_org and t.required_for_activation and t.status = 'published'
      and ((v_minor and t.applies_to_minors) or (not v_minor and t.applies_to_adults))
    order by t.key
  loop
    if v_t.signer_requirement in ('patient', 'patient_and_guardian') and not exists (
      select 1 from public.consent_records r
      where r.organization_id = p_org and r.patient_id = p_patient and r.consent_template_id = v_t.id
        and r.signer_type = 'patient' and r.status = 'accepted'
    ) then
      v_missing := array_append(v_missing, 'consent:' || v_t.key || ':patient');
    end if;
    if v_minor and v_t.signer_requirement in ('guardian', 'patient_and_guardian') and not exists (
      select 1 from public.consent_records r
      join public.patient_guardians pg on pg.organization_id = r.organization_id and pg.id = r.patient_guardian_id
      where r.organization_id = p_org and r.patient_id = p_patient and r.consent_template_id = v_t.id
        and r.signer_type = 'guardian' and r.status = 'accepted' and pg.status = 'active'
    ) then
      v_missing := array_append(v_missing, 'consent:' || v_t.key || ':guardian');
    end if;
  end loop;
  return v_missing;
end
$$;

-- Shared checks for a version a caller wants to decide on. Raises; returns the template row.
create function app.signable_version(p_org uuid, p_version uuid, p_patient uuid)
returns table (template_id uuid, consent_type public.consent_type, signer_requirement public.consent_signer_requirement,
               body_hash bytea, patient_is_minor boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_t record;
  v_minor boolean;
begin
  select t.id, t.consent_type, t.signer_requirement, t.applies_to_minors, t.applies_to_adults, v.body_hash
    into v_t
  from public.consent_template_versions v
  join public.consent_templates t on t.organization_id = v.organization_id and t.id = v.consent_template_id
  where v.organization_id = p_org and v.id = p_version and v.status = 'published' and t.status = 'published';
  if v_t.id is null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:consent_version_not_signable';
  end if;
  v_minor := app.patient_is_minor(p_org, p_patient);
  if v_minor is null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:jurisdiction_not_configured';
  end if;
  if (v_minor and not v_t.applies_to_minors) or (not v_minor and not v_t.applies_to_adults) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:consent_not_applicable';
  end if;
  template_id := v_t.id;
  consent_type := v_t.consent_type;
  signer_requirement := v_t.signer_requirement;
  body_hash := v_t.body_hash;
  patient_is_minor := v_minor;
  return next;
end
$$;

-- Portal signature (CON-06, CON-03). p_acting_as is the server's active capacity; the DB
-- re-derives that the caller really holds it. IP/UA come from server request metadata.
create function app.sign_consent(
  p_org uuid,
  p_acting_as text,
  p_patient uuid,
  p_version uuid,
  p_decision public.consent_decision,
  p_typed_name text,
  p_checkbox_confirmed boolean,
  p_text_hash bytea,
  p_ip inet,
  p_user_agent text,
  p_request_id text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_sv record;
  v_record uuid := pg_catalog.gen_random_uuid();
  v_guardian uuid;
  v_link uuid;
  v_signer public.signer_type;
  v_legal boolean;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:no_actor';
  end if;
  -- Authorize the capacity first so non-signers learn nothing about versions (NOT_FOUND class).
  if p_acting_as = 'patient' then
    if not app.is_patient_self(p_org, p_patient, 'sign') then
      raise exception using errcode = '42501', message = 'FORBIDDEN:consent.sign.self';
    end if;
    v_signer := 'patient';
  elsif p_acting_as = 'guardian' then
    if not app.guardian_can(p_org, p_patient, 'sign_consents') then
      raise exception using errcode = '42501', message = 'FORBIDDEN:consent.sign.guardian';
    end if;
    select g.id, pg.id, (pg.is_legal_representative and pg.legal_basis_verified_at is not null)
      into v_guardian, v_link, v_legal
    from public.guardians g
    join public.patient_guardians pg on pg.organization_id = g.organization_id and pg.guardian_id = g.id
    where g.organization_id = p_org and pg.patient_id = p_patient and g.profile_id = v_actor
      and pg.status = 'active';
    v_signer := 'guardian';
  else
    raise exception using errcode = '42501', message = 'FORBIDDEN:consent.sign';
  end if;

  select * into v_sv from app.signable_version(p_org, p_version, p_patient);
  if p_text_hash is null or p_text_hash <> v_sv.body_hash then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:consent_text_mismatch';
  end if;
  -- Q-17 default: typed name AND checkbox for every portal decision [NEEDS LEGAL VERIFICATION].
  if p_checkbox_confirmed is not true or p_typed_name is null or char_length(btrim(p_typed_name)) < 2 then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:consent_evidence_incomplete';
  end if;
  if v_signer = 'patient' then
    if v_sv.signer_requirement = 'guardian' then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:signer_not_allowed';
    end if;
    if v_sv.consent_type = 'minor_assent' and not v_sv.patient_is_minor then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:consent_not_applicable';
    end if;
  else
    if v_sv.consent_type = 'minor_assent' then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:assent_requires_patient';
    end if;
    if v_sv.signer_requirement = 'patient' then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:signer_not_allowed';
    end if;
    -- F-12 / GRD-03: these types need a verified legal representative.
    if v_sv.consent_type in ('treatment_informed_consent', 'guardian_authorization', 'personal_data_processing')
       and v_legal is not true then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:legal_representative_not_verified';
    end if;
  end if;

  insert into public.consent_records (
    id, organization_id, patient_id, consent_template_id, consent_template_version_id, consent_type, signer_type,
    signer_profile_id, signer_guardian_id, patient_guardian_id, recorded_by_profile_id, decision, method,
    locale, text_hash, accepted_at
  ) values (
    v_record, p_org, p_patient, v_sv.template_id, p_version, v_sv.consent_type, v_signer,
    v_actor, v_guardian, v_link, v_actor, p_decision, 'portal_typed_name',
    'es', v_sv.body_hash, now()
  );
  insert into public.consent_record_evidence (organization_id, consent_record_id, typed_name, checkbox_confirmed,
                                              ip_address, user_agent)
  values (p_org, v_record, btrim(p_typed_name), true, p_ip, left(p_user_agent, 512));

  perform app.insert_audit_row(
    case when p_decision = 'accepted' then 'consent.signed' else 'consent.declined' end,
    'user', 'user', v_actor, array[p_acting_as], p_org, 'consent_record', v_record,
    jsonb_build_object('patient_id', p_patient, 'consent_record_id', v_record,
                       'consent_template_version_id', p_version, 'consent_type', v_sv.consent_type,
                       'signer_type', v_signer, 'method', 'portal_typed_name'),
    p_request_id, null, null);
  return v_record;
end
$$;

-- Professional record of a verbal decision (CON-02). paper_scan needs file_objects (Phase 3).
create function app.record_consent(
  p_org uuid,
  p_patient uuid,
  p_version uuid,
  p_signer_type public.signer_type,
  p_patient_guardian uuid,
  p_method public.consent_method,
  p_decision public.consent_decision,
  p_decided_at timestamptz,
  p_request_id text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_sv record;
  v_record uuid := pg_catalog.gen_random_uuid();
  v_rel record;
  v_signer_profile uuid;
begin
  if v_actor is null or not app.can_manage_patient(p_org, p_patient) then
    raise exception using errcode = '42501', message = 'FORBIDDEN:consent.request';
  end if;
  if p_method = 'paper_scan' then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:paper_scan_requires_file_storage';
  end if;
  if p_method <> 'verbal_recorded' then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:method_not_allowed';
  end if;
  if p_decided_at is null or p_decided_at > now() + interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:decided_at_invalid';
  end if;
  select * into v_sv from app.signable_version(p_org, p_version, p_patient);

  if p_signer_type = 'patient' then
    if v_sv.signer_requirement = 'guardian' then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:signer_not_allowed';
    end if;
    select p.profile_id into v_signer_profile from public.patients p
    where p.organization_id = p_org and p.id = p_patient;
  elsif p_signer_type = 'guardian' then
    if v_sv.consent_type = 'minor_assent' then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:assent_requires_patient';
    end if;
    if v_sv.signer_requirement = 'patient' then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:signer_not_allowed';
    end if;
    select pg.id, pg.guardian_id, g.profile_id,
           (pg.is_legal_representative and pg.legal_basis_verified_at is not null) as legal
      into v_rel
    from public.patient_guardians pg
    join public.guardians g on g.organization_id = pg.organization_id and g.id = pg.guardian_id
    where pg.organization_id = p_org and pg.id = p_patient_guardian and pg.patient_id = p_patient
      and pg.status = 'active';
    if v_rel.id is null then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:relationship_not_active';
    end if;
    if v_sv.consent_type in ('treatment_informed_consent', 'guardian_authorization', 'personal_data_processing')
       and not v_rel.legal then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:legal_representative_not_verified';
    end if;
    v_signer_profile := v_rel.profile_id;
  else
    raise exception using errcode = 'P0001', message = 'PRECONDITION:signer_not_allowed';
  end if;

  insert into public.consent_records (
    id, organization_id, patient_id, consent_template_id, consent_template_version_id, consent_type, signer_type,
    signer_profile_id, signer_guardian_id, patient_guardian_id, recorded_by_profile_id, decision, method,
    locale, text_hash, accepted_at
  ) values (
    v_record, p_org, p_patient, v_sv.template_id, p_version, v_sv.consent_type, p_signer_type,
    v_signer_profile, v_rel.guardian_id, v_rel.id, v_actor, p_decision, p_method,
    'es', v_sv.body_hash, p_decided_at
  );
  perform app.insert_audit_row('consent.recorded', 'user', 'user', v_actor, array['psychologist'], p_org,
    'consent_record', v_record,
    jsonb_build_object('patient_id', p_patient, 'consent_record_id', v_record,
                       'consent_template_version_id', p_version, 'consent_type', v_sv.consent_type,
                       'signer_type', p_signer_type, 'method', p_method, 'decision', p_decision),
    p_request_id, null, null);
  return v_record;
end
$$;

-- Withdrawal (CON-04): signer (own record) or care team. One-time; history preserved.
create function app.withdraw_consent(
  p_org uuid,
  p_acting_as text,
  p_record uuid,
  p_reason text,
  p_request_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_r record;
  v_allowed boolean := false;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:no_actor';
  end if;
  select r.id, r.patient_id, r.signer_type, r.signer_guardian_id, r.status, r.consent_type
    into v_r
  from public.consent_records r
  where r.organization_id = p_org and r.id = p_record;
  if v_r.id is not null then
    v_allowed := case p_acting_as
      when 'staff' then app.can_manage_patient(p_org, v_r.patient_id)
      when 'patient' then v_r.signer_type = 'patient' and app.is_patient_self(p_org, v_r.patient_id, 'onboarding')
      when 'guardian' then v_r.signer_type = 'guardian'
                           and app.is_my_guardian_record(p_org, v_r.signer_guardian_id)
                           and app.is_active_guardian_of(p_org, v_r.patient_id)
      else false end;
  end if;
  if not coalesce(v_allowed, false) then
    raise exception using errcode = '42501', message = 'FORBIDDEN:consent.withdraw';
  end if;
  if v_r.status <> 'accepted' then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:consent_not_withdrawable';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:withdrawal_reason_required';
  end if;
  update public.consent_records
     set withdrawn_at = now(), withdrawn_by_profile_id = v_actor, withdrawal_reason = btrim(p_reason)
   where organization_id = p_org and id = p_record;
  perform app.insert_audit_row('consent.withdrawn', 'user', 'user', v_actor, array[p_acting_as], p_org,
    'consent_record', p_record,
    jsonb_build_object('patient_id', v_r.patient_id, 'consent_record_id', p_record,
                       'consent_type', v_r.consent_type, 'withdrawn_by', p_acting_as),
    p_request_id, null, null);
  -- TODO(notifications): alert the care team; block new assignments until resolved (CON-04,
  -- enforced by the activity_assignments trigger in Phase 4).
end
$$;

-- -----------------------------------------------------------------------------
-- Audit events
-- -----------------------------------------------------------------------------
insert into app.audit_event_types (event_type, category, writer, org_optional, description) values
  ('consent_template.created', 'consent', 'user', false, 'Consent template created'),
  ('consent_template.updated', 'consent', 'user', false, 'Consent template updated (field names only)'),
  ('consent_template_version.draft_saved', 'consent', 'user', false, 'Consent version draft saved'),
  ('consent_template_version.published', 'consent', 'user', false, 'Consent version published (hash fixed)'),
  ('consent_template_version.retired', 'consent', 'user', false, 'Consent version retired'),
  ('consent.signed', 'consent', 'user', false, 'Consent accepted in the portal'),
  ('consent.declined', 'consent', 'user', false, 'Consent declined in the portal (evidence too)'),
  ('consent.recorded', 'consent', 'user', false, 'Consent decision recorded by the care team'),
  ('consent.withdrawn', 'consent', 'user', false, 'Consent withdrawn'),
  ('consent.status_viewed', 'consent', 'user', false, 'Consent status of a patient viewed by the care team'),
  ('consent.evidence_viewed', 'consent', 'user', false, 'Consent evidence viewed by the care team');

-- -----------------------------------------------------------------------------
-- RLS, grants, policies
-- -----------------------------------------------------------------------------
alter table public.consent_templates enable row level security;
alter table public.consent_templates force row level security;
alter table public.consent_template_versions enable row level security;
alter table public.consent_template_versions force row level security;
alter table public.consent_records enable row level security;
alter table public.consent_records force row level security;
alter table public.consent_record_evidence enable row level security;
alter table public.consent_record_evidence force row level security;
revoke all on public.consent_templates, public.consent_template_versions, public.consent_records,
  public.consent_record_evidence from public, anon, authenticated, service_role;

-- Templates/versions: staff read; owners manage; portal identities read PUBLISHED ones.
grant select on public.consent_templates to authenticated;
grant insert (organization_id, key, consent_type, title, signer_requirement, applies_to_minors, applies_to_adults,
              required_for_activation)
  on public.consent_templates to authenticated;
grant update (title, required_for_activation, status) on public.consent_templates to authenticated;
create policy consent_templates_select_staff on public.consent_templates for select to authenticated
  using (app.is_org_member(organization_id));
create policy consent_templates_select_portal on public.consent_templates for select to authenticated
  using (status = 'published' and app.is_portal_identity(organization_id));
create policy consent_templates_insert_owner on public.consent_templates for insert to authenticated
  with check (app.can_write_as_role(organization_id, 'organization_owner'));
create policy consent_templates_update_owner on public.consent_templates for update to authenticated
  using (app.can_write_as_role(organization_id, 'organization_owner'))
  with check (app.can_write_as_role(organization_id, 'organization_owner'));

grant select on public.consent_template_versions to authenticated;
grant insert (organization_id, consent_template_id, locale, title, body, legal_review_reference)
  on public.consent_template_versions to authenticated;
grant update (title, body, legal_review_reference, status) on public.consent_template_versions to authenticated;
create policy consent_template_versions_select_staff on public.consent_template_versions for select to authenticated
  using (app.is_org_member(organization_id));
create policy consent_template_versions_select_portal on public.consent_template_versions for select to authenticated
  using (status = 'published' and app.is_portal_identity(organization_id));
create policy consent_template_versions_insert_owner on public.consent_template_versions for insert to authenticated
  with check (app.can_write_as_role(organization_id, 'organization_owner'));
create policy consent_template_versions_update_owner on public.consent_template_versions for update to authenticated
  using (app.can_write_as_role(organization_id, 'organization_owner'))
  with check (app.can_write_as_role(organization_id, 'organization_owner'));

-- Records: care team reads all of its patient's records; patient reads own patient-signed
-- records; a guardian reads ONLY records they signed while the relationship is effective (F-09).
-- No direct writes for authenticated (definer functions only).
grant select on public.consent_records to authenticated;
create policy consent_records_select_care_team on public.consent_records for select to authenticated
  using (app.is_on_care_team(organization_id, patient_id));
create policy consent_records_select_patient on public.consent_records for select to authenticated
  using (signer_type = 'patient' and app.is_patient_self(organization_id, patient_id, 'onboarding'));
create policy consent_records_select_guardian on public.consent_records for select to authenticated
  using (signer_type = 'guardian'
         and app.is_my_guardian_record(organization_id, signer_guardian_id)
         and app.is_active_guardian_of(organization_id, patient_id));

-- Evidence: care team only.
grant select on public.consent_record_evidence to authenticated;
create policy consent_record_evidence_select_care_team on public.consent_record_evidence for select to authenticated
  using (app.can_read_consent_evidence(organization_id, consent_record_id));

-- app_definer: reads for the functions; inserts/withdrawal re-checked in policies.
grant select on public.consent_templates to app_definer;
create policy consent_templates_select_definer on public.consent_templates for select to app_definer using (true);
grant select on public.consent_template_versions to app_definer;
create policy consent_template_versions_select_definer on public.consent_template_versions for select to app_definer
  using (true);
grant select on public.consent_records to app_definer;
create policy consent_records_select_definer on public.consent_records for select to app_definer using (true);
grant insert (id, organization_id, patient_id, consent_template_id, consent_template_version_id, consent_type,
              signer_type, signer_profile_id, signer_guardian_id, patient_guardian_id, recorded_by_profile_id,
              decision, method, locale, text_hash, accepted_at)
  on public.consent_records to app_definer;
create policy consent_records_insert_definer on public.consent_records for insert to app_definer
  with check (
    recorded_by_profile_id = (select app.request_uid())
    and (
      app.can_manage_patient(organization_id, patient_id)
      or (signer_type = 'patient' and signer_profile_id = (select app.request_uid())
          and app.is_patient_self(organization_id, patient_id, 'sign'))
      or (signer_type = 'guardian' and signer_profile_id = (select app.request_uid())
          and app.guardian_can(organization_id, patient_id, 'sign_consents'))
    )
  );
grant update (withdrawn_at, withdrawn_by_profile_id, withdrawal_reason) on public.consent_records to app_definer;
create policy consent_records_withdraw_definer on public.consent_records for update to app_definer
  using (
    app.can_manage_patient(organization_id, patient_id)
    or (signer_type = 'patient' and app.is_patient_self(organization_id, patient_id, 'onboarding'))
    or (signer_type = 'guardian' and app.is_my_guardian_record(organization_id, signer_guardian_id))
  )
  with check (withdrawn_by_profile_id = (select app.request_uid()));
grant insert (organization_id, consent_record_id, typed_name, checkbox_confirmed, ip_address, user_agent)
  on public.consent_record_evidence to app_definer;
create policy consent_record_evidence_insert_definer on public.consent_record_evidence for insert to app_definer
  with check (exists (
    select 1 from public.consent_records r
    where r.organization_id = consent_record_evidence.organization_id and r.id = consent_record_evidence.consent_record_id
      and r.signer_profile_id = (select app.request_uid()) and r.created_at = now()
  ));

grant create on schema app to app_definer;
alter function app.can_read_consent_evidence(uuid, uuid) owner to app_definer;
alter function app.patient_activation_missing(uuid, uuid) owner to app_definer;
alter function app.signable_version(uuid, uuid, uuid) owner to app_definer;
alter function app.sign_consent(uuid, text, uuid, uuid, public.consent_decision, text, boolean, bytea, inet, text, text)
  owner to app_definer;
alter function app.record_consent(uuid, uuid, uuid, public.signer_type, uuid, public.consent_method,
  public.consent_decision, timestamptz, text) owner to app_definer;
alter function app.withdraw_consent(uuid, text, uuid, text, text) owner to app_definer;
revoke create on schema app from app_definer;

revoke all on function app.consent_body_hash(jsonb) from public, anon, service_role;
revoke all on function app.can_read_consent_evidence(uuid, uuid) from public, anon, service_role;
revoke all on function app.signable_version(uuid, uuid, uuid) from public, anon, service_role, authenticated;
revoke all on function app.sign_consent(uuid, text, uuid, uuid, public.consent_decision, text, boolean, bytea, inet, text, text)
  from public, anon, service_role;
revoke all on function app.record_consent(uuid, uuid, uuid, public.signer_type, uuid, public.consent_method,
  public.consent_decision, timestamptz, text) from public, anon, service_role;
revoke all on function app.withdraw_consent(uuid, text, uuid, text, text) from public, anon, service_role;
revoke all on function app.guard_consent_template() from public, anon, authenticated, service_role;
revoke all on function app.guard_consent_template_version() from public, anon, authenticated, service_role;
revoke all on function app.guard_consent_record() from public, anon, authenticated, service_role;
grant execute on function app.consent_body_hash(jsonb) to authenticated, app_definer;
grant execute on function app.can_read_consent_evidence(uuid, uuid) to authenticated;
grant execute on function app.sign_consent(uuid, text, uuid, uuid, public.consent_decision, text, boolean, bytea, inet, text, text)
  to authenticated;
grant execute on function app.record_consent(uuid, uuid, uuid, public.signer_type, uuid, public.consent_method,
  public.consent_decision, timestamptz, text) to authenticated;
grant execute on function app.withdraw_consent(uuid, text, uuid, text, text) to authenticated;
