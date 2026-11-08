-- anon has nothing; system-path functions are app_server-only and reject user context.
begin;
\ir _helpers.psql

select plan(19);

select tests.as_anon();
select throws_ok($$ select * from public.organizations $$, '42501', null, 'anon: organizations denied');
select throws_ok($$ select * from public.organization_branding $$, '42501', null, 'anon: branding denied');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon: profiles denied');
select throws_ok($$ select * from public.audit_logs $$, '42501', null, 'anon: audit_logs denied');
select throws_ok($$ select app.is_org_member(gen_random_uuid()) $$, '42501', null, 'anon: no usage on schema app');

select tests.as_admin();
select ok(not has_function_privilege('authenticated', 'app.resolve_organization_by_host(text)', 'execute'),
  'authenticated cannot resolve hosts directly');
select ok(not has_function_privilege('authenticated', 'app.get_public_branding(uuid)', 'execute'),
  'authenticated cannot call get_public_branding');
select ok(not has_function_privilege('authenticated', 'app.accept_staff_invitation(bytea,uuid,text,text,text,text)', 'execute'),
  'authenticated cannot accept invitations directly');
select ok(has_function_privilege('app_server', 'app.accept_staff_invitation(bytea,uuid,text,text,text,text)', 'execute'),
  'app_server can execute the system functions');

-- Host resolution: verified only, normalized.
select is(app.resolve_organization_by_host('test-x.localhost'), 'c1000000-0000-4000-8000-000000000001'::uuid, 'verified host resolves');
select is(app.resolve_organization_by_host('  TEST-X.localhost '), 'c1000000-0000-4000-8000-000000000001'::uuid, 'host is normalized');
select is(app.resolve_organization_by_host('test-y.localhost')::text, null::text, 'unverified host does not resolve');
select is((select count(*) from app.get_public_branding('c1000000-0000-4000-8000-000000000001')), 1::bigint, 'public branding row');

-- Invitation acceptance (system path).
select tests.create_user('c0000000-0000-4000-8000-0000000000e1', 'invitee.x@example.test');
select throws_ok(
  $$ select * from app.accept_staff_invitation(extensions.digest('test-token-x', 'sha256'), 'c0000000-0000-4000-8000-0000000000e1') $$,
  'P0001', 'PRECONDITION:professional_profile_required', 'psychologist invitation needs professional data'
);
select throws_ok(
  $$ select * from app.accept_staff_invitation(extensions.digest('test-token-y', 'sha256'), 'c0000000-0000-4000-8000-000000000009') $$,
  'P0001', 'PRECONDITION:invitation_invalid', 'email binding: another user cannot accept'
);
select lives_ok(
  $$ select * from app.accept_staff_invitation(extensions.digest('test-token-x', 'sha256'), 'c0000000-0000-4000-8000-0000000000e1',
       'Psicóloga (ficticia)', 'TEST-X-E1', 'Ficticio', 'req-accept') $$,
  'matching verified user accepts'
);
select results_eq(
  $$ select r.role::text from public.membership_roles r join public.memberships m on m.id = r.membership_id
     where m.profile_id = 'c0000000-0000-4000-8000-0000000000e1' $$,
  $$ values ('psychologist'::text) $$,
  'roles are exactly those of the invitation'
);
select throws_ok(
  $$ select * from app.accept_staff_invitation(extensions.digest('test-token-x', 'sha256'), 'c0000000-0000-4000-8000-0000000000e1',
       'x', 'x', 'x') $$,
  'P0001', 'PRECONDITION:invitation_invalid', 'invitation tokens are single use'
);

-- System functions refuse to run with user claims present.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}', true);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
select throws_ok($$ select app.write_system_audit('access.denied') $$, 'P0001', 'AUDIT:system_writer_in_user_context',
  'system audit writer refuses a user context');

select * from finish();
rollback;
