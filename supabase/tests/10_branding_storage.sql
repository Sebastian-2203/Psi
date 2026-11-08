-- Workstream 1.7: branding bucket + storage policy + logo_path (ADR-010, Q-09, SECURITY.md §8).
begin;
\ir _helpers.psql

select plan(22);

-- Bucket configuration -----------------------------------------------------------------------
select is((select public from storage.buckets where id = 'branding'), true, 'branding bucket is public-read');
select is((select file_size_limit from storage.buckets where id = 'branding'), 524288::bigint, 'branding bucket caps size at 512 KiB');
select results_eq(
  $$ select m from (select unnest(allowed_mime_types) as m from storage.buckets where id = 'branding') x order by m $$,
  $$ values ('image/jpeg'::text), ('image/png'::text), ('image/webp'::text) $$,
  'branding bucket allows PNG/JPEG/WebP only (no SVG)'
);
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and cmd = 'SELECT' and policyname like 'branding%'), 0::bigint,
  'no SELECT policy on branding objects (listing disabled)');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'branding%' and cmd in ('UPDATE', 'DELETE')), 0::bigint,
  'no UPDATE/DELETE policy on branding objects (immutable)');

-- Path helper --------------------------------------------------------------------------------
select tests.as_admin();
select is(app.branding_object_org('c1000000-0000-4000-8000-000000000001/logo-0123456789abcdef0123456789abcdef.png'),
  'c1000000-0000-4000-8000-000000000001'::uuid, 'well-formed path resolves its organization');
select is(app.branding_object_org('c1000000-0000-4000-8000-000000000001/logo-0123456789abcdef0123456789abcdef.svg')::text, null::text, 'svg path rejected');
select is(app.branding_object_org('c1000000-0000-4000-8000-000000000001/x/logo-0123456789abcdef0123456789abcdef.png')::text, null::text, 'nested path rejected');
select is(app.branding_object_org('not-a-uuid/logo-0123456789abcdef0123456789abcdef.png')::text, null::text, 'non-uuid org rejected without a cast error');
select is(app.branding_object_org('c1000000-0000-4000-8000-000000000001/logo-0123456789ABCDEF0123456789abcdef.png')::text, null::text, 'uppercase hash rejected');

-- No direct writes (P1-16): only the server (service role) writes branding objects ------------
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'branding%'), 0::bigint,
  'no storage policy for branding objects at all (writes are server-only)');
select ok(not has_function_privilege('authenticated', 'app.branding_object_org(text)', 'execute'),
  'authenticated cannot call the (unused) path helper');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and cmd in ('INSERT', 'ALL') and 'authenticated' = any(roles)
           and (with_check ilike '%branding%' or qual ilike '%branding%')), 0::bigint,
  'no INSERT/ALL policy for authenticated mentions the branding bucket');

select tests.as_user('c0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('branding', 'c1000000-0000-4000-8000-000000000001/logo-0123456789abcdef0123456789abcdef.png') $$,
  '42501', null, 'owner X (aal2) cannot insert a logo object for X directly');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('branding', 'd1000000-0000-4000-8000-000000000001/logo-0123456789abcdef0123456789abcdef.png') $$,
  '42501', null, 'owner X cannot insert a logo object for Y');
select is(tests.affected($$ update storage.objects set name = name where bucket_id = 'branding' $$), 0,
  'owner X cannot update branding objects');
select is((select count(*) from storage.objects where bucket_id = 'branding'), 0::bigint, 'owner cannot SELECT objects (no listing)');

select tests.as_user('c0000000-0000-4000-8000-000000000003');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('branding', 'c1000000-0000-4000-8000-000000000001/logo-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png') $$,
  '42501', null, 'psychologist X cannot insert a logo object');

select tests.as_user('c0000000-0000-4000-8000-000000000001', 'aal1');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('branding', 'c1000000-0000-4000-8000-000000000001/logo-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png') $$,
  '42501', null, 'owner at aal1 cannot insert a logo object');

-- Audit event for takedown (P1-18).
select tests.as_admin();
select is((select writer from app.audit_event_types where event_type = 'organization_branding.logo_removed'),
  'user', 'organization_branding.logo_removed is a user-written audit event');

-- logo_path column ------------------------------------------------------------------------------
select tests.as_user('c0000000-0000-4000-8000-000000000001');
select throws_ok(
  $$ update public.organization_branding set logo_path = 'd1000000-0000-4000-8000-000000000001/logo-0123456789abcdef0123456789abcdef.png'
     where organization_id = 'c1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'logo_path must point inside the own organization folder');
select is(tests.affected($$ update public.organization_branding set logo_path = 'c1000000-0000-4000-8000-000000000001/logo-0123456789abcdef0123456789abcdef.png'
     where organization_id = 'c1000000-0000-4000-8000-000000000001' $$), 1, 'owner can set a well-formed logo_path');

select * from finish();
rollback;
