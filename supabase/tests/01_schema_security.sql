-- Schema-wide security invariants (SECURITY.md §13.1 "RLS pgTAP", DATABASE.md §11 lint).
begin;
\ir _helpers.psql

select plan(12);

-- Every table in public: RLS enabled AND forced.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not (c.relrowsecurity and c.relforcerowsecurity)),
  0::bigint,
  'every public table has RLS enabled and forced'
);

-- anon holds no privilege on any public table, sequence or function.
select is(
  (select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'PUBLIC')),
  0::bigint,
  'anon/PUBLIC have no table privileges in public'
);
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app') and has_function_privilege('anon', p.oid, 'execute')),
  0::bigint,
  'anon cannot execute any function in public/app'
);

-- Every function in app/public pins search_path.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app') and p.prokind = 'f'
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  0::bigint,
  'every app/public function sets search_path'
);

-- SECURITY DEFINER only in schema app.
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef and n.nspname = 'public'),
  0::bigint,
  'no SECURITY DEFINER function outside schema app'
);

-- Views (none yet) must be security_invoker.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not coalesce('security_invoker=true' = any (c.reloptions), false)),
  0::bigint,
  'every public view is security_invoker'
);

-- ADR-019: GraphQL extension absent.
select is((select count(*) from pg_extension where extname = 'pg_graphql'), 0::bigint, 'pg_graphql is not installed');

-- Realtime publication carries no domain table.
select is(
  (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'),
  0::bigint,
  'no public table in the supabase_realtime publication'
);

-- app_server: login, no inherit, no bypassrls/superuser, owns nothing, only member of authenticated (SET, not INHERIT).
select ok(
  (select rolcanlogin and not rolinherit and not rolbypassrls and not rolsuper and not rolcreaterole and not rolcreatedb
   from pg_roles where rolname = 'app_server'),
  'app_server is a non-privileged login role'
);
select is(
  (select count(*) from pg_class c join pg_roles r on r.oid = c.relowner where r.rolname = 'app_server')
  + (select count(*) from pg_proc p join pg_roles r on r.oid = p.proowner where r.rolname = 'app_server'),
  0::bigint,
  'app_server owns no relations or functions'
);
select is(
  (select string_agg(r.rolname || ':' || a.inherit_option || ':' || a.set_option, ',')
   from pg_auth_members a join pg_roles r on r.oid = a.roleid join pg_roles m on m.oid = a.member
   where m.rolname = 'app_server'),
  'authenticated:false:true',
  'app_server is a member of authenticated only, SET without INHERIT'
);
select is(
  (select count(*) from information_schema.role_table_grants where grantee = 'app_server'),
  0::bigint,
  'app_server has no direct table privileges'
);

select * from finish();
rollback;
