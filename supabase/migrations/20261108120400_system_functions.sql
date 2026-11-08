-- =============================================================================
-- System-path functions (ARCHITECTURE §6.4): executed by the app_server login role
-- WITHOUT `set role authenticated`, i.e. with no user claims. Each is narrow, schema-
-- qualified, has no dynamic SQL, and refuses to run inside a user context.
-- Execute is granted to app_server in the next migration; never to authenticated/anon.
-- Refs: ADR-017 (host resolution), ADR-010 (pre-auth branding), SECURITY.md §3.8.
-- =============================================================================

-- Host -> organization id for VERIFIED hosts (middleware hint, ADR-017). Returns only an id.
create function app.resolve_organization_by_host(p_host text) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.organization_id
  from public.organization_domains d
  join public.organizations o on o.id = d.organization_id
  where d.host = lower(btrim(p_host))::extensions.citext
    and d.verified_at is not null
    and o.status <> 'closed'
$$;
comment on function app.resolve_organization_by_host(text) is
  'ADR-017 host lookup (verified hosts, org not closed). The result is a HINT; the server re-validates membership.';
revoke all on function app.resolve_organization_by_host(text) from public, anon, authenticated, service_role;

-- Branding tokens for pre-auth rendering (sign-in page, portal shell). Non-PHI.
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
  portal_welcome_en text
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.slug, b.display_name, o.default_locale, b.brand_color, b.functional_color,
         b.secondary_color, b.accent_color, b.child_mode_enabled, b.logo_file_id,
         b.favicon_file_id, b.portal_welcome_es, b.portal_welcome_en
  from public.organizations o
  join public.organization_branding b on b.organization_id = o.id
  where o.id = p_org and o.status <> 'closed'
$$;
revoke all on function app.get_public_branding(uuid) from public, anon, authenticated, service_role;

-- Staff invitation acceptance (SECURITY.md §3.8): single-use atomic update, expiry, email
-- binding to the verified auth email, roles fixed by the invitation (no escalation).
-- p_profile_id is the auth user created/verified by the Auth admin API in the same flow.
-- All failures raise the same generic PRECONDITION:invitation_invalid (no enumeration).
create function app.accept_staff_invitation(
  p_token_hash bytea,
  p_profile_id uuid,
  p_professional_title text default null,
  p_license_number text default null,
  p_license_issuer text default null,
  p_request_id text default null
)
returns table (organization_id uuid, membership_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
  v_email text;
  v_confirmed timestamptz;
  v_membership_id uuid;
  v_role public.membership_role;
begin
  if (select auth.uid()) is not null then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:system_function_in_user_context';
  end if;

  update public.invitations i
     set status = 'accepted', accepted_by_profile_id = p_profile_id
   where i.token_hash = p_token_hash
     and i.status = 'pending'
     and i.expires_at > now()
     and i.invitation_type = 'staff'
  returning i.* into v_inv;
  if not found then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invitation_invalid';
  end if;

  select u.email, u.email_confirmed_at into v_email, v_confirmed
  from auth.users u where u.id = p_profile_id;
  if v_email is null or v_confirmed is null or lower(v_email) <> lower(v_inv.email::text) then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invitation_invalid';
  end if;

  if not exists (select 1 from public.organizations o where o.id = v_inv.organization_id and o.status = 'active') then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:invitation_invalid';
  end if;

  insert into public.memberships as m (organization_id, profile_id, status)
  values (v_inv.organization_id, p_profile_id, 'active')
  on conflict (organization_id, profile_id) do update set status = 'active'
  returning m.id into v_membership_id;

  if 'psychologist' = any (v_inv.roles) and not exists (
    select 1 from public.professional_profiles pp where pp.membership_id = v_membership_id
  ) then
    if p_professional_title is null or p_license_number is null or p_license_issuer is null then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:professional_profile_required';
    end if;
    insert into public.professional_profiles (organization_id, membership_id, professional_title, license_number, license_issuer)
    values (v_inv.organization_id, v_membership_id, p_professional_title, p_license_number, p_license_issuer);
  end if;

  foreach v_role in array v_inv.roles loop
    insert into public.membership_roles (organization_id, membership_id, role, granted_by)
    values (v_inv.organization_id, v_membership_id, v_role, v_inv.invited_by)
    on conflict on constraint membership_roles_membership_role_key do nothing;
  end loop;

  perform app.insert_audit_row(
    'invitation.accepted', 'system', 'system', p_profile_id, '{}', v_inv.organization_id,
    'invitation', v_inv.id, jsonb_build_object('membership_id', v_membership_id), p_request_id, null, null
  );
  perform app.insert_audit_row(
    'membership.created', 'system', 'system', p_profile_id,
    (select coalesce(array_agg(r::text), '{}') from unnest(v_inv.roles) r), v_inv.organization_id,
    'membership', v_membership_id, jsonb_build_object('invitation_id', v_inv.id), p_request_id, null, null
  );

  organization_id := v_inv.organization_id;
  membership_id := v_membership_id;
  return next;
end
$$;
comment on function app.accept_staff_invitation(bytea, uuid, text, text, text, text) is
  'System path: accept a staff invitation by sha256(token) for a verified auth user whose email matches.';
revoke all on function app.accept_staff_invitation(bytea, uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
