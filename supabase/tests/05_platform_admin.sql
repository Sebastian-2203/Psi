-- platform_admin: metadata only, no tenant member data without an approved grant (ADR-014).
begin;
\ir _helpers.psql

select plan(19);

select tests.as_user('e0000000-0000-4000-8000-000000000001');
select ok(app.is_platform_admin(), 'aal2 platform admin');
select ok(not app.is_org_member('c1000000-0000-4000-8000-000000000001'), 'platform admin is not an org member');
select ok((select count(*) from public.organizations) >= 4, 'platform admin reads organization metadata');
select is((select count(*) from public.memberships), 0::bigint, 'no memberships without a grant');
select is((select count(*) from public.membership_roles), 0::bigint, 'no membership_roles without a grant');
select is((select count(*) from public.professional_profiles), 0::bigint, 'no professional profiles');
select is((select count(*) from public.invitations), 0::bigint, 'no invitations');
select is((select count(*) from public.profiles), 1::bigint, 'only own profile');
select is((select count(*) from public.audit_logs where organization_id is not null and break_glass_grant_id is null), 0::bigint,
  'no tenant audit rows');
select hasnt_function('app', 'can_read_clinical', 'no clinical helper exists yet (Phase 3): no clinical path at all');

-- Grant requests: pending only, requester = auth.uid(), no self-activation.
select lives_ok(
  $$ insert into public.platform_access_grants (organization_id, scope, reason, ticket_reference, requested_duration)
     values ('c1000000-0000-4000-8000-000000000001', 'org_support_non_clinical', 'Fictional support ticket needing staff list', 'TCK-1', interval '1 hour') $$,
  'platform admin can request a T2 grant'
);
select results_eq(
  $$ select status::text, platform_admin_profile_id from public.platform_access_grants where ticket_reference = 'TCK-1' $$,
  $$ values ('pending'::text, 'e0000000-0000-4000-8000-000000000001'::uuid) $$,
  'request is pending and attributed to the caller'
);
select throws_ok(
  $$ insert into public.platform_access_grants (organization_id, scope, reason, ticket_reference, status)
     values ('c1000000-0000-4000-8000-000000000001', 'org_support_non_clinical', 'Fictional support ticket needing staff list', 'TCK-2', 'approved') $$,
  '42501', null, 'status is not insertable (no self-approval)'
);
select throws_ok(
  $$ insert into public.platform_access_grants (organization_id, scope, patient_id, reason, ticket_reference)
     values ('c1000000-0000-4000-8000-000000000001', 'clinical_read_break_glass', gen_random_uuid(), 'Fictional incident requiring clinical read', 'TCK-3') $$,
  'P0001', 'PRECONDITION:break_glass_not_available', 'clinical break-glass is unavailable in Phase 1 (fail closed)'
);
select throws_ok($$ update public.platform_access_grants set status = 'approved' $$, '42501', null,
  'requester cannot update grants');
select throws_ok($$ select app.approve_grant_as_second_admin(gen_random_uuid()) $$, '42501', null,
  'approval workflow stubs are not executable');

-- An APPROVED T2 grant (owner + second admin, inserted by the system) opens the staff list.
select tests.as_admin();
insert into public.platform_access_grants (organization_id, platform_admin_profile_id, scope, reason, ticket_reference,
  requested_duration, status, owner_approved_by_profile_id, owner_approved_at, psychologist_approval_required,
  second_approver_profile_id, second_approved_at, starts_at, expires_at)
values ('c1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'org_support_non_clinical',
  'Fictional approved support ticket for staff list', 'TCK-4', interval '1 hour', 'approved',
  'c0000000-0000-4000-8000-000000000001', now(), false, 'e0000000-0000-4000-8000-000000000002', now(), now(), now() + interval '1 hour');

select tests.as_user('e0000000-0000-4000-8000-000000000001');
select is((select count(*) from public.memberships where organization_id = 'c1000000-0000-4000-8000-000000000001'), 4::bigint,
  'approved T2 grant: requester reads X memberships');
select tests.as_user('e0000000-0000-4000-8000-000000000002');
select is((select count(*) from public.memberships), 0::bigint, 'the second approver gains nothing');

select tests.as_admin();
select throws_ok(
  $$ insert into public.platform_access_grants (organization_id, platform_admin_profile_id, scope, reason, ticket_reference,
       status, owner_approved_by_profile_id, owner_approved_at, psychologist_approval_required, second_approver_profile_id,
       second_approved_at, starts_at, expires_at)
     values ('c1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'org_support_non_clinical',
       'Fictional self approved grant attempt here', 'TCK-5', 'approved', 'c0000000-0000-4000-8000-000000000001', now(), false,
       'e0000000-0000-4000-8000-000000000001', now(), now(), now() + interval '1 hour') $$,
  '23514', null, 'second approver must differ from the requester (DB check)'
);

select * from finish();
rollback;
