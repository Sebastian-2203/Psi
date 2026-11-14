-- Phase 2: patients, care team, guardians, consents (SECURITY.md §4.1, §5; Q-03/Q-04/Q-17 defaults).
begin;
\ir _helpers.psql

select plan(55);

-- Portal users (FICTIONAL)
select tests.create_user('c0000000-0000-4000-8000-000000000010', 'patient.x@example.test');
select tests.create_user('c0000000-0000-4000-8000-000000000011', 'guardian.x@example.test');
select tests.create_user('c0000000-0000-4000-8000-000000000012', 'guardian2.x@example.test');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

-- psy X (c..03) creates an adult and a minor; owner+psy (c..02) creates one more.
select tests.as_user('c0000000-0000-4000-8000-000000000003');
insert into ids select 'adult', app.create_patient('c1000000-0000-4000-8000-000000000001', 'Ana', 'Ficticia', null,
  date '1990-01-01', 'cc', 'X-1001', null, null, 'es', 'r1');
insert into ids select 'minor', app.create_patient('c1000000-0000-4000-8000-000000000001', 'Camila', 'Ficticia', null,
  (current_date - interval '10 years')::date, 'ti', 'X-1002', null, null, 'es', 'r2');
select tests.as_user('c0000000-0000-4000-8000-000000000002');
insert into ids select 'other', app.create_patient('c1000000-0000-4000-8000-000000000001', 'Bruno', 'Ficticio', null,
  date '1980-01-01', null, null, null, null, 'es', 'r3');

-- 1. Care team / Q-03 ---------------------------------------------------------------------
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select is((select count(*) from public.patients), 2::bigint, 'psy sees only its 2 care-team patients');
select ok(app.is_on_care_team('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult')),
  'creator is on the care team (primary)');
select is((select count(*) from app.patient_directory('c1000000-0000-4000-8000-000000000001')), 3::bigint,
  'directory lists all 3 patients (name + status only)');
select is(tests.affected($$ update public.patients set first_name = 'X' where id = (select v from ids where k = 'other') $$), 0,
  'psy cannot update a patient off its care team');
select tests.as_user('c0000000-0000-4000-8000-000000000001');
select is((select count(*) from public.patients), 0::bigint, 'Q-03: owner off the care team reads no patient rows');
select is((select count(*) from app.patient_directory('c1000000-0000-4000-8000-000000000001')), 3::bigint,
  'Q-03: owner gets the directory projection');
select is((select count(*) from public.care_team_members), 3::bigint, 'owner reads care-team assignments');
select tests.as_user('c0000000-0000-4000-8000-000000000003', 'aal1');
select is((select count(*) from public.patients), 0::bigint, 'aal1 staff reads no patients');
select tests.as_user('d0000000-0000-4000-8000-000000000001');
select is((select count(*) from app.patient_directory('c1000000-0000-4000-8000-000000000001')), 0::bigint,
  'cross-tenant: owner Y gets an empty directory of X');
select is((select count(*) from public.patients), 0::bigint, 'cross-tenant: owner Y reads no X patients');
select throws_ok($$ select app.create_patient('c1000000-0000-4000-8000-000000000001', 'E', 'Vil', null,
  date '1990-01-01', null, null, null, null, 'es', 'r') $$, '42501', null, 'owner Y cannot create patients in X');

-- F-06 self-assignment by owner+psy onto psy X's patient needs a reason and is audited.
select tests.as_user('c0000000-0000-4000-8000-000000000002');
select throws_ok(format($$ insert into public.care_team_members (organization_id, patient_id, membership_id, care_role)
  values ('c1000000-0000-4000-8000-000000000001', %L, 'c2000000-0000-4000-8000-000000000002', 'secondary') $$,
  (select v from ids where k = 'adult')), 'P0001', 'PRECONDITION:self_assignment_reason_required',
  'self-assignment without reason is rejected');
select lives_ok(format($$ insert into public.care_team_members (organization_id, patient_id, membership_id, care_role, assignment_reason)
  values ('c1000000-0000-4000-8000-000000000001', %L, 'c2000000-0000-4000-8000-000000000002', 'secondary', 'Cobertura por vacaciones ficticia') $$,
  (select v from ids where k = 'adult')), 'self-assignment with reason succeeds');
select tests.as_admin();
select is((select count(*) from public.audit_logs where event_type = 'care_team.self_assigned'
  and patient_id = (select v from ids where k = 'adult')), 1::bigint, 'care_team.self_assigned audited with patient_id');

-- 2. Status gating (PAT-02) ------------------------------------------------------------------
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select throws_ok(format($$ update public.patients set status = 'active' where id = %L $$, (select v from ids where k = 'minor')),
  'P0001', 'PRECONDITION:activation_requirements_missing', 'minor cannot activate without a verified legal representative');
select ok('legal_representative' = any (app.patient_activation_missing('c1000000-0000-4000-8000-000000000001',
  (select v from ids where k = 'minor'))), 'missing list names the legal representative');
select throws_ok(format($$ update public.patients set status = 'paused' where id = %L $$, (select v from ids where k = 'adult')),
  'P0001', 'PRECONDITION:invalid_status_transition', 'status transitions are DB-enforced (intake -> paused rejected)');

-- 3. Guardians -------------------------------------------------------------------------------
insert into ids select 'g1', guardian_id from app.create_guardian('c1000000-0000-4000-8000-000000000001',
  (select v from ids where k = 'minor'), 'Gloria', 'Ficticia', 'cc', 'X-2001', null, null, 'mother', true,
  'parental_authority', true, 'r4');
insert into ids select 'pg1', id from public.patient_guardians where guardian_id = (select v from ids where k = 'g1');
insert into ids select 'g2', guardian_id from app.create_guardian('c1000000-0000-4000-8000-000000000001',
  (select v from ids where k = 'minor'), 'Gustavo', 'Ficticio', null, null, null, null, 'father', false, null, false, 'r5');
insert into ids select 'pg2', id from public.patient_guardians where guardian_id = (select v from ids where k = 'g2');
select throws_ok(format($$ select app.create_guardian('c1000000-0000-4000-8000-000000000001', %L, 'A', 'B', null, null,
  null, null, 'other', false, null, false, 'r') $$, (select v from ids where k = 'adult')), 'P0001', 'PRECONDITION:patient_not_minor',
  'guardians can only be linked to minors');
select is((select status::text from public.patient_guardians where id = (select v from ids where k = 'pg1')),
  'pending_verification', 'new relationship starts unverified');
update public.patient_guardians set status = 'active', legal_basis_verified_at = now(), verification_note = 'Documento ficticio'
 where id = (select v from ids where k = 'pg1');
update public.patient_guardians set status = 'active' where id = (select v from ids where k = 'pg2');
select ok((select verified_by = 'c0000000-0000-4000-8000-000000000003' and legal_basis_verified_by_membership_id is not null
  from public.patient_guardians where id = (select v from ids where k = 'pg1')), 'verification stamps actor (server-side)');
select * from app.set_guardian_permissions('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'pg1'),
  array['sign_consents', 'view_assignments']::public.guardian_permission[]);
select * from app.set_guardian_permissions('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'pg2'),
  array['view_assignments']::public.guardian_permission[]);
insert into public.patient_guardian_caveats (organization_id, patient_guardian_id, caveat, restrict_schedule)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'pg2'), 'Restriccion ficticia', true);
select throws_ok(format($$ select app.set_guardian_permissions('c1000000-0000-4000-8000-000000000001', %L,
  array['view_assignments','view_session_schedule']::public.guardian_permission[]) $$, (select v from ids where k = 'pg2')),
  'P0001', 'PRECONDITION:schedule_restricted_by_caveat', 'GRD-08 caveat blocks view_session_schedule');
select lives_ok(format($$ update public.patients set status = 'active' where id = %L $$, (select v from ids where k = 'minor')),
  'minor activates once a verified legal representative exists (no required consents yet)');

select tests.as_admin();
update public.guardians set profile_id = 'c0000000-0000-4000-8000-000000000011' where id = (select v from ids where k = 'g1');
update public.guardians set profile_id = 'c0000000-0000-4000-8000-000000000012' where id = (select v from ids where k = 'g2');
update public.patients set profile_id = 'c0000000-0000-4000-8000-000000000010' where id = (select v from ids where k = 'adult');
select throws_ok($$ update public.patients set profile_id = 'c0000000-0000-4000-8000-000000000003'
  where id = (select v from ids where k = 'other') $$, 'P0001', 'PRECONDITION:staff_cannot_be_patient', 'F-21: staff cannot be a patient in the same org');

-- Guardian per permission (aal1 allowed, Q-07)
select tests.as_user('c0000000-0000-4000-8000-000000000011', 'aal1');
select ok(app.guardian_can('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'minor'), 'sign_consents'),
  'guardian with grant: sign_consents');
select ok(not app.guardian_can('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'minor'), 'view_responses'),
  'guardian without grant: view_responses denied');
select is((select count(*) from public.patients), 0::bigint, 'guardian reads no patient rows');
select is((select patient_display_name from app.guardian_patient_summary('c1000000-0000-4000-8000-000000000001')),
  'Camila', 'guardian summary: first name only when effective');
select is((select count(*) from public.guardians), 1::bigint, 'guardian reads only its own guardian record');
select is((select count(*) from public.patient_guardian_caveats), 0::bigint, 'guardian never reads caveats');
select tests.as_user('c0000000-0000-4000-8000-000000000012', 'aal1');
select is((select count(*) from public.patient_guardians), 1::bigint, 'guardian 2 sees only its own relationship');

-- Portal mode read (gap fix): the guardian reads the minor's mode; the patient her own; others null.
select is(app.my_portal_mode('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult')), null::public.portal_mode,
  'my_portal_mode: guardian 2 gets null for a patient she does not guard');
select tests.as_user('c0000000-0000-4000-8000-000000000011', 'aal1');
select is(app.my_portal_mode('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'minor')), 'child'::public.portal_mode,
  'my_portal_mode: active guardian reads the minor mode (age default child)');
select is(app.my_portal_mode('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult')), null::public.portal_mode,
  'my_portal_mode: guardian gets null for a patient she does not guard');
select tests.as_user('c0000000-0000-4000-8000-000000000010', 'aal1');
select is(app.my_portal_mode('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult')), 'adult'::public.portal_mode,
  'my_portal_mode: patient reads own mode');
select tests.as_user('d0000000-0000-4000-8000-000000000001');
select is(app.my_portal_mode('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult')), null::public.portal_mode,
  'my_portal_mode: cross-tenant user gets null');

-- Revocation (GRD-05) and majority (F-08)
select tests.as_user('c0000000-0000-4000-8000-000000000003');
update public.patient_guardians set status = 'revoked', revoke_reason = 'Revocacion ficticia'
 where id = (select v from ids where k = 'pg2');
select is((select count(*) from public.patient_guardian_permissions
  where patient_guardian_id = (select v from ids where k = 'pg2') and revoked_at is null), 0::bigint,
  'revoking a relationship revokes all its permissions');
select tests.as_user('c0000000-0000-4000-8000-000000000012', 'aal1');
select ok(not app.guardian_can('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'minor'), 'view_assignments'),
  'revoked guardian: denied');
select tests.as_admin();
update public.patients set date_of_birth = (current_date - interval '18 years' - interval '1 day')::date
 where id = (select v from ids where k = 'minor');
select tests.as_user('c0000000-0000-4000-8000-000000000011', 'aal1');
select ok(not app.guardian_can('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'minor'), 'sign_consents'),
  'majority: guardian_can is false by date even before the job runs');
select tests.as_admin();
select is(app.suspend_guardians_at_majority('job'), 1, 'majority job suspends the active relationship');
select is((select suspension_reason::text from public.patient_guardians where id = (select v from ids where k = 'pg1')),
  'age_of_majority', 'suspension reason recorded');
update public.patients set date_of_birth = (current_date - interval '10 years')::date where id = (select v from ids where k = 'minor');

-- 4. Consents --------------------------------------------------------------------------------
insert into public.consent_templates (id, organization_id, key, consent_type, title, signer_requirement,
  applies_to_minors, applies_to_adults, required_for_activation, created_by)
values ('c7000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'treatment', 'treatment_informed_consent',
  'Consentimiento ficticio', 'patient', false, true, true, 'c0000000-0000-4000-8000-000000000001');
select tests.as_user('c0000000-0000-4000-8000-000000000001');
insert into public.consent_template_versions (organization_id, consent_template_id, locale, title, body)
values ('c1000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 'es', 'v1', '{"type":"doc","content":[]}');
update public.consent_template_versions set status = 'published' where consent_template_id = 'c7000000-0000-4000-8000-000000000001';
update public.consent_templates set status = 'published' where id = 'c7000000-0000-4000-8000-000000000001';
select throws_ok($$ update public.consent_template_versions set body = '{"type":"doc","content":[1]}'
  where consent_template_id = 'c7000000-0000-4000-8000-000000000001' $$, 'P0001', 'IMMUTABLE:consent_template_versions',
  'published version text is immutable');
select tests.as_admin();
insert into ids select 'v1', id from public.consent_template_versions where consent_template_id = 'c7000000-0000-4000-8000-000000000001';

select tests.as_user('c0000000-0000-4000-8000-000000000010', 'aal1');
select throws_ok(format($$ select app.sign_consent('c1000000-0000-4000-8000-000000000001', 'patient', %L, %L, 'accepted',
  'Ana Ficticia', true, extensions.digest('tampered', 'sha256'), null, null, 'r') $$,
  (select v from ids where k = 'adult'), (select v from ids where k = 'v1')), 'P0001', 'PRECONDITION:consent_text_mismatch',
  'hash of the shown text must match the published version');
select throws_ok(format($$ select app.sign_consent('c1000000-0000-4000-8000-000000000001', 'patient', %L, %L, 'accepted',
  null, true, app.consent_body_hash('{"type":"doc","content":[]}'), null, null, 'r') $$,
  (select v from ids where k = 'adult'), (select v from ids where k = 'v1')), 'P0001', 'PRECONDITION:consent_evidence_incomplete',
  'Q-17: typed name required');
insert into ids select 'rec', app.sign_consent('c1000000-0000-4000-8000-000000000001', 'patient',
  (select v from ids where k = 'adult'), (select v from ids where k = 'v1'), 'accepted', 'Ana Ficticia', true,
  app.consent_body_hash('{"type":"doc","content":[]}'), '203.0.113.7', 'FictionalUA/1.0', 'r6');
select is((select count(*) from public.consent_records), 1::bigint, 'patient reads its own record');
select is((select count(*) from public.consent_record_evidence), 0::bigint, 'patient cannot read stored evidence');
select throws_ok($$ update public.consent_records set withdrawn_at = now() $$, '42501', null, 'no direct writes on consent records');
select tests.as_user('c0000000-0000-4000-8000-000000000011', 'aal1');
select is((select count(*) from public.consent_records), 0::bigint, 'F-09: guardian does not see records it did not sign');
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select is((select count(*) from public.consent_record_evidence), 1::bigint, 'care team reads evidence');
select lives_ok(format($$ update public.patients set status = 'active' where id = %L $$, (select v from ids where k = 'adult')),
  'adult activates once the required consent exists');
select tests.as_user('c0000000-0000-4000-8000-000000000010', 'aal1');
select lives_ok(format($$ select app.withdraw_consent('c1000000-0000-4000-8000-000000000001', 'patient', %L, 'Ya no deseo continuar', 'r7') $$,
  (select v from ids where k = 'rec')), 'signer can withdraw');
select throws_ok(format($$ select app.withdraw_consent('c1000000-0000-4000-8000-000000000001', 'patient', %L, 'otra vez', 'r8') $$,
  (select v from ids where k = 'rec')), 'P0001', 'PRECONDITION:consent_not_withdrawable', 'withdrawal is one-time (append-only)');
select tests.as_user('d0000000-0000-4000-8000-000000000001');
select is((select count(*) from public.consent_records), 0::bigint, 'cross-tenant: no consent records of X');

-- S2-01 (SECURITY.md §15): portal identities may only write auth.* audit events, no patient_id.
select tests.as_user('c0000000-0000-4000-8000-000000000010', 'aal1');
select throws_ok(format($$ select app.write_audit('consent.recorded', 'c1000000-0000-4000-8000-000000000001',
  'patient', %L, jsonb_build_object('patient_id', %L)) $$, (select v from ids where k = 'minor'), (select v from ids where k = 'minor')),
  'P0001', 'AUDIT:event_not_allowed_for_portal', 'S2-01: portal patient cannot forge a care-team audit event');
select throws_ok(format($$ select app.write_audit('auth.capacity_switched', 'c1000000-0000-4000-8000-000000000001',
  null, null, jsonb_build_object('patient_id', %L)) $$, (select v from ids where k = 'minor')),
  'P0001', 'AUDIT:event_not_allowed_for_portal', 'S2-01: portal auth event cannot carry a patient_id');
select lives_ok($$ select app.write_audit('auth.capacity_switched', 'c1000000-0000-4000-8000-000000000001',
  null, null, '{"to_acting_as":"patient"}'::jsonb) $$, 'S2-01: portal capacity switch is still audited');

select * from finish();
rollback;
