-- =============================================================================
-- Phase 1.7 — Organization branding: logo storage.
-- Refs: ADR-010, ADR-011, Q-09, SECURITY.md §8 (branding bucket conditions), F-18,
--       ARCHITECTURE §12.
--
-- * Public-read bucket `branding` (logos only; PNG/JPEG/WebP; NO SVG; 512 KiB). Public reads go
--   through /storage/v1/object/public/ and need no policy. There is NO select policy for any
--   role, so objects cannot be listed through the Storage API.
-- * Object names: `<organization_id>/logo-<32 hex of sha256>.<png|jpg|webp>` (content-addressed,
--   unguessable enough, no user file names, no PHI).
-- * INSERT only, only for the organization_owner of the path's organization (aal2, org active),
--   i.e. the same decision as organization_branding_update_owner. No UPDATE/DELETE policy:
--   objects are immutable once written (orphan cleanup is a later maintenance job).
-- * The app uploads through the server action (magic-byte sniffing, metadata stripping) using the
--   caller's own JWT; browsers never hold the JWT (httpOnly cookies, no browser Supabase client).
-- * organization_branding.logo_path references the object; get_public_branding returns it.
-- =============================================================================

alter table public.organization_branding
  add column logo_path text null;
alter table public.organization_branding
  add constraint organization_branding_logo_path_format check (
    logo_path is null
    or logo_path ~ ('^' || organization_id::text || '/logo-[0-9a-f]{32}\.(png|jpg|webp)$')
  );
comment on column public.organization_branding.logo_path is
  'Object path inside the public `branding` bucket (<organization_id>/logo-<hash>.<ext>). Set by the server after validation.';
grant update (logo_path) on public.organization_branding to authenticated;

-- Pre-auth branding now also returns the logo path (new column appended; same grants).
drop function app.get_public_branding(uuid);
create function app.get_public_branding(p_org uuid)
returns table (
  organization_id uuid,
  slug text,
  display_name text,
  default_locale text,
  brand_color text,
  functional_color text,
  secondary_color text,
  accent_color text,
  child_mode_enabled boolean,
  logo_file_id uuid,
  favicon_file_id uuid,
  portal_welcome_es text,
  portal_welcome_en text,
  logo_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.slug, b.display_name, o.default_locale, b.brand_color, b.functional_color,
         b.secondary_color, b.accent_color, b.child_mode_enabled, b.logo_file_id,
         b.favicon_file_id, b.portal_welcome_es, b.portal_welcome_en, b.logo_path
  from public.organizations o
  join public.organization_branding b on b.organization_id = o.id
  where o.id = p_org and o.status <> 'closed'
$$;
revoke all on function app.get_public_branding(uuid) from public, anon, authenticated, service_role;
grant execute on function app.get_public_branding(uuid) to app_server;

-- Audit event (allowlist; must match src/server/audit/events.ts).
insert into app.audit_event_types (event_type, category, writer, org_optional, description) values
  ('organization_branding.logo_uploaded', 'branding', 'user', false, 'Organization logo uploaded');

-- Bucket (public read, logos only).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding', 'branding', true, 524288, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Organization id encoded in a branding object name; NULL unless the whole name is well formed
-- (a malformed name can neither pass the policy nor raise a cast error).
create function app.branding_object_org(p_name text) returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/logo-[0-9a-f]{32}\.(png|jpg|webp)$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;
revoke all on function app.branding_object_org(text) from public, anon;
grant execute on function app.branding_object_org(text) to authenticated;

create policy branding_logos_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and (select app.can_write_as_role(app.branding_object_org(name), 'organization_owner'))
  );
