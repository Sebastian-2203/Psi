-- =============================================================================
-- Phase 3 — audit: clinical event catalog + S2-02 closure (SECURITY.md §15). Forward-only.
--
-- S2-02 (Low, Phase 2 review): the staff branch of app.write_audit accepted ANY patient_id of
-- the organization, so a psychologist could attach audit rows to a patient outside their care
-- team (they would surface in that care team's per-patient audit view). Clinical read-access
-- auditing now relies on audit_logs.patient_id, so the tag is validated here.
-- Owner (app_definer) and grants are preserved by CREATE OR REPLACE.
-- =============================================================================

alter table app.audit_event_types drop constraint audit_event_types_category_check;
alter table app.audit_event_types add constraint audit_event_types_category_check check (category in
  ('auth', 'organization', 'membership', 'invitation', 'branding', 'profile', 'platform', 'security',
   'patient', 'care_team', 'guardian', 'consent', 'privacy', 'clinical', 'file'));

insert into app.audit_event_types (event_type, category, writer, org_optional, description) values
  ('clinical_config.updated', 'clinical', 'user', false, 'Section definition or note type created/updated (field names only)'),
  ('clinical_record.opened', 'clinical', 'user', false, 'Clinical record opened for a patient'),
  ('clinical_record.viewed', 'clinical', 'user', false, 'Clinical record overview read'),
  ('clinical_record.closed', 'clinical', 'user', false, 'Clinical record closed'),
  ('clinical_record.reopened', 'clinical', 'user', false, 'Clinical record reopened'),
  ('clinical_record_section.updated', 'clinical', 'user', false, 'Record section saved (new revision)'),
  ('clinical_record_section.history_viewed', 'clinical', 'user', false, 'Record section revision history read'),
  ('clinical_assessment.created', 'clinical', 'user', false, 'Assessment draft created'),
  ('clinical_assessment.updated', 'clinical', 'user', false, 'Assessment draft updated (field names only)'),
  ('clinical_assessment.finalized', 'clinical', 'user', false, 'Assessment finalized (immutable)'),
  ('clinical_assessment.discarded', 'clinical', 'user', false, 'Assessment draft discarded'),
  ('clinical_assessment.list_viewed', 'clinical', 'user', false, 'Assessments of a patient listed'),
  ('clinical_diagnosis.added', 'clinical', 'user', false, 'Diagnostic impression recorded by the professional'),
  ('clinical_diagnosis.status_changed', 'clinical', 'user', false, 'Diagnostic impression status changed'),
  ('treatment_plan.created', 'clinical', 'user', false, 'Treatment plan draft created'),
  ('treatment_plan.updated', 'clinical', 'user', false, 'Treatment plan draft updated (field names only)'),
  ('treatment_plan.activated', 'clinical', 'user', false, 'Treatment plan activated (previous active superseded)'),
  ('treatment_plan.revised', 'clinical', 'user', false, 'New draft version created from a plan'),
  ('treatment_plan.status_changed', 'clinical', 'user', false, 'Treatment plan completed / discontinued'),
  ('treatment_plan.viewed', 'clinical', 'user', false, 'Treatment plan read'),
  ('treatment_goal.added', 'clinical', 'user', false, 'Goal added to a draft plan'),
  ('treatment_goal.status_changed', 'clinical', 'user', false, 'Goal status changed'),
  ('treatment_goal.patient_text_set', 'clinical', 'user', false, 'Patient-facing goal wording set / cleared / withdrawn'),
  ('therapy_session.recorded', 'clinical', 'user', false, 'Therapy session recorded'),
  ('therapy_session.updated', 'clinical', 'user', false, 'Therapy session details/status changed'),
  ('therapy_session.list_viewed', 'clinical', 'user', false, 'Session timeline read'),
  ('clinical_note.created', 'clinical', 'user', false, 'Note draft created'),
  ('clinical_note.draft_updated', 'clinical', 'user', false, 'Note draft updated'),
  ('clinical_note.finalized', 'clinical', 'user', false, 'Note finalized (immutable)'),
  ('clinical_note.draft_discarded', 'clinical', 'user', false, 'Note draft discarded'),
  ('clinical_note.addendum_created', 'clinical', 'user', false, 'Addendum appended to a finalized note'),
  ('clinical_note.viewed', 'clinical', 'user', false, 'Note (with addenda) read'),
  ('clinical_note.list_viewed', 'clinical', 'user', false, 'Notes of a patient listed'),
  ('clinical_document.attached', 'clinical', 'user', false, 'Document uploaded and attached to the record'),
  ('clinical_document.archived', 'clinical', 'user', false, 'Document archived (shares revoked)'),
  ('clinical_document.list_viewed', 'clinical', 'user', false, 'Documents of a patient listed'),
  ('document.shared', 'clinical', 'user', false, 'Document shared with the patient (optionally guardians)'),
  ('document.unshared', 'clinical', 'user', false, 'Document share revoked'),
  ('file.download_url_issued', 'file', 'user', false, 'Short-lived signed URL issued for a clinical file');

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
  v_patient_text text;
  v_patient uuid;
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
      if p_event_type not like 'auth.%' or coalesce(p_metadata, '{}'::jsonb) ? 'patient_id' then
        raise exception using errcode = 'P0001', message = 'AUDIT:event_not_allowed_for_portal';
      end if;
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

  -- S2-02: a staff / platform row may tag only a patient the actor can access: on its care
  -- team (incl. a row ended in THIS transaction, e.g. care_team.ended), or an owner of the
  -- patient's organization (directory / care-team administration). Unknown or cross-tenant
  -- ids are rejected, so audit_logs.patient_id is never forged for another care team.
  if coalesce(p_metadata, '{}'::jsonb) ? 'patient_id' then
    v_patient_text := p_metadata ->> 'patient_id';
    if p_organization_id is null
       or v_patient_text is null
       or v_patient_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'AUDIT:patient_not_accessible';
    end if;
    v_patient := v_patient_text::uuid;
    if not (
         app.is_on_care_team(p_organization_id, v_patient)
      or (app.is_org_member(p_organization_id) and exists (
            select 1 from public.care_team_members c
            join public.memberships m on m.organization_id = c.organization_id and m.id = c.membership_id
            where c.organization_id = p_organization_id and c.patient_id = v_patient
              and m.profile_id = v_actor and m.status = 'active'
              and c.starts_at <= now() and c.ends_at is not null and c.ends_at >= now()))
      or (app.has_org_role(p_organization_id, 'organization_owner') and exists (
            select 1 from public.patients p where p.organization_id = p_organization_id and p.id = v_patient))
    ) then
      raise exception using errcode = 'P0001', message = 'AUDIT:patient_not_accessible';
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

-- -----------------------------------------------------------------------------
-- Portal document access audit (PRT-07, DOC-03). Portal identities cannot attach a patient_id
-- through app.write_audit (S2-01), so the access is verified and audited here.
-- -----------------------------------------------------------------------------
insert into app.audit_event_types (event_type, category, writer, org_optional, description) values
  ('document.portal_list_viewed', 'clinical', 'user', false, 'Shared documents listed in the portal'),
  ('document.portal_url_issued', 'file', 'user', false, 'Signed URL of a shared document issued to the portal');

create function app.audit_portal_document_access(
  p_org uuid,
  p_patient uuid,
  p_document uuid default null,
  p_result_count integer default null,
  p_request_id text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_role text;
  v_file uuid;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'AUDIT:no_actor';
  end if;
  if app.is_patient_self(p_org, p_patient, 'portal') then
    v_role := 'patient';
  elsif app.guardian_can(p_org, p_patient, 'view_shared_documents') then
    v_role := 'guardian';
  else
    raise exception using errcode = '42501', message = 'FORBIDDEN:portal_document';
  end if;
  if p_document is null then
    return app.insert_audit_row('document.portal_list_viewed', 'user', 'user', v_actor, array[v_role], p_org,
      'patient', p_patient,
      jsonb_build_object('patient_id', p_patient, 'result_count', greatest(coalesce(p_result_count, 0), 0)),
      p_request_id, null, null);
  end if;
  select d.file_object_id into v_file from public.clinical_documents d
  where d.organization_id = p_org and d.id = p_document and d.patient_id = p_patient;
  if v_file is null or not app.portal_can_view_document(p_org, p_document) then
    raise exception using errcode = '42501', message = 'FORBIDDEN:portal_document';
  end if;
  return app.insert_audit_row('document.portal_url_issued', 'user', 'user', v_actor, array[v_role], p_org,
    'clinical_document', p_document,
    jsonb_build_object('patient_id', p_patient, 'file_object_id', v_file),
    p_request_id, null, null);
end
$$;
grant create on schema app to app_definer;
alter function app.audit_portal_document_access(uuid, uuid, uuid, integer, text) owner to app_definer;
revoke create on schema app from app_definer;
revoke all on function app.audit_portal_document_access(uuid, uuid, uuid, integer, text) from public, anon, service_role;
grant execute on function app.audit_portal_document_access(uuid, uuid, uuid, integer, text) to authenticated;
