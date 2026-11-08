-- =============================================================================
-- Recovery-code MFA reset: recoverable state + audit of every outcome (SECURITY.md §14 P1-05,
-- ADR-021). Forward-only.
--
-- Before: the code was marked used, then the server deleted factors and revoked sessions; a
-- failure part-way left a spent code, a partial reset and NO auth.mfa_reset audit row.
--
-- After (all in the caller's own user transaction, app_definer-owned functions):
--   1. app.consume_recovery_code: marks the code used AND reset_status = 'pending', and writes
--      auth.recovery_code_used + auth.mfa_reset {outcome: 'started', attempt} atomically.
--      Retry path: the SAME code is accepted again (status 'retry') while its reset is still
--      pending, for RESET_RETRY_WINDOW (1 h) and at most 5 attempts; the rate limit applies.
--   2. The server removes factors (Auth admin API) and revokes all sessions.
--   3. app.finish_recovery_reset(outcome, factors_removed): writes auth.mfa_reset with the
--      outcome (`ok` / `partial` / `failed`); only `ok` sets reset_status = 'completed'
--      (final, the code is then dead). If step 2 or 3 fails, the code stays 'pending', so the
--      user can retry, and support sees `started` without a matching `ok` (alert/runbook).
-- Durations are product constants, not legal values.
-- =============================================================================

alter table public.mfa_recovery_codes
  add column reset_status text null check (reset_status in ('pending', 'completed')),
  add column reset_attempts smallint not null default 0 check (reset_attempts between 0 and 5),
  add constraint mfa_recovery_codes_reset_requires_use check (reset_status is null or used_at is not null);
comment on column public.mfa_recovery_codes.reset_status is
  'P1-05: MFA reset driven by this code: pending (retryable) -> completed (final).';

-- used_at / revoked_at are one-time; reset_status only null -> pending -> completed;
-- reset_attempts only grows; nothing else changes after insert.
create or replace function app.guard_mfa_recovery_code() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.profile_id <> old.profile_id or new.batch_id <> old.batch_id
     or new.code_hash <> old.code_hash or new.created_at <> old.created_at
     or (old.used_at is not null and new.used_at is distinct from old.used_at)
     or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
     or (old.reset_status = 'completed' and new.reset_status is distinct from old.reset_status)
     or (old.reset_status = 'pending' and new.reset_status is distinct from old.reset_status
         and new.reset_status is distinct from 'completed')
     or (old.reset_status is null and new.reset_status = 'completed')
     or new.reset_attempts < old.reset_attempts then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:mfa_recovery_codes';
  end if;
  return new;
end
$$;

-- The existing caller-only update policy for app_definer covers the new columns.
grant update (reset_status, reset_attempts) on public.mfa_recovery_codes to app_definer;

-- -----------------------------------------------------------------------------
-- app.consume_recovery_code(code) — same signature; adds 'pending' state and the retry path.
-- Status: ok | retry | invalid | rate_limited.
-- -----------------------------------------------------------------------------
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
    -- Unused codes first; then codes whose reset is still pending (retry window, attempts cap).
    for v_row in
      select c.id, c.batch_id, c.code_hash, c.used_at, c.reset_attempts
      from public.mfa_recovery_codes c
      where c.profile_id = v_actor and c.revoked_at is null
        and (c.used_at is null
             or (c.reset_status = 'pending' and c.used_at > now() - interval '1 hour'
                 and c.reset_attempts < 5))
      order by (c.used_at is null) desc
      for update
    loop
      if extensions.crypt(v_code, v_row.code_hash) = v_row.code_hash then
        if v_row.used_at is null then
          update public.mfa_recovery_codes
             set used_at = now(), reset_status = 'pending', reset_attempts = 1
           where id = v_row.id;
          perform app.insert_audit_row('auth.recovery_code_used', 'system', 'system', v_actor, '{}',
            null, 'mfa_recovery_batch', v_row.batch_id,
            jsonb_build_object('batch_id', v_row.batch_id), null, null, null);
          status := 'ok';
        else
          update public.mfa_recovery_codes
             set reset_attempts = v_row.reset_attempts + 1
           where id = v_row.id;
          status := 'retry';
        end if;
        perform app.insert_audit_row('auth.mfa_reset', 'system', 'system', v_actor, '{}',
          null, 'mfa_recovery_batch', v_row.batch_id,
          jsonb_build_object('via', 'recovery_code', 'outcome', 'started',
                             'attempt', case when v_row.used_at is null then 1
                                             else v_row.reset_attempts + 1 end),
          null, null, null);
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
comment on function app.consume_recovery_code(text) is
  'ADR-021/P1-05: caller consumes one own recovery code (bcrypt, single use, rate limited fail-closed); marks the reset pending (retryable 1 h / 5 attempts); audits used + mfa_reset started.';

-- -----------------------------------------------------------------------------
-- app.finish_recovery_reset(outcome, factors_removed): caller-only. Records the outcome of the
-- server-side reset for the caller's most recent PENDING code; `ok` completes it.
-- -----------------------------------------------------------------------------
create function app.finish_recovery_reset(p_outcome text, p_factors_removed integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select app.request_uid());
  v_row record;
begin
  if v_actor is null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:no_actor';
  end if;
  if p_outcome is null or p_outcome not in ('ok', 'partial', 'failed')
     or p_factors_removed is null or p_factors_removed not between 0 and 50 then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invalid_reset_outcome';
  end if;

  select c.id, c.batch_id, c.reset_attempts into v_row
  from public.mfa_recovery_codes c
  where c.profile_id = v_actor and c.reset_status = 'pending'
    and c.used_at > now() - interval '1 hour'
  order by c.used_at desc
  limit 1
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:no_pending_reset';
  end if;

  if p_outcome = 'ok' then
    update public.mfa_recovery_codes set reset_status = 'completed' where id = v_row.id;
  end if;
  perform app.insert_audit_row('auth.mfa_reset', 'system', 'system', v_actor, '{}',
    null, 'mfa_recovery_batch', v_row.batch_id,
    jsonb_build_object('via', 'recovery_code', 'outcome', p_outcome,
                       'factors_removed', p_factors_removed, 'attempt', v_row.reset_attempts),
    null, null, null);
  return case when p_outcome = 'ok' then 'completed' else 'pending' end;
end
$$;
comment on function app.finish_recovery_reset(text, integer) is
  'ADR-021/P1-05: caller records the outcome of the MFA reset for its pending recovery code (audited); ok completes it.';

-- Owner model (SECURITY.md §14.2): new definer functions are owned by app_definer.
grant create on schema app to app_definer;
alter function app.finish_recovery_reset(text, integer) owner to app_definer;
revoke create on schema app from app_definer;
revoke all on function app.finish_recovery_reset(text, integer) from public, anon, service_role;
grant execute on function app.finish_recovery_reset(text, integer) to authenticated;

-- Invariants (same as 20261108140000 §8, for the functions touched here).
do $$
begin
  if (select r.rolname from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid = p.proowner
      where p.oid = 'app.finish_recovery_reset(text, integer)'::regprocedure) <> 'app_definer'
     or (select r.rolname from pg_catalog.pg_proc p join pg_catalog.pg_roles r on r.oid = p.proowner
         where p.oid = 'app.consume_recovery_code(text)'::regprocedure) <> 'app_definer' then
    raise exception 'recovery functions must be owned by app_definer';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid in ('app.finish_recovery_reset(text, integer)'::regprocedure,
                    'app.consume_recovery_code(text)'::regprocedure)
      and not coalesce(p.proconfig @> array['search_path=""'], false)
  ) then
    raise exception 'recovery functions must set search_path = ''''';
  end if;
  if has_function_privilege('anon', 'app.finish_recovery_reset(text, integer)', 'execute') then
    raise exception 'anon must not execute app.finish_recovery_reset';
  end if;
end
$$;
