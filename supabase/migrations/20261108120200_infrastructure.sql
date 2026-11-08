-- =============================================================================
-- Infrastructure tables: rate_limit_counters (ADR-020), idempotency_keys (API §6),
-- mfa_recovery_codes (ADR-021). No PHI, no raw IPs, no raw codes.
-- Refs: DATABASE.md §5.7, SECURITY.md §3.2, §3.6.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- rate_limit_counters — fixed-window counters; UNLOGGED (a crash only resets limits).
-- Access only via app.consume_rate_limit* (no table privileges for any API role).
-- -----------------------------------------------------------------------------
create unlogged table public.rate_limit_counters (
  bucket_key bytea not null check (octet_length(bucket_key) = 32),
  window_start timestamptz not null,
  count integer not null default 0 check (count >= 0),
  primary key (bucket_key, window_start)
);
create index rate_limit_counters_window_idx on public.rate_limit_counters (window_start);
comment on table public.rate_limit_counters is
  'ADR-020 limiter. bucket_key = sha256("<action>:<profile|ip-hash>"). Purge job removes old windows.';
alter table public.rate_limit_counters enable row level security;
alter table public.rate_limit_counters force row level security;
revoke all on public.rate_limit_counters from public, anon, authenticated, service_role;

-- Window start aligned to multiples of p_window since the epoch.
create function app.rate_limit_window_start(p_window interval) returns timestamptz
language sql
stable
set search_path = ''
as $$
  select to_timestamp(
    floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window)
  )
$$;
revoke all on function app.rate_limit_window_start(interval) from public, anon, authenticated, service_role;

-- User context: the key is derived from the action and auth.uid() inside the function, so a
-- caller can only consume its own buckets. Returns true when the action is allowed.
create function app.consume_rate_limit(p_action text, p_limit integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
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
revoke all on function app.consume_rate_limit(text, integer, interval) from public, anon, service_role;
grant execute on function app.consume_rate_limit(text, integer, interval) to authenticated;

-- System context (pre-auth, per-IP): the server passes sha256("<action>:<ip-hash>").
-- Executable only by app_server (granted in the app_server migration).
create function app.consume_rate_limit_key(p_bucket_key bytea, p_limit integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if (select auth.uid()) is not null then
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
revoke all on function app.consume_rate_limit_key(bytea, integer, interval) from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- idempotency_keys — operational, not clinical. result_ref holds ids only.
-- -----------------------------------------------------------------------------
create table public.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid null references public.organizations (id) on delete restrict,
  actor_profile_id uuid not null references public.profiles (id) on delete cascade,
  action_name text not null check (action_name ~ '^[a-z][a-zA-Z0-9_.]{0,63}$'),
  key uuid not null,
  request_hash bytea not null check (octet_length(request_hash) = 32),
  result_ref jsonb null check (result_ref is null or jsonb_typeof(result_ref) = 'object'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  constraint idempotency_keys_actor_action_key unique (actor_profile_id, action_name, key),
  constraint idempotency_keys_expiry check (expires_at > created_at)
);
create index idempotency_keys_org_idx on public.idempotency_keys (organization_id);
create index idempotency_keys_expires_idx on public.idempotency_keys (expires_at);
comment on table public.idempotency_keys is 'API_CONTRACTS §6. Actor reads/inserts own rows; purge job deletes expired rows.';
alter table public.idempotency_keys enable row level security;
alter table public.idempotency_keys force row level security;
revoke all on public.idempotency_keys from public, anon, authenticated, service_role;
grant select on public.idempotency_keys to authenticated;
grant insert (organization_id, actor_profile_id, action_name, key, request_hash, result_ref)
  on public.idempotency_keys to authenticated;
grant update (result_ref) on public.idempotency_keys to authenticated;
create policy idempotency_keys_select_own on public.idempotency_keys for select to authenticated
  using (actor_profile_id = (select auth.uid()));
create policy idempotency_keys_insert_own on public.idempotency_keys for insert to authenticated
  with check (
    actor_profile_id = (select auth.uid())
    and (organization_id is null or (select app.is_org_member(organization_id)))
  );
create policy idempotency_keys_update_own on public.idempotency_keys for update to authenticated
  using (actor_profile_id = (select auth.uid()))
  with check (actor_profile_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- mfa_recovery_codes (ADR-021) — hashed, single use. No policies and no grants for
-- authenticated: only the recovery server functions (workstream 1.3) touch this table.
-- NOTE: GoTrue v2.197 ships native recovery codes (auth.mfa_recovery_code_sets, auth-js
-- `mfa.recoveryCodes.*` behind a flag). ADR-021 says to prefer native support if it exists;
-- the architect/security decision may supersede this table (see DATABASE.md §5.7).
-- -----------------------------------------------------------------------------
create table public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  batch_id uuid not null,
  code_hash text not null check (char_length(code_hash) between 20 and 255),
  created_at timestamptz not null default now(),
  used_at timestamptz null,
  revoked_at timestamptz null
);
create index mfa_recovery_codes_profile_idx on public.mfa_recovery_codes (profile_id, batch_id);
create unique index mfa_recovery_codes_hash_key on public.mfa_recovery_codes (code_hash);
comment on table public.mfa_recovery_codes is
  'ADR-021 recovery codes: Argon2id/bcrypt hash only, single use (used_at), batch revoked on regeneration.';
alter table public.mfa_recovery_codes enable row level security;
alter table public.mfa_recovery_codes force row level security;
revoke all on public.mfa_recovery_codes from public, anon, authenticated, service_role;

-- used_at / revoked_at are one-time; nothing else changes after insert.
create function app.guard_mfa_recovery_code() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.profile_id <> old.profile_id or new.batch_id <> old.batch_id
     or new.code_hash <> old.code_hash or new.created_at <> old.created_at
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:mfa_recovery_codes';
  end if;
  return new;
end
$$;
revoke all on function app.guard_mfa_recovery_code() from public, anon, authenticated, service_role;
create trigger mfa_recovery_codes_guard before update on public.mfa_recovery_codes
  for each row execute function app.guard_mfa_recovery_code();
