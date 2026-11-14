-- =============================================================================
-- Phase 2 gap fix: portal-facing read of the patient's experience mode (child / adolescent /
-- adult). The patient reads her own mode; a guardian reads it only for a patient she is an
-- ACTIVE guardian of (same predicate as every guardian read: verified, in window, minor,
-- portal allowed). Falls back to the age default (app.suggest_portal_mode) if no preferences row
-- exists. Returns the mode only: no preferences, no personal data. Care-team users get null
-- (they read patient_preferences through RLS). Needs security review (definer function).
-- Forward-only.
-- =============================================================================

create function app.my_portal_mode(p_org uuid, p_patient uuid)
returns public.portal_mode
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pp.portal_mode, app.suggest_portal_mode(p.date_of_birth, o.country_code))
  from public.patients p
  join public.organizations o on o.id = p.organization_id
  left join public.patient_preferences pp
    on pp.organization_id = p.organization_id and pp.patient_id = p.id
  where p.organization_id = p_org and p.id = p_patient
    and (app.is_patient_self(p_org, p_patient, 'onboarding') or app.is_active_guardian_of(p_org, p_patient))
$$;
comment on function app.my_portal_mode(uuid, uuid) is
  'Portal mode of the patient for the patient herself or an active guardian; null for anyone else.';

grant create on schema app to app_definer;
alter function app.my_portal_mode(uuid, uuid) owner to app_definer;
revoke create on schema app from app_definer;
revoke all on function app.my_portal_mode(uuid, uuid) from public, anon, service_role;
grant execute on function app.my_portal_mode(uuid, uuid) to authenticated;
