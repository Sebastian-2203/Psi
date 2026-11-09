-- =============================================================================
-- Phase 2 — portal identities (SECURITY.md §3.3, §3.8; API_CONTRACTS §4 acting-as; F-21).
-- Forward-only.
-- * invitations: patient / guardian kinds (composite FKs), care-team create/read/revoke.
-- * app.peek_invitation / app.accept_portal_invitation (system path, app_server only):
--   single use, email bound, links patients.profile_id / guardians.profile_id. Guardian
--   acceptance never activates the relationship (rule 6).
-- * app.my_capacities() gains patient / guardian rows (+ subject_id).
-- * Relationship revocation revokes pending guardian invitations (SECURITY.md §5.4).
-- MFA optional for patients/guardians (Q-07 default): helpers do not require aal2.
-- =============================================================================

alter table public.invitations drop constraint invitations_phase1_staff_only;
alter table public.invitations
  add column patient_id uuid null,
  add column guardian_id uuid null,
  add column patient_guardian_id uuid null,
  add constraint invitations_patient_fkey foreign key (organization_id, patient_id)
    references public.patients (organization_id, id) on delete restrict,
  add constraint invitations_guardian_fkey foreign key (organization_id, guardian_id)
    references public.guardians (organization_id, id) on delete restrict,
  add constraint invitations_pg_fkey foreign key (organization_id, patient_guardian_id)
    references public.patient_guardians (organization_id, id) on delete restrict,
  add constraint invitations_kind_subject check (
    (invitation_type = 'staff' and patient_id is null and guardian_id is null and patient_guardian_id is null)
    or (invitation_type = 'patient' and roles is null and patient_id is not null
        and guardian_id is null and patient_guardian_id is null)
    or (invitation_type = 'guardian' and roles is null and patient_id is null
        and guardian_id is not null and patient_guardian_id is not null)
  );
create index invitations_patient_idx on public.invitations (organization_id, patient_id) where patient_id is not null;
create index invitations_guardian_idx on public.invitations (organization_id, guardian_id) where guardian_id is not null;
create index invitations_pg_idx on public.invitations (organization_id, patient_guardian_id)
  where patient_guardian_id is not null;

-- Subject checks for user-created portal invitations (care team; invoker).
create function app.guard_portal_invitation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.invitation_type = 'staff' or (select app.request_uid()) is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    new.patient_id := old.patient_id;
    new.guardian_id := old.guardian_id;
    new.patient_guardian_id := old.patient_guardian_id;
    return new;
  end if;
  if new.invitation_type = 'patient' and not exists (
    select 1 from public.patients p
    where p.organization_id = new.organization_id and p.id = new.patient_id
      and p.profile_id is null and p.status <> 'archived'
  ) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:patient_not_invitable';
  end if;
  if new.invitation_type = 'guardian' and not exists (
    select 1 from public.patient_guardians pg
    join public.guardians g on g.organization_id = pg.organization_id and g.id = pg.guardian_id
    where pg.organization_id = new.organization_id and pg.id = new.patient_guardian_id
      and pg.guardian_id = new.guardian_id and g.profile_id is null and g.status = 'active'
      and pg.status in ('pending_verification', 'active')
  ) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:guardian_not_invitable';
  end if;
  return new;
end
$$;
revoke all on function app.guard_portal_invitation() from public, anon, authenticated, service_role;
create trigger invitations_portal_guard before insert or update on public.invitations
  for each row execute function app.guard_portal_invitation();

grant select (patient_id, guardian_id, patient_guardian_id) on public.invitations to authenticated;
grant insert (patient_id, guardian_id, patient_guardian_id) on public.invitations to authenticated;
create policy invitations_select_care_team on public.invitations for select to authenticated
  using ((invitation_type = 'patient' and app.is_on_care_team(organization_id, patient_id))
         or (invitation_type = 'guardian' and app.can_manage_relationship(organization_id, patient_guardian_id)));
create policy invitations_insert_care_team on public.invitations for insert to authenticated
  with check (status = 'pending' and invited_by = (select auth.uid()) and (
    (invitation_type = 'patient' and app.can_manage_patient(organization_id, patient_id))
    or (invitation_type = 'guardian' and app.org_allows(organization_id, 'staff_write')
        and app.can_manage_relationship(organization_id, patient_guardian_id))));
create policy invitations_revoke_care_team on public.invitations for update to authenticated
  using (status = 'pending' and (
    (invitation_type = 'patient' and app.can_manage_patient(organization_id, patient_id))
    or (invitation_type = 'guardian' and app.can_manage_relationship(organization_id, patient_guardian_id))))
  with check (status = 'revoked');

-- Revoking a relationship revokes its pending invitations (same transaction, caller context).
create function app.revoke_relationship_invitations() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'revoked' and old.status <> 'revoked' then
    update public.invitations set status = 'revoked'
    where organization_id = new.organization_id and patient_guardian_id = new.id and status = 'pending';
  end if;
  return null;
end
$$;
revoke all on function app.revoke_relationship_invitations() from public, anon, authenticated, service_role;
create trigger patient_guardians_revoke_invitations after update on public.patient_guardians
  for each row execute function app.revoke_relationship_invitations();

-- -----------------------------------------------------------------------------
-- System path: peek + accept (all kinds)
-- -----------------------------------------------------------------------------
create function app.peek_invitation(p_token_hash bytea)
returns table (
  invitation_id uuid,
  organization_id uuid,
  organization_display_name text,
  invitation_type public.invitation_type,
  email text,
  roles public.membership_role[],
  expires_at timestamptz,
  existing_profile_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if (select app.request_uid()) is not null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:system_function_in_user_context';
  end if;
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    return;
  end if;
  return query
  select i.id, i.organization_id, o.display_name, i.invitation_type, i.email::text, i.roles, i.expires_at,
         app.auth_user_id_by_email(i.email::text)
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token_hash = p_token_hash and i.status = 'pending' and i.expires_at > now() and o.status = 'active';
end
$$;

create function app.accept_portal_invitation(p_token_hash bytea, p_profile_id uuid, p_request_id text default null)
returns table (organization_id uuid, invitation_type public.invitation_type, subject_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_inv public.invitations%rowtype;
  v_email text;
  v_subject uuid;
begin
  if (select app.request_uid()) is not null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:system_function_in_user_context';
  end if;
  update public.invitations i
     set status = 'accepted', accepted_by_profile_id = p_profile_id
   where i.token_hash = p_token_hash and i.status = 'pending' and i.expires_at > now()
     and i.invitation_type in ('patient', 'guardian')
  returning i.* into v_inv;
  if not found then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invitation_invalid';
  end if;
  v_email := app.auth_user_verified_email(p_profile_id);
  if v_email is null or lower(v_email) <> lower(v_inv.email::text)
     or not exists (select 1 from public.organizations o where o.id = v_inv.organization_id and o.status = 'active')
     or app.profile_is_staff_of(v_inv.organization_id, p_profile_id) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invitation_invalid';
  end if;

  if v_inv.invitation_type = 'patient' then
    update public.patients p set profile_id = p_profile_id
     where p.organization_id = v_inv.organization_id and p.id = v_inv.patient_id
       and p.profile_id is null and p.status <> 'archived'
    returning p.id into v_subject;
  else
    update public.guardians g set profile_id = p_profile_id
     where g.organization_id = v_inv.organization_id and g.id = v_inv.guardian_id
       and g.profile_id is null and g.status = 'active'
    returning g.id into v_subject;
  end if;
  if v_subject is null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invitation_invalid';
  end if;

  perform app.insert_audit_row('invitation.accepted', 'system', 'system', p_profile_id, '{}', v_inv.organization_id,
    'invitation', v_inv.id,
    case when v_inv.invitation_type = 'patient'
         then jsonb_build_object('patient_id', v_subject)
         else jsonb_build_object('guardian_id', v_subject) end, p_request_id, null, null);
  perform app.insert_audit_row(
    case when v_inv.invitation_type = 'patient' then 'patient.portal_linked' else 'guardian.portal_linked' end,
    'system', 'system', p_profile_id, '{}', v_inv.organization_id, v_inv.invitation_type::text, v_subject,
    case when v_inv.invitation_type = 'patient'
         then jsonb_build_object('patient_id', v_subject, 'invitation_id', v_inv.id)
         else jsonb_build_object('guardian_id', v_subject, 'invitation_id', v_inv.id) end,
    p_request_id, null, null);
  organization_id := v_inv.organization_id;
  invitation_type := v_inv.invitation_type;
  subject_id := v_subject;
  return next;
end
$$;

-- app_definer: portal kinds on the system path only.
create policy invitations_select_definer_portal_system on public.invitations for select to app_definer
  using ((select app.request_uid()) is null and invitation_type in ('patient', 'guardian'));
create policy invitations_update_definer_portal_system on public.invitations for update to app_definer
  using ((select app.request_uid()) is null and invitation_type in ('patient', 'guardian') and status = 'pending')
  with check (status = 'accepted' and accepted_by_profile_id is not null);
grant update (profile_id) on public.patients to app_definer;
create policy patients_link_definer_system on public.patients for update to app_definer
  using ((select app.request_uid()) is null and profile_id is null)
  with check (profile_id is not null);
grant update (profile_id) on public.guardians to app_definer;
create policy guardians_link_definer_system on public.guardians for update to app_definer
  using ((select app.request_uid()) is null and profile_id is null)
  with check (profile_id is not null);

-- -----------------------------------------------------------------------------
-- my_capacities: + patient / guardian (subject_id = patient id / guardian id)
-- -----------------------------------------------------------------------------
drop function app.my_capacities();
create function app.my_capacities()
returns table (
  organization_id uuid,
  acting_as text,
  membership_id uuid,
  membership_status public.membership_status,
  org_status public.org_status,
  roles public.membership_role[],
  subject_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id, 'staff'::text, m.id, m.status, o.status,
         coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}'), null::uuid
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  left join public.membership_roles r on r.organization_id = m.organization_id and r.membership_id = m.id
  where m.profile_id = (select app.request_uid()) and m.status <> 'removed'
  group by m.organization_id, m.id, m.status, o.status
  union all
  select null::uuid, 'platform_admin'::text, null::uuid, null::public.membership_status,
         null::public.org_status, '{}'::public.membership_role[], null::uuid
  from public.platform_admins pa
  where pa.profile_id = (select app.request_uid()) and pa.revoked_at is null
  union all
  select p.organization_id, 'patient'::text, null::uuid, null::public.membership_status, o.status,
         '{}'::public.membership_role[], p.id
  from public.patients p
  join public.organizations o on o.id = p.organization_id
  where p.profile_id = (select app.request_uid()) and p.status <> 'archived' and o.status = 'active'
  union all
  select g.organization_id, 'guardian'::text, null::uuid, null::public.membership_status, o.status,
         '{}'::public.membership_role[], g.id
  from public.guardians g
  join public.organizations o on o.id = g.organization_id
  where g.profile_id = (select app.request_uid()) and g.status = 'active' and o.status = 'active'
$$;

grant create on schema app to app_definer;
alter function app.peek_invitation(bytea) owner to app_definer;
alter function app.accept_portal_invitation(bytea, uuid, text) owner to app_definer;
alter function app.my_capacities() owner to app_definer;
revoke create on schema app from app_definer;
revoke all on function app.peek_invitation(bytea) from public, anon, authenticated, service_role;
revoke all on function app.accept_portal_invitation(bytea, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.my_capacities() from public, anon, service_role;
grant execute on function app.peek_invitation(bytea) to app_server;
grant execute on function app.accept_portal_invitation(bytea, uuid, text) to app_server;
grant execute on function app.my_capacities() to authenticated;
grant execute on function app.profile_is_staff_of(uuid, uuid) to app_definer;
