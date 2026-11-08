-- Role checks within one tenant (SECURITY.md §4.1; F-06 DB-enforced role rules; last owner).
begin;
\ir _helpers.psql

select plan(20);

-- Psychologist X (not owner) ---------------------------------------------------------------
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select ok(app.has_org_role('c1000000-0000-4000-8000-000000000001', 'psychologist'), 'psy X holds psychologist');
select ok(not app.has_org_role('c1000000-0000-4000-8000-000000000001', 'organization_owner'), 'psy X is not owner');
select is((select count(*) from public.memberships), 4::bigint, 'psy X reads the member list (org.members.read)');
select is((select count(*) from public.invitations), 0::bigint, 'psy X cannot read invitations');
select is((select count(*) from public.audit_logs), 0::bigint, 'psy X cannot read org audit logs');
select is(tests.affected($$ update public.organizations set display_name = 'x' $$), 0, 'psy X cannot update org settings');
select is(tests.affected($$ update public.memberships set status = 'suspended' where id = 'c2000000-0000-4000-8000-000000000001' $$), 0,
  'psy X cannot suspend members');
select is(tests.affected($$ delete from public.membership_roles where membership_id = 'c2000000-0000-4000-8000-000000000001' $$), 0,
  'psy X cannot remove roles');
select throws_ok(
  $$ insert into public.membership_roles (organization_id, membership_id, role)
     values ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000003', 'organization_owner') $$,
  '42501', null, 'psy X cannot self-grant organization_owner'
);
select is(tests.affected($$ update public.professional_profiles set professional_title = 'Updated (ficticio)'
                            where membership_id = 'c2000000-0000-4000-8000-000000000003' $$), 1,
  'psy X updates own professional profile');
select is(tests.affected($$ update public.professional_profiles set professional_title = 'x'
                            where membership_id = 'c2000000-0000-4000-8000-000000000002' $$), 0,
  'psy X cannot update another member''s professional profile');

-- Owner X ----------------------------------------------------------------------------------
select tests.as_user('c0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ insert into public.membership_roles (organization_id, membership_id, role)
     values ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'psychologist') $$,
  'P0001', 'PRECONDITION:professional_profile_required',
  'psychologist role requires a professional profile (F-06, DB-enforced)'
);
select lives_ok(
  $$ insert into public.professional_profiles (organization_id, membership_id, professional_title, license_number, license_issuer)
     values ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'Psicóloga (ficticia)', 'TEST-X-1', 'Ficticio') $$,
  'owner X creates own professional profile'
);
select lives_ok(
  $$ insert into public.membership_roles (organization_id, membership_id, role)
     values ('c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 'psychologist') $$,
  'owner X self-grants psychologist once the profile exists'
);
select is((select count(*) from public.audit_logs where event_type = 'membership.role_self_granted'
             and actor_profile_id = 'c0000000-0000-4000-8000-000000000001'), 1::bigint,
  'self-grant wrote membership.role_self_granted with the real actor');
select is(
  (select granted_by from public.membership_roles where membership_id = 'c2000000-0000-4000-8000-000000000001' and role = 'psychologist'),
  'c0000000-0000-4000-8000-000000000001'::uuid,
  'granted_by is taken from auth.uid(), not from input'
);
select is(tests.affected($$ delete from public.membership_roles
                            where membership_id = 'c2000000-0000-4000-8000-000000000002' and role = 'organization_owner' $$), 1,
  'owner X removes the owner role of the second owner');
select throws_ok(
  $$ delete from public.membership_roles where membership_id = 'c2000000-0000-4000-8000-000000000001' and role = 'organization_owner' $$,
  'P0001', 'PRECONDITION:last_owner', 'the last owner role cannot be removed'
);
select throws_ok(
  $$ update public.memberships set status = 'removed' where id = 'c2000000-0000-4000-8000-000000000001' $$,
  'P0001', 'PRECONDITION:last_owner', 'the last owner cannot be suspended/removed'
);
select throws_ok(
  $$ update public.invitations set status = 'accepted' where organization_id = 'c1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'owners can only revoke invitations, never accept them'
);

select * from finish();
rollback;
