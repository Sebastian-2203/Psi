-- Append-only, non-forgeable audit log (ADR-012, F-04, SECURITY.md §7.2).
begin;
\ir _helpers.psql

select plan(19);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname = 'write_audit' and pg_get_function_arguments(p.oid) ilike '%actor%'),
  0::bigint, 'write_audit takes no actor parameter'
);

select tests.as_user('c0000000-0000-4000-8000-000000000002');
select lives_ok(
  $$ select app.write_audit('organization.updated', 'c1000000-0000-4000-8000-000000000001', 'organization',
       'c1000000-0000-4000-8000-000000000001', '{"changed_fields":["display_name"]}', 'req-test-1') $$,
  'member writes an allowlisted event for own org'
);
select tests.as_admin();
select results_eq(
  $$ select actor_profile_id, actor_type::text, actor_roles from public.audit_logs where request_id = 'req-test-1' $$,
  $$ values ('c0000000-0000-4000-8000-000000000002'::uuid, 'user'::text, '{organization_owner,psychologist}'::text[]) $$,
  'actor from auth.uid(), roles from the DB'
);

select tests.as_user('c0000000-0000-4000-8000-000000000002');
select throws_ok($$ select app.write_audit('organization.updated', 'd1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'AUDIT:organization_not_allowed', 'cannot write audit rows for a foreign org');
select throws_ok($$ select app.write_audit('clinical_note.exported_nowhere', 'c1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'AUDIT:unknown_event', 'unknown events are rejected');
select throws_ok($$ select app.write_audit('access.denied', null) $$,
  'P0001', 'AUDIT:wrong_writer', 'system-only events cannot be written from a user context');
select throws_ok($$ select app.write_audit('organization.updated', 'c1000000-0000-4000-8000-000000000001', null, null, '{"display_name":"Ana"}') $$,
  'P0001', 'AUDIT:unsafe_metadata', 'metadata keys suggesting PHI are rejected');
select throws_ok($$ select app.write_audit('organization.updated', null) $$,
  'P0001', 'AUDIT:organization_required', 'org-scoped events need an organization');
select throws_ok(
  $$ insert into public.audit_logs (actor_type, event_type) values ('user', 'organization.updated') $$,
  '42501', null, 'authenticated cannot insert directly');
select throws_ok($$ update public.audit_logs set event_type = 'x' $$, '42501', null, 'authenticated cannot update');
select throws_ok($$ delete from public.audit_logs $$, '42501', null, 'authenticated cannot delete');
select throws_ok($$ select app.write_system_audit('access.denied') $$, '42501', null,
  'authenticated cannot call the system writer');
select throws_ok(
  $$ select app.write_audit('profile.updated', null, null, null, '{"changed_fields":["locale"]}') from generate_series(1, 301) $$,
  'P0001', 'RATE_LIMITED:audit', 'per-actor audit flood protection');

-- Visibility
select tests.as_user('c0000000-0000-4000-8000-000000000001');
select ok((select count(*) from public.audit_logs where organization_id = 'c1000000-0000-4000-8000-000000000001') >= 1,
  'owner X reads X audit rows');
select tests.as_user('d0000000-0000-4000-8000-000000000001');
select is((select count(*) from public.audit_logs where organization_id = 'c1000000-0000-4000-8000-000000000001'), 0::bigint,
  'owner Y reads no X audit rows');

-- Even the table owner cannot mutate the log.
select tests.as_admin();
select throws_ok($$ update public.audit_logs set event_type = 'x' $$, 'P0001', 'IMMUTABLE:audit_logs', 'UPDATE rejected for postgres');
select throws_ok($$ delete from public.audit_logs $$, 'P0001', 'IMMUTABLE:audit_logs', 'DELETE rejected for postgres');
select throws_ok($$ truncate public.audit_logs $$, 'P0001', 'IMMUTABLE:audit_logs', 'TRUNCATE rejected for postgres');
select throws_ok($$ select app.write_audit('profile.updated', null) $$, 'P0001', 'AUDIT:no_actor',
  'write_audit refuses calls without a verified actor');

select * from finish();
rollback;
