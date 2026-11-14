-- =============================================================================
-- Phase 3 — clinical documents, shares, private storage (DATABASE.md §5.4; SECURITY.md §8;
-- PRD DOC-01..03, PRT-07). Forward-only.
--
-- Storage model: bucket `clinical-documents` is PRIVATE and has NO storage.objects policy for
-- authenticated/anon. Bytes are written and signed URLs are issued only by the server with the
-- service role (src/server/db/service-role.ts), and only after the caller's RLS-bound
-- transaction proved access (file_objects insert policy / app.can_read_file).
-- Object path: org/<organization_id>/patient/<patient_id>/<file_object_id>.
-- =============================================================================

create type public.clinical_document_type as enum
  ('referral', 'report', 'external_evaluation', 'consent_scan', 'certificate', 'other');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinical-documents', 'clinical-documents', false, 20971520,
        array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'audio/mpeg', 'audio/mp4', 'audio/ogg',
              'audio/wav'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- clinical_documents
-- -----------------------------------------------------------------------------
create table public.clinical_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  clinical_record_id uuid not null,
  patient_id uuid not null,
  file_object_id uuid not null,
  document_type public.clinical_document_type not null,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  document_date date null,
  description text null check (char_length(description) <= 1000),
  supersedes_document_id uuid null,
  uploaded_by_membership_id uuid not null,
  archived_at timestamptz null,
  archived_by_membership_id uuid null,
  archive_reason text null check (char_length(archive_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_documents_org_id_key unique (organization_id, id),
  constraint clinical_documents_org_id_patient_key unique (organization_id, id, patient_id),
  constraint clinical_documents_file_key unique (file_object_id),
  constraint clinical_documents_record_fkey foreign key (organization_id, clinical_record_id, patient_id)
    references public.clinical_records (organization_id, id, patient_id) on delete restrict,
  constraint clinical_documents_file_fkey foreign key (organization_id, file_object_id)
    references public.file_objects (organization_id, id) on delete restrict,
  constraint clinical_documents_supersedes_fkey foreign key (organization_id, supersedes_document_id, patient_id)
    references public.clinical_documents (organization_id, id, patient_id) on delete restrict,
  constraint clinical_documents_uploader_fkey foreign key (organization_id, uploaded_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint clinical_documents_archiver_fkey foreign key (organization_id, archived_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint clinical_documents_archive_consistent check (
    (archived_at is null) = (archived_by_membership_id is null) and (archived_at is null) = (archive_reason is null))
);
create index clinical_documents_org_patient_idx on public.clinical_documents (organization_id, patient_id, created_at desc);
create index clinical_documents_record_idx on public.clinical_documents (organization_id, clinical_record_id);
create index clinical_documents_supersedes_idx on public.clinical_documents (organization_id, supersedes_document_id);
create index clinical_documents_uploader_idx on public.clinical_documents (organization_id, uploaded_by_membership_id);
comment on table public.clinical_documents is
  'Documents attached to a clinical record (DOC-01). Private by default; portal visibility only through clinical_document_shares. File content immutable; replacement = new document with supersedes_document_id.';
create trigger clinical_documents_set_updated_at before update on public.clinical_documents
  for each row execute function app.set_updated_at();

create function app.guard_clinical_document() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.my_membership_id(coalesce(new.organization_id, old.organization_id));
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_documents';
  end if;
  if tg_op = 'INSERT' then
    if new.uploaded_by_membership_id is distinct from v_me or new.archived_at is not null then
      raise exception using errcode = '42501', message = 'FORBIDDEN:document_insert';
    end if;
    perform app.assert_record_open(new.organization_id, new.clinical_record_id);
    if not exists (select 1 from public.file_objects f
                   where f.organization_id = new.organization_id and f.id = new.file_object_id
                     and f.patient_id = new.patient_id and f.bucket = 'clinical-documents'
                     and f.status = 'ready') then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:file_not_ready';
    end if;
    return new;
  end if;
  if row(new.organization_id, new.clinical_record_id, new.patient_id, new.file_object_id, new.document_type,
         new.title, new.document_date, new.description, new.supersedes_document_id, new.uploaded_by_membership_id,
         new.created_at)
     is distinct from row(old.organization_id, old.clinical_record_id, old.patient_id, old.file_object_id,
                          old.document_type, old.title, old.document_date, old.description,
                          old.supersedes_document_id, old.uploaded_by_membership_id, old.created_at)
     or old.archived_at is not null then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_documents';
  end if;
  if new.archived_at is not null then
    if new.archive_reason is null or char_length(btrim(new.archive_reason)) < 3 then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:archive_reason_required';
    end if;
    new.archived_at := now();
    new.archived_by_membership_id := v_me;
  end if;
  return new;
end
$$;
create trigger clinical_documents_guard before insert or update or delete on public.clinical_documents
  for each row execute function app.guard_clinical_document();

-- -----------------------------------------------------------------------------
-- clinical_document_shares (DOC-02, PRT-07). clinical_notes have no path here (NOTE-04).
-- -----------------------------------------------------------------------------
create table public.clinical_document_shares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  clinical_document_id uuid not null,
  patient_id uuid not null,
  shared_by_membership_id uuid not null,
  shared_at timestamptz not null default now(),
  guardian_visible boolean not null default false,
  revoked_at timestamptz null,
  revoked_by_membership_id uuid null,
  constraint clinical_document_shares_org_id_key unique (organization_id, id),
  constraint clinical_document_shares_document_fkey foreign key (organization_id, clinical_document_id, patient_id)
    references public.clinical_documents (organization_id, id, patient_id) on delete restrict,
  constraint clinical_document_shares_sharer_fkey foreign key (organization_id, shared_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint clinical_document_shares_revoker_fkey foreign key (organization_id, revoked_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint clinical_document_shares_revoke_consistent check ((revoked_at is null) = (revoked_by_membership_id is null))
);
create unique index clinical_document_shares_one_active on public.clinical_document_shares (clinical_document_id, patient_id)
  where revoked_at is null;
create index clinical_document_shares_org_patient_idx on public.clinical_document_shares (organization_id, patient_id);
create index clinical_document_shares_sharer_idx on public.clinical_document_shares (organization_id, shared_by_membership_id);
create index clinical_document_shares_revoker_idx on public.clinical_document_shares (organization_id, revoked_by_membership_id);

create function app.guard_document_share() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_me uuid := app.my_membership_id(coalesce(new.organization_id, old.organization_id));
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_document_shares';
  end if;
  if tg_op = 'INSERT' then
    if new.shared_by_membership_id is distinct from v_me or new.revoked_at is not null then
      raise exception using errcode = '42501', message = 'FORBIDDEN:share_insert';
    end if;
    if not exists (select 1 from public.clinical_documents d
                   where d.organization_id = new.organization_id and d.id = new.clinical_document_id
                     and d.archived_at is null) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:document_archived';
    end if;
    new.shared_at := now();
    return new;
  end if;
  if row(new.organization_id, new.clinical_document_id, new.patient_id, new.shared_by_membership_id, new.shared_at,
         new.guardian_visible)
     is distinct from row(old.organization_id, old.clinical_document_id, old.patient_id, old.shared_by_membership_id,
                          old.shared_at, old.guardian_visible)
     or old.revoked_at is not null or new.revoked_at is null then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:clinical_document_shares';
  end if;
  new.revoked_at := now();
  new.revoked_by_membership_id := v_me;
  return new;
end
$$;
create trigger clinical_document_shares_guard before insert or update or delete on public.clinical_document_shares
  for each row execute function app.guard_document_share();

-- Archiving a document revokes its active shares in the same statement (unshare = immediate).
create function app.revoke_shares_on_archive() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    update public.clinical_document_shares s
       set revoked_at = now(), revoked_by_membership_id = new.archived_by_membership_id
     where s.organization_id = new.organization_id and s.clinical_document_id = new.id and s.revoked_at is null;
  end if;
  return null;
end
$$;
create trigger clinical_documents_revoke_shares after update on public.clinical_documents
  for each row execute function app.revoke_shares_on_archive();

-- -----------------------------------------------------------------------------
-- Access helpers (SECURITY DEFINER, owner app_definer)
-- -----------------------------------------------------------------------------
-- Active share visible to the CALLER as patient (portal) or guardian (view_shared_documents +
-- guardian_visible). Never for archived documents.
create function app.portal_can_view_document(p_org uuid, p_document uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clinical_document_shares s
    join public.clinical_documents d on d.organization_id = s.organization_id and d.id = s.clinical_document_id
    where s.organization_id = p_org and s.clinical_document_id = p_document
      and s.revoked_at is null and d.archived_at is null
      and (app.is_patient_self(s.organization_id, s.patient_id, 'portal')
           or (s.guardian_visible and app.guardian_can(s.organization_id, s.patient_id, 'view_shared_documents')))
  )
$$;

-- DATABASE.md §1: delegates to the owning entity. Clinical files: care team (read), or an
-- active portal share of the document that owns the file. Only READY files.
create function app.can_read_file(p_file uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.file_objects f
    where f.id = p_file and f.status = 'ready' and f.bucket = 'clinical-documents'
      and (app.can_read_clinical(f.organization_id, f.patient_id)
           or exists (select 1 from public.clinical_documents d
                      where d.organization_id = f.organization_id and d.file_object_id = f.id
                        and app.portal_can_view_document(d.organization_id, d.id)))
  )
$$;

-- Portal list of documents shared with the caller (patient self or guardian).
create function app.portal_shared_documents(p_org uuid, p_patient uuid)
returns table (document_id uuid, file_object_id uuid, title text, document_type public.clinical_document_type,
               document_date date, mime_type text, size_bytes bigint, shared_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.file_object_id, d.title, d.document_type, d.document_date, f.mime_type, f.size_bytes, s.shared_at
  from public.clinical_document_shares s
  join public.clinical_documents d on d.organization_id = s.organization_id and d.id = s.clinical_document_id
  join public.file_objects f on f.organization_id = d.organization_id and f.id = d.file_object_id
  where s.organization_id = p_org and s.patient_id = p_patient and s.revoked_at is null
    and d.archived_at is null and f.status = 'ready'
    and (app.is_patient_self(p_org, p_patient, 'portal')
         or (s.guardian_visible and app.guardian_can(p_org, p_patient, 'view_shared_documents')))
  order by s.shared_at desc
  limit 200
$$;

-- -----------------------------------------------------------------------------
-- RLS, grants, policies
-- -----------------------------------------------------------------------------
alter table public.clinical_documents enable row level security;
alter table public.clinical_documents force row level security;
alter table public.clinical_document_shares enable row level security;
alter table public.clinical_document_shares force row level security;
revoke all on public.clinical_documents, public.clinical_document_shares from public, anon, authenticated, service_role;

grant select on public.clinical_documents to authenticated;
grant insert (organization_id, clinical_record_id, patient_id, file_object_id, document_type, title, document_date,
              description, supersedes_document_id, uploaded_by_membership_id)
  on public.clinical_documents to authenticated;
grant update (archived_at, archive_reason) on public.clinical_documents to authenticated;
create policy clinical_documents_select on public.clinical_documents for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id));
create policy clinical_documents_insert on public.clinical_documents for insert to authenticated
  with check (app.can_write_clinical(organization_id, patient_id));
create policy clinical_documents_update on public.clinical_documents for update to authenticated
  using (app.can_write_clinical(organization_id, patient_id)) with check (app.can_write_clinical(organization_id, patient_id));

grant select on public.clinical_document_shares to authenticated;
grant insert (organization_id, clinical_document_id, patient_id, shared_by_membership_id, guardian_visible)
  on public.clinical_document_shares to authenticated;
grant update (revoked_at) on public.clinical_document_shares to authenticated;
create policy clinical_document_shares_select on public.clinical_document_shares for select to authenticated
  using (app.can_read_clinical(organization_id, patient_id));
create policy clinical_document_shares_insert on public.clinical_document_shares for insert to authenticated
  with check (app.can_write_clinical(organization_id, patient_id));
create policy clinical_document_shares_update on public.clinical_document_shares for update to authenticated
  using (app.can_write_clinical(organization_id, patient_id)) with check (app.can_write_clinical(organization_id, patient_id));

-- file_objects: readable rows are exactly those app.can_read_file admits (care team or share).
-- The care-team branch is also expressed on the row itself so the NEW row of an UPDATE
-- (pending_upload -> ready, ready -> deleted) is visible to its writer.
create policy file_objects_select_care_team on public.file_objects for select to authenticated
  using (bucket = 'clinical-documents' and status <> 'pending_upload'
         and app.can_read_clinical(organization_id, patient_id));
create policy file_objects_select_readable on public.file_objects for select to authenticated
  using (app.can_read_file(id));

-- app_definer
grant select on public.file_objects, public.clinical_documents, public.clinical_document_shares to app_definer;
create policy file_objects_select_definer on public.file_objects for select to app_definer using (true);
create policy clinical_documents_select_definer on public.clinical_documents for select to app_definer using (true);
create policy clinical_document_shares_select_definer on public.clinical_document_shares
  for select to app_definer using (true);

grant create on schema app to app_definer;
alter function app.portal_can_view_document(uuid, uuid) owner to app_definer;
alter function app.can_read_file(uuid) owner to app_definer;
alter function app.portal_shared_documents(uuid, uuid) owner to app_definer;
revoke create on schema app from app_definer;

revoke all on function app.guard_clinical_document() from public, anon, service_role;
revoke all on function app.guard_document_share() from public, anon, service_role;
revoke all on function app.revoke_shares_on_archive() from public, anon, service_role;
revoke all on function app.portal_can_view_document(uuid, uuid) from public, anon, service_role;
revoke all on function app.can_read_file(uuid) from public, anon, service_role;
revoke all on function app.portal_shared_documents(uuid, uuid) from public, anon, service_role;
grant execute on function app.guard_clinical_document(), app.guard_document_share(), app.revoke_shares_on_archive()
  to authenticated;
grant execute on function app.portal_can_view_document(uuid, uuid) to authenticated;
grant execute on function app.can_read_file(uuid) to authenticated;
grant execute on function app.portal_shared_documents(uuid, uuid) to authenticated;
