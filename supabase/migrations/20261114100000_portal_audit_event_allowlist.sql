-- =============================================================================
-- Security fix (Phase 2 review, SECURITY.md §15 S2-01, High): app.write_audit let a portal
-- identity (patient / guardian) write ANY user-writer audit event for its organization with
-- arbitrary metadata, e.g. 'consent.recorded' or 'patient_guardian.revoked' with the
-- patient_id of ANOTHER patient. insert_audit_row derives audit_logs.patient_id from that
-- metadata, so forged rows appeared in the care team's per-patient audit view.
-- Portal identities are now limited to the auth.* events their sessions emit (capacity / org
-- switch, sign-out, MFA) and may not attach a patient_id. Staff branch unchanged.
-- Forward-only. Owner (app_definer) and grants preserved by CREATE OR REPLACE.
-- =============================================================================
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
