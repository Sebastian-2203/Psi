-- =============================================================================
-- SECURITY DEFINER owner hardening (SECURITY.md §4.3, §14; ADR-018). Forward-only.
--
-- Before: every SECURITY DEFINER function in `app` was owned by `postgres`, which has
-- BYPASSRLS (and pg_read_all_data) in Supabase, so a logic bug in any definer function could
-- read or write ANY row of ANY table, including future clinical tables.
--
-- After:
-- * New role `app_definer`: NOLOGIN, NOINHERIT, NOBYPASSRLS, no superuser/createrole/
--   createdb/replication, member of nothing. It owns every definer function in `app` and is
--   subject to (forced) RLS like any other non-owner role.
-- * `app_definer` gets ONLY the table/column privileges its functions need, plus RLS policies
--   `to app_definer` that are as narrow as each use allows (see the table in SECURITY.md §14.2).
--   It has no privilege on idempotency_keys, platform tables beyond reads, storage, or any
--   future table unless a migration grants it explicitly.
-- * `postgres` (migration runner) is a member of app_definer (INHERIT, SET) so it can keep
--   `create or replace`-ing these functions and the pgTAP suite can call system functions.
--   `authenticated`, `anon`, `service_role` and `app_server` are NOT members.
-- * Schema `auth` belongs to supabase_admin and `postgres` cannot grant USAGE on it, so:
--     - app.request_uid() / app.request_jwt() re-implement auth.uid() / auth.jwt() from the
--       same request GUCs (pure SQL, invoker, no table access). pgTAP 09 asserts they equal
--       auth.uid()/auth.jwt() in user, system and anon contexts (vendor drift check).
--     - Two auth.users lookups stay owned by postgres (ALLOWLISTED, reason in comments and in
--       supabase/tests/09_definer_hardening.sql): app.auth_user_verified_email(uuid) and
--       app.auth_user_id_by_email(text). EXECUTE only for app_definer.
-- * Function bodies that ran as postgres are re-created to use the shims (behaviour unchanged).
--   app.insert_audit_row now generates the id itself, so app_definer needs INSERT but no
--   SELECT on audit_logs.
-- * Every definer function: search_path = '', schema-qualified names, no PUBLIC execute.
--   A final assertion block makes this migration (and db reset) fail otherwise.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Role
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'app_definer') then
    create role app_definer with nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$$;
alter role app_definer with nologin noinherit nocreatedb nocreaterole;
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'app_definer' and (rolsuper or rolbypassrls or rolreplication or rolcanlogin)
  ) then
    raise exception 'app_definer must not be superuser, bypass RLS, replicate or log in';
  end if;
end
$$;
comment on role app_definer is
  'Owner of SECURITY DEFINER functions in schema app (SECURITY.md §14). NOLOGIN, NOBYPASSRLS; least-privilege grants + policies to app_definer.';

-- The migration runner must be able to SET ROLE app_definer (ALTER OWNER, CREATE OR REPLACE).
grant app_definer to postgres with inherit true, set true;

grant usage on schema app to app_definer;
grant usage on schema public to app_definer;
grant usage on schema extensions to app_definer;
-- Transient: ALTER ... OWNER requires the new owner to hold CREATE on the schema. Revoked below.
grant create on schema app to app_definer;

-- -----------------------------------------------------------------------------
-- 2. Request identity shims (no auth schema access needed). Mirror auth.uid()/auth.jwt().
-- -----------------------------------------------------------------------------
create function app.request_uid() returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
comment on function app.request_uid() is
  'Same semantics as auth.uid() (request GUCs), usable by app_definer which has no USAGE on schema auth. Drift-tested in pgTAP 09.';

create function app.request_jwt() returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(pg_catalog.current_setting('request.jwt.claim', true), ''),
    nullif(pg_catalog.current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
comment on function app.request_jwt() is
  'Same semantics as auth.jwt() (request GUCs), usable by app_definer. Drift-tested in pgTAP 09.';

revoke all on function app.request_uid() from public, anon, service_role;
revoke all on function app.request_jwt() from public, anon, service_role;
grant execute on function app.request_uid() to authenticated, app_definer;
grant execute on function app.request_jwt() to authenticated, app_definer;

-- -----------------------------------------------------------------------------
-- 3. ALLOWLISTED postgres-owned auth.users lookups (system path only).
--    Why bypass is required: auth.users lives in schema `auth` (owner supabase_admin);
--    `postgres` holds USAGE on it WITHOUT grant option, so no other role can be given access.
--    Scope: one row by id / one id by email; no RLS-protected table is read; EXECUTE only for
--    app_definer (i.e. only from app.accept_staff_invitation / app.peek_staff_invitation).
-- -----------------------------------------------------------------------------
create function app.auth_user_verified_email(p_user_id uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text
  from auth.users u
  where u.id = p_user_id
    and u.email_confirmed_at is not null
    and u.deleted_at is null
$$;
comment on function app.auth_user_verified_email(uuid) is
  'DEFINER-ALLOWLIST (owner postgres): auth schema not grantable. Verified email of a live auth user, else null. app_definer only.';

create function app.auth_user_id_by_email(p_email text) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(p_email)
    and u.deleted_at is null
  limit 1
$$;
comment on function app.auth_user_id_by_email(text) is
  'DEFINER-ALLOWLIST (owner postgres): auth schema not grantable. Live auth user id for an email, else null. app_definer only.';

revoke all on function app.auth_user_verified_email(uuid) from public, anon, authenticated, service_role;
revoke all on function app.auth_user_id_by_email(text) from public, anon, authenticated, service_role;
grant execute on function app.auth_user_verified_email(uuid) to app_definer;
grant execute on function app.auth_user_id_by_email(text) to app_definer;

-- -----------------------------------------------------------------------------
-- 4. Re-create bodies that referenced the auth schema (auth.uid/auth.jwt/auth.users) so they
--    run as app_definer. Logic is unchanged except where noted.
-- -----------------------------------------------------------------------------

-- Invoker helpers called from definer context.
create or replace function app.aal() returns text
language sql
stable
set search_path = ''
as $$ select coalesce((select app.request_jwt()) ->> 'aal', 'none') $$;

create or replace function app.has_recent_mfa(p_seconds integer) returns boolean
language sql
stable
set search_path = ''
as $$
  select (select app.is_aal2()) and coalesce((
    select bool_or(
      e ->> 'method' in ('totp', 'mfa/totp')
      and (e ->> 'timestamp') ~ '^\d{1,12}$'
      and (e ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - p_seconds
    )
    from jsonb_array_elements(
      case when jsonb_typeof((select app.request_jwt()) -> 'amr') = 'array'
           then (select app.request_jwt()) -> 'amr' else '[]'::jsonb end
    ) as e
  ), false)
$$;

-- RLS helpers.
create or replace function app.my_membership_id(p_org uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  where (select app.is_aal2())
    and m.organization_id = p_org
    and m.profile_id = (select app.request_uid())
    and m.status = 'active'
    and o.status in ('active', 'read_only')
$$;

create or replace function app.is_org_member(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.is_aal2()) and exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org
      and m.profile_id = (select app.request_uid())
      and m.status = 'active'
      and o.status in ('active', 'read_only')
  )
$$;

create or replace function app.has_org_role(p_org uuid, p_role public.membership_role) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.is_aal2()) and exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    join public.membership_roles r on r.organization_id = m.organization_id and r.membership_id = m.id
    where m.organization_id = p_org
      and m.profile_id = (select app.request_uid())
      and m.status = 'active'
      and o.status in ('active', 'read_only')
      and r.role = p_role
  )
$$;

create or replace function app.is_platform_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.is_aal2()) and exists (
    select 1 from public.platform_admins pa
    where pa.profile_id = (select app.request_uid()) and pa.revoked_at is null
  )
$$;

create or replace function app.has_active_platform_grant(p_org uuid, p_scope public.grant_scope) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.is_platform_admin()) and exists (
    select 1 from public.platform_access_grants g
    where g.organization_id = p_org
      and g.scope = p_scope
      and g.platform_admin_profile_id = (select app.request_uid())
      and g.status = 'approved'
      and g.owner_approved_at is not null
      and g.second_approver_profile_id is not null
      and g.second_approver_profile_id <> g.platform_admin_profile_id
      and g.revoked_at is null
      and now() >= g.starts_at and now() < g.expires_at
  )
$$;

create or replace function app.my_capacities()
returns table (
  organization_id uuid,
  acting_as text,
  membership_id uuid,
  membership_status public.membership_status,
  org_status public.org_status,
  roles public.membership_role[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id, 'staff'::text, m.id, m.status, o.status,
         coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}')
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  left join public.membership_roles r on r.organization_id = m.organization_id and r.membership_id = m.id
  where m.profile_id = (select app.request_uid()) and m.status <> 'removed'
  group by m.organization_id, m.id, m.status, o.status
  union all
  select null::uuid, 'platform_admin'::text, null::uuid, null::public.membership_status,
         null::public.org_status, '{}'::public.membership_role[]
  from public.platform_admins pa
  where pa.profile_id = (select app.request_uid()) and pa.revoked_at is null
$$;

-- Integrity / audit triggers.
create or replace function app.guard_membership_role() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:membership_roles';
  end if;
  if tg_op = 'INSERT' then
    new.granted_by := coalesce((select app.request_uid()), new.granted_by);
    new.granted_at := now();
    if new.role = 'psychologist' and not exists (
      select 1 from public.professional_profiles pp
      where pp.organization_id = new.organization_id and pp.membership_id = new.membership_id
    ) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:professional_profile_required';
    end if;
    return new;
  end if;
  -- DELETE
  if old.role = 'organization_owner'
     and exists (select 1 from public.memberships m where m.id = old.membership_id and m.status = 'active')
     and not exists (
       select 1 from public.memberships m
       join public.membership_roles r on r.membership_id = m.id and r.role = 'organization_owner'
       where m.organization_id = old.organization_id and m.status = 'active' and m.id <> old.membership_id)
  then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:last_owner';
  end if;
  return old;
end
$$;

create or replace function app.audit_role_self_grant() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select app.request_uid()) is not null and exists (
    select 1 from public.memberships m
    where m.id = new.membership_id and m.profile_id = (select app.request_uid())
  ) then
    perform app.insert_audit_row(
      'membership.role_self_granted', 'user', 'user', (select app.request_uid()),
      array[new.role::text], new.organization_id, 'membership', new.membership_id,
      jsonb_build_object('role', new.role::text), null, null, null
    );
    -- TODO(1.3/notifications): notify other owners/psychologists of the org.
  end if;
  return new;
end
$$;

-- Rate limiting.
create or replace function app.consume_rate_limit(p_action text, p_limit integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_count integer;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'RATE_LIMIT:no_actor';
  end if;
  if p_action !~ '^[a-z][a-z0-9_.]{0,63}$' or p_limit < 1 or p_window <= interval '0'
     or p_window > interval '1 day' then
    raise exception using errcode = 'P0001', message = 'RATE_LIMIT:invalid_arguments';
  end if;
  insert into public.rate_limit_counters as c (bucket_key, window_start, count)
  values (extensions.digest(p_action || ':' || v_actor::text, 'sha256'),
          app.rate_limit_window_start(p_window), 1)
  on conflict (bucket_key, window_start) do update set count = c.count + 1
  returning c.count into v_count;
  return v_count <= p_limit;
end
$$;

create or replace function app.consume_rate_limit_key(p_bucket_key bytea, p_limit integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if (select app.request_uid()) is not null then
    raise exception using errcode = 'P0001', message = 'RATE_LIMIT:system_function_in_user_context';
  end if;
  if octet_length(p_bucket_key) <> 32 or p_limit < 1 or p_window <= interval '0'
     or p_window > interval '1 day' then
    raise exception using errcode = 'P0001', message = 'RATE_LIMIT:invalid_arguments';
  end if;
  insert into public.rate_limit_counters as c (bucket_key, window_start, count)
  values (p_bucket_key, app.rate_limit_window_start(p_window), 1)
  on conflict (bucket_key, window_start) do update set count = c.count + 1
  returning c.count into v_count;
  return v_count <= p_limit;
end
$$;

-- Audit. insert_audit_row: id generated here (no RETURNING => no SELECT on audit_logs needed).
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
  insert into public.audit_logs (
    id, organization_id, actor_profile_id, actor_type, actor_roles, event_type, resource_type,
    resource_id, request_id, ip_address, user_agent, metadata
  ) values (
    v_id, p_organization_id, p_actor_profile_id, p_actor_type, coalesce(p_actor_roles, '{}'), p_event_type,
    p_resource_type, p_resource_id, left(p_request_id, 64), p_ip, left(p_user_agent, 512),
    coalesce(p_metadata, '{}'::jsonb)
  );
  return v_id;
end
$$;

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

  -- Per-actor flood protection: 300 user-written audit rows per minute (ADR-012 / F-04).
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

create or replace function app.write_system_audit(
  p_event_type text,
  p_actor_profile_id uuid default null,
  p_organization_id uuid default null,
  p_resource_type text default null,
  p_resource_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_request_id text default null,
  p_ip inet default null,
  p_user_agent text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select app.request_uid()) is not null then
    raise exception using errcode = 'P0001', message = 'AUDIT:system_writer_in_user_context';
  end if;
  return app.insert_audit_row(
    p_event_type, 'system', 'system', p_actor_profile_id, '{}', p_organization_id,
    p_resource_type, p_resource_id, p_metadata, p_request_id, p_ip, p_user_agent
  );
end
$$;

-- System path: invitations.
create or replace function app.accept_staff_invitation(
  p_token_hash bytea,
  p_profile_id uuid,
  p_professional_title text default null,
  p_license_number text default null,
  p_license_issuer text default null,
  p_request_id text default null
)
returns table (organization_id uuid, membership_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_inv public.invitations%rowtype;
  v_email text;
  v_membership_id uuid;
  v_role public.membership_role;
begin
  if (select app.request_uid()) is not null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:system_function_in_user_context';
  end if;

  update public.invitations i
     set status = 'accepted', accepted_by_profile_id = p_profile_id
   where i.token_hash = p_token_hash
     and i.status = 'pending'
     and i.expires_at > now()
     and i.invitation_type = 'staff'
  returning i.* into v_inv;
  if not found then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invitation_invalid';
  end if;

  -- Verified (confirmed, not deleted) auth email must equal the invitation email.
  v_email := app.auth_user_verified_email(p_profile_id);
  if v_email is null or lower(v_email) <> lower(v_inv.email::text) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invitation_invalid';
  end if;

  if not exists (select 1 from public.organizations o where o.id = v_inv.organization_id and o.status = 'active') then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invitation_invalid';
  end if;

  insert into public.memberships as m (organization_id, profile_id, status)
  values (v_inv.organization_id, p_profile_id, 'active')
  on conflict (organization_id, profile_id) do update set status = 'active'
  returning m.id into v_membership_id;

  if 'psychologist' = any (v_inv.roles) and not exists (
    select 1 from public.professional_profiles pp where pp.membership_id = v_membership_id
  ) then
    if p_professional_title is null or p_license_number is null or p_license_issuer is null then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:professional_profile_required';
    end if;
    insert into public.professional_profiles (organization_id, membership_id, professional_title, license_number, license_issuer)
    values (v_inv.organization_id, v_membership_id, p_professional_title, p_license_number, p_license_issuer);
  end if;

  foreach v_role in array v_inv.roles loop
    insert into public.membership_roles (organization_id, membership_id, role, granted_by)
    values (v_inv.organization_id, v_membership_id, v_role, v_inv.invited_by)
    on conflict on constraint membership_roles_membership_role_key do nothing;
  end loop;

  perform app.insert_audit_row(
    'invitation.accepted', 'system', 'system', p_profile_id, '{}', v_inv.organization_id,
    'invitation', v_inv.id, jsonb_build_object('membership_id', v_membership_id), p_request_id, null, null
  );
  perform app.insert_audit_row(
    'membership.created', 'system', 'system', p_profile_id,
    (select coalesce(array_agg(r::text), '{}') from unnest(v_inv.roles) r), v_inv.organization_id,
    'membership', v_membership_id, jsonb_build_object('invitation_id', v_inv.id), p_request_id, null, null
  );

  organization_id := v_inv.organization_id;
  membership_id := v_membership_id;
  return next;
end
$$;

create or replace function app.peek_staff_invitation(p_token_hash bytea)
returns table (
  invitation_id uuid,
  organization_id uuid,
  organization_display_name text,
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
  select i.id, i.organization_id, o.display_name, i.email::text, i.roles, i.expires_at,
         app.auth_user_id_by_email(i.email::text)
  from public.invitations i
  join public.organizations o on o.id = i.organization_id
  where i.token_hash = p_token_hash
    and i.status = 'pending'
    and i.expires_at > now()
    and i.invitation_type = 'staff'
    and o.status = 'active';
end
$$;

-- Recovery codes (ADR-021).
create or replace function app.replace_recovery_codes(p_codes text[]) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_batch uuid := gen_random_uuid();
  v_code text;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:no_actor';
  end if;
  if not app.has_recent_mfa(900) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:recent_mfa_required';
  end if;
  if p_codes is null or cardinality(p_codes) <> 10
     or (select count(distinct c) from unnest(p_codes) c) <> 10 then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:recovery_codes_invalid';
  end if;
  foreach v_code in array p_codes loop
    if v_code !~ '^[A-HJ-NP-Z2-9]{16}$' then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:recovery_codes_invalid';
    end if;
  end loop;

  update public.mfa_recovery_codes
     set revoked_at = now()
   where profile_id = v_actor and used_at is null and revoked_at is null;

  insert into public.mfa_recovery_codes (profile_id, batch_id, code_hash)
  select v_actor, v_batch, extensions.crypt(c, extensions.gen_salt('bf', 10))
  from unnest(p_codes) as c;

  perform app.write_audit('auth.recovery_codes_generated', null, 'mfa_recovery_batch', v_batch,
                          jsonb_build_object('batch_id', v_batch), null);
  return v_batch;
end
$$;

create or replace function app.consume_recovery_code(p_code text)
returns table (status text, batch_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_actor uuid := (select app.request_uid());
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  v_row record;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:no_actor';
  end if;

  if not app.consume_rate_limit('auth.recovery_code', 5, interval '15 minutes') then
    perform app.insert_audit_row('auth.rate_limited', 'system', 'system', v_actor, '{}', null,
      null, null, jsonb_build_object('action', 'auth.recovery_code'), null, null, null);
    status := 'rate_limited';
    return next;
    return;
  end if;

  if v_code ~ '^[A-HJ-NP-Z2-9]{16}$' then
    for v_row in
      select c.id, c.batch_id, c.code_hash
      from public.mfa_recovery_codes c
      where c.profile_id = v_actor and c.used_at is null and c.revoked_at is null
      for update
    loop
      if extensions.crypt(v_code, v_row.code_hash) = v_row.code_hash then
        update public.mfa_recovery_codes set used_at = now() where id = v_row.id;
        perform app.insert_audit_row('auth.recovery_code_used', 'system', 'system', v_actor, '{}',
          null, 'mfa_recovery_batch', v_row.batch_id,
          jsonb_build_object('batch_id', v_row.batch_id), null, null, null);
        status := 'ok';
        batch_id := v_row.batch_id;
        return next;
        return;
      end if;
    end loop;
  end if;

  perform app.insert_audit_row('auth.mfa_failed', 'system', 'system', v_actor, '{}', null,
    null, null, '{}'::jsonb, null, null, null);
  status := 'invalid';
  return next;
end
$$;

create or replace function app.my_recovery_codes_status()
returns table (batch_id uuid, remaining integer, total integer, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.batch_id,
         (count(*) filter (where c.used_at is null))::integer,
         count(*)::integer,
         min(c.created_at)
  from public.mfa_recovery_codes c
  where c.profile_id = (select app.request_uid()) and c.revoked_at is null
  group by c.batch_id
  order by min(c.created_at) desc
  limit 1
$$;

-- -----------------------------------------------------------------------------
-- 5. Execute on non-owned helpers used inside definer bodies.
-- -----------------------------------------------------------------------------
grant execute on function app.aal() to app_definer;
grant execute on function app.is_aal2() to app_definer;
grant execute on function app.has_recent_mfa(integer) to app_definer;
grant execute on function app.rate_limit_window_start(interval) to app_definer;
grant execute on function app.audit_metadata_is_safe(jsonb) to app_definer;
-- extensions.digest / crypt / gen_salt: executable by PUBLIC (pgcrypto default); asserted in pgTAP 09.

-- -----------------------------------------------------------------------------
-- 6. Table privileges (exactly what the functions use) + policies `to app_definer`.
--    RLS stays FORCED on every table; app_definer is not a table owner, so RLS applies.
-- -----------------------------------------------------------------------------

-- organizations: status gate + host/branding/invitation reads (any org id the caller passes;
-- the functions themselves gate on membership/status). Read only.
grant select on public.organizations to app_definer;
create policy organizations_select_definer on public.organizations for select to app_definer
  using (true);

-- organization_domains: host resolution of VERIFIED hosts only.
grant select (organization_id, host, verified_at) on public.organization_domains to app_definer;
create policy organization_domains_select_definer on public.organization_domains for select to app_definer
  using (verified_at is not null);

-- organization_branding: non-PHI pre-auth tokens (get_public_branding). Read only.
grant select on public.organization_branding to app_definer;
create policy organization_branding_select_definer on public.organization_branding for select to app_definer
  using (true);

-- platform_admins / platform_access_grants: the caller's OWN rows only.
grant select (profile_id, revoked_at) on public.platform_admins to app_definer;
create policy platform_admins_select_definer on public.platform_admins for select to app_definer
  using (profile_id = (select app.request_uid()));
grant select on public.platform_access_grants to app_definer;
create policy platform_access_grants_select_definer on public.platform_access_grants for select to app_definer
  using (platform_admin_profile_id = (select app.request_uid()));

-- memberships: read for helpers/last-owner guards (rows filtered inside the functions);
-- insert/update ONLY on the system path (no user claims) = invitation acceptance.
grant select on public.memberships to app_definer;
grant insert (organization_id, profile_id, status) on public.memberships to app_definer;
grant update (status) on public.memberships to app_definer;
create policy memberships_select_definer on public.memberships for select to app_definer
  using (true);
create policy memberships_insert_definer_system on public.memberships for insert to app_definer
  with check ((select app.request_uid()) is null and status = 'active');
create policy memberships_update_definer_system on public.memberships for update to app_definer
  using ((select app.request_uid()) is null)
  with check ((select app.request_uid()) is null and status = 'active');

-- membership_roles: read for helpers/guards; insert on the system path only.
grant select (organization_id, membership_id, role) on public.membership_roles to app_definer;
grant insert (organization_id, membership_id, role, granted_by) on public.membership_roles to app_definer;
create policy membership_roles_select_definer on public.membership_roles for select to app_definer
  using (true);
create policy membership_roles_insert_definer_system on public.membership_roles for insert to app_definer
  with check ((select app.request_uid()) is null);

-- professional_profiles: existence check (F-06 guard); insert on the system path only.
grant select (organization_id, membership_id) on public.professional_profiles to app_definer;
grant insert (organization_id, membership_id, professional_title, license_number, license_issuer)
  on public.professional_profiles to app_definer;
create policy professional_profiles_select_definer on public.professional_profiles for select to app_definer
  using (true);
create policy professional_profiles_insert_definer_system on public.professional_profiles for insert to app_definer
  with check ((select app.request_uid()) is null);

-- profiles: display names for org_member_directory (gated by is_org_member inside); the
-- auth.users insert trigger creates the profile row (GoTrue connection: no request claims).
grant select (id, display_name) on public.profiles to app_definer;
grant insert (id, display_name, locale) on public.profiles to app_definer;
create policy profiles_select_definer on public.profiles for select to app_definer
  using (true);
create policy profiles_insert_definer_system on public.profiles for insert to app_definer
  with check ((select app.request_uid()) is null);

-- invitations: system path only, staff only; the only transition is pending -> accepted.
grant select on public.invitations to app_definer;
grant update (status, accepted_by_profile_id) on public.invitations to app_definer;
create policy invitations_select_definer_system on public.invitations for select to app_definer
  using ((select app.request_uid()) is null and invitation_type = 'staff');
create policy invitations_update_definer_system on public.invitations for update to app_definer
  using ((select app.request_uid()) is null and invitation_type = 'staff' and status = 'pending')
  with check (status = 'accepted' and accepted_by_profile_id is not null);

-- rate_limit_counters: BYPASS-EQUIVALENT by design (ADR-020). Hashed keys, no tenant data;
-- counters must be written for denied/pre-auth attempts. No DELETE (purge job is separate).
grant select, insert (bucket_key, window_start, count), update (count)
  on public.rate_limit_counters to app_definer;
create policy rate_limit_counters_select_definer on public.rate_limit_counters for select to app_definer
  using (true);
create policy rate_limit_counters_insert_definer on public.rate_limit_counters for insert to app_definer
  with check (true);
create policy rate_limit_counters_update_definer on public.rate_limit_counters for update to app_definer
  using (true) with check (true);

-- mfa_recovery_codes: the CALLER's own rows only (all users of this table run in user context).
grant select on public.mfa_recovery_codes to app_definer;
grant insert (profile_id, batch_id, code_hash) on public.mfa_recovery_codes to app_definer;
grant update (used_at, revoked_at) on public.mfa_recovery_codes to app_definer;
create policy mfa_recovery_codes_select_definer on public.mfa_recovery_codes for select to app_definer
  using (profile_id = (select app.request_uid()));
create policy mfa_recovery_codes_insert_definer on public.mfa_recovery_codes for insert to app_definer
  with check (profile_id = (select app.request_uid()));
create policy mfa_recovery_codes_update_definer on public.mfa_recovery_codes for update to app_definer
  using (profile_id = (select app.request_uid()))
  with check (profile_id = (select app.request_uid()));

-- audit_logs: INSERT ONLY (no SELECT/UPDATE/DELETE). BYPASS-EQUIVALENT for insert by design:
-- denied attempts and system events must be recorded regardless of the actor's visibility.
-- Event allowlist, writer kind, org rules and metadata checks are enforced in
-- app.insert_audit_row; hash-chain and break-glass columns are not insertable.
grant insert (id, organization_id, actor_profile_id, actor_type, actor_roles, event_type, resource_type,
              resource_id, request_id, ip_address, user_agent, metadata)
  on public.audit_logs to app_definer;
create policy audit_logs_insert_definer on public.audit_logs for insert to app_definer
  with check (prev_hash is null and row_hash is null and break_glass_grant_id is null);

-- Audit allowlist lookup.
grant select on app.audit_event_types to app_definer;

-- -----------------------------------------------------------------------------
-- 7. Ownership: every SECURITY DEFINER function in app, except the allowlisted auth.users
--    lookups, is owned by app_definer. Execute ACLs are preserved by ALTER OWNER.
-- -----------------------------------------------------------------------------
alter function app.handle_new_auth_user() owner to app_definer;
alter function app.org_allows(uuid, text) owner to app_definer;
alter function app.my_membership_id(uuid) owner to app_definer;
alter function app.is_org_member(uuid) owner to app_definer;
alter function app.has_org_role(uuid, public.membership_role) owner to app_definer;
alter function app.is_platform_admin() owner to app_definer;
alter function app.has_active_platform_grant(uuid, public.grant_scope) owner to app_definer;
alter function app.my_capacities() owner to app_definer;
alter function app.org_member_directory(uuid) owner to app_definer;
alter function app.guard_membership_update() owner to app_definer;
alter function app.guard_membership_role() owner to app_definer;
alter function app.consume_rate_limit(text, integer, interval) owner to app_definer;
alter function app.consume_rate_limit_key(bytea, integer, interval) owner to app_definer;
alter function app.insert_audit_row(text, text, public.actor_type, uuid, text[], uuid, text, uuid, jsonb, text, inet, text)
  owner to app_definer;
alter function app.write_audit(text, uuid, text, uuid, jsonb, text) owner to app_definer;
alter function app.write_system_audit(text, uuid, uuid, text, uuid, jsonb, text, inet, text) owner to app_definer;
alter function app.audit_role_self_grant() owner to app_definer;
alter function app.resolve_organization_by_host(text) owner to app_definer;
alter function app.get_public_branding(uuid) owner to app_definer;
alter function app.accept_staff_invitation(bytea, uuid, text, text, text, text) owner to app_definer;
alter function app.replace_recovery_codes(text[]) owner to app_definer;
alter function app.consume_recovery_code(text) owner to app_definer;
alter function app.my_recovery_codes_status() owner to app_definer;
alter function app.peek_staff_invitation(bytea) owner to app_definer;

revoke create on schema app from app_definer;

-- Belt and braces: no PUBLIC/anon/service_role execute on any definer function.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where p.prosecdef and n.nspname in ('app', 'public')
  loop
    execute format('revoke all on function %s from public, anon, service_role', f.sig);
  end loop;
end
$$;

-- -----------------------------------------------------------------------------
-- 8. Invariants (fail the migration, and therefore `db reset` / deploy, if violated).
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

  if exists (select 1 from pg_catalog.pg_auth_members a join pg_catalog.pg_roles r on r.oid = a.member
             where a.roleid = 'app_definer'::regrole and r.rolname <> 'postgres') then
    raise exception 'app_definer must have no members other than postgres';
  end if;
  if exists (select 1 from pg_catalog.pg_auth_members a where a.member = 'app_definer'::regrole) then
    raise exception 'app_definer must not be a member of any role';
  end if;
end
$$;
