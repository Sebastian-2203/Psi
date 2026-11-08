-- Cross-tenant isolation (ADR-003 release gate, SECURITY.md §13.1 "Cross-tenant").
begin;
\ir _helpers.psql

select plan(22);

-- Owner X (aal2) -------------------------------------------------------------------------
select tests.as_user('c0000000-0000-4000-8000-000000000001');

select results_eq(
  $$ select slug from public.organizations order by slug $$,
  $$ values ('test-r'::text), ('test-x'::text) $$,
  'owner X sees X and read_only R; never Y; suspended S hidden'
);
select is((select count(*) from public.memberships where organization_id = 'd1000000-0000-4000-8000-000000000001'), 0::bigint,
  'owner X sees no memberships of Y');
select is((select count(*) from public.memberships where organization_id = 'c1000000-0000-4000-8000-000000000001'), 4::bigint,
  'owner X sees all 4 memberships of X');
select is((select count(*) from public.membership_roles where organization_id = 'd1000000-0000-4000-8000-000000000001'), 0::bigint,
  'owner X sees no membership_roles of Y');
select is((select count(*) from public.invitations where organization_id = 'd1000000-0000-4000-8000-000000000001'), 0::bigint,
  'owner X sees no invitations of Y');
select is((select count(*) from public.invitations where organization_id = 'c1000000-0000-4000-8000-000000000001'), 1::bigint,
  'owner X sees the invitation of X');
select is((select count(*) from public.organization_branding where organization_id = 'd1000000-0000-4000-8000-000000000001'), 0::bigint,
  'owner X cannot read Y branding');
select is((select count(*) from public.organization_domains where organization_id = 'd1000000-0000-4000-8000-000000000001'), 0::bigint,
  'owner X cannot read Y domains');
select is((select count(*) from public.profiles), 1::bigint, 'profiles: only own row is readable');
select is((select count(*) from app.org_member_directory('d1000000-0000-4000-8000-000000000001')), 0::bigint,
  'directory of Y is empty for owner X');
select is((select count(*) from app.org_member_directory('c1000000-0000-4000-8000-000000000001')), 4::bigint,
  'directory of X lists its 4 members');

select is(tests.affected($$ update public.organizations set display_name = 'Hijacked' where id = 'd1000000-0000-4000-8000-000000000001' $$), 0,
  'owner X cannot update org Y (0 rows)');
select is(tests.affected($$ update public.organizations set display_name = 'Org X renamed' where id = 'c1000000-0000-4000-8000-000000000001' $$), 1,
  'owner X can update own org');
select is(tests.affected($$ update public.organizations set display_name = 'R renamed' where id = 'c1000000-0000-4000-8000-0000000000aa' $$), 0,
  'read_only org R is not writable even by its owner');
select is(tests.affected($$ update public.memberships set status = 'suspended' where id = 'd2000000-0000-4000-8000-000000000001' $$), 0,
  'owner X cannot suspend a member of Y');
select throws_ok(
  $$ insert into public.professional_profiles (organization_id, membership_id, professional_title, license_number, license_issuer)
     values ('d1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'x', 'x-1', 'x') $$,
  '42501', null, 'owner X cannot insert a professional profile into Y (RLS)'
);
select throws_ok(
  $$ insert into public.invitations (organization_id, email, roles, token_hash, expires_at)
     values ('d1000000-0000-4000-8000-000000000001', 'evil@example.test', '{organization_owner}', extensions.digest('t', 'sha256'), now() + interval '1 day') $$,
  '42501', null, 'owner X cannot invite into Y (RLS)'
);
select throws_ok($$ select token_hash from public.invitations $$, '42501', null,
  'invitations.token_hash is not readable by authenticated');

-- Composite tenant FKs (as admin: integrity holds even without RLS) -----------------------
select tests.as_admin();
insert into public.memberships (id, organization_id, profile_id)
values ('d2000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000009');
select throws_ok(
  $$ insert into public.membership_roles (organization_id, membership_id, role)
     values ('c1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000009', 'organization_owner') $$,
  '23503', null, 'composite FK: a role in X cannot point at a membership of Y'
);
select throws_ok(
  $$ insert into public.professional_profiles (organization_id, membership_id, professional_title, license_number, license_issuer)
     values ('c1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'x', 'x-2', 'x') $$,
  '23503', null, 'composite FK: a professional profile in X cannot point at a membership of Y'
);

-- Members of suspended membership / no membership -----------------------------------------
select tests.as_user('c0000000-0000-4000-8000-000000000004');
select is((select count(*) from public.organizations), 0::bigint, 'suspended member sees no organization');
select tests.as_user('c0000000-0000-4000-8000-0000000000ff');
select is((select count(*) from public.memberships), 0::bigint, 'user without membership sees no memberships');

select * from finish();
rollback;
