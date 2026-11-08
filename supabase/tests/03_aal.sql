-- aal1 vs aal2 for staff and platform helpers (F-03, SECURITY.md §3.2 point 2).
begin;
\ir _helpers.psql

select plan(12);

select tests.as_user('c0000000-0000-4000-8000-000000000001', 'aal1');
select is(app.aal(), 'aal1', 'aal() reads the verified claim');
select ok(not app.is_org_member('c1000000-0000-4000-8000-000000000001'), 'aal1 owner: is_org_member false');
select ok(not app.has_org_role('c1000000-0000-4000-8000-000000000001', 'organization_owner'), 'aal1 owner: has_org_role false');
select is(app.my_membership_id('c1000000-0000-4000-8000-000000000001'), null, 'aal1 owner: my_membership_id null');
select is((select count(*) from public.organizations), 0::bigint, 'aal1 owner reads no organization');
select is((select count(*) from public.memberships), 0::bigint, 'aal1 owner reads no membership');
select is(tests.affected($$ update public.organizations set display_name = 'x' where id = 'c1000000-0000-4000-8000-000000000001' $$), 0,
  'aal1 owner cannot write');
select is((select count(*) from app.my_capacities()), 3::bigint,
  'aal1 owner still sees own capacities (so the app can answer MFA_REQUIRED)');

select tests.as_user('e0000000-0000-4000-8000-000000000001', 'aal1');
select ok(not app.is_platform_admin(), 'aal1 platform admin: is_platform_admin false');
select is((select count(*) from public.organizations), 0::bigint, 'aal1 platform admin reads no organization');

-- Claims without any aal (e.g. a token we did not verify) behave like aal1.
select tests.as_admin();
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(app.aal(), 'none', 'missing aal claim -> none');

select tests.as_user('c0000000-0000-4000-8000-000000000001', 'aal2');
select ok(app.is_org_member('c1000000-0000-4000-8000-000000000001'), 'aal2 owner: is_org_member true');

select * from finish();
rollback;
