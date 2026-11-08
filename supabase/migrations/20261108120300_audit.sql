-- =============================================================================
-- Append-only audit log, event allowlist and non-forgeable writers.
-- Refs: ADR-012, DATABASE.md §9, SECURITY.md §7, API_CONTRACTS §9, F-04, F-23.
--
-- * Only app.write_audit (user context) and app.write_system_audit (system path) insert.
-- * Actor id comes from auth.uid() and roles from the DB — never from parameters.
-- * UPDATE/DELETE/TRUNCATE are revoked AND rejected by triggers for every role.
-- * Metadata: ids, enum values, changed field NAMES, status transitions. Never clinical
--   text, names, emails, document numbers, response values or file names (SECURITY.md §7.3).
--   The DB enforces object type, a size cap and a key deny-list; the TS writer enforces a
--   strict Zod schema per event (src/server/audit/events.ts).
-- * Partitioning by month (DATABASE.md §9) is deferred until volume requires it; the
--   (organization_id, occurred_at) indexes keep that migration straightforward.
-- =============================================================================

create table app.audit_event_types (
  event_type text primary key check (event_type ~ '^[a-z_]+\.[a-z_]+$'),
  category text not null check (category in
    ('auth', 'organization', 'membership', 'invitation', 'branding', 'profile', 'platform', 'security')),
  -- user: app.write_audit only; system: app.write_system_audit only; both: either path.
  writer text not null check (writer in ('user', 'system', 'both')),
  -- Whether the event may be written without an organization (auth/platform events).
  org_optional boolean not null default false,
  description text not null
);
comment on table app.audit_event_types is
  'Allowlist of audit events. Must match src/server/audit/events.ts (integration test asserts parity).';
revoke all on app.audit_event_types from public, anon, authenticated, service_role;

insert into app.audit_event_types (event_type, category, writer, org_optional, description) values
  -- auth (SECURITY.md §7.1)
  ('auth.signed_in', 'auth', 'both', true, 'User signed in'),
  ('auth.sign_in_failed', 'auth', 'system', true, 'Sign-in attempt failed (no user context)'),
  ('auth.signed_out', 'auth', 'user', true, 'User signed out'),
  ('auth.mfa_enrolled', 'auth', 'user', true, 'TOTP factor enrolled'),
  ('auth.mfa_verified', 'auth', 'user', true, 'MFA challenge verified (aal2)'),
  ('auth.mfa_failed', 'auth', 'both', true, 'MFA verification failed'),
  ('auth.mfa_reset', 'auth', 'system', true, 'MFA factors reset (recovery or support)'),
  ('auth.password_reset', 'auth', 'both', true, 'Password reset completed'),
  ('auth.rate_limited', 'auth', 'system', true, 'Auth-adjacent action rate limited'),
  ('auth.org_switched', 'auth', 'user', false, 'Active organization switched'),
  ('auth.capacity_switched', 'auth', 'user', false, 'Acting-as capacity switched'),
  ('auth.session_revoked', 'auth', 'system', true, 'Sessions revoked'),
  ('auth.recovery_codes_generated', 'auth', 'user', true, 'MFA recovery codes generated'),
  ('auth.recovery_code_used', 'auth', 'system', true, 'MFA recovery code used'),
  -- organization
  ('organization.provisioned', 'organization', 'system', false, 'Organization provisioned'),
  ('organization.updated', 'organization', 'user', false, 'Organization settings updated'),
  ('organization.suspended', 'organization', 'both', false, 'Organization suspended'),
  ('organization_domain.added', 'organization', 'user', false, 'Domain added'),
  ('organization_domain.verified', 'organization', 'system', false, 'Domain verified'),
  ('organization_domain.removed', 'organization', 'user', false, 'Domain removed'),
  -- branding
  ('organization_branding.updated', 'branding', 'user', false, 'Branding updated'),
  -- membership
  ('membership.created', 'membership', 'system', false, 'Membership created (invitation accepted)'),
  ('membership.roles_changed', 'membership', 'user', false, 'Membership roles changed'),
  ('membership.role_self_granted', 'membership', 'user', false, 'A member granted a role to themselves (F-06)'),
  ('membership.suspended', 'membership', 'user', false, 'Membership suspended'),
  ('membership.removed', 'membership', 'user', false, 'Membership removed'),
  ('professional_profile.updated', 'membership', 'user', false, 'Professional profile created/updated'),
  -- invitation
  ('invitation.created', 'invitation', 'user', false, 'Staff invitation created'),
  ('invitation.accepted', 'invitation', 'system', false, 'Invitation accepted'),
  ('invitation.revoked', 'invitation', 'user', false, 'Invitation revoked'),
  ('invitation.expired', 'invitation', 'system', false, 'Invitation expired'),
  -- profile
  ('profile.updated', 'profile', 'user', true, 'Own profile updated'),
  -- platform
  ('platform_grant.requested', 'platform', 'user', false, 'Platform access grant requested'),
  -- security
  ('access.denied', 'security', 'system', true, 'Authorization denied (FORBIDDEN/NOT_FOUND)'),
  ('access.rate_limited', 'security', 'system', true, 'Action rate limited');

create table public.audit_logs (
  seq bigint generated always as identity primary key,
  id uuid not null default gen_random_uuid(),
  -- No FKs: the log must outlive the rows it describes and must never block their lifecycle.
  organization_id uuid null,
  occurred_at timestamptz not null default now(),
  actor_profile_id uuid null,
  actor_type public.actor_type not null,
  actor_roles text[] not null default '{}',
  event_type text not null,
  resource_type text null check (resource_type ~ '^[a-z_]{1,64}$'),
  resource_id uuid null,
  -- Phase 2 adds patient_id uuid null (+ index) for "who accessed this patient" reports.
  request_id text null check (char_length(request_id) <= 64),
  ip_address inet null,
  user_agent text null check (char_length(user_agent) <= 512),
  break_glass_grant_id uuid null,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata) = 'object'),
  prev_hash bytea null,
  row_hash bytea null,
  constraint audit_logs_id_key unique (id)
);
create index audit_logs_org_time_idx on public.audit_logs (organization_id, occurred_at desc);
create index audit_logs_actor_time_idx on public.audit_logs (actor_profile_id, occurred_at desc);
create index audit_logs_event_time_idx on public.audit_logs (event_type, occurred_at desc);
comment on table public.audit_logs is
  'Append-only audit log (ADR-012). Inserts only via app.write_audit / app.write_system_audit. No PHI in metadata.';

alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;
revoke all on public.audit_logs from public, anon, authenticated, service_role;
-- Owners read their organization's log (care team "own patients" view arrives in Phase 2).
grant select on public.audit_logs to authenticated;
create policy audit_logs_select_owner on public.audit_logs for select to authenticated
  using (organization_id is not null and (select app.has_org_role(organization_id, 'organization_owner')));
-- Platform admins read platform events (no organization) and break-glass events only.
create policy audit_logs_select_platform on public.audit_logs for select to authenticated
  using ((organization_id is null or break_glass_grant_id is not null) and (select app.is_platform_admin()));

create trigger audit_logs_no_update before update on public.audit_logs
  for each row execute function app.reject_mutation();
create trigger audit_logs_no_delete before delete on public.audit_logs
  for each row execute function app.reject_mutation();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function app.reject_mutation();

-- -----------------------------------------------------------------------------
-- Internal insert (no execute grants). Validates the event and the metadata shape.
-- -----------------------------------------------------------------------------
create function app.audit_metadata_is_safe(p_metadata jsonb) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    return false;
  end if;
  if octet_length(p_metadata::text) > 4096 then
    return false;
  end if;
  -- Top-level keys only: ids, enum values and field-name lists. Deny keys that suggest
  -- free text or direct identifiers (defence in depth; the TS schemas are the main control).
  -- Keys must be snake_case; a key is rejected when any of its `_`-separated segments is
  -- in the deny-list (so `membership_id` passes, `display_name` / `ip_address` do not).
  for v_key in select jsonb_object_keys(p_metadata) loop
    if v_key !~ '^[a-z][a-z0-9_]{0,63}$' then
      return false;
    end if;
    if exists (
      select 1 from unnest(string_to_array(v_key, '_')) as seg(s)
      where seg.s in ('name', 'email', 'phone', 'address', 'body', 'text', 'note', 'notes',
                      'content', 'comment', 'document', 'password', 'token', 'secret', 'ip',
                      'agent', 'reason', 'message', 'value', 'answer', 'response', 'diagnosis')
    ) then
      return false;
    end if;
  end loop;
  return true;
end
$$;
revoke all on function app.audit_metadata_is_safe(jsonb) from public, anon, authenticated, service_role;

create function app.insert_audit_row(
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
  v_id uuid;
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
    organization_id, actor_profile_id, actor_type, actor_roles, event_type, resource_type,
    resource_id, request_id, ip_address, user_agent, metadata
  ) values (
    p_organization_id, p_actor_profile_id, p_actor_type, coalesce(p_actor_roles, '{}'), p_event_type,
    p_resource_type, p_resource_id, left(p_request_id, 64), p_ip, left(p_user_agent, 512),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end
$$;
revoke all on function app.insert_audit_row(text, text, public.actor_type, uuid, text[], uuid, text, uuid, jsonb, text, inet, text)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- app.write_audit — user-context writer (called by the DAL / ADR-018 functions inside the
-- request transaction). Actor = auth.uid(); roles from the DB; org must be the caller's
-- (or the caller is a platform admin writing a platform event); per-actor rate limit.
-- -----------------------------------------------------------------------------
create function app.write_audit(
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
  v_actor uuid := (select auth.uid());
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
comment on function app.write_audit(text, uuid, text, uuid, jsonb, text) is
  'User-context audit writer (F-04): actor from auth.uid(), roles from DB, allowlisted events, org membership checked, rate limited.';
revoke all on function app.write_audit(text, uuid, text, uuid, jsonb, text) from public, anon, service_role;
grant execute on function app.write_audit(text, uuid, text, uuid, jsonb, text) to authenticated;

-- -----------------------------------------------------------------------------
-- app.write_system_audit — system path (denied attempts, pre-auth auth events, jobs).
-- Executable only by the app_server login role WITHOUT `set role authenticated`
-- (granted in the app_server migration); never by authenticated/anon.
-- -----------------------------------------------------------------------------
create function app.write_system_audit(
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
  -- Refuse when called inside a user transaction (claims present): system events are
  -- written only from the system path, so a user context can never pick its actor.
  if (select auth.uid()) is not null then
    raise exception using errcode = 'P0001', message = 'AUDIT:system_writer_in_user_context';
  end if;
  return app.insert_audit_row(
    p_event_type, 'system', 'system', p_actor_profile_id, '{}', p_organization_id,
    p_resource_type, p_resource_id, p_metadata, p_request_id, p_ip, p_user_agent
  );
end
$$;
comment on function app.write_system_audit(text, uuid, uuid, text, uuid, jsonb, text, inet, text) is
  'System audit writer (actor_type = system, initiating profile recorded as given). app_server only.';
revoke all on function app.write_system_audit(text, uuid, uuid, text, uuid, jsonb, text, inet, text)
  from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Trigger-sourced event: psychologist/owner role self-granted (F-06, DATABASE.md §5.2).
-- Single source for membership.role_self_granted (F-23).
-- -----------------------------------------------------------------------------
create function app.audit_role_self_grant() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and exists (
    select 1 from public.memberships m
    where m.id = new.membership_id and m.profile_id = (select auth.uid())
  ) then
    perform app.insert_audit_row(
      'membership.role_self_granted', 'user', 'user', (select auth.uid()),
      array[new.role::text], new.organization_id, 'membership', new.membership_id,
      jsonb_build_object('role', new.role::text), null, null, null
    );
    -- TODO(1.3/notifications): notify other owners/psychologists of the org.
  end if;
  return new;
end
$$;
revoke all on function app.audit_role_self_grant() from public, anon, authenticated, service_role;
create trigger membership_roles_audit_self_grant after insert on public.membership_roles
  for each row execute function app.audit_role_self_grant();
