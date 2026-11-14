-- Phase 3: clinical records, notes, addenda, plans, sessions, documents (SECURITY.md §4.4b/f,
-- DATABASE.md §5.4, §6). Care team only; cross-tenant; patient/guardian/platform denial;
-- immutability; append-only addenda/revisions; file access; S2-02 audit tagging.
begin;
\ir _helpers.psql

select plan(81);

select tests.create_user('c0000000-0000-4000-8000-000000000010', 'patient.x@example.test');
select tests.create_user('c0000000-0000-4000-8000-000000000011', 'guardian.x@example.test');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

-- FICTIONAL configuration for org X [NEEDS PSYCHOLOGIST INPUT].
insert into public.clinical_note_types (id, organization_id, key, label) values
  ('c5000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'free_text', 'Texto libre (ficticio)'),
  ('c5000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', 'retired', 'Inactivo (ficticio)');
update public.clinical_note_types set is_active = false where id = 'c5000000-0000-4000-8000-000000000002';
insert into public.clinical_section_definitions (id, organization_id, key, title) values
  ('c6000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'consultation_reason', 'Motivo (ficticio)');
insert into public.clinical_note_types (id, organization_id, key, label) values
  ('d5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'free_text', 'Texto libre Y');

-- psy X (c..03) creates an adult and a minor; is primary care team for both.
select tests.as_user('c0000000-0000-4000-8000-000000000003');
insert into ids select 'adult', app.create_patient('c1000000-0000-4000-8000-000000000001', 'Ana', 'Clinica', null,
  date '1990-01-01', 'cc', 'X-3001', null, null, 'es', 'r1');
insert into ids select 'minor', app.create_patient('c1000000-0000-4000-8000-000000000001', 'Camilo', 'Clinico', null,
  (current_date - interval '10 years')::date, 'ti', 'X-3002', null, null, 'es', 'r2');

-- 1. Helpers ---------------------------------------------------------------------------------
select ok(app.can_read_clinical('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult'))
  and app.can_write_clinical('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult')),
  'care-team psychologist can read and write clinical data');
select tests.as_user('c0000000-0000-4000-8000-000000000003', 'aal1');
select ok(not app.can_read_clinical('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult')),
  'aal1 denies clinical read');
select tests.as_user('c0000000-0000-4000-8000-000000000002');
select ok(not app.can_read_clinical('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult')),
  'owner+psychologist OFF the care team has no clinical read');
select tests.as_user('c0000000-0000-4000-8000-000000000001');
select ok(not app.can_read_clinical('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult')),
  'owner (no psychologist role) has no clinical read');

-- 2. Records ---------------------------------------------------------------------------------
select tests.as_user('c0000000-0000-4000-8000-000000000003');
insert into public.clinical_records (organization_id, patient_id, opened_by_membership_id)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult'), 'c2000000-0000-4000-8000-000000000003');
insert into ids select 'rec', id from public.clinical_records where patient_id = (select v from ids where k = 'adult');
select ok((select record_number ~ '^HC-[0-9A-F]{10}$' and status = 'open' from public.clinical_records
  where id = (select v from ids where k = 'rec')), 'record number generated server-side, status open');
select throws_ok(format($$ insert into public.clinical_records (organization_id, patient_id, opened_by_membership_id)
  values ('c1000000-0000-4000-8000-000000000001', %L, 'c2000000-0000-4000-8000-000000000003') $$,
  (select v from ids where k = 'adult')), '23505', null, 'one record per patient per org');
select throws_ok(format($$ insert into public.clinical_records (organization_id, patient_id, opened_by_membership_id)
  values ('c1000000-0000-4000-8000-000000000001', %L, 'c2000000-0000-4000-8000-000000000002') $$,
  (select v from ids where k = 'minor')), '42501', null, 'opener must be the caller');
select throws_ok(format($$ delete from public.clinical_records where id = %L $$, (select v from ids where k = 'rec')),
  '42501', null, 'no DELETE privilege on records (CLR-07)');

-- 3. Sections + revisions ------------------------------------------------------------------------
insert into public.clinical_record_sections (organization_id, clinical_record_id, patient_id, section_definition_id,
  content, last_edited_by_membership_id)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'rec'), (select v from ids where k = 'adult'),
  'c6000000-0000-4000-8000-000000000001', '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"v1"}]}]}',
  'c2000000-0000-4000-8000-000000000003');
insert into ids select 'sec', id from public.clinical_record_sections where clinical_record_id = (select v from ids where k = 'rec');
update public.clinical_record_sections set content = '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"v2"}]}]}'
 where id = (select v from ids where k = 'sec');
select is((select revision from public.clinical_record_sections where id = (select v from ids where k = 'sec')), 2,
  'section UPDATE increments the revision');
select is((select content #>> '{blocks,0,children,0,text}' from public.clinical_record_section_revisions
  where section_id = (select v from ids where k = 'sec') and revision = 1), 'v1', 'previous content copied to revisions');
select throws_ok($$ insert into public.clinical_record_section_revisions (organization_id, section_id, patient_id, revision,
  content, content_locale, edited_by_membership_id, edited_at) select organization_id, section_id, patient_id, 9, content,
  content_locale, edited_by_membership_id, edited_at from public.clinical_record_section_revisions limit 1 $$,
  '42501', null, 'users cannot forge revisions');
select tests.as_admin();
select throws_ok($$ update public.clinical_record_section_revisions set content = '{}' $$, 'P0001', 'IMMUTABLE:clinical_record_section_revisions',
  'revisions are append-only even for the table owner');
select throws_ok($$ delete from public.clinical_record_section_revisions $$, 'P0001', 'IMMUTABLE:clinical_record_section_revisions',
  'revisions cannot be deleted');

-- 4. Notes: drafts author-only, finalization, immutability ---------------------------------------
select tests.as_user('c0000000-0000-4000-8000-000000000003');
insert into public.clinical_notes (organization_id, clinical_record_id, patient_id, note_type_id, body, author_membership_id)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'rec'), (select v from ids where k = 'adult'),
  'c5000000-0000-4000-8000-000000000001', '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Nota ficticia"}]}]}',
  'c2000000-0000-4000-8000-000000000003');
insert into ids select 'note', id from public.clinical_notes where patient_id = (select v from ids where k = 'adult');
select throws_ok(format($$ insert into public.clinical_notes (organization_id, clinical_record_id, patient_id, note_type_id, body,
  author_membership_id) values ('c1000000-0000-4000-8000-000000000001', %L, %L, 'c5000000-0000-4000-8000-000000000002',
  '{"version":1,"blocks":[]}', 'c2000000-0000-4000-8000-000000000003') $$, (select v from ids where k = 'rec'),
  (select v from ids where k = 'adult')), 'P0001', 'PRECONDITION:note_type_inactive', 'inactive note types are refused');
select throws_ok(format($$ insert into public.clinical_notes (organization_id, clinical_record_id, patient_id, note_type_id, body,
  author_membership_id, status) values ('c1000000-0000-4000-8000-000000000001', %L, %L, 'c5000000-0000-4000-8000-000000000001',
  '{"version":1,"blocks":[]}', 'c2000000-0000-4000-8000-000000000003', 'finalized') $$, (select v from ids where k = 'rec'),
  (select v from ids where k = 'adult')), '42501', null, 'notes cannot be inserted already finalized');
select throws_ok(format($$ insert into public.clinical_notes (organization_id, clinical_record_id, patient_id, note_type_id, body,
  author_membership_id) values ('c1000000-0000-4000-8000-000000000001', %L, %L, 'c5000000-0000-4000-8000-000000000001',
  '{"version":1,"blocks":[]}', 'c2000000-0000-4000-8000-000000000002') $$, (select v from ids where k = 'rec'),
  (select v from ids where k = 'adult')), '42501', null, 'cannot author a note as someone else');

-- second care-team member (owner+psy, assigned with reason) cannot read or edit the draft
select tests.as_user('c0000000-0000-4000-8000-000000000003');
insert into public.care_team_members (organization_id, patient_id, membership_id, care_role)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult'), 'c2000000-0000-4000-8000-000000000002', 'secondary');
select tests.as_user('c0000000-0000-4000-8000-000000000002');
select ok(app.can_read_clinical('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult')),
  'secondary care-team member has clinical read');
select is((select count(*) from public.clinical_notes), 0::bigint, 'drafts are author-only (not visible to co-members)');
select is(tests.affected(format($$ update public.clinical_notes set body = '{"version":1,"blocks":[]}' where id = %L $$,
  (select v from ids where k = 'note'))), 0, 'co-member cannot update the draft');
select throws_ok(format($$ select * from app.finalize_clinical_note('c1000000-0000-4000-8000-000000000001', %L) $$,
  (select v from ids where k = 'note')), 'P0001', 'NOT_FOUND:clinical_note', 'co-member cannot finalize the draft');

select tests.as_user('c0000000-0000-4000-8000-000000000003');
select throws_ok(format($$ update public.clinical_notes set status = 'finalized', finalized_by_membership_id = 'c2000000-0000-4000-8000-000000000003',
  content_hash = '\x00' where id = %L $$, (select v from ids where k = 'note')), 'P0001', 'PRECONDITION:finalize',
  'finalization with a wrong hash is rejected (self-validating trigger)');
select lives_ok(format($$ select * from app.finalize_clinical_note('c1000000-0000-4000-8000-000000000001', %L, 'r-fin') $$,
  (select v from ids where k = 'note')), 'author finalizes through app.finalize_clinical_note');
select ok((select status = 'finalized' and finalized_at is not null and content_hash = app.clinical_content_hash(body)
  from public.clinical_notes where id = (select v from ids where k = 'note')), 'finalized note stores time, finalizer and hash');
select is(tests.affected(format($$ update public.clinical_notes set body = '{"version":1,"blocks":[]}' where id = %L $$,
  (select v from ids where k = 'note'))), 0, 'finalized note cannot be updated by its author (RLS: drafts only)');
select tests.as_admin();
select throws_ok(format($$ update public.clinical_notes set content_locale = 'en' where id = %L $$, (select v from ids where k = 'note')),
  'P0001', 'IMMUTABLE:clinical_notes', 'finalized note cannot be updated even by the table owner');
select throws_ok(format($$ delete from public.clinical_notes where id = %L $$, (select v from ids where k = 'note')),
  'P0001', 'IMMUTABLE:clinical_notes', 'finalized note cannot be deleted even by the table owner');
select tests.as_user('c0000000-0000-4000-8000-000000000002');
select is((select count(*) from public.clinical_notes), 1::bigint, 'finalized notes are visible to the whole care team');

-- 5. Addenda (append-only) -------------------------------------------------------------------------
select lives_ok(format($$ insert into public.clinical_note_addenda (organization_id, clinical_note_id, patient_id, reason, body,
  author_membership_id, content_hash) values ('c1000000-0000-4000-8000-000000000001', %L, %L, 'correction',
  '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Correccion ficticia"}]}]}',
  'c2000000-0000-4000-8000-000000000002', '\x00') $$, (select v from ids where k = 'note'), (select v from ids where k = 'adult')),
  'care-team member appends an addendum to a finalized note');
select ok((select content_hash = app.clinical_content_hash(body) from public.clinical_note_addenda limit 1),
  'addendum hash is computed server-side (client value ignored)');
select throws_ok($$ update public.clinical_note_addenda set reason = 'other' $$, '42501', null, 'no UPDATE privilege on addenda');
select tests.as_admin();
select throws_ok($$ update public.clinical_note_addenda set reason = 'other' $$, 'P0001', 'IMMUTABLE:clinical_note_addenda',
  'addenda are append-only for the table owner too');
select throws_ok($$ delete from public.clinical_note_addenda $$, 'P0001', 'IMMUTABLE:clinical_note_addenda', 'addenda cannot be deleted');
select tests.as_user('c0000000-0000-4000-8000-000000000003');
insert into public.clinical_notes (organization_id, clinical_record_id, patient_id, note_type_id, body, author_membership_id)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'rec'), (select v from ids where k = 'adult'),
  'c5000000-0000-4000-8000-000000000001', '{"version":1,"blocks":[]}', 'c2000000-0000-4000-8000-000000000003');
insert into ids select 'draft2', id from public.clinical_notes where status = 'draft' and patient_id = (select v from ids where k = 'adult');
select throws_ok(format($$ insert into public.clinical_note_addenda (organization_id, clinical_note_id, patient_id, reason, body,
  author_membership_id, content_hash) values ('c1000000-0000-4000-8000-000000000001', %L, %L, 'other',
  '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"x"}]}]}', 'c2000000-0000-4000-8000-000000000003', '\x00') $$,
  (select v from ids where k = 'draft2'), (select v from ids where k = 'adult')), 'P0001', 'PRECONDITION:note_not_finalized',
  'addenda only on finalized notes');
select throws_ok(format($$ select * from app.finalize_clinical_note('c1000000-0000-4000-8000-000000000001', %L) $$,
  (select v from ids where k = 'draft2')), 'P0001', 'PRECONDITION:note_empty', 'an empty note cannot be finalized');
update public.clinical_notes set discarded_at = now(), discard_reason = 'Borrador ficticio duplicado'
 where id = (select v from ids where k = 'draft2');
select throws_ok(format($$ update public.clinical_notes set body = '{"version":1,"blocks":[]}' where id = %L $$,
  (select v from ids where k = 'draft2')), 'P0001', 'IMMUTABLE:clinical_notes', 'discarded drafts are frozen');

-- 6. Diagnoses, assessments -------------------------------------------------------------------------
insert into public.clinical_diagnoses (organization_id, clinical_record_id, patient_id, code_system, code, label, diagnosed_on,
  recorded_by_membership_id)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'rec'), (select v from ids where k = 'adult'),
  'cie10', 'Z00.0', 'Impresion ficticia', current_date, 'c2000000-0000-4000-8000-000000000003');
select lives_ok($$ update public.clinical_diagnoses set status = 'resolved', resolved_on = current_date $$,
  'diagnosis status / resolved_on can change');
select throws_ok($$ update public.clinical_diagnoses set label = 'Otra' $$, '42501', null,
  'diagnosis label cannot be updated (new row instead)');
insert into public.clinical_assessments (organization_id, clinical_record_id, patient_id, assessed_on, instrument_name, results,
  author_membership_id)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'rec'), (select v from ids where k = 'adult'),
  current_date, 'Instrumento ficticio', '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"r"}]}]}',
  'c2000000-0000-4000-8000-000000000003');
insert into ids select 'asm', id from public.clinical_assessments limit 1;
select lives_ok(format($$ select * from app.finalize_clinical_assessment('c1000000-0000-4000-8000-000000000001', %L) $$,
  (select v from ids where k = 'asm')), 'assessment finalizes');
select is(tests.affected(format($$ update public.clinical_assessments set instrument_name = 'X' where id = %L $$,
  (select v from ids where k = 'asm'))), 0, 'finalized assessment is frozen for its author (RLS)');
select tests.as_admin();
select throws_ok(format($$ update public.clinical_assessments set instrument_name = 'X' where id = %L $$,
  (select v from ids where k = 'asm')), 'P0001', 'IMMUTABLE:clinical_assessments', 'finalized assessment is frozen for the table owner');
select tests.as_user('c0000000-0000-4000-8000-000000000003');

-- 7. Treatment plans + patient-facing texts ----------------------------------------------------------
insert into public.treatment_plans (organization_id, clinical_record_id, patient_id, version, summary, start_date, author_membership_id)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'rec'), (select v from ids where k = 'adult'), 1,
  '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Plan ficticio"}]}]}', current_date,
  'c2000000-0000-4000-8000-000000000003');
insert into ids select 'plan', id from public.treatment_plans limit 1;
select throws_ok(format($$ update public.treatment_plans set status = 'active' where id = %L $$, (select v from ids where k = 'plan')),
  'P0001', 'PRECONDITION:plan_without_goals', 'a plan without goals cannot be activated');
insert into public.treatment_goals (organization_id, treatment_plan_id, patient_id, description)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'plan'), (select v from ids where k = 'adult'),
  '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Redaccion clinica ficticia"}]}]}');
insert into ids select 'goal', id from public.treatment_goals limit 1;
insert into public.treatment_goal_patient_texts (organization_id, treatment_goal_id, patient_id, patient_facing_text, author_membership_id)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'goal'), (select v from ids where k = 'adult'),
  '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Mi objetivo ficticio"}]}]}',
  'c2000000-0000-4000-8000-000000000003');
update public.treatment_plans set status = 'active' where id = (select v from ids where k = 'plan');
select throws_ok(format($$ update public.treatment_goals set description = '{"version":1,"blocks":[]}' where id = %L $$,
  (select v from ids where k = 'goal')), 'P0001', 'IMMUTABLE:treatment_goals', 'goal wording is frozen once the plan is active');
select lives_ok(format($$ update public.treatment_goals set status = 'in_progress' where id = %L $$, (select v from ids where k = 'goal')),
  'goal status is updatable while the plan is active');
select throws_ok(format($$ update public.treatment_plans set summary = '{"version":1,"blocks":[]}' where id = %L $$,
  (select v from ids where k = 'plan')), 'P0001', 'IMMUTABLE:treatment_plans', 'active plan content is frozen');
select throws_ok($$ update public.treatment_goal_patient_texts set patient_facing_text = '{"version":1,"blocks":[]}' $$,
  'P0001', 'IMMUTABLE:treatment_goal_patient_texts', 'patient-facing text frozen with its plan');
insert into ids select 'plan2', app.revise_treatment_plan('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'plan'), 'r-rev');
select is((select version from public.treatment_plans where id = (select v from ids where k = 'plan2')), 2,
  'revision creates version 2 as a draft');
select is((select count(*) from public.treatment_goals where treatment_plan_id = (select v from ids where k = 'plan2')), 1::bigint,
  'revision copies goals');

-- 8. Sessions --------------------------------------------------------------------------------------
insert into public.therapy_sessions (organization_id, patient_id, psychologist_membership_id, scheduled_start, scheduled_end, status, modality)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult'), 'c2000000-0000-4000-8000-000000000003',
  now() + interval '2 days', now() + interval '2 days 50 minutes', 'scheduled', 'in_person');
select throws_ok(format($$ insert into public.therapy_sessions (organization_id, patient_id, psychologist_membership_id, scheduled_start,
  scheduled_end, modality) values ('c1000000-0000-4000-8000-000000000001', %L, 'c2000000-0000-4000-8000-000000000003',
  now(), now() - interval '1 hour', 'phone') $$, (select v from ids where k = 'adult')), '23514', null, 'session end must follow start');

-- 9. Documents, shares, file access ------------------------------------------------------------------
insert into ids values ('file', 'c7000000-0000-4000-8000-000000000001');
insert into public.file_objects (id, organization_id, patient_id, bucket, storage_path, mime_type, size_bytes, display_name, uploaded_by)
select 'c7000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', v, 'clinical-documents',
  'org/c1000000-0000-4000-8000-000000000001/patient/' || v || '/c7000000-0000-4000-8000-000000000001',
  'application/pdf', 1234, 'informe-ficticio.pdf', 'c0000000-0000-4000-8000-000000000003'
from ids where k = 'adult';
select throws_ok(format($$ insert into public.file_objects (organization_id, patient_id, bucket, storage_path, mime_type, size_bytes,
  display_name, uploaded_by) values ('c1000000-0000-4000-8000-000000000001', %L, 'clinical-documents',
  'org/d1000000-0000-4000-8000-000000000001/x', 'application/pdf', 1, 'x.pdf', 'c0000000-0000-4000-8000-000000000003') $$,
  (select v from ids where k = 'adult')), '23514', null, 'clinical object path must be org/<org>/patient/<patient>/<id>');
select ok(not app.can_read_file('c7000000-0000-4000-8000-000000000001'), 'pending files are not readable');
update public.file_objects set status = 'ready', sha256 = extensions.digest('x', 'sha256') where id = 'c7000000-0000-4000-8000-000000000001';
select ok(app.can_read_file('c7000000-0000-4000-8000-000000000001'), 'care team reads a ready clinical file');
select throws_ok($$ update public.file_objects set size_bytes = 99 where id = 'c7000000-0000-4000-8000-000000000001' $$,
  'P0001', 'IMMUTABLE:file_objects', 'ready file metadata is immutable');
insert into public.clinical_documents (organization_id, clinical_record_id, patient_id, file_object_id, document_type, title,
  uploaded_by_membership_id)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'rec'), (select v from ids where k = 'adult'),
  'c7000000-0000-4000-8000-000000000001', 'report', 'Informe ficticio', 'c2000000-0000-4000-8000-000000000003');
insert into ids select 'doc', id from public.clinical_documents limit 1;

-- portal identities: adult patient linked; nothing shared yet
select tests.as_admin();
update public.patients set profile_id = 'c0000000-0000-4000-8000-000000000010' where id = (select v from ids where k = 'adult');
update public.patients set status = 'active' where id = (select v from ids where k = 'adult');
select tests.as_user('c0000000-0000-4000-8000-000000000010', 'aal1');
select is((select count(*) from public.clinical_records) + (select count(*) from public.clinical_notes)
  + (select count(*) from public.clinical_note_addenda) + (select count(*) from public.clinical_record_sections)
  + (select count(*) from public.clinical_diagnoses) + (select count(*) from public.clinical_assessments)
  + (select count(*) from public.treatment_plans) + (select count(*) from public.treatment_goals)
  + (select count(*) from public.treatment_goal_patient_texts) + (select count(*) from public.therapy_sessions)
  + (select count(*) from public.clinical_documents) + (select count(*) from public.clinical_document_shares), 0::bigint,
  'patient reads NO clinical row (records, notes, addenda, sections, plans, goals, texts, sessions, documents)');
select is((select count(*) from app.portal_shared_documents('c1000000-0000-4000-8000-000000000001',
  (select v from ids where k = 'adult'))), 0::bigint, 'private document is absent from the portal');
select ok(not app.can_read_file('c7000000-0000-4000-8000-000000000001'), 'patient cannot read an unshared file');
select is((select count(*) from app.portal_patient_goals('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult'))),
  1::bigint, 'patient sees the patient-facing goal of the active plan');
select ok((select patient_facing_text #>> '{blocks,0,children,0,text}' = 'Mi objetivo ficticio' and status = 'in_progress'
  from app.portal_patient_goals('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult'))),
  'portal goal = patient-facing wording + status only');
select is((select count(*) from app.portal_upcoming_sessions('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'adult'))),
  1::bigint, 'patient sees its upcoming session (date/time/status only)');

select tests.as_user('c0000000-0000-4000-8000-000000000003');
insert into public.clinical_document_shares (organization_id, clinical_document_id, patient_id, shared_by_membership_id)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'doc'), (select v from ids where k = 'adult'),
  'c2000000-0000-4000-8000-000000000003');
select tests.as_user('c0000000-0000-4000-8000-000000000010', 'aal1');
select is((select count(*) from app.portal_shared_documents('c1000000-0000-4000-8000-000000000001',
  (select v from ids where k = 'adult'))), 1::bigint, 'shared document appears in the portal');
select ok(app.can_read_file('c7000000-0000-4000-8000-000000000001'), 'patient may read the file of a shared document');
select is((select count(*) from public.clinical_documents), 0::bigint, 'sharing does not open the clinical_documents table');
select lives_ok(format($$ select app.audit_portal_document_access('c1000000-0000-4000-8000-000000000001', %L, %L, null, 'r-p') $$,
  (select v from ids where k = 'adult'), (select v from ids where k = 'doc')), 'portal URL issuance is audited by the definer');
select tests.as_user('c0000000-0000-4000-8000-000000000003');
update public.clinical_document_shares set revoked_at = now();
select tests.as_user('c0000000-0000-4000-8000-000000000010', 'aal1');
select ok(not app.can_read_file('c7000000-0000-4000-8000-000000000001'), 'unsharing removes file access immediately');
select throws_ok(format($$ select app.audit_portal_document_access('c1000000-0000-4000-8000-000000000001', %L, %L) $$,
  (select v from ids where k = 'adult'), (select v from ids where k = 'doc')), '42501', null, 'no audit/URL for an unshared document');

-- 9b. Guardian of the minor: no clinical rows; shared documents only with guardian_visible ----------
select tests.as_user('c0000000-0000-4000-8000-000000000003');
insert into ids select 'g1', guardian_id from app.create_guardian('c1000000-0000-4000-8000-000000000001',
  (select v from ids where k = 'minor'), 'Gloria', 'Clinica', 'cc', 'X-3101', null, null, 'mother', true,
  'parental_authority', true, 'r-g');
insert into ids select 'pg1', id from public.patient_guardians where guardian_id = (select v from ids where k = 'g1');
update public.patient_guardians set status = 'active', legal_basis_verified_at = now(), verification_note = 'Documento ficticio'
 where id = (select v from ids where k = 'pg1');
select * from app.set_guardian_permissions('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'pg1'),
  array['view_shared_documents', 'view_patient_facing_goals', 'view_session_schedule']::public.guardian_permission[]);
update public.patients set status = 'active' where id = (select v from ids where k = 'minor');
insert into public.clinical_records (organization_id, patient_id, opened_by_membership_id)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'minor'), 'c2000000-0000-4000-8000-000000000003');
insert into public.file_objects (id, organization_id, patient_id, bucket, storage_path, mime_type, size_bytes, display_name, uploaded_by)
select 'c7000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001', v, 'clinical-documents',
  'org/c1000000-0000-4000-8000-000000000001/patient/' || v || '/c7000000-0000-4000-8000-000000000002',
  'application/pdf', 10, 'colegio-ficticio.pdf', 'c0000000-0000-4000-8000-000000000003' from ids where k = 'minor';
update public.file_objects set status = 'ready', sha256 = extensions.digest('y', 'sha256') where id = 'c7000000-0000-4000-8000-000000000002';
insert into public.clinical_documents (organization_id, clinical_record_id, patient_id, file_object_id, document_type, title,
  uploaded_by_membership_id)
select 'c1000000-0000-4000-8000-000000000001', r.id, r.patient_id, 'c7000000-0000-4000-8000-000000000002', 'report',
  'Informe escolar ficticio', 'c2000000-0000-4000-8000-000000000003'
from public.clinical_records r where r.patient_id = (select v from ids where k = 'minor');
insert into ids select 'mdoc', id from public.clinical_documents where file_object_id = 'c7000000-0000-4000-8000-000000000002';
insert into public.clinical_document_shares (organization_id, clinical_document_id, patient_id, shared_by_membership_id)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'mdoc'), (select v from ids where k = 'minor'),
  'c2000000-0000-4000-8000-000000000003');
select tests.as_admin();
update public.guardians set profile_id = 'c0000000-0000-4000-8000-000000000011' where id = (select v from ids where k = 'g1');
select tests.as_user('c0000000-0000-4000-8000-000000000011', 'aal1');
select is((select count(*) from public.clinical_records) + (select count(*) from public.clinical_notes)
  + (select count(*) from public.clinical_documents) + (select count(*) from public.clinical_document_shares)
  + (select count(*) from public.treatment_goals) + (select count(*) from public.therapy_sessions), 0::bigint,
  'guardian with every portal permission reads NO clinical row');
select is((select count(*) from app.portal_shared_documents('c1000000-0000-4000-8000-000000000001',
  (select v from ids where k = 'minor'))), 0::bigint, 'patient-only share is invisible to the guardian');
select ok(not app.can_read_file('c7000000-0000-4000-8000-000000000002'), 'guardian cannot read a patient-only shared file');
select tests.as_user('c0000000-0000-4000-8000-000000000003');
update public.clinical_document_shares set revoked_at = now() where clinical_document_id = (select v from ids where k = 'mdoc');
insert into public.clinical_document_shares (organization_id, clinical_document_id, patient_id, shared_by_membership_id, guardian_visible)
values ('c1000000-0000-4000-8000-000000000001', (select v from ids where k = 'mdoc'), (select v from ids where k = 'minor'),
  'c2000000-0000-4000-8000-000000000003', true);
select tests.as_user('c0000000-0000-4000-8000-000000000011', 'aal1');
select is((select count(*) from app.portal_shared_documents('c1000000-0000-4000-8000-000000000001',
  (select v from ids where k = 'minor'))), 1::bigint, 'guardian-visible share appears for the permitted guardian');
select ok(app.can_read_file('c7000000-0000-4000-8000-000000000002'), 'guardian reads the guardian-visible shared file');

-- 10. Cross-tenant, platform admin, off-care-team writes -------------------------------------------------
select tests.as_user('d0000000-0000-4000-8000-000000000001');
select is((select count(*) from public.clinical_records) + (select count(*) from public.clinical_notes)
  + (select count(*) from public.file_objects), 0::bigint, 'cross-tenant owner reads no clinical rows');
select throws_ok(format($$ insert into public.clinical_notes (organization_id, clinical_record_id, patient_id, note_type_id, body,
  author_membership_id) values ('d1000000-0000-4000-8000-000000000001', %L, %L, 'd5000000-0000-4000-8000-000000000001',
  '{"version":1,"blocks":[]}', 'd2000000-0000-4000-8000-000000000001') $$, (select v from ids where k = 'rec'),
  (select v from ids where k = 'adult')), 'P0001', 'NOT_FOUND:clinical_record', 'cross-tenant note insert refused (record invisible)');
select tests.as_user('e0000000-0000-4000-8000-000000000001');
select is((select count(*) from public.clinical_records) + (select count(*) from public.clinical_notes)
  + (select count(*) from public.clinical_documents), 0::bigint, 'platform admin reads no clinical rows');
select ok(not app.can_read_file('c7000000-0000-4000-8000-000000000001'), 'platform admin cannot read clinical files');
select tests.as_user('c0000000-0000-4000-8000-000000000001');
select is((select count(*) from public.clinical_records), 0::bigint, 'owner off the care team reads no records');

-- 11. Closed record is read-only -------------------------------------------------------------------------
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select throws_ok(format($$ update public.clinical_records set status = 'closed' where id = %L $$, (select v from ids where k = 'rec')),
  'P0001', 'PRECONDITION:closure_summary_required', 'closing requires a summary');
update public.clinical_records set status = 'closed',
  closure_summary = '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Cierre ficticio"}]}]}'
 where id = (select v from ids where k = 'rec');
select throws_ok(format($$ update public.clinical_record_sections set content = '{"version":1,"blocks":[]}' where id = %L $$,
  (select v from ids where k = 'sec')), 'P0001', 'PRECONDITION:record_closed', 'sections are read-only while the record is closed');
update public.clinical_records set status = 'open' where id = (select v from ids where k = 'rec');
select ok((select reopened_at is not null and closed_at is null from public.clinical_records where id = (select v from ids where k = 'rec')),
  'reopening clears closure fields and stamps reopened_at');

-- 12. S2-02: staff audit rows may tag only accessible patients -----------------------------------------------
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select lives_ok(format($$ select app.write_audit('clinical_note.viewed', 'c1000000-0000-4000-8000-000000000001', 'clinical_note', %L,
  jsonb_build_object('patient_id', %L::text)) $$, (select v from ids where k = 'note'),
  (select v from ids where k = 'adult')), 'care team tags its own patient');
select tests.as_admin();
select tests.as_user('c0000000-0000-4000-8000-000000000002');
insert into ids select 'other', app.create_patient('c1000000-0000-4000-8000-000000000001', 'Bruno', 'Ajeno', null,
  date '1980-01-01', null, null, null, null, 'es', 'r9');
select tests.as_user('c0000000-0000-4000-8000-000000000003');
select throws_ok(format($$ select app.write_audit('patient.viewed', 'c1000000-0000-4000-8000-000000000001', 'patient', %L,
  jsonb_build_object('patient_id', %L::text)) $$, (select v from ids where k = 'other'), (select v from ids where k = 'other')),
  'P0001', 'AUDIT:patient_not_accessible', 'psychologist cannot tag a patient outside its care team');
select throws_ok($$ select app.write_audit('patient.viewed', 'c1000000-0000-4000-8000-000000000001', 'patient', null,
  jsonb_build_object('patient_id', gen_random_uuid()::text)) $$,
  'P0001', 'AUDIT:patient_not_accessible', 'unknown patient ids are rejected');
select tests.as_user('c0000000-0000-4000-8000-000000000001');
select lives_ok(format($$ select app.write_audit('care_team.assigned', 'c1000000-0000-4000-8000-000000000001', 'care_team_member', null,
  jsonb_build_object('patient_id', %L::text, 'membership_id', 'c2000000-0000-4000-8000-000000000003', 'care_role', 'secondary')) $$,
  (select v from ids where k = 'other')), 'owner may tag patients of its organization (care-team administration)');

select * from finish();
rollback;
