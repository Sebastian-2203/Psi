-- =============================================================================
-- Phase 2 QA D-3 / PRD PAT-09 / Q-14 — data-subject requests (access, rectification).
-- DATABASE.md §5.7 `data_subject_requests`. Forward-only. Needs security review.
--
-- * A patient (own data) or a guardian (own guardian record) submits from the portal through
--   app.submit_data_subject_request (definer): re-derives the real capacity, one OPEN request per
--   subject + type, writes the audit row (portal identities cannot call app.write_audit).
-- * The care team of the subject (patient: ON the care team; guardian: on the care team of any
--   patient the guardian is linked to) and organization owners read and resolve through
--   app.update_data_subject_request (definer): forward-only status machine, one-time resolution.
-- * No legal interpretation: `due_at` is NEVER computed or defaulted here. The care team / owner
--   sets it from the organization's own policy. [NEEDS LEGAL VERIFICATION] (Ley 1581/2012
--   deadlines, identity-verification requirements, what may be disclosed).
-- * Rectification of clinical content is by addendum, never overwrite (rule 6): resolving a
--   request does not change any clinical row; the resolution summary only records the decision.
-- * export_file_id (DATABASE.md) waits for the file storage module (no file_objects yet).
-- * requester_note is free text typed by the requester: it never goes into audit metadata.
-- =============================================================================

create type public.dsr_type as enum
  ('access', 'rectification', 'update', 'suppression', 'revoke_authorization', 'other');
create type public.dsr_status as enum
  ('received', 'in_review', 'fulfilled', 'partially_fulfilled', 'rejected');

create table public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  subject_patient_id uuid null,
  subject_guardian_id uuid null,
  request_type public.dsr_type not null,
  received_at timestamptz not null default now(),
  channel text not null check (channel in ('portal', 'professional')),
  status public.dsr_status not null default 'received',
  requester_note text null check (char_length(btrim(requester_note)) between 1 and 1000),
  due_at timestamptz null,
  handled_by_membership_id uuid null,
  resolution_summary text null check (char_length(btrim(resolution_summary)) between 3 and 2000),
  resolved_at timestamptz null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dsr_org_id_key unique (organization_id, id),
  constraint dsr_patient_fk foreign key (organization_id, subject_patient_id)
    references public.patients (organization_id, id) on delete restrict,
  constraint dsr_guardian_fk foreign key (organization_id, subject_guardian_id)
    references public.guardians (organization_id, id) on delete restrict,
  constraint dsr_handler_fk foreign key (organization_id, handled_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint dsr_one_subject check ((subject_patient_id is null) <> (subject_guardian_id is null)),
  constraint dsr_resolution_consistent check (
    (status in ('fulfilled', 'partially_fulfilled', 'rejected')) = (resolved_at is not null)
    and (resolved_at is not null) = (resolution_summary is not null)
  )
);
create index dsr_org_status_idx on public.data_subject_requests (organization_id, status, received_at desc);
create index dsr_patient_idx on public.data_subject_requests (organization_id, subject_patient_id)
  where subject_patient_id is not null;
create index dsr_guardian_idx on public.data_subject_requests (organization_id, subject_guardian_id)
  where subject_guardian_id is not null;
create index dsr_created_by_idx on public.data_subject_requests (created_by);
create index dsr_handler_idx on public.data_subject_requests (organization_id, handled_by_membership_id)
  where handled_by_membership_id is not null;
-- One OPEN request per subject and type (also bounds spam from the portal).
create unique index dsr_one_open_patient_key on public.data_subject_requests
  (organization_id, subject_patient_id, request_type)
  where subject_patient_id is not null and status in ('received', 'in_review');
create unique index dsr_one_open_guardian_key on public.data_subject_requests
  (organization_id, subject_guardian_id, request_type)
  where subject_guardian_id is not null and status in ('received', 'in_review');
comment on table public.data_subject_requests is
  'PAT-09 access / rectification requests. Written only by definer functions; due_at is set by the organization, never computed [NEEDS LEGAL VERIFICATION].';
comment on column public.data_subject_requests.due_at is
  'Organization-configured deadline. No legal period is hardcoded. [NEEDS LEGAL VERIFICATION]';
create trigger data_subject_requests_set_updated_at before update on public.data_subject_requests
  for each row execute function app.set_updated_at();

-- Identity columns are immutable; a resolved request is final (corrections = a new request).
create function app.guard_data_subject_request() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id or new.organization_id is distinct from old.organization_id
     or new.subject_patient_id is distinct from old.subject_patient_id
     or new.subject_guardian_id is distinct from old.subject_guardian_id
     or new.request_type is distinct from old.request_type or new.received_at is distinct from old.received_at
     or new.channel is distinct from old.channel or new.requester_note is distinct from old.requester_note
     or new.created_by is distinct from old.created_by then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:data_subject_request_immutable';
  end if;
  if old.status in ('fulfilled', 'partially_fulfilled', 'rejected') then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:request_already_resolved';
  end if;
  return new;
end
$$;
create trigger data_subject_requests_guard before update on public.data_subject_requests
  for each row execute function app.guard_data_subject_request();

-- Staff read scope: owner of the org, or ON the care team of the subject patient / of any patient
-- the subject guardian is linked to. Not a clinical-data grant: the row holds no clinical content.
create function app.dsr_staff_scope(p_org uuid, p_patient uuid, p_guardian uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_org_role(p_org, 'organization_owner')
      or (p_patient is not null and app.is_on_care_team(p_org, p_patient))
      or (p_guardian is not null and exists (
            select 1 from public.patient_guardians pg
            where pg.organization_id = p_org and pg.guardian_id = p_guardian
              and app.is_on_care_team(p_org, pg.patient_id)))
$$;

-- -----------------------------------------------------------------------------
-- Audit events (category `privacy`)
-- -----------------------------------------------------------------------------
alter table app.audit_event_types drop constraint audit_event_types_category_check;
alter table app.audit_event_types add constraint audit_event_types_category_check check (category in
  ('auth', 'organization', 'membership', 'invitation', 'branding', 'profile', 'platform', 'security',
   'patient', 'care_team', 'guardian', 'consent', 'privacy'));
insert into app.audit_event_types (event_type, category, writer, org_optional, description) values
  ('data_subject_request.submitted', 'privacy', 'user', false, 'Access / rectification request submitted from the portal'),
  ('data_subject_request.status_changed', 'privacy', 'user', false, 'Data-subject request status changed (resolution recorded)'),
  ('data_subject_request.due_date_set', 'privacy', 'user', false, 'Data-subject request due date set by the organization'),
  ('data_subject_request.list_viewed', 'privacy', 'user', false, 'Data-subject requests listed by staff');

-- -----------------------------------------------------------------------------
-- Submit (portal)
-- -----------------------------------------------------------------------------
create function app.submit_data_subject_request(
  p_org uuid,
  p_acting_as text,
  p_patient uuid,
  p_type public.dsr_type,
  p_note text,
  p_request_id text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_id uuid := pg_catalog.gen_random_uuid();
  v_patient uuid;
  v_guardian uuid;
  v_meta jsonb;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:no_actor';
  end if;
  if p_acting_as = 'patient' then
    if p_patient is null or not app.is_patient_self(p_org, p_patient, 'onboarding') then
      raise exception using errcode = '42501', message = 'FORBIDDEN:dsr.submit.self';
    end if;
    v_patient := p_patient;
  elsif p_acting_as = 'guardian' then
    select g.id into v_guardian
    from public.guardians g
    join public.organizations o on o.id = g.organization_id
    where g.organization_id = p_org and g.profile_id = v_actor and g.status = 'active' and o.status = 'active';
    if v_guardian is null then
      raise exception using errcode = '42501', message = 'FORBIDDEN:dsr.submit.guardian';
    end if;
  else
    raise exception using errcode = '42501', message = 'FORBIDDEN:dsr.submit';
  end if;
  -- Only these two types are exposed (Q-14: simple request form). [NEEDS LEGAL VERIFICATION]
  if p_type not in ('access', 'rectification') then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:request_type_not_supported';
  end if;
  if exists (
    select 1 from public.data_subject_requests r
    where r.organization_id = p_org and r.request_type = p_type
      and r.subject_patient_id is not distinct from v_patient
      and r.subject_guardian_id is not distinct from v_guardian
      and r.status in ('received', 'in_review')
  ) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:request_already_open';
  end if;

  insert into public.data_subject_requests (
    id, organization_id, subject_patient_id, subject_guardian_id, request_type, channel, requester_note, created_by
  ) values (
    v_id, p_org, v_patient, v_guardian, p_type, 'portal', nullif(btrim(p_note), ''), v_actor
  );
  v_meta := jsonb_build_object('data_subject_request_id', v_id, 'request_type', p_type,
                               'subject_type', case when v_patient is not null then 'patient' else 'guardian' end);
  if v_patient is not null then
    v_meta := v_meta || jsonb_build_object('patient_id', v_patient);
  end if;
  perform app.insert_audit_row('data_subject_request.submitted', 'user', 'user', v_actor, array[p_acting_as], p_org,
    'data_subject_request', v_id, v_meta, p_request_id, null, null);
  return v_id;
end
$$;

-- -----------------------------------------------------------------------------
-- Update (care team / owner): received -> in_review -> fulfilled | partially_fulfilled | rejected
-- (received may go straight to a final status). Due date may be set while open.
-- -----------------------------------------------------------------------------
create function app.update_data_subject_request(
  p_org uuid,
  p_id uuid,
  p_status public.dsr_status,
  p_resolution_summary text,
  p_due_at timestamptz,
  p_request_id text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_r public.data_subject_requests%rowtype;
  v_final boolean := p_status in ('fulfilled', 'partially_fulfilled', 'rejected');
  v_roles text[];
  v_meta jsonb;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:no_actor';
  end if;
  select * into v_r from public.data_subject_requests where organization_id = p_org and id = p_id for update;
  if v_r.id is null or not app.org_allows(p_org, 'staff_write')
     or not app.dsr_staff_scope(p_org, v_r.subject_patient_id, v_r.subject_guardian_id) then
    raise exception using errcode = '42501', message = 'FORBIDDEN:dsr.manage';
  end if;
  if v_r.status in ('fulfilled', 'partially_fulfilled', 'rejected') then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:request_already_resolved';
  end if;
  if not (p_status = v_r.status
          or (v_r.status = 'received' and p_status = 'in_review')
          or v_final) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invalid_status_transition';
  end if;
  if v_final and (p_resolution_summary is null or char_length(btrim(p_resolution_summary)) < 3) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:resolution_summary_required';
  end if;
  if p_due_at is not null and p_due_at < v_r.received_at then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:due_at_invalid';
  end if;
  if p_status = v_r.status and p_due_at is null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invalid_status_transition';
  end if;

  update public.data_subject_requests
     set status = p_status,
         due_at = coalesce(p_due_at, due_at),
         handled_by_membership_id = coalesce(handled_by_membership_id, (select app.my_membership_id(p_org))),
         resolution_summary = case when v_final then btrim(p_resolution_summary) end,
         resolved_at = case when v_final then now() end
   where organization_id = p_org and id = p_id;

  select coalesce(array_agg(r.role::text order by r.role), '{}') into v_roles
  from public.memberships m
  join public.membership_roles r on r.organization_id = m.organization_id and r.membership_id = m.id
  where m.organization_id = p_org and m.profile_id = v_actor and m.status = 'active';

  v_meta := jsonb_build_object('data_subject_request_id', p_id, 'request_type', v_r.request_type);
  if v_r.subject_patient_id is not null then
    v_meta := v_meta || jsonb_build_object('patient_id', v_r.subject_patient_id);
  end if;
  if p_status <> v_r.status then
    perform app.insert_audit_row('data_subject_request.status_changed', 'user', 'user', v_actor, v_roles, p_org,
      'data_subject_request', p_id,
      v_meta || jsonb_build_object('from_status', v_r.status, 'to_status', p_status), p_request_id, null, null);
  end if;
  if p_due_at is not null then
    perform app.insert_audit_row('data_subject_request.due_date_set', 'user', 'user', v_actor, v_roles, p_org,
      'data_subject_request', p_id, v_meta, p_request_id, null, null);
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- RLS, grants, owners
-- -----------------------------------------------------------------------------
alter table public.data_subject_requests enable row level security;
alter table public.data_subject_requests force row level security;
revoke all on public.data_subject_requests from public, anon, authenticated, service_role;
grant select on public.data_subject_requests to authenticated;

create policy dsr_select_staff on public.data_subject_requests for select to authenticated
  using (app.dsr_staff_scope(organization_id, subject_patient_id, subject_guardian_id));
create policy dsr_select_patient on public.data_subject_requests for select to authenticated
  using (subject_patient_id is not null and app.is_patient_self(organization_id, subject_patient_id, 'onboarding'));
create policy dsr_select_guardian on public.data_subject_requests for select to authenticated
  using (subject_guardian_id is not null and app.is_my_guardian_record(organization_id, subject_guardian_id));

grant select on public.data_subject_requests to app_definer;
create policy dsr_select_definer on public.data_subject_requests for select to app_definer using (true);
grant insert (id, organization_id, subject_patient_id, subject_guardian_id, request_type, channel, requester_note,
              created_by)
  on public.data_subject_requests to app_definer;
create policy dsr_insert_definer on public.data_subject_requests for insert to app_definer
  with check (created_by = (select app.request_uid()) and channel = 'portal' and status = 'received');
grant update (status, due_at, handled_by_membership_id, resolution_summary, resolved_at)
  on public.data_subject_requests to app_definer;
create policy dsr_update_definer on public.data_subject_requests for update to app_definer
  using (app.dsr_staff_scope(organization_id, subject_patient_id, subject_guardian_id))
  with check (app.dsr_staff_scope(organization_id, subject_patient_id, subject_guardian_id));

grant create on schema app to app_definer;
alter function app.dsr_staff_scope(uuid, uuid, uuid) owner to app_definer;
alter function app.submit_data_subject_request(uuid, text, uuid, public.dsr_type, text, text) owner to app_definer;
alter function app.update_data_subject_request(uuid, uuid, public.dsr_status, text, timestamptz, text)
  owner to app_definer;
revoke create on schema app from app_definer;

revoke all on function app.guard_data_subject_request() from public, anon, authenticated, service_role;
revoke all on function app.dsr_staff_scope(uuid, uuid, uuid) from public, anon, service_role;
revoke all on function app.submit_data_subject_request(uuid, text, uuid, public.dsr_type, text, text)
  from public, anon, service_role;
revoke all on function app.update_data_subject_request(uuid, uuid, public.dsr_status, text, timestamptz, text)
  from public, anon, service_role;
grant execute on function app.dsr_staff_scope(uuid, uuid, uuid) to authenticated, app_definer;
grant execute on function app.submit_data_subject_request(uuid, text, uuid, public.dsr_type, text, text)
  to authenticated;
grant execute on function app.update_data_subject_request(uuid, uuid, public.dsr_status, text, timestamptz, text)
  to authenticated;
