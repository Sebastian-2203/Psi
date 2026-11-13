-- =============================================================================
-- Fix (Phase 2 server layer finding): app.record_consent referenced the unassigned record
-- v_rel when p_signer_type = 'patient' (SQLSTATE 55000), so a professional could not record a
-- patient's verbal decision. Behaviour is otherwise identical: same checks, same audit, same
-- signature, owner (app_definer) and grants are preserved by CREATE OR REPLACE.
-- Needs security review (definer function). Forward-only.
-- =============================================================================

create or replace function app.record_consent(
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
  v_guardian uuid;
  v_link uuid;
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
    v_guardian := v_rel.guardian_id;
    v_link := v_rel.id;
  else
    raise exception using errcode = 'P0001', message = 'PRECONDITION:signer_not_allowed';
  end if;

  insert into public.consent_records (
    id, organization_id, patient_id, consent_template_id, consent_template_version_id, consent_type, signer_type,
    signer_profile_id, signer_guardian_id, patient_guardian_id, recorded_by_profile_id, decision, method,
    locale, text_hash, accepted_at
  ) values (
    v_record, p_org, p_patient, v_sv.template_id, p_version, v_sv.consent_type, p_signer_type,
    v_signer_profile, v_guardian, v_link, v_actor, p_decision, p_method,
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
