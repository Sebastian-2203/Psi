-- PAT-09 / Q-14: access / rectification requests (portal intake, care-team resolution). FICTIONAL data.
begin;
\ir _helpers.psql

select plan(14);

select tests.create_user('c0000000-0000-4000-8000-000000000010', 'teen.d@example.test');
select tests.create_user('c0000000-0000-4000-8000-000000000011', 'guardian.d@example.test');
select tests.create_user('c0000000-0000-4000-8000-000000000012', 'adult.d@example.test');
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

select tests.as_user('c0000000-0000-4000-8000-000000000003');
insert into ids select 'teen', app.create_patient('c1000000-0000-4000-8000-000000000001', 'Tomas', 'Ficticio', null,
  (current_date - interval '15 years')::date, null, null, null, null, 'es', 'd1');
insert into ids select 'adult', app.create_patient('c1000000-0000-4000-8000-000000000001', 'Ana', 'Ficticia', null,
  date '1990-01-01', null, null, null, null, 'es', 'd2');
insert into ids select 'g', guardian_id from app.create_guardian('c1000000-0000-4000-8000-000000000001',
  (select v from ids where k = 'teen'), 'Gloria', 'Ficticia', null, null, null, null, 'mother', true,
  'parental_authority', true, 'd3');
select tests.as_admin();
update public.patient_guardians set status = 'active', legal_basis_verified_at = now(), verification_note = 'Documento ficticio'
 where guardian_id = (select v from ids where k = 'g');
update public.guardians set profile_id = 'c0000000-0000-4000-8000-000000000011' where id = (select v from ids where k = 'g');
update public.patients set profile_id = 'c0000000-0000-4000-8000-000000000010' where id = (select v from ids where k = 'teen');
update public.patients set profile_id = 'c0000000-0000-4000-8000-000000000012' where id = (select v from ids where k = 'adult');

-- Patient submits for herself.
select tests.as_user('c0000000-0000-4000-8000-000000000012', 'aal1');
insert into ids select 'r_adult', app.submit_data_subject_request('c1000000-0000-4000-8000-000000000001', 'patient',
  (select v from ids where k = 'adult'), 'access', 'Quiero una copia de mis datos', 'd4');
select ok((select v from ids where k = 'r_adult') is not null, 'patient submits an access request');
select throws_ok(format($$ select app.submit_data_subject_request('c1000000-0000-4000-8000-000000000001', 'patient',
  %L, 'access', null, 'd5') $$, (select v from ids where k = 'adult')), 'P0001', 'PRECONDITION:request_already_open',
  'one open request per subject and type');
select throws_ok(format($$ select app.submit_data_subject_request('c1000000-0000-4000-8000-000000000001', 'patient',
  %L, 'suppression', null, 'd6') $$, (select v from ids where k = 'adult')), 'P0001', 'PRECONDITION:request_type_not_supported',
  'only access / rectification are exposed');
select throws_ok(format($$ select app.submit_data_subject_request('c1000000-0000-4000-8000-000000000001', 'patient',
  %L, 'rectification', null, 'd7') $$, (select v from ids where k = 'teen')), '42501', null,
  'a patient cannot submit for another patient');
select is((select count(*)::int from public.data_subject_requests), 1, 'the patient reads only her own request');
select throws_ok($$ update public.data_subject_requests set status = 'fulfilled' $$, '42501', null,
  'no direct writes for authenticated');

-- Guardian submits about her own guardian record.
select tests.as_user('c0000000-0000-4000-8000-000000000011', 'aal1');
insert into ids select 'r_guardian', app.submit_data_subject_request('c1000000-0000-4000-8000-000000000001', 'guardian',
  null, 'rectification', null, 'd8');
select is((select count(*)::int from public.data_subject_requests), 1, 'the guardian reads only her own request');

-- The minor does not see the guardian request nor the adult request.
select tests.as_user('c0000000-0000-4000-8000-000000000010', 'aal1');
select is((select count(*)::int from public.data_subject_requests), 0, 'another patient sees nothing');

-- Staff: care team sees and resolves; a portal identity cannot resolve.
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select is((select count(*)::int from public.data_subject_requests), 2, 'care team sees patient and guardian requests');
select lives_ok(format($$ select app.update_data_subject_request('c1000000-0000-4000-8000-000000000001', %L,
  'in_review', null, now() + interval '30 days', 'd9') $$, (select v from ids where k = 'r_adult')),
  'care team moves a request to in_review and sets a due date');
select throws_ok(format($$ select app.update_data_subject_request('c1000000-0000-4000-8000-000000000001', %L,
  'fulfilled', null, null, 'd10') $$, (select v from ids where k = 'r_adult')), 'P0001',
  'PRECONDITION:resolution_summary_required', 'a final status needs a resolution summary');
select lives_ok(format($$ select app.update_data_subject_request('c1000000-0000-4000-8000-000000000001', %L,
  'fulfilled', 'Copia entregada en consulta', null, 'd11') $$, (select v from ids where k = 'r_adult')),
  'care team resolves with a summary');
select throws_ok(format($$ select app.update_data_subject_request('c1000000-0000-4000-8000-000000000001', %L,
  'rejected', 'Cambio de decision', null, 'd12') $$, (select v from ids where k = 'r_adult')), 'P0001',
  'PRECONDITION:request_already_resolved', 'a resolved request is final');

select tests.as_user('c0000000-0000-4000-8000-000000000012', 'aal1');
select throws_ok(format($$ select app.update_data_subject_request('c1000000-0000-4000-8000-000000000001', %L,
  'rejected', 'No autorizado', null, 'd13') $$, (select v from ids where k = 'r_guardian')), '42501', null,
  'a portal identity cannot resolve requests');

select * from finish();
rollback;
