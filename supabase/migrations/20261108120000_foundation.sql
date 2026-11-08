-- =============================================================================
-- Foundation: extensions, non-exposed `app` schema, default-privilege hardening,
-- Phase 1 enums and shared trigger functions.
-- Refs: ADR-003 (forced RLS, default deny), ADR-004/ADR-019 Option A (no Data API),
--       ADR-018 (functions: search_path = '', no dynamic SQL), DATABASE.md §1, §3, §11.
-- =============================================================================

-- Extensions live in `extensions` (Supabase convention); always schema-qualify.
create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- ADR-019 Option A: GraphQL must stay off. The Data API is disabled in config.toml
-- ([api] enabled = false); dropping pg_graphql removes the GraphQL resolver even if the
-- Data API were re-enabled by mistake.
drop extension if exists pg_graphql;

-- -----------------------------------------------------------------------------
-- `app` schema: helpers, audit writer, system functions. NEVER exposed by any API.
-- -----------------------------------------------------------------------------
create schema if not exists app;
comment on schema app is
  'Non-exposed schema for RLS helpers, integrity functions and the audit writer (SECURITY.md §4.3). Never add it to [api].schemas.';
revoke all on schema app from public;
revoke all on schema app from anon;
-- `authenticated` needs USAGE so RLS policies can call helpers; EXECUTE is granted per function.
grant usage on schema app to authenticated;

-- Functions are not executable by PUBLIC unless granted explicitly (schema app and public).
alter default privileges in schema app revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema app revoke execute on functions from anon, authenticated, service_role;
alter default privileges in schema public revoke execute on functions from anon, authenticated, service_role;

-- New tables/sequences in public get NO privileges for API roles by default; every table
-- migration grants exactly what its policies need (and never anything to anon).
alter default privileges in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums (DATABASE.md §3) — Phase 1 subset. Adding values is a migration; never remove.
-- -----------------------------------------------------------------------------
create type public.org_status as enum ('active', 'read_only', 'suspended', 'closed');
create type public.domain_type as enum ('subdomain', 'custom');
create type public.membership_status as enum ('active', 'suspended', 'removed');
create type public.membership_role as enum ('organization_owner', 'psychologist');
create type public.invitation_type as enum ('staff', 'patient', 'guardian');
create type public.invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
create type public.grant_scope as enum ('org_support_non_clinical', 'clinical_read_break_glass');
create type public.grant_status as enum ('pending', 'approved', 'rejected', 'revoked', 'expired');
create type public.actor_type as enum ('user', 'system', 'platform_admin', 'break_glass');

-- -----------------------------------------------------------------------------
-- Shared trigger functions
-- -----------------------------------------------------------------------------

-- Maintains updated_at on every mutable table (DATABASE.md §1 rule 4).
create function app.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;
comment on function app.set_updated_at() is 'BEFORE UPDATE trigger: server-side updated_at.';

-- Rejects UPDATE/DELETE/TRUNCATE on append-only tables (audit_logs). The error prefix
-- IMMUTABLE: is mapped to IMMUTABLE_RECORD by src/server/errors (ARCHITECTURE §13).
create function app.reject_mutation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'IMMUTABLE:' || tg_table_name;
end
$$;
comment on function app.reject_mutation() is
  'Append-only guard. No role is exempt in Phase 1; a dedicated retention role is added only with an active retention policy (ADR-013).';
