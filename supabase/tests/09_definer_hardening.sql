-- SECURITY DEFINER hardening (SECURITY.md §14, migration 20261108140000_definer_owner_hardening).
-- * No definer function in app/public owned by a BYPASSRLS/superuser role (except the
--   allowlist below, each with a reason).
-- * Fixed search_path = '' on every definer function; no PUBLIC execute; no dynamic SQL;
--   schema-qualified relations (heuristic).
-- * app_definer is least-privilege and RLS applies to it.
-- * Behaviour of the re-owned functions is unchanged (plus suites 01-08).
-- * ADR-019 Option A: PostgREST/GraphQL stay off at the DB level (config side:
--   tests/integration/data-api-closed.test.ts).
begin;
\ir _helpers.psql

select plan(43);

-- ALLOWLIST of definer functions that may be owned by a BYPASSRLS role. Reason for both:
-- they read auth.users; schema `auth` is owned by supabase_admin and `postgres` cannot grant
-- USAGE on it to any other role. EXECUTE is granted to app_definer only.
create table tests.definer_allowlist (sig text primary key, reason text not null);
insert into tests.definer_allowlist values
  ('app.auth_user_verified_email(uuid)', 'auth.users lookup; auth schema not grantable by postgres'),
  ('app.auth_user_id_by_email(text)', 'auth.users lookup; auth schema not grantable by postgres');

create view tests.definer_functions as
  select p.oid, p.oid::regprocedure::text as sig, r.rolname as owner,
         (r.rolbypassrls or r.rolsuper) as owner_bypasses_rls, p.proconfig, p.prosrc, l.lanname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  join pg_language l on l.oid = p.prolang
  where p.prosecdef and n.nspname in ('app', 'public');

-- 1. app_definer role ---------------------------------------------------------------------
select ok(
  (select not rolcanlogin and not rolbypassrls and not rolsuper and not rolinherit
          and not rolcreaterole and not rolcreatedb and not rolreplication
   from pg_roles where rolname = 'app_definer'),
  'app_definer: NOLOGIN, NOBYPASSRLS, NOINHERIT, no superuser/createrole/createdb/replication');
select is(
  (select string_agg(distinct m.rolname, ',') from pg_auth_members a
   join pg_roles m on m.oid = a.member where a.roleid = 'app_definer'::regrole),
  'postgres', 'only postgres (migration runner) is a member of app_definer');
select is(
  (select count(*) from pg_auth_members where member = 'app_definer'::regrole),
  0::bigint, 'app_definer is a member of no role (not authenticated, not postgres)');
select ok(not pg_has_role('authenticated', 'app_definer', 'usage')
          and not pg_has_role('app_server', 'app_definer', 'usage')
          and not pg_has_role('anon', 'app_definer', 'usage')
          and not pg_has_role('service_role', 'app_definer', 'usage'),
  'authenticated/app_server/anon/service_role cannot use app_definer');
select is(
  (select count(*) from pg_class c where c.relowner = 'app_definer'::regrole),
  0::bigint, 'app_definer owns no relations');
select is(
  (select count(*) from pg_proc p where p.proowner = 'app_definer'::regrole and not p.prosecdef),
  0::bigint, 'app_definer owns only SECURITY DEFINER functions');
select ok(not has_schema_privilege('app_definer', 'app', 'create')
          and not has_schema_privilege('app_definer', 'public', 'create'),
  'app_definer cannot create objects in app/public (transient CREATE revoked)');

-- 2. Ownership, search_path, execute -------------------------------------------------------
select is(
  (select string_agg(sig, ', ') from tests.definer_functions
   where owner_bypasses_rls and sig not in (select sig from tests.definer_allowlist)),
  null, 'no SECURITY DEFINER function in app/public is owned by a BYPASSRLS/superuser role (outside the allowlist)');
select is(
  (select count(*) from tests.definer_functions d join tests.definer_allowlist a using (sig) where d.owner = 'postgres'),
  2::bigint, 'allowlisted auth.users lookups exist (owner postgres)');
select ok(
  (select count(*) from tests.definer_functions where owner = 'app_definer') >= 24,
  'Phase 1 definer functions are owned by app_definer');
select is(
  (select string_agg(sig, ', ') from tests.definer_functions
   where not coalesce(proconfig @> array['search_path=""'], false)),
  null, 'every definer function pins search_path to empty');
select is(
  (select string_agg(sig, ', ') from tests.definer_functions where has_function_privilege('public', oid, 'execute')),
  null, 'PUBLIC has no EXECUTE on any definer function');
select is(
  (select string_agg(p.oid::regprocedure::text, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and has_function_privilege('public', p.oid, 'execute')),
  null, 'PUBLIC has no EXECUTE on any app/public function');
select is(
  (select string_agg(sig, ', ') from tests.definer_functions
   where has_function_privilege('service_role', oid, 'execute')),
  null, 'service_role (unused Data API role) executes no definer function');
select ok(
  not has_function_privilege('authenticated', 'app.auth_user_verified_email(uuid)', 'execute')
  and not has_function_privilege('app_server', 'app.auth_user_verified_email(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.auth_user_id_by_email(text)', 'execute')
  and not has_function_privilege('app_server', 'app.auth_user_id_by_email(text)', 'execute')
  and has_function_privilege('app_definer', 'app.auth_user_id_by_email(text)', 'execute'),
  'allowlisted auth.users lookups are executable by app_definer only');
select is(
  (select string_agg(sig, ', ') from tests.definer_functions
   where lanname = 'plpgsql' and prosrc ~* '\mexecute\M'),
  null, 'no dynamic SQL (EXECUTE) in definer functions');
-- Heuristic: every relation after FROM/JOIN/UPDATE/INTO/TABLE is schema-qualified (tokens
-- followed by "(" are function calls; plpgsql variables use the v_ prefix).
select is(
  (select string_agg(distinct d.sig || ':' || m[2], ', ')
   from tests.definer_functions d,
        regexp_matches(lower(d.prosrc), '\m(from|join|update|into|table)\s+([a-z_][a-z0-9_]*)\M(?!\s*\.)(?!\s*\()', 'g') m
   where m[2] not in ('set', 'loop') and m[2] !~ '^v_'),
  null, 'definer function bodies reference only schema-qualified relations');
select ok(
  has_function_privilege('app_definer', 'extensions.digest(text,text)', 'execute')
  and has_function_privilege('app_definer', 'extensions.crypt(text,text)', 'execute')
  and has_function_privilege('app_definer', 'extensions.gen_salt(text,integer)', 'execute'),
  'app_definer can use the pgcrypto functions its bodies call');

-- 3. app_definer least privilege -----------------------------------------------------------
select is(
  (select string_agg(distinct table_name || ':' || privilege_type, ', ')
   from information_schema.role_table_grants
   where grantee = 'app_definer' and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')),
  null, 'app_definer has no DELETE/TRUNCATE/REFERENCES/TRIGGER anywhere');
select ok(not has_table_privilege('app_definer', 'public.idempotency_keys', 'select,insert,update,delete')
          and not has_table_privilege('app_definer', 'storage.objects', 'select,insert,update,delete'),
  'app_definer has no access to idempotency_keys or storage.objects');
select ok(not has_table_privilege('app_definer', 'public.audit_logs', 'select')
          and not has_table_privilege('app_definer', 'public.audit_logs', 'update')
          and has_column_privilege('app_definer', 'public.audit_logs', 'event_type', 'insert')
          and not has_column_privilege('app_definer', 'public.audit_logs', 'prev_hash', 'insert')
          and not has_column_privilege('app_definer', 'public.audit_logs', 'break_glass_grant_id', 'insert'),
  'audit_logs: app_definer may only INSERT, and not hash-chain/break-glass columns');
select ok(not has_column_privilege('app_definer', 'public.profiles', 'locale', 'select')
          and not has_column_privilege('app_definer', 'public.professional_profiles', 'license_number', 'select'),
  'app_definer reads only the profile/professional columns it needs');
select is(
  (select count(*) from pg_policies where 'app_definer' = any (roles) and cmd = 'DELETE'),
  0::bigint, 'no DELETE policy for app_definer');

-- 4. RLS applies to app_definer -----------------------------------------------------------
insert into public.mfa_recovery_codes (profile_id, batch_id, code_hash) values
  ('c0000000-0000-4000-8000-000000000003', gen_random_uuid(), 'fictional-hash-not-bcrypt-000000001');

set local role app_definer;
select is((select count(*) from public.mfa_recovery_codes), 0::bigint,
  'app_definer without claims sees no recovery codes (RLS applies, no bypass)');
select is((select count(*) from public.organization_domains where verified_at is null), 0::bigint,
  'app_definer sees verified domains only');
select throws_ok($$ select count(*) from public.audit_logs $$, '42501', null, 'app_definer cannot read audit_logs');
select throws_ok($$ select count(*) from public.idempotency_keys $$, '42501', null, 'app_definer cannot read idempotency_keys');
reset role;

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
set local role app_definer;
select is((select count(*) from public.mfa_recovery_codes), 0::bigint,
  'app_definer in user X context does not see user Y recovery codes');
select is((select count(*) from public.invitations), 0::bigint,
  'app_definer in a user context sees no invitations (system path only)');
select throws_ok(
  $$ insert into public.memberships (organization_id, profile_id, status)
     values ('d1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'active') $$,
  '42501', null, 'app_definer cannot create memberships in a user context');
reset role;

select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', true);
set local role app_definer;
select is((select count(*) from public.mfa_recovery_codes), 1::bigint, 'app_definer sees the caller''s own codes');
reset role;

-- 5. Identity shims equal auth.uid()/auth.jwt() (vendor drift check) ----------------------
select tests.as_user('c0000000-0000-4000-8000-000000000002', 'aal2');
select ok(app.request_uid() = auth.uid() and app.request_jwt() = auth.jwt(), 'shims match auth.* in a user context');
select tests.as_anon();
reset role;
select ok(app.request_uid() is not distinct from auth.uid() and app.request_jwt() is not distinct from auth.jwt(),
  'shims match auth.* in the anon context');
select tests.as_admin();
select ok(app.request_uid() is null and auth.uid() is null and app.request_jwt() is null and auth.jwt() is null,
  'shims match auth.* in the system context (no claims)');
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001"}', true);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim', '{"aal":"aal1"}', true);
select ok(app.request_uid() = auth.uid() and app.request_jwt() = auth.jwt(),
  'shims follow the same GUC precedence as auth.* (claim.sub, claim)');
select tests.as_admin();

-- 6. Behaviour preserved ------------------------------------------------------------------
select tests.create_user('c0000000-0000-4000-8000-0000000000f1', 'definer.trigger@example.test');
select is((select display_name from public.profiles where id = 'c0000000-0000-4000-8000-0000000000f1'),
  'Fictional definer.trigger@example.test', 'auth.users trigger still creates the profile (as app_definer)');
select is((select existing_profile_id from app.peek_staff_invitation(extensions.digest('test-token-x', 'sha256'))),
  null::uuid, 'peek: no existing auth user for a new invitee');
select ok(app.consume_rate_limit_key(extensions.digest('test:definer', 'sha256'), 1, interval '1 minute')
          and not app.consume_rate_limit_key(extensions.digest('test:definer', 'sha256'), 1, interval '1 minute'),
  'system limiter still counts (app_definer writes counters)');
select isnt(app.write_system_audit('access.denied', null, null, null, null, '{}'::jsonb, 'req-09'), null,
  'system audit writer still inserts');

select tests.as_user('c0000000-0000-4000-8000-000000000001', 'aal2');
select ok(app.is_org_member('c1000000-0000-4000-8000-000000000001')
          and not app.is_org_member('d1000000-0000-4000-8000-000000000001'),
  'is_org_member unchanged for authenticated callers');
select is((select count(*) from app.org_member_directory('c1000000-0000-4000-8000-000000000001')), 4::bigint,
  'org_member_directory returns co-members (profiles read as app_definer)');
select isnt(app.write_audit('organization.updated', 'c1000000-0000-4000-8000-000000000001', 'organization',
  'c1000000-0000-4000-8000-000000000001', '{}'::jsonb, 'req-09u'), null, 'user audit writer still inserts');
select tests.as_admin();

-- 7. ADR-019 Option A at the DB level (Data API / GraphQL) --------------------------------
select ok(
  not exists (select 1 from pg_extension where extname = 'pg_graphql')
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'graphql'),
  'pg_graphql and its resolver are absent');

select * from finish();
rollback;
