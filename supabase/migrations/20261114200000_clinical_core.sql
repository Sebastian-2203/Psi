-- =============================================================================
-- Phase 3 — clinical core (DATABASE.md §5.4, §6; SECURITY.md §4; ADR-006, ADR-015, ADR-016,
-- ADR-018, ADR-019 Option A). Forward-only. Authorized 2026-11-14.
--
-- Tables: clinical_section_definitions, clinical_note_types (per-org configuration),
--         clinical_records, clinical_record_sections, clinical_record_section_revisions,
--         clinical_assessments, clinical_diagnoses, treatment_plans, treatment_goals,
--         treatment_goal_patient_texts, therapy_sessions, clinical_notes,
--         clinical_note_addenda, file_objects.
-- Helpers: app.can_read_clinical, app.can_write_clinical (care team + aal2 + org status;
--          break-glass is NOT honoured yet: the grant approval workflow is still a deny stub,
--          so platform_admin has no clinical access at all).
-- Portal projections (SECURITY DEFINER, explicit checks): app.portal_patient_goals,
--          app.portal_upcoming_sessions. Patients/guardians have NO policy on any clinical table.
--
-- Deviations from DATABASE.md (documented in §13):
-- * section keys and note types are per-org configuration tables (CLR-02/NOTE-01 "configurable
--   per org") instead of the record_section_key / note_type enums.
-- * treatment_goal_patient_texts has no published_at: a text is visible to the portal iff its
--   plan is `active` and withdrawn_at is null (publication = plan activation).
-- * clinical_notes / clinical_assessments drafts are discarded with discarded_at (soft, audited);
--   no DELETE privilege anywhere.
-- * clinical records may be closed/reopened; while closed, record content is read-only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Enums (DATABASE.md §3)
-- -----------------------------------------------------------------------------
create type public.record_status as enum ('open', 'closed');
create type public.entry_status as enum ('draft', 'finalized');
create type public.code_system as enum ('cie10', 'cie11', 'dsm5tr', 'other');
create type public.diagnosis_status as enum ('provisional', 'confirmed', 'ruled_out', 'resolved');
create type public.plan_status as enum ('draft', 'active', 'completed', 'superseded', 'discontinued');
create type public.goal_status as enum ('open', 'in_progress', 'achieved', 'discontinued');
create type public.session_status as enum
  ('scheduled', 'held', 'cancelled_by_patient', 'cancelled_by_psychologist', 'no_show');
create type public.session_modality as enum ('in_person', 'remote_external', 'phone');
create type public.addendum_reason as enum ('correction', 'clarification', 'late_entry', 'other');
create type public.file_bucket as enum ('clinical-documents', 'activity-media', 'resources', 'branding', 'exports');
create type public.file_status as enum ('pending_upload', 'ready', 'quarantined', 'deleted');
create type public.section_audience as enum ('any', 'adult', 'minor');

-- -----------------------------------------------------------------------------
-- 2. Helpers
-- -----------------------------------------------------------------------------
-- Read: aal2 + active psychologist membership + active care-team row + org active|read_only
-- (all inside app.is_on_care_team). Break-glass deliberately absent until the approval
-- workflow exists (F-02); when added it must only ever extend READ.
create function app.can_read_clinical(p_org uuid, p_patient uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select app.is_on_care_team(p_org, p_patient)
$$;
comment on function app.can_read_clinical(uuid, uuid) is
  'Clinical READ: care team (aal2, psychologist, active row, org active|read_only). No platform_admin, no portal.';

create function app.can_write_clinical(p_org uuid, p_patient uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select app.is_on_care_team(p_org, p_patient) and app.org_allows(p_org, 'staff_write')
$$;
comment on function app.can_write_clinical(uuid, uuid) is
  'Clinical WRITE: can_read_clinical AND org active. Never satisfied by break-glass.';

create function app.can_manage_clinical_config(p_org uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select app.can_write_as_role(p_org, 'organization_owner') or app.can_write_as_role(p_org, 'psychologist')
$$;

-- Canonical content hash (jsonb text form is normalized by Postgres).
create function app.clinical_content_hash(p_body jsonb) returns bytea
language sql
immutable
set search_path = ''
as $$ select extensions.digest(p_body::text, 'sha256') $$;

-- A rich-text AST with at least one block (finalization / addenda must not be empty).
create function app.rich_text_has_content(p_body jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_body) = 'object' and jsonb_typeof(p_body -> 'blocks') = 'array'
     and jsonb_array_length(p_body -> 'blocks') > 0, false)
$$;

-- -----------------------------------------------------------------------------
-- 3. Per-org configuration (FICTIONAL generic defaults live in seed.sql)
-- -----------------------------------------------------------------------------
create table public.clinical_section_definitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,47}$'),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text null check (char_length(description) <= 500),
  audience public.section_audience not null default 'any',
  is_required boolean not null default false,
  position smallint not null default 0 check (position between 0 and 999),
  is_active boolean not null default true,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_section_definitions_org_id_key unique (organization_id, id),
  constraint clinical_section_definitions_org_key_key unique (organization_id, key)
);
comment on table public.clinical_section_definitions is
  'Per-org record section catalogue (CLR-02/03). Section list and wording [NEEDS PSYCHOLOGIST INPUT]. Keys never change; deactivate instead of delete.';
create trigger clinical_section_definitions_set_updated_at before update on public.clinical_section_definitions
  for each row execute function app.set_updated_at();

create table public.clinical_note_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,47}$'),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  description text null check (char_length(description) <= 500),
  position smallint not null default 0 check (position between 0 and 999),
  is_active boolean not null default true,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_note_types_org_id_key unique (organization_id, id),
  constraint clinical_note_types_org_key_key unique (organization_id, key)
);
comment on table public.clinical_note_types is
  'Per-org note formats (NOTE-01). Catalogue [NEEDS PSYCHOLOGIST INPUT]. Keys never change; deactivate instead of delete.';
create trigger clinical_note_types_set_updated_at before update on public.clinical_note_types
  for each row execute function app.set_updated_at();

create function app.guard_clinical_config() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id or new.key is distinct from old.key
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:' || tg_table_name;
  end if;
  return new;
end
$$;
create trigger clinical_section_definitions_guard before update on public.clinical_section_definitions
  for each row execute function app.guard_clinical_config();
create trigger clinical_note_types_guard before update on public.clinical_note_types
  for each row execute function app.guard_clinical_config();

-- -----------------------------------------------------------------------------
-- 4. file_objects (metadata of every storage object; bytes are written by the server only)
-- -----------------------------------------------------------------------------
create table public.file_objects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  patient_id uuid null,
  bucket public.file_bucket not null,
  storage_path text not null check (char_length(storage_path) <= 300),
  mime_type text not null check (mime_type ~ '^[a-z]+/[a-z0-9.+-]{1,100}$'),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 bytea null check (sha256 is null or octet_length(sha256) = 32),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 200
                                    and display_name !~ '[/\\<>:"|?*[:cntrl:]]'),
  status public.file_status not null default 'pending_upload',
  uploaded_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  constraint file_objects_org_id_key unique (organization_id, id),
  constraint file_objects_bucket_path_key unique (bucket, storage_path),
  constraint file_objects_patient_fkey foreign key (organization_id, patient_id)
    references public.patients (organization_id, id) on delete restrict,
  constraint file_objects_path_in_org check (storage_path like 'org/' || organization_id::text || '/%'),
  -- Clinical objects: org/<org>/patient/<patient>/<file id>, nothing else.
  constraint file_objects_clinical_path check (
    bucket <> 'clinical-documents'
    or (patient_id is not null
        and storage_path = 'org/' || organization_id::text || '/patient/' || patient_id::text || '/' || id::text)),
  constraint file_objects_ready_has_hash check (status <> 'ready' or sha256 is not null),
  constraint file_objects_deleted_consistent check ((status = 'deleted') = (deleted_at is not null))
);
create index file_objects_org_patient_idx on public.file_objects (organization_id, patient_id);
create index file_objects_uploaded_by_idx on public.file_objects (uploaded_by);
comment on table public.file_objects is
  'Storage object metadata. Clinical objects live in the PRIVATE clinical-documents bucket; only the server (service role, after an RLS check) writes bytes; reads are short-lived signed URLs after app.can_read_file.';
create trigger file_objects_set_updated_at before update on public.file_objects
  for each row execute function app.set_updated_at();

-- Only the status lifecycle may change: pending_upload -> ready | quarantined | deleted,
-- ready -> quarantined | deleted, quarantined -> deleted. Bytes are immutable once ready.
create function app.guard_file_object() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending_upload' or new.sha256 is not null or new.deleted_at is not null then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:file_must_start_pending';
    end if;
    if new.uploaded_by is distinct from (select app.request_uid()) then
      raise exception using errcode = '42501', message = 'FORBIDDEN:file_uploader';
    end if;
    return new;
  end if;
  if row(new.organization_id, new.patient_id, new.bucket, new.storage_path, new.uploaded_by, new.created_at)
     is distinct from row(old.organization_id, old.patient_id, old.bucket, old.storage_path, old.uploaded_by,
                          old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:file_objects';
  end if;
  if old.status <> 'pending_upload'
     and row(new.mime_type, new.size_bytes, new.sha256, new.display_name)
         is distinct from row(old.mime_type, old.size_bytes, old.sha256, old.display_name) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:file_objects';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'pending_upload' and new.status in ('ready', 'quarantined', 'deleted'))
    or (old.status = 'ready' and new.status in ('quarantined', 'deleted'))
    or (old.status = 'quarantined' and new.status = 'deleted')) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invalid_file_transition';
  end if;
  if old.status = 'deleted' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:file_objects';
  end if;
  new.deleted_at := case when new.status = 'deleted' then coalesce(old.deleted_at, now()) else null end;
  return new;
end
$$;
create trigger file_objects_guard before insert or update on public.file_objects
  for each row execute function app.guard_file_object();

-- -----------------------------------------------------------------------------
-- 5. clinical_records (one per patient per org; close / reopen)
-- -----------------------------------------------------------------------------
create table public.clinical_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  patient_id uuid not null,
  record_number text not null check (record_number ~ '^HC-[0-9A-F]{10}$'),
  status public.record_status not null default 'open',
  opened_at timestamptz not null default now(),
  opened_by_membership_id uuid not null,
  closed_at timestamptz null,
  closed_by_membership_id uuid null,
  closure_summary jsonb null check (closure_summary is null or jsonb_typeof(closure_summary) = 'object'),
  reopened_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_records_org_id_key unique (organization_id, id),
  constraint clinical_records_org_id_patient_key unique (organization_id, id, patient_id),
  constraint clinical_records_org_patient_key unique (organization_id, patient_id),
  constraint clinical_records_org_number_key unique (organization_id, record_number),
  constraint clinical_records_patient_fkey foreign key (organization_id, patient_id)
    references public.patients (organization_id, id) on delete restrict,
  constraint clinical_records_opener_fkey foreign key (organization_id, opened_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint clinical_records_closer_fkey foreign key (organization_id, closed_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint clinical_records_closed_consistent check (
    (status = 'closed') = (closed_at is not null and closed_by_membership_id is not null))
);
comment on table public.clinical_records is
  'One clinical record per patient per org (CLR-01; episodes = Q-12). Never deleted (CLR-07); retention [NEEDS LEGAL VERIFICATION].';
create trigger clinical_records_set_updated_at before update on public.clinical_records
  for each row execute function app.set_updated_at();

create function app.guard_clinical_record() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.my_membership_id(coalesce(new.organization_id, old.organization_id));
begin
  if tg_op = 'INSERT' then
    if new.opened_by_membership_id is distinct from v_me then
      raise exception using errcode = '42501', message = 'FORBIDDEN:record_opener';
    end if;
    new.status := 'open';
    new.opened_at := now();
    new.closed_at := null;
    new.closed_by_membership_id := null;
    new.closure_summary := null;
    new.reopened_at := null;
    new.record_number := 'HC-' || upper(substr(replace(new.id::text, '-', ''), 1, 10));
    return new;
  end if;
  if row(new.organization_id, new.patient_id, new.record_number, new.opened_at, new.opened_by_membership_id,
         new.created_at)
     is distinct from row(old.organization_id, old.patient_id, old.record_number, old.opened_at,
                          old.opened_by_membership_id, old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_records';
  end if;
  if new.status = old.status then
    if row(new.closed_at, new.closed_by_membership_id, new.closure_summary, new.reopened_at)
       is distinct from row(old.closed_at, old.closed_by_membership_id, old.closure_summary, old.reopened_at) then
      raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_records';
    end if;
    return new;
  end if;
  if new.status = 'closed' then
    if not app.rich_text_has_content(new.closure_summary) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:closure_summary_required';
    end if;
    new.closed_at := now();
    new.closed_by_membership_id := v_me;
  else
    -- reopen: the previous closure is kept in the audit trail; summary cleared.
    new.closed_at := null;
    new.closed_by_membership_id := null;
    new.closure_summary := null;
    new.reopened_at := now();
  end if;
  return new;
end
$$;
create trigger clinical_records_guard before insert or update on public.clinical_records
  for each row execute function app.guard_clinical_record();

-- Record content is writable only while the record is open (reads RLS-visible rows only).
create function app.assert_record_open(p_org uuid, p_record uuid) returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_status public.record_status;
begin
  select r.status into v_status from public.clinical_records r where r.organization_id = p_org and r.id = p_record;
  if v_status is null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND:clinical_record';
  elsif v_status <> 'open' then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:record_closed';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 6. clinical_record_sections + append-only revisions
-- -----------------------------------------------------------------------------
create table public.clinical_record_sections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  clinical_record_id uuid not null,
  patient_id uuid not null,
  section_definition_id uuid not null,
  content jsonb not null check (jsonb_typeof(content) = 'object' and octet_length(content::text) <= 200000),
  content_locale text not null default 'es' check (content_locale in ('es', 'en')),
  revision integer not null default 1 check (revision >= 1),
  last_edited_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_record_sections_org_id_key unique (organization_id, id),
  constraint clinical_record_sections_record_def_key unique (clinical_record_id, section_definition_id),
  constraint clinical_record_sections_record_fkey foreign key (organization_id, clinical_record_id, patient_id)
    references public.clinical_records (organization_id, id, patient_id) on delete restrict,
  constraint clinical_record_sections_def_fkey foreign key (organization_id, section_definition_id)
    references public.clinical_section_definitions (organization_id, id) on delete restrict,
  constraint clinical_record_sections_editor_fkey foreign key (organization_id, last_edited_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict
);
create index clinical_record_sections_org_patient_idx on public.clinical_record_sections (organization_id, patient_id);
create index clinical_record_sections_def_idx on public.clinical_record_sections (organization_id, section_definition_id);
create trigger clinical_record_sections_set_updated_at before update on public.clinical_record_sections
  for each row execute function app.set_updated_at();

create table public.clinical_record_section_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  section_id uuid not null,
  patient_id uuid not null,
  revision integer not null check (revision >= 1),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  content_locale text not null,
  edited_by_membership_id uuid not null,
  edited_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint clinical_record_section_revisions_section_rev_key unique (section_id, revision),
  constraint clinical_record_section_revisions_section_fkey foreign key (organization_id, section_id)
    references public.clinical_record_sections (organization_id, id) on delete restrict,
  constraint clinical_record_section_revisions_patient_fkey foreign key (organization_id, patient_id)
    references public.patients (organization_id, id) on delete restrict
);
create index clinical_record_section_revisions_org_patient_idx
  on public.clinical_record_section_revisions (organization_id, patient_id);
comment on table public.clinical_record_section_revisions is
  'Append-only history of record sections: every UPDATE of a section copies the previous content here (written only by app.capture_section_revision).';
create trigger clinical_record_section_revisions_append_only
  before update or delete on public.clinical_record_section_revisions
  for each row execute function app.reject_mutation();
create trigger clinical_record_section_revisions_no_truncate
  before truncate on public.clinical_record_section_revisions
  for each statement execute function app.reject_mutation();

-- Definer (owner app_definer): the only writer of revisions; authenticated has no INSERT.
create function app.capture_section_revision() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := app.my_membership_id(coalesce(new.organization_id, old.organization_id));
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_record_sections';
  end if;
  if v_me is null then
    raise exception using errcode = '42501', message = 'FORBIDDEN:section_editor';
  end if;
  perform app.assert_record_open(new.organization_id, new.clinical_record_id);
  if tg_op = 'INSERT' then
    new.revision := 1;
    new.last_edited_by_membership_id := v_me;
    return new;
  end if;
  if row(new.organization_id, new.clinical_record_id, new.patient_id, new.section_definition_id, new.created_at)
     is distinct from row(old.organization_id, old.clinical_record_id, old.patient_id, old.section_definition_id,
                          old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_record_sections';
  end if;
  if new.revision is distinct from old.revision then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:stale_revision';
  end if;
  insert into public.clinical_record_section_revisions
    (organization_id, section_id, patient_id, revision, content, content_locale, edited_by_membership_id, edited_at)
  values (old.organization_id, old.id, old.patient_id, old.revision, old.content, old.content_locale,
          old.last_edited_by_membership_id, old.updated_at);
  new.revision := old.revision + 1;
  new.last_edited_by_membership_id := v_me;
  return new;
end
$$;
create trigger clinical_record_sections_capture before insert or update or delete on public.clinical_record_sections
  for each row execute function app.capture_section_revision();

-- -----------------------------------------------------------------------------
-- 7. clinical_assessments (no scoring engine; finalized => frozen)
-- -----------------------------------------------------------------------------
create table public.clinical_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  clinical_record_id uuid not null,
  patient_id uuid not null,
  assessed_on date not null,
  instrument_name text not null check (char_length(btrim(instrument_name)) between 1 and 200),
  instrument_reference text null check (char_length(instrument_reference) <= 300),
  administered_by text null check (char_length(administered_by) <= 200),
  results jsonb not null check (jsonb_typeof(results) = 'object' and octet_length(results::text) <= 200000),
  interpretation jsonb null check (interpretation is null or (jsonb_typeof(interpretation) = 'object'
                                                              and octet_length(interpretation::text) <= 200000)),
  attachment_file_id uuid null,
  corrects_assessment_id uuid null,
  status public.entry_status not null default 'draft',
  author_membership_id uuid not null,
  finalized_at timestamptz null,
  finalized_by_membership_id uuid null,
  content_hash bytea null,
  discarded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_assessments_org_id_key unique (organization_id, id),
  constraint clinical_assessments_org_id_patient_key unique (organization_id, id, patient_id),
  constraint clinical_assessments_record_fkey foreign key (organization_id, clinical_record_id, patient_id)
    references public.clinical_records (organization_id, id, patient_id) on delete restrict,
  constraint clinical_assessments_author_fkey foreign key (organization_id, author_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint clinical_assessments_finalizer_fkey foreign key (organization_id, finalized_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint clinical_assessments_file_fkey foreign key (organization_id, attachment_file_id)
    references public.file_objects (organization_id, id) on delete restrict,
  constraint clinical_assessments_corrects_fkey foreign key (organization_id, corrects_assessment_id, patient_id)
    references public.clinical_assessments (organization_id, id, patient_id) on delete restrict,
  constraint clinical_assessments_finalized_consistent check (
    (status = 'finalized') = (finalized_at is not null and finalized_by_membership_id is not null
                              and content_hash is not null)),
  constraint clinical_assessments_discard_draft_only check (discarded_at is null or status = 'draft')
);
create index clinical_assessments_org_patient_idx on public.clinical_assessments (organization_id, patient_id, assessed_on desc);
create index clinical_assessments_record_idx on public.clinical_assessments (organization_id, clinical_record_id);
create index clinical_assessments_author_idx on public.clinical_assessments (organization_id, author_membership_id);
create index clinical_assessments_file_idx on public.clinical_assessments (organization_id, attachment_file_id);
create index clinical_assessments_corrects_idx on public.clinical_assessments (organization_id, corrects_assessment_id);
create trigger clinical_assessments_set_updated_at before update on public.clinical_assessments
  for each row execute function app.set_updated_at();

create function app.assessment_hash(a public.clinical_assessments) returns bytea
language sql
immutable
set search_path = ''
as $$
  select app.clinical_content_hash(jsonb_build_object(
    'assessed_on', a.assessed_on, 'instrument_name', a.instrument_name,
    'instrument_reference', a.instrument_reference, 'administered_by', a.administered_by,
    'results', a.results, 'interpretation', a.interpretation, 'attachment_file_id', a.attachment_file_id))
$$;

-- An attachment must be a READY clinical file of the same patient (visible to the caller).
create function app.assert_assessment_attachment(a public.clinical_assessments) returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if a.attachment_file_id is not null and not exists (
       select 1 from public.file_objects f
       where f.organization_id = a.organization_id and f.id = a.attachment_file_id
         and f.patient_id = a.patient_id and f.bucket = 'clinical-documents' and f.status = 'ready') then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:attachment_not_ready';
  end if;
end
$$;

create function app.guard_clinical_assessment() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.my_membership_id(coalesce(new.organization_id, old.organization_id));
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_assessments';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.author_membership_id is distinct from v_me or new.discarded_at is not null then
      raise exception using errcode = '42501', message = 'FORBIDDEN:assessment_insert';
    end if;
    perform app.assert_record_open(new.organization_id, new.clinical_record_id);
    if new.corrects_assessment_id is not null and not exists (
         select 1 from public.clinical_assessments c
         where c.organization_id = new.organization_id and c.id = new.corrects_assessment_id
           and c.status = 'finalized') then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:corrects_must_be_finalized';
    end if;
    new.finalized_at := null; new.finalized_by_membership_id := null; new.content_hash := null;
    perform app.assert_assessment_attachment(new);
    return new;
  end if;
  if old.status = 'finalized' or old.discarded_at is not null then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_assessments';
  end if;
  if row(new.organization_id, new.clinical_record_id, new.patient_id, new.author_membership_id,
         new.corrects_assessment_id, new.created_at)
     is distinct from row(old.organization_id, old.clinical_record_id, old.patient_id, old.author_membership_id,
                          old.corrects_assessment_id, old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_assessments';
  end if;
  if old.author_membership_id is distinct from v_me then
    raise exception using errcode = '42501', message = 'FORBIDDEN:assessment_author_only';
  end if;
  perform app.assert_record_open(new.organization_id, new.clinical_record_id);
  if new.attachment_file_id is distinct from old.attachment_file_id then
    perform app.assert_assessment_attachment(new);
  end if;
  if new.status = 'finalized' then
    if row(new.assessed_on, new.instrument_name, new.instrument_reference, new.administered_by, new.results,
           new.interpretation, new.attachment_file_id, new.discarded_at)
       is distinct from row(old.assessed_on, old.instrument_name, old.instrument_reference, old.administered_by,
                            old.results, old.interpretation, old.attachment_file_id, old.discarded_at)
       or new.finalized_by_membership_id is distinct from v_me
       or new.content_hash is distinct from app.assessment_hash(new) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:finalize';
    end if;
    if not app.rich_text_has_content(new.results) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:assessment_empty';
    end if;
    new.finalized_at := now();
  else
    new.finalized_at := null; new.finalized_by_membership_id := null; new.content_hash := null;
    if new.discarded_at is not null then
      new.discarded_at := now();
    end if;
  end if;
  return new;
end
$$;
create trigger clinical_assessments_guard before insert or update or delete on public.clinical_assessments
  for each row execute function app.guard_clinical_assessment();

-- -----------------------------------------------------------------------------
-- 8. clinical_diagnoses (professional-entered; the system never proposes one, CLR-06)
-- -----------------------------------------------------------------------------
create table public.clinical_diagnoses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  clinical_record_id uuid not null,
  patient_id uuid not null,
  code_system public.code_system not null,
  code text null check (code ~ '^[A-Za-z0-9][A-Za-z0-9.\-]{0,19}$'),
  label text not null check (char_length(btrim(label)) between 1 and 300),
  status public.diagnosis_status not null default 'provisional',
  diagnosed_on date not null,
  resolved_on date null,
  notes jsonb null check (notes is null or jsonb_typeof(notes) = 'object'),
  recorded_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_diagnoses_org_id_key unique (organization_id, id),
  constraint clinical_diagnoses_record_fkey foreign key (organization_id, clinical_record_id, patient_id)
    references public.clinical_records (organization_id, id, patient_id) on delete restrict,
  constraint clinical_diagnoses_recorder_fkey foreign key (organization_id, recorded_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint clinical_diagnoses_resolved_after check (resolved_on is null or resolved_on >= diagnosed_on),
  constraint clinical_diagnoses_code_needed check (code_system = 'other' or code is not null)
);
create index clinical_diagnoses_org_patient_idx on public.clinical_diagnoses (organization_id, patient_id);
create index clinical_diagnoses_record_idx on public.clinical_diagnoses (organization_id, clinical_record_id);
create index clinical_diagnoses_recorder_idx on public.clinical_diagnoses (organization_id, recorded_by_membership_id);
comment on table public.clinical_diagnoses is
  'Diagnostic impressions typed by the psychologist (CLR-06). Only status/resolved_on change; code/label changes = new row. Code catalogue [NEEDS PSYCHOLOGIST INPUT].';
create trigger clinical_diagnoses_set_updated_at before update on public.clinical_diagnoses
  for each row execute function app.set_updated_at();

create function app.guard_clinical_diagnosis() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_diagnoses';
  end if;
  perform app.assert_record_open(new.organization_id, new.clinical_record_id);
  if tg_op = 'INSERT' then
    if new.recorded_by_membership_id is distinct from app.my_membership_id(new.organization_id) then
      raise exception using errcode = '42501', message = 'FORBIDDEN:diagnosis_recorder';
    end if;
    return new;
  end if;
  if row(new.organization_id, new.clinical_record_id, new.patient_id, new.code_system, new.code, new.label,
         new.diagnosed_on, new.notes, new.recorded_by_membership_id, new.created_at)
     is distinct from row(old.organization_id, old.clinical_record_id, old.patient_id, old.code_system, old.code,
                          old.label, old.diagnosed_on, old.notes, old.recorded_by_membership_id, old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_diagnoses';
  end if;
  return new;
end
$$;
create trigger clinical_diagnoses_guard before insert or update or delete on public.clinical_diagnoses
  for each row execute function app.guard_clinical_diagnosis();

-- -----------------------------------------------------------------------------
-- 9. treatment_plans, treatment_goals, treatment_goal_patient_texts [split]
-- -----------------------------------------------------------------------------
create table public.treatment_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  clinical_record_id uuid not null,
  patient_id uuid not null,
  version integer not null check (version >= 1),
  status public.plan_status not null default 'draft',
  supersedes_plan_id uuid null,
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 200000),
  interventions jsonb null check (interventions is null or jsonb_typeof(interventions) = 'object'),
  frequency text null check (char_length(frequency) <= 200),
  start_date date not null,
  review_date date null,
  author_membership_id uuid not null,
  activated_at timestamptz null,
  ended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treatment_plans_org_id_key unique (organization_id, id),
  constraint treatment_plans_org_id_patient_key unique (organization_id, id, patient_id),
  constraint treatment_plans_record_version_key unique (clinical_record_id, version),
  constraint treatment_plans_record_fkey foreign key (organization_id, clinical_record_id, patient_id)
    references public.clinical_records (organization_id, id, patient_id) on delete restrict,
  constraint treatment_plans_supersedes_fkey foreign key (organization_id, supersedes_plan_id, patient_id)
    references public.treatment_plans (organization_id, id, patient_id) on delete restrict,
  constraint treatment_plans_author_fkey foreign key (organization_id, author_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint treatment_plans_review_after check (review_date is null or review_date >= start_date),
  constraint treatment_plans_activated_consistent check ((status = 'draft') = (activated_at is null)
                                                        or status = 'discontinued')
);
create unique index treatment_plans_one_active on public.treatment_plans (clinical_record_id) where status = 'active';
create unique index treatment_plans_one_draft on public.treatment_plans (clinical_record_id) where status = 'draft';
create index treatment_plans_org_patient_idx on public.treatment_plans (organization_id, patient_id);
create index treatment_plans_supersedes_idx on public.treatment_plans (organization_id, supersedes_plan_id);
create index treatment_plans_author_idx on public.treatment_plans (organization_id, author_membership_id);
create trigger treatment_plans_set_updated_at before update on public.treatment_plans
  for each row execute function app.set_updated_at();

create table public.treatment_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  treatment_plan_id uuid not null,
  patient_id uuid not null,
  position smallint not null default 0 check (position between 0 and 99),
  description jsonb not null check (jsonb_typeof(description) = 'object' and octet_length(description::text) <= 50000),
  status public.goal_status not null default 'open',
  target_date date null,
  achieved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treatment_goals_org_id_key unique (organization_id, id),
  constraint treatment_goals_org_id_patient_key unique (organization_id, id, patient_id),
  constraint treatment_goals_plan_fkey foreign key (organization_id, treatment_plan_id, patient_id)
    references public.treatment_plans (organization_id, id, patient_id) on delete restrict,
  constraint treatment_goals_achieved_consistent check ((status = 'achieved') = (achieved_at is not null))
);
create index treatment_goals_plan_idx on public.treatment_goals (organization_id, treatment_plan_id, position);
create index treatment_goals_org_patient_idx on public.treatment_goals (organization_id, patient_id);
create trigger treatment_goals_set_updated_at before update on public.treatment_goals
  for each row execute function app.set_updated_at();

create table public.treatment_goal_patient_texts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  treatment_goal_id uuid not null,
  patient_id uuid not null,
  patient_facing_text jsonb not null check (jsonb_typeof(patient_facing_text) = 'object'
                                            and octet_length(patient_facing_text::text) <= 20000),
  author_membership_id uuid not null,
  withdrawn_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint treatment_goal_patient_texts_goal_key unique (treatment_goal_id),
  constraint treatment_goal_patient_texts_goal_fkey foreign key (organization_id, treatment_goal_id, patient_id)
    references public.treatment_goals (organization_id, id, patient_id) on delete restrict,
  constraint treatment_goal_patient_texts_author_fkey foreign key (organization_id, author_membership_id)
    references public.memberships (organization_id, id) on delete restrict
);
create index treatment_goal_patient_texts_org_patient_idx on public.treatment_goal_patient_texts (organization_id, patient_id);
comment on table public.treatment_goal_patient_texts is
  'Patient-facing wording of a goal (TPL-03, F-08b). Portal reads ONLY via app.portal_patient_goals (plan active, not withdrawn). The clinical description is never reachable from the portal.';
create trigger treatment_goal_patient_texts_set_updated_at before update on public.treatment_goal_patient_texts
  for each row execute function app.set_updated_at();

create function app.plan_status_of(p_org uuid, p_plan uuid) returns public.plan_status
language sql
stable
set search_path = ''
as $$
  select p.status from public.treatment_plans p where p.organization_id = p_org and p.id = p_plan
$$;

create function app.guard_treatment_plan() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.my_membership_id(coalesce(new.organization_id, old.organization_id));
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:treatment_plans';
  end if;
  if tg_op = 'INSERT' then
    perform app.assert_record_open(new.organization_id, new.clinical_record_id);
    if new.status <> 'draft' or new.author_membership_id is distinct from v_me then
      raise exception using errcode = '42501', message = 'FORBIDDEN:plan_insert';
    end if;
    new.version := coalesce((select max(p.version) from public.treatment_plans p
                             where p.organization_id = new.organization_id
                               and p.clinical_record_id = new.clinical_record_id), 0) + 1;
    new.activated_at := null; new.ended_at := null;
    return new;
  end if;
  if row(new.organization_id, new.clinical_record_id, new.patient_id, new.version, new.supersedes_plan_id,
         new.author_membership_id, new.created_at)
     is distinct from row(old.organization_id, old.clinical_record_id, old.patient_id, old.version,
                          old.supersedes_plan_id, old.author_membership_id, old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:treatment_plans';
  end if;
  if old.status in ('completed', 'superseded', 'discontinued') then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:treatment_plans';
  end if;
  if old.status = 'active' then
    if row(new.summary, new.interventions, new.frequency, new.start_date, new.review_date, new.activated_at)
       is distinct from row(old.summary, old.interventions, old.frequency, old.start_date, old.review_date,
                            old.activated_at)
       or new.status not in ('active', 'completed', 'superseded', 'discontinued') then
      raise exception using errcode = 'P0001', message = 'IMMUTABLE:treatment_plans';
    end if;
    if new.status <> 'active' then
      new.ended_at := now();
    end if;
    return new;
  end if;
  -- old.status = 'draft'
  perform app.assert_record_open(new.organization_id, new.clinical_record_id);
  if new.status = 'draft' then
    new.activated_at := null;
  elsif new.status = 'active' then
    if not app.rich_text_has_content(new.summary) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:plan_summary_empty';
    end if;
    if not exists (select 1 from public.treatment_goals g
                   where g.organization_id = new.organization_id and g.treatment_plan_id = new.id) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:plan_without_goals';
    end if;
    -- The current active plan of the record is superseded in the same statement.
    update public.treatment_plans p set status = 'superseded'
     where p.organization_id = new.organization_id and p.clinical_record_id = new.clinical_record_id
       and p.status = 'active' and p.id <> new.id;
    new.activated_at := now();
  elsif new.status = 'discontinued' then
    new.ended_at := now();
  else
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invalid_plan_transition';
  end if;
  return new;
end
$$;
create trigger treatment_plans_guard before insert or update or delete on public.treatment_plans
  for each row execute function app.guard_treatment_plan();

create function app.guard_treatment_goal() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_plan public.plan_status;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:treatment_goals';
  end if;
  v_plan := app.plan_status_of(new.organization_id, new.treatment_plan_id);
  if tg_op = 'INSERT' then
    if v_plan is distinct from 'draft' then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:plan_not_draft';
    end if;
  else
    if row(new.organization_id, new.treatment_plan_id, new.patient_id, new.created_at)
       is distinct from row(old.organization_id, old.treatment_plan_id, old.patient_id, old.created_at) then
      raise exception using errcode = 'P0001', message = 'IMMUTABLE:treatment_goals';
    end if;
    if v_plan = 'active' then
      if row(new.position, new.description, new.target_date)
         is distinct from row(old.position, old.description, old.target_date) then
        raise exception using errcode = 'P0001', message = 'IMMUTABLE:treatment_goals';
      end if;
    elsif v_plan is distinct from 'draft' then
      raise exception using errcode = 'P0001', message = 'IMMUTABLE:treatment_goals';
    end if;
  end if;
  new.achieved_at := case when new.status = 'achieved'
                          then coalesce(case when tg_op = 'UPDATE' then old.achieved_at end, now())
                          else null end;
  return new;
end
$$;
create trigger treatment_goals_guard before insert or update or delete on public.treatment_goals
  for each row execute function app.guard_treatment_goal();

create function app.guard_goal_patient_text() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid := coalesce(new.organization_id, old.organization_id);
  v_goal uuid := coalesce(new.treatment_goal_id, old.treatment_goal_id);
  v_plan public.plan_status;
begin
  select app.plan_status_of(g.organization_id, g.treatment_plan_id) into v_plan
  from public.treatment_goals g where g.organization_id = v_org and g.id = v_goal;
  if tg_op = 'DELETE' then
    if v_plan is distinct from 'draft' then
      raise exception using errcode = 'P0001', message = 'IMMUTABLE:treatment_goal_patient_texts';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if v_plan is distinct from 'draft' then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:plan_not_draft';
    end if;
    if new.author_membership_id is distinct from app.my_membership_id(new.organization_id)
       or new.withdrawn_at is not null then
      raise exception using errcode = '42501', message = 'FORBIDDEN:goal_text_insert';
    end if;
    return new;
  end if;
  if row(new.organization_id, new.treatment_goal_id, new.patient_id, new.created_at)
     is distinct from row(old.organization_id, old.treatment_goal_id, old.patient_id, old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:treatment_goal_patient_texts';
  end if;
  if v_plan = 'draft' then
    if new.withdrawn_at is not null then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:plan_not_active';
    end if;
    new.author_membership_id := app.my_membership_id(new.organization_id);
    return new;
  end if;
  -- Frozen with its plan: only a one-time withdrawal (plan active).
  if v_plan = 'active' and old.withdrawn_at is null and new.withdrawn_at is not null
     and row(new.patient_facing_text, new.author_membership_id)
         is not distinct from row(old.patient_facing_text, old.author_membership_id) then
    new.withdrawn_at := now();
    return new;
  end if;
  raise exception using errcode = 'P0001', message = 'IMMUTABLE:treatment_goal_patient_texts';
end
$$;
create trigger treatment_goal_patient_texts_guard before insert or update or delete on public.treatment_goal_patient_texts
  for each row execute function app.guard_goal_patient_text();

-- Revise: new draft (version + 1) copying summary, goals and patient texts (TPL-02).
create function app.revise_treatment_plan(p_org uuid, p_plan uuid, p_request_id text default null) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_src public.treatment_plans;
  v_new uuid;
  g record;
  v_goal uuid;
begin
  select * into v_src from public.treatment_plans where organization_id = p_org and id = p_plan;
  if not found or not app.can_write_clinical(p_org, v_src.patient_id) then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND:treatment_plan';
  end if;
  if v_src.status = 'draft' then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:plan_is_draft';
  end if;
  insert into public.treatment_plans (organization_id, clinical_record_id, patient_id, version, supersedes_plan_id,
                                      summary, interventions, frequency, start_date, review_date, author_membership_id)
  values (p_org, v_src.clinical_record_id, v_src.patient_id, 1, v_src.id, v_src.summary, v_src.interventions,
          v_src.frequency, current_date, v_src.review_date, app.my_membership_id(p_org))
  returning id into v_new;
  for g in select * from public.treatment_goals where organization_id = p_org and treatment_plan_id = p_plan
           order by position loop
    insert into public.treatment_goals (organization_id, treatment_plan_id, patient_id, position, description,
                                        status, target_date)
    values (p_org, v_new, g.patient_id, g.position, g.description, g.status, g.target_date)
    returning id into v_goal;
    insert into public.treatment_goal_patient_texts (organization_id, treatment_goal_id, patient_id,
                                                     patient_facing_text, author_membership_id)
    select p_org, v_goal, t.patient_id, t.patient_facing_text, app.my_membership_id(p_org)
    from public.treatment_goal_patient_texts t
    where t.organization_id = p_org and t.treatment_goal_id = g.id and t.withdrawn_at is null;
  end loop;
  perform app.write_audit('treatment_plan.revised', p_org, 'treatment_plan', v_new,
    jsonb_build_object('patient_id', v_src.patient_id, 'supersedes_plan_id', v_src.id),
    p_request_id);
  return v_new;
end
$$;

-- -----------------------------------------------------------------------------
-- 10. therapy_sessions (record only; no scheduling engine, SES-07)
-- -----------------------------------------------------------------------------
create table public.therapy_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  patient_id uuid not null,
  psychologist_membership_id uuid not null,
  treatment_plan_id uuid null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  status public.session_status not null default 'held',
  modality public.session_modality not null,
  cancelled_reason text null check (char_length(cancelled_reason) <= 500),
  location_or_link text null check (char_length(location_or_link) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint therapy_sessions_org_id_key unique (organization_id, id),
  constraint therapy_sessions_org_id_patient_key unique (organization_id, id, patient_id),
  constraint therapy_sessions_patient_fkey foreign key (organization_id, patient_id)
    references public.patients (organization_id, id) on delete restrict,
  constraint therapy_sessions_psychologist_fkey foreign key (organization_id, psychologist_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint therapy_sessions_plan_fkey foreign key (organization_id, treatment_plan_id, patient_id)
    references public.treatment_plans (organization_id, id, patient_id) on delete restrict,
  constraint therapy_sessions_time_order check (scheduled_end > scheduled_start
                                                and scheduled_end <= scheduled_start + interval '12 hours'),
  constraint therapy_sessions_cancel_reason check (cancelled_reason is null
                                                   or status in ('cancelled_by_patient', 'cancelled_by_psychologist'))
);
create index therapy_sessions_psy_start_idx on public.therapy_sessions (organization_id, psychologist_membership_id, scheduled_start);
create index therapy_sessions_patient_start_idx on public.therapy_sessions (organization_id, patient_id, scheduled_start desc);
create index therapy_sessions_plan_idx on public.therapy_sessions (organization_id, treatment_plan_id);
create trigger therapy_sessions_set_updated_at before update on public.therapy_sessions
  for each row execute function app.set_updated_at();

create function app.guard_therapy_session() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:therapy_sessions';
  end if;
  if tg_op = 'INSERT' then
    if new.psychologist_membership_id is distinct from app.my_membership_id(new.organization_id) then
      raise exception using errcode = '42501', message = 'FORBIDDEN:session_psychologist';
    end if;
    return new;
  end if;
  if row(new.organization_id, new.patient_id, new.psychologist_membership_id, new.created_at)
     is distinct from row(old.organization_id, old.patient_id, old.psychologist_membership_id, old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:therapy_sessions';
  end if;
  if new.status not in ('cancelled_by_patient', 'cancelled_by_psychologist') then
    new.cancelled_reason := null;
  end if;
  return new;
end
$$;
create trigger therapy_sessions_guard before insert or update or delete on public.therapy_sessions
  for each row execute function app.guard_therapy_session();

-- -----------------------------------------------------------------------------
-- 11. clinical_notes (draft -> finalized; author-only drafts) + addenda (append-only)
-- -----------------------------------------------------------------------------
create table public.clinical_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  clinical_record_id uuid not null,
  patient_id uuid not null,
  therapy_session_id uuid null,
  note_type_id uuid not null,
  body jsonb not null check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 200000),
  content_locale text not null default 'es' check (content_locale in ('es', 'en')),
  status public.entry_status not null default 'draft',
  author_membership_id uuid not null,
  finalized_at timestamptz null,
  finalized_by_membership_id uuid null,
  content_hash bytea null,
  discarded_at timestamptz null,
  discard_reason text null check (char_length(discard_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_notes_org_id_key unique (organization_id, id),
  constraint clinical_notes_org_id_patient_key unique (organization_id, id, patient_id),
  constraint clinical_notes_record_fkey foreign key (organization_id, clinical_record_id, patient_id)
    references public.clinical_records (organization_id, id, patient_id) on delete restrict,
  constraint clinical_notes_session_fkey foreign key (organization_id, therapy_session_id, patient_id)
    references public.therapy_sessions (organization_id, id, patient_id) on delete restrict,
  constraint clinical_notes_type_fkey foreign key (organization_id, note_type_id)
    references public.clinical_note_types (organization_id, id) on delete restrict,
  constraint clinical_notes_author_fkey foreign key (organization_id, author_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint clinical_notes_finalizer_fkey foreign key (organization_id, finalized_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint clinical_notes_finalized_consistent check (
    (status = 'finalized') = (finalized_at is not null and finalized_by_membership_id is not null
                              and content_hash is not null)),
  constraint clinical_notes_discard_draft_only check (discarded_at is null or status = 'draft'),
  constraint clinical_notes_discard_consistent check ((discarded_at is null) = (discard_reason is null))
);
create index clinical_notes_org_patient_created_idx on public.clinical_notes (organization_id, patient_id, created_at desc);
create index clinical_notes_record_idx on public.clinical_notes (organization_id, clinical_record_id);
create index clinical_notes_session_idx on public.clinical_notes (organization_id, therapy_session_id);
create index clinical_notes_type_idx on public.clinical_notes (organization_id, note_type_id);
create index clinical_notes_author_idx on public.clinical_notes (organization_id, author_membership_id, status);
comment on table public.clinical_notes is
  'Progress notes (NOTE-01..04). NEVER visible to patients or guardians; no share path exists. Finalized => immutable (trigger); corrections are clinical_note_addenda. Drafts are author-only [NEEDS PSYCHOLOGIST INPUT].';
create trigger clinical_notes_set_updated_at before update on public.clinical_notes
  for each row execute function app.set_updated_at();

-- SECURITY.md §4.4f: self-validating finalization, applies to every role incl. table owner paths.
create function app.guard_clinical_note() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.my_membership_id(coalesce(new.organization_id, old.organization_id));
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_notes';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.author_membership_id is distinct from v_me
       or new.discarded_at is not null or new.discard_reason is not null then
      raise exception using errcode = '42501', message = 'FORBIDDEN:note_insert';
    end if;
    if not exists (select 1 from public.clinical_note_types t
                   where t.organization_id = new.organization_id and t.id = new.note_type_id and t.is_active) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:note_type_inactive';
    end if;
    perform app.assert_record_open(new.organization_id, new.clinical_record_id);
    new.finalized_at := null; new.finalized_by_membership_id := null; new.content_hash := null;
    return new;
  end if;
  if old.status = 'finalized' or old.discarded_at is not null then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_notes';
  end if;
  if old.author_membership_id is distinct from v_me then
    raise exception using errcode = '42501', message = 'FORBIDDEN:note_author_only';
  end if;
  if row(new.organization_id, new.clinical_record_id, new.patient_id, new.author_membership_id, new.created_at)
     is distinct from row(old.organization_id, old.clinical_record_id, old.patient_id, old.author_membership_id,
                          old.created_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_notes';
  end if;
  perform app.assert_record_open(new.organization_id, new.clinical_record_id);
  if new.status = 'finalized' then
    if row(new.body, new.content_locale, new.note_type_id, new.therapy_session_id, new.discarded_at)
       is distinct from row(old.body, old.content_locale, old.note_type_id, old.therapy_session_id, old.discarded_at)
       or new.finalized_by_membership_id is distinct from v_me
       or new.content_hash is distinct from app.clinical_content_hash(new.body) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:finalize';
    end if;
    if not app.rich_text_has_content(new.body) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:note_empty';
    end if;
    new.finalized_at := now();
  else
    new.finalized_at := null; new.finalized_by_membership_id := null; new.content_hash := null;
    if new.discarded_at is not null then
      if row(new.body, new.content_locale, new.note_type_id, new.therapy_session_id)
         is distinct from row(old.body, old.content_locale, old.note_type_id, old.therapy_session_id) then
        raise exception using errcode = 'P0001', message = 'PRECONDITION:discard_changes_content';
      end if;
      new.discarded_at := now();
    end if;
  end if;
  return new;
end
$$;
create trigger clinical_notes_guard before insert or update or delete on public.clinical_notes
  for each row execute function app.guard_clinical_note();
create trigger clinical_notes_no_truncate before truncate on public.clinical_notes
  for each statement execute function app.reject_mutation();

create table public.clinical_note_addenda (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  clinical_note_id uuid not null,
  patient_id uuid not null,
  reason public.addendum_reason not null,
  body jsonb not null check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 100000),
  content_locale text not null default 'es' check (content_locale in ('es', 'en')),
  author_membership_id uuid not null,
  content_hash bytea not null,
  idempotency_key uuid null,
  created_at timestamptz not null default now(),
  constraint clinical_note_addenda_org_id_key unique (organization_id, id),
  constraint clinical_note_addenda_idem_key unique (organization_id, author_membership_id, idempotency_key),
  constraint clinical_note_addenda_note_fkey foreign key (organization_id, clinical_note_id, patient_id)
    references public.clinical_notes (organization_id, id, patient_id) on delete restrict,
  constraint clinical_note_addenda_author_fkey foreign key (organization_id, author_membership_id)
    references public.memberships (organization_id, id) on delete restrict
);
create index clinical_note_addenda_note_idx on public.clinical_note_addenda (organization_id, clinical_note_id, created_at);
create index clinical_note_addenda_org_patient_idx on public.clinical_note_addenda (organization_id, patient_id);
create index clinical_note_addenda_author_idx on public.clinical_note_addenda (organization_id, author_membership_id);
comment on table public.clinical_note_addenda is
  'Append-only corrections/clarifications of FINALIZED notes (ADR-006, NOTE-03). Never updated or deleted.';

create function app.guard_note_addendum() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.author_membership_id is distinct from app.my_membership_id(new.organization_id) then
    raise exception using errcode = '42501', message = 'FORBIDDEN:addendum_author';
  end if;
  if not exists (select 1 from public.clinical_notes n
                 where n.organization_id = new.organization_id and n.id = new.clinical_note_id
                   and n.status = 'finalized') then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:note_not_finalized';
  end if;
  if not app.rich_text_has_content(new.body) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:addendum_empty';
  end if;
  new.content_hash := app.clinical_content_hash(new.body);
  new.created_at := now();
  return new;
end
$$;
create trigger clinical_note_addenda_guard before insert on public.clinical_note_addenda
  for each row execute function app.guard_note_addendum();
create trigger clinical_note_addenda_append_only before update or delete on public.clinical_note_addenda
  for each row execute function app.reject_mutation();
create trigger clinical_note_addenda_no_truncate before truncate on public.clinical_note_addenda
  for each statement execute function app.reject_mutation();

-- Atomic finalize + audit (ADR-006/018). Invoker: RLS + the guard trigger decide.
create function app.finalize_clinical_note(p_org uuid, p_note uuid, p_request_id text default null)
returns table (finalized_at timestamptz, content_hash text)
language plpgsql
set search_path = ''
as $$
declare
  v_n public.clinical_notes;
begin
  select * into v_n from public.clinical_notes n where n.organization_id = p_org and n.id = p_note for update;
  if not found or v_n.discarded_at is not null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND:clinical_note';
  end if;
  if v_n.status = 'finalized' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_notes';
  end if;
  update public.clinical_notes n
     set status = 'finalized', finalized_by_membership_id = app.my_membership_id(p_org),
         content_hash = app.clinical_content_hash(n.body)
   where n.organization_id = p_org and n.id = p_note
  returning * into v_n;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND:clinical_note';
  end if;
  perform app.write_audit('clinical_note.finalized', p_org, 'clinical_note', p_note,
    jsonb_build_object('patient_id', v_n.patient_id), p_request_id);
  return query select v_n.finalized_at, encode(v_n.content_hash, 'hex');
end
$$;

create function app.finalize_clinical_assessment(p_org uuid, p_assessment uuid, p_request_id text default null)
returns table (finalized_at timestamptz, content_hash text)
language plpgsql
set search_path = ''
as $$
declare
  v_a public.clinical_assessments;
begin
  select * into v_a from public.clinical_assessments a where a.organization_id = p_org and a.id = p_assessment for update;
  if not found or v_a.discarded_at is not null then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND:clinical_assessment';
  end if;
  if v_a.status = 'finalized' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_assessments';
  end if;
  update public.clinical_assessments a
     set status = 'finalized', finalized_by_membership_id = app.my_membership_id(p_org),
         content_hash = app.assessment_hash(a)
   where a.organization_id = p_org and a.id = p_assessment
  returning * into v_a;
  if not found then
    raise exception using errcode = 'P0001', message = 'NOT_FOUND:clinical_assessment';
  end if;
  perform app.write_audit('clinical_assessment.finalized', p_org, 'clinical_assessment', p_assessment,
    jsonb_build_object('patient_id', v_a.patient_id), p_request_id);
  return query select v_a.finalized_at, encode(v_a.content_hash, 'hex');
end
$$;

-- -----------------------------------------------------------------------------
-- 12. Portal projections (SECURITY DEFINER: callers have NO row access to the base tables)
-- -----------------------------------------------------------------------------
-- Patient-facing goals of the ACTIVE plan: wording written for the patient + goal status only.
create function app.portal_patient_goals(p_org uuid, p_patient uuid)
returns table (goal_id uuid, patient_facing_text jsonb, status public.goal_status, goal_position smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, t.patient_facing_text, g.status, g.position
  from public.treatment_goal_patient_texts t
  join public.treatment_goals g on g.organization_id = t.organization_id and g.id = t.treatment_goal_id
  join public.treatment_plans p on p.organization_id = g.organization_id and p.id = g.treatment_plan_id
  where t.organization_id = p_org and t.patient_id = p_patient
    and p.status = 'active' and t.withdrawn_at is null
    and (app.is_patient_self(p_org, p_patient, 'portal')
         or app.guardian_can(p_org, p_patient, 'view_patient_facing_goals'))
  order by g.position
$$;

-- Upcoming sessions: date/time/status/modality only. Guardians need view_session_schedule and
-- no active restrict_schedule caveat on their relationship (GRD-08).
create function app.portal_upcoming_sessions(p_org uuid, p_patient uuid)
returns table (session_id uuid, scheduled_start timestamptz, scheduled_end timestamptz,
               status public.session_status, modality public.session_modality)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.scheduled_start, s.scheduled_end, s.status, s.modality
  from public.therapy_sessions s
  where s.organization_id = p_org and s.patient_id = p_patient
    and s.scheduled_start >= now() - interval '1 day'
    and s.status = 'scheduled'
    and (app.is_patient_self(p_org, p_patient, 'portal')
         or (app.guardian_can(p_org, p_patient, 'view_session_schedule')
             and not exists (
               select 1
               from public.patient_guardian_caveats c
               join public.patient_guardians pg on pg.organization_id = c.organization_id and pg.id = c.patient_guardian_id
               join public.guardians g on g.organization_id = pg.organization_id and g.id = pg.guardian_id
               where c.organization_id = p_org and pg.patient_id = p_patient and c.restrict_schedule
                 and c.ended_at is null and g.profile_id = (select app.request_uid()))))
  order by s.scheduled_start
  limit 50
$$;

-- -----------------------------------------------------------------------------
-- 13. RLS, grants, policies (authenticated). Patients/guardians/platform: NO clinical policy.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['clinical_section_definitions', 'clinical_note_types', 'file_objects', 'clinical_records',
    'clinical_record_sections', 'clinical_record_section_revisions', 'clinical_assessments', 'clinical_diagnoses',
    'treatment_plans', 'treatment_goals', 'treatment_goal_patient_texts', 'therapy_sessions', 'clinical_notes',
    'clinical_note_addenda'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
  end loop;
end
$$;

-- Configuration: any aal2 staff member reads; owner or psychologist (org active) manages.
grant select on public.clinical_section_definitions, public.clinical_note_types to authenticated;
grant insert (organization_id, key, title, description, audience, is_required, position, is_active, created_by)
  on public.clinical_section_definitions to authenticated;
grant update (title, description, audience, is_required, position, is_active) on public.clinical_section_definitions to authenticated;
grant insert (organization_id, key, label, description, position, is_active, created_by)
  on public.clinical_note_types to authenticated;
grant update (label, description, position, is_active) on public.clinical_note_types to authenticated;
create policy clinical_section_definitions_select on public.clinical_section_definitions for select to authenticated
  using (app.is_org_member(organization_id));
create policy clinical_section_definitions_insert on public.clinical_section_definitions for insert to authenticated
  with check (app.can_manage_clinical_config(organization_id) and created_by = (select auth.uid()));
create policy clinical_section_definitions_update on public.clinical_section_definitions for update to authenticated
  using (app.can_manage_clinical_config(organization_id)) with check (app.can_manage_clinical_config(organization_id));
create policy clinical_note_types_select on public.clinical_note_types for select to authenticated
  using (app.is_org_member(organization_id));
create policy clinical_note_types_insert on public.clinical_note_types for insert to authenticated
  with check (app.can_manage_clinical_config(organization_id) and created_by = (select auth.uid()));
create policy clinical_note_types_update on public.clinical_note_types for update to authenticated
  using (app.can_manage_clinical_config(organization_id)) with check (app.can_manage_clinical_config(organization_id));

-- clinical_records
grant select on public.clinical_records to authenticated;
grant insert (organization_id, patient_id, opened_by_membership_id) on public.clinical_records to authenticated;
grant update (status, closure_summary) on public.clinical_records to authenticated;
create policy clinical_records_select on public.clinical_records for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id));
create policy clinical_records_insert on public.clinical_records for insert to authenticated
  with check (app.can_write_clinical(organization_id, patient_id));
create policy clinical_records_update on public.clinical_records for update to authenticated
  using (app.can_write_clinical(organization_id, patient_id)) with check (app.can_write_clinical(organization_id, patient_id));

-- sections + revisions (revisions: read only; written by the definer trigger)
grant select on public.clinical_record_sections to authenticated;
grant insert (organization_id, clinical_record_id, patient_id, section_definition_id, content, content_locale,
              last_edited_by_membership_id)
  on public.clinical_record_sections to authenticated;
grant update (content, content_locale) on public.clinical_record_sections to authenticated;
create policy clinical_record_sections_select on public.clinical_record_sections for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id));
create policy clinical_record_sections_insert on public.clinical_record_sections for insert to authenticated
  with check (app.can_write_clinical(organization_id, patient_id));
create policy clinical_record_sections_update on public.clinical_record_sections for update to authenticated
  using (app.can_write_clinical(organization_id, patient_id)) with check (app.can_write_clinical(organization_id, patient_id));
grant select on public.clinical_record_section_revisions to authenticated;
create policy clinical_record_section_revisions_select on public.clinical_record_section_revisions for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id));

-- assessments (drafts author-only, like notes)
grant select on public.clinical_assessments to authenticated;
grant insert (organization_id, clinical_record_id, patient_id, assessed_on, instrument_name, instrument_reference,
              administered_by, results, interpretation, attachment_file_id, corrects_assessment_id, author_membership_id)
  on public.clinical_assessments to authenticated;
grant update (assessed_on, instrument_name, instrument_reference, administered_by, results, interpretation,
              attachment_file_id, status, finalized_by_membership_id, content_hash, discarded_at)
  on public.clinical_assessments to authenticated;
create policy clinical_assessments_select on public.clinical_assessments for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id)
         and (status = 'finalized' or author_membership_id = app.my_membership_id(organization_id)));
create policy clinical_assessments_insert on public.clinical_assessments for insert to authenticated
  with check (status = 'draft' and app.can_write_clinical(organization_id, patient_id)
              and author_membership_id = app.my_membership_id(organization_id));
create policy clinical_assessments_update on public.clinical_assessments for update to authenticated
  using (status = 'draft' and author_membership_id = app.my_membership_id(organization_id)
         and app.can_write_clinical(organization_id, patient_id))
  with check (author_membership_id = app.my_membership_id(organization_id)
              and app.can_write_clinical(organization_id, patient_id));

-- diagnoses
grant select on public.clinical_diagnoses to authenticated;
grant insert (organization_id, clinical_record_id, patient_id, code_system, code, label, status, diagnosed_on,
              resolved_on, notes, recorded_by_membership_id)
  on public.clinical_diagnoses to authenticated;
grant update (status, resolved_on) on public.clinical_diagnoses to authenticated;
create policy clinical_diagnoses_select on public.clinical_diagnoses for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id));
create policy clinical_diagnoses_insert on public.clinical_diagnoses for insert to authenticated
  with check (app.can_write_clinical(organization_id, patient_id));
create policy clinical_diagnoses_update on public.clinical_diagnoses for update to authenticated
  using (app.can_write_clinical(organization_id, patient_id)) with check (app.can_write_clinical(organization_id, patient_id));

-- treatment plans / goals / patient texts
grant select on public.treatment_plans, public.treatment_goals, public.treatment_goal_patient_texts to authenticated;
grant insert (organization_id, clinical_record_id, patient_id, version, supersedes_plan_id, summary, interventions,
              frequency, start_date, review_date, author_membership_id)
  on public.treatment_plans to authenticated;
grant update (status, summary, interventions, frequency, start_date, review_date) on public.treatment_plans to authenticated;
grant insert (organization_id, treatment_plan_id, patient_id, position, description, status, target_date)
  on public.treatment_goals to authenticated;
grant update (position, description, status, target_date) on public.treatment_goals to authenticated;
grant insert (organization_id, treatment_goal_id, patient_id, patient_facing_text, author_membership_id)
  on public.treatment_goal_patient_texts to authenticated;
grant update (patient_facing_text, withdrawn_at) on public.treatment_goal_patient_texts to authenticated;
grant delete on public.treatment_goal_patient_texts to authenticated;
create policy treatment_plans_select on public.treatment_plans for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id));
create policy treatment_plans_insert on public.treatment_plans for insert to authenticated
  with check (app.can_write_clinical(organization_id, patient_id));
create policy treatment_plans_update on public.treatment_plans for update to authenticated
  using (app.can_write_clinical(organization_id, patient_id)) with check (app.can_write_clinical(organization_id, patient_id));
create policy treatment_goals_select on public.treatment_goals for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id));
create policy treatment_goals_insert on public.treatment_goals for insert to authenticated
  with check (app.can_write_clinical(organization_id, patient_id));
create policy treatment_goals_update on public.treatment_goals for update to authenticated
  using (app.can_write_clinical(organization_id, patient_id)) with check (app.can_write_clinical(organization_id, patient_id));
create policy treatment_goal_patient_texts_select on public.treatment_goal_patient_texts for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id));
create policy treatment_goal_patient_texts_insert on public.treatment_goal_patient_texts for insert to authenticated
  with check (app.can_write_clinical(organization_id, patient_id));
create policy treatment_goal_patient_texts_update on public.treatment_goal_patient_texts for update to authenticated
  using (app.can_write_clinical(organization_id, patient_id)) with check (app.can_write_clinical(organization_id, patient_id));
create policy treatment_goal_patient_texts_delete on public.treatment_goal_patient_texts for delete to authenticated
  using (app.can_write_clinical(organization_id, patient_id));

-- therapy sessions
grant select on public.therapy_sessions to authenticated;
grant insert (organization_id, patient_id, psychologist_membership_id, treatment_plan_id, scheduled_start, scheduled_end,
              status, modality, cancelled_reason, location_or_link)
  on public.therapy_sessions to authenticated;
grant update (treatment_plan_id, scheduled_start, scheduled_end, status, modality, cancelled_reason, location_or_link)
  on public.therapy_sessions to authenticated;
create policy therapy_sessions_select on public.therapy_sessions for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id));
create policy therapy_sessions_insert on public.therapy_sessions for insert to authenticated
  with check (app.can_write_clinical(organization_id, patient_id));
create policy therapy_sessions_update on public.therapy_sessions for update to authenticated
  using (app.can_write_clinical(organization_id, patient_id)) with check (app.can_write_clinical(organization_id, patient_id));

-- clinical notes (SECURITY.md §4.4b) + addenda (insert only)
grant select on public.clinical_notes to authenticated;
grant insert (organization_id, clinical_record_id, patient_id, therapy_session_id, note_type_id, body, content_locale,
              author_membership_id)
  on public.clinical_notes to authenticated;
grant update (therapy_session_id, note_type_id, body, content_locale, status, finalized_by_membership_id, content_hash,
              discarded_at, discard_reason)
  on public.clinical_notes to authenticated;
create policy clinical_notes_select on public.clinical_notes for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id)
         and (status = 'finalized' or author_membership_id = app.my_membership_id(organization_id)));
create policy clinical_notes_insert on public.clinical_notes for insert to authenticated
  with check (status = 'draft' and app.can_write_clinical(organization_id, patient_id)
              and author_membership_id = app.my_membership_id(organization_id));
create policy clinical_notes_update_own_draft on public.clinical_notes for update to authenticated
  using (status = 'draft' and author_membership_id = app.my_membership_id(organization_id)
         and app.can_write_clinical(organization_id, patient_id))
  with check (author_membership_id = app.my_membership_id(organization_id)
              and app.can_write_clinical(organization_id, patient_id));
grant select on public.clinical_note_addenda to authenticated;
grant insert (organization_id, clinical_note_id, patient_id, reason, body, content_locale, author_membership_id,
              content_hash, idempotency_key)
  on public.clinical_note_addenda to authenticated;
create policy clinical_note_addenda_select on public.clinical_note_addenda for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id));
create policy clinical_note_addenda_insert on public.clinical_note_addenda for insert to authenticated
  with check (app.can_write_clinical(organization_id, patient_id)
              and author_membership_id = app.my_membership_id(organization_id));

-- file_objects: the uploader sees/updates its own PENDING clinical row; everything else is
-- app.can_read_file (defined in the next migration, which adds the select policy).
grant select on public.file_objects to authenticated;
grant insert (id, organization_id, patient_id, bucket, storage_path, mime_type, size_bytes, display_name, uploaded_by)
  on public.file_objects to authenticated;
grant update (status, sha256, size_bytes, mime_type) on public.file_objects to authenticated;
create policy file_objects_select_own_pending on public.file_objects for select to authenticated
  using (status = 'pending_upload' and uploaded_by = (select auth.uid())
         and bucket = 'clinical-documents' and app.can_write_clinical(organization_id, patient_id));
create policy file_objects_insert_clinical on public.file_objects for insert to authenticated
  with check (bucket = 'clinical-documents' and uploaded_by = (select auth.uid())
              and app.can_write_clinical(organization_id, patient_id));
create policy file_objects_update_clinical on public.file_objects for update to authenticated
  using (bucket = 'clinical-documents' and app.can_write_clinical(organization_id, patient_id)
         and (status <> 'pending_upload' or uploaded_by = (select auth.uid())))
  with check (bucket = 'clinical-documents' and app.can_write_clinical(organization_id, patient_id));

-- -----------------------------------------------------------------------------
-- 14. app_definer: least-privilege grants + policies, ownership, execute grants
-- -----------------------------------------------------------------------------
grant select on public.clinical_record_sections to app_definer;
grant select on public.clinical_records to app_definer;
create policy clinical_records_select_definer on public.clinical_records for select to app_definer using (true);
grant insert (organization_id, section_id, patient_id, revision, content, content_locale, edited_by_membership_id, edited_at)
  on public.clinical_record_section_revisions to app_definer;
create policy clinical_record_section_revisions_insert_definer on public.clinical_record_section_revisions
  for insert to app_definer with check (true);
grant select on public.treatment_goal_patient_texts, public.treatment_goals, public.treatment_plans,
  public.therapy_sessions, public.patient_guardian_caveats to app_definer;
create policy treatment_goal_patient_texts_select_definer on public.treatment_goal_patient_texts
  for select to app_definer using (true);
create policy treatment_goals_select_definer on public.treatment_goals for select to app_definer using (true);
create policy treatment_plans_select_definer on public.treatment_plans for select to app_definer using (true);
create policy therapy_sessions_select_definer on public.therapy_sessions for select to app_definer using (true);
create policy patient_guardian_caveats_select_definer on public.patient_guardian_caveats
  for select to app_definer using (true);

grant create on schema app to app_definer;
alter function app.capture_section_revision() owner to app_definer;
alter function app.portal_patient_goals(uuid, uuid) owner to app_definer;
alter function app.portal_upcoming_sessions(uuid, uuid) owner to app_definer;
revoke create on schema app from app_definer;

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in (
      'can_read_clinical', 'can_write_clinical', 'can_manage_clinical_config', 'clinical_content_hash',
      'rich_text_has_content', 'assert_assessment_attachment', 'guard_clinical_config', 'guard_file_object', 'guard_clinical_record',
      'assert_record_open', 'capture_section_revision', 'assessment_hash', 'guard_clinical_assessment',
      'guard_clinical_diagnosis', 'plan_status_of', 'guard_treatment_plan', 'guard_treatment_goal',
      'guard_goal_patient_text', 'revise_treatment_plan', 'guard_therapy_session', 'guard_clinical_note',
      'guard_note_addendum', 'finalize_clinical_note', 'finalize_clinical_assessment', 'portal_patient_goals',
      'portal_upcoming_sessions')
  loop
    execute format('revoke all on function %s from public, anon, service_role', f.sig);
  end loop;
end
$$;
grant execute on function app.can_read_clinical(uuid, uuid) to authenticated, app_definer;
grant execute on function app.can_write_clinical(uuid, uuid) to authenticated, app_definer;
grant execute on function app.can_manage_clinical_config(uuid) to authenticated;
grant execute on function app.clinical_content_hash(jsonb) to authenticated;
grant execute on function app.rich_text_has_content(jsonb) to authenticated;
grant execute on function app.assert_record_open(uuid, uuid) to authenticated, app_definer;
grant execute on function app.assessment_hash(public.clinical_assessments) to authenticated;
grant execute on function app.assert_assessment_attachment(public.clinical_assessments) to authenticated;
grant execute on function app.plan_status_of(uuid, uuid) to authenticated;
grant execute on function app.revise_treatment_plan(uuid, uuid, text) to authenticated;
grant execute on function app.finalize_clinical_note(uuid, uuid, text) to authenticated;
grant execute on function app.finalize_clinical_assessment(uuid, uuid, text) to authenticated;
grant execute on function app.portal_patient_goals(uuid, uuid) to authenticated;
grant execute on function app.portal_upcoming_sessions(uuid, uuid) to authenticated;
-- Trigger functions run as the invoking role; capture_section_revision is the only definer one.
grant execute on function app.guard_clinical_config(), app.guard_file_object(), app.guard_clinical_record(),
  app.capture_section_revision(), app.guard_clinical_assessment(), app.guard_clinical_diagnosis(),
  app.guard_treatment_plan(), app.guard_treatment_goal(), app.guard_goal_patient_text(),
  app.guard_therapy_session(), app.guard_clinical_note(), app.guard_note_addendum() to authenticated;
grant execute on function app.my_membership_id(uuid) to app_definer;
