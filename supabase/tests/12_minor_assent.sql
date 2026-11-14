-- QA Phase 2: CON-03 minor assent is the minor's own, separate record (SECURITY.md §5.2). FICTIONAL data.
begin;
\ir _helpers.psql

select plan(6);

select tests.create_user('c0000000-0000-4000-8000-000000000010', 'teen.x@example.test');
select tests.create_user('c0000000-0000-4000-8000-000000000011', 'guardian.x@example.test');
select tests.create_user('c0000000-0000-4000-8000-000000000012', 'adult.x@example.test');
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

select tests.as_user('c0000000-0000-4000-8000-000000000003');
insert into ids select 'teen', app.create_patient('c1000000-0000-4000-8000-000000000001', 'Tomas', 'Ficticio', null,
  (current_date - interval '15 years')::date, null, null, null, null, 'es', 'a1');
insert into ids select 'adult', app.create_patient('c1000000-0000-4000-8000-000000000001', 'Ana', 'Ficticia', null,
  date '1990-01-01', null, null, null, null, 'es', 'a2');
insert into ids select 'g', guardian_id from app.create_guardian('c1000000-0000-4000-8000-000000000001',
  (select v from ids where k = 'teen'), 'Gloria', 'Ficticia', null, null, null, null, 'mother', true,
  'parental_authority', true, 'a3');
select tests.as_admin();
update public.patient_guardians set status = 'active', legal_basis_verified_at = now(), verification_note = 'Documento ficticio'
 where guardian_id = (select v from ids where k = 'g');
update public.guardians set profile_id = 'c0000000-0000-4000-8000-000000000011' where id = (select v from ids where k = 'g');
update public.patients set profile_id = 'c0000000-0000-4000-8000-000000000010' where id = (select v from ids where k = 'teen');
update public.patients set profile_id = 'c0000000-0000-4000-8000-000000000012' where id = (select v from ids where k = 'adult');
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select * from app.set_guardian_permissions('c1000000-0000-4000-8000-000000000001',
  (select id from public.patient_guardians where guardian_id = (select v from ids where k = 'g')),
  array['sign_consents']::public.guardian_permission[]);

select tests.as_admin();
insert into public.consent_templates (id, organization_id, key, consent_type, title, signer_requirement,
  applies_to_minors, applies_to_adults, required_for_activation, created_by)
values ('c7000000-0000-4000-8000-0000000000a1', 'c1000000-0000-4000-8000-000000000001', 'assent', 'minor_assent',
  'Asentimiento ficticio', 'patient', true, false, false, 'c0000000-0000-4000-8000-000000000001');
select tests.as_user('c0000000-0000-4000-8000-000000000001');
insert into public.consent_template_versions (organization_id, consent_template_id, locale, title, body)
values ('c1000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-0000000000a1', 'es', 'v1', '{"type":"doc","content":[]}');
update public.consent_template_versions set status = 'published' where consent_template_id = 'c7000000-0000-4000-8000-0000000000a1';
update public.consent_templates set status = 'published' where id = 'c7000000-0000-4000-8000-0000000000a1';
select tests.as_admin();
insert into ids select 'v', id from public.consent_template_versions where consent_template_id = 'c7000000-0000-4000-8000-0000000000a1';

-- A guardian can never give the minor's assent.
select tests.as_user('c0000000-0000-4000-8000-000000000011', 'aal1');
select throws_ok(format($$ select app.sign_consent('c1000000-0000-4000-8000-000000000001', 'guardian', %L, %L, 'accepted',
  'Gloria Ficticia', true, app.consent_body_hash('{"type":"doc","content":[]}'), null, null, 'a4') $$,
  (select v from ids where k = 'teen'), (select v from ids where k = 'v')), 'P0001', 'PRECONDITION:assent_requires_patient',
  'CON-03: guardian cannot sign the minor assent');
-- An adult patient cannot sign an assent.
select tests.as_user('c0000000-0000-4000-8000-000000000012', 'aal1');
select throws_ok(format($$ select app.sign_consent('c1000000-0000-4000-8000-000000000001', 'patient', %L, %L, 'accepted',
  'Ana Ficticia', true, app.consent_body_hash('{"type":"doc","content":[]}'), null, null, 'a5') $$,
  (select v from ids where k = 'adult'), (select v from ids where k = 'v')), 'P0001', null,
  'CON-03: assent does not apply to an adult');
-- The minor signs it as herself; separate record of kind minor_assent.
select tests.as_user('c0000000-0000-4000-8000-000000000010', 'aal1');
select lives_ok(format($$ select app.sign_consent('c1000000-0000-4000-8000-000000000001', 'patient', %L, %L, 'accepted',
  'Tomas F', true, app.consent_body_hash('{"type":"doc","content":[]}'), null, null, 'a6') $$,
  (select v from ids where k = 'teen'), (select v from ids where k = 'v')), 'CON-03: the minor signs her own assent');
select is((select consent_type::text || '/' || signer_type::text from public.consent_records), 'minor_assent/patient',
  'assent is its own record kind, signed by the patient');
select tests.as_user('c0000000-0000-4000-8000-000000000011', 'aal1');
select is((select count(*) from public.consent_records), 0::bigint, 'guardian cannot read the minor assent record');
select tests.as_admin();
select is((select count(*) from public.consent_records where consent_type = 'minor_assent' and signer_guardian_id is not null), 0::bigint,
  'no guardian-signed assent exists');

select * from finish();
rollback;
