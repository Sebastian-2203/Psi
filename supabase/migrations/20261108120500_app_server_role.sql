-- =============================================================================
-- app_server: the Next.js server's database login role (ADR-019 Option A).
--
-- * LOGIN, NOINHERIT, no BYPASSRLS/superuser/createrole/createdb/replication, owns nothing.
-- * Member of `authenticated` WITH INHERIT FALSE, SET TRUE: it holds no table privileges of
--   its own and can only act on data after `set local role authenticated` with verified
--   claims (src/server/db/server.ts). It cannot `set role` to service_role/postgres.
-- * Without `set role`, it may execute only the narrow system functions below
--   (src/server/db/admin.ts, ARCHITECTURE §6.4).
-- * The PASSWORD IS NOT SET HERE. Locally: `pnpm db:app-password` (scripts/db-app-password.mjs)
--   reads APP_DB_PASSWORD from .env.local. Hosted: set once by an operator (runbook), stored
--   only in the deployment secret store as part of DATABASE_URL.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'app_server') then
    create role app_server with login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$$;
alter role app_server with login noinherit nocreatedb nocreaterole;
-- SUPERUSER/REPLICATION/BYPASSRLS can only be changed by a superuser; assert they are off.
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname = 'app_server' and (rolsuper or rolbypassrls or rolreplication or rolinherit)
  ) then
    raise exception 'app_server must not be superuser, bypass RLS, replicate or inherit';
  end if;
end
$$;
comment on role app_server is 'Next.js server login role (ADR-019 A). Acts on data only as authenticated with verified claims.';

-- Conservative server-side limits for the app role (per-transaction values may be lower).
alter role app_server set statement_timeout = '15s';
alter role app_server set idle_in_transaction_session_timeout = '30s';
alter role app_server set lock_timeout = '5s';

grant authenticated to app_server with inherit false, set true;

grant usage on schema app to app_server;
grant execute on function app.write_system_audit(text, uuid, uuid, text, uuid, jsonb, text, inet, text) to app_server;
grant execute on function app.consume_rate_limit_key(bytea, integer, interval) to app_server;
grant execute on function app.resolve_organization_by_host(text) to app_server;
grant execute on function app.get_public_branding(uuid) to app_server;
grant execute on function app.accept_staff_invitation(bytea, uuid, text, text, text, text) to app_server;
