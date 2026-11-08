-- =============================================================================
-- Phase 1 security remediation — branding logo writes are server-only (SECURITY.md §14.7
-- P1-16, P1-18).
--
-- P1-16: with `branding_logos_insert_owner` an owner could write ARBITRARY bytes (e.g. HTML)
-- directly to the Storage API with their own aal2 JWT under the content-addressed name of a
-- valid logo; the server then treated the 409 "already exists" as success and published the
-- unsanitised object. Fix: `authenticated` gets NO write path into the `branding` bucket.
-- The server action is the only writer: it checks owner + aal2 + active org in the user's
-- RLS-bound transaction (UPDATE of organization_branding under
-- organization_branding_update_owner), and only then uploads the SANITISED bytes with the
-- service role (src/server/db/service-role.ts, upsert, so a pre-existing object under that
-- name is overwritten with the sanitised bytes). Removing the policy (instead of keeping it
-- and re-verifying bytes) leaves no direct-write surface for any user role.
--
-- P1-18: audit event for taking a logo down (`organization_branding.logo_removed`); the
-- object itself is deleted by the server with the service role (Storage API).
-- =============================================================================

drop policy if exists branding_logos_insert_owner on storage.objects;

-- The path helper is no longer used by any policy; keep it (pgTAP + documentation of the
-- naming convention) but callable by no API role.
revoke execute on function app.branding_object_org(text) from authenticated;

comment on column public.organization_branding.logo_path is
  'Object path inside the public `branding` bucket (<organization_id>/logo-<hash>.<ext>). Set by the server after validation; the object is written only by the server (service role).';

-- Audit event (allowlist; must match src/server/audit/events.ts).
insert into app.audit_event_types (event_type, category, writer, org_optional, description) values
  ('organization_branding.logo_removed', 'branding', 'user', false, 'Organization logo removed and its objects deleted');
