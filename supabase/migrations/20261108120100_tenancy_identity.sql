-- =============================================================================
-- Tenancy, platform and identity: tables, RLS helpers, policies and grants.
-- Tables: profiles, organizations, organization_domains, organization_branding,
--         platform_admins, memberships, membership_roles, professional_profiles,
--         invitations, platform_access_grants.
-- Refs: ADR-002/003/004/014/016/017/019, DATABASE.md §1, §5.1, §5.2, SECURITY.md §4.
--
-- Every table: RLS enabled + FORCED, default deny, no privileges for anon, explicit
-- per-column grants for authenticated matching the policies below.
-- Helpers (schema app): STABLE, set search_path = '', identity from auth.uid()/auth.jwt()
-- only, boolean results, aal2 required for every staff/platform check (F-03), org status
-- gate (DATABASE.md §5.1). Clinical/guardian/patient helpers arrive with Phase 2/3 tables.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles (1:1 with auth.users, no organization_id)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 120),
  locale text null check (locale in ('es', 'en')),
  time_zone text null check (char_length(time_zone) <= 64),
  last_seen_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'One row per auth user (person-level settings). Created by trigger on auth.users.';

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

-- Profile row for every new auth user (invitation flow creates users via the Auth admin API).
create function app.handle_new_auth_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_locale text := new.raw_user_meta_data ->> 'locale';
begin
  insert into public.profiles (id, display_name, locale)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 120),
    case when v_locale in ('es', 'en') then v_locale else null end
  )
  on conflict (id) do nothing;
  return new;
end
$$;
revoke all on function app.handle_new_auth_user() from public, anon, authenticated, service_role;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- organizations (tenant root)
-- -----------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  legal_name text not null check (char_length(legal_name) between 1 and 200),
  display_name text not null check (char_length(display_name) between 1 and 120),
  tax_id text null check (char_length(tax_id) <= 32),
  country_code char(2) not null default 'CO' check (country_code ~ '^[A-Z]{2}$'),
  default_locale text not null default 'es' check (default_locale in ('es', 'en')),
  time_zone text not null default 'America/Bogota' check (char_length(time_zone) between 1 and 64),
  status public.org_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_slug_key unique (slug),
  constraint organizations_slug_format check (slug ~ '^[a-z0-9-]{3,48}$')
);
comment on table public.organizations is 'Tenant (practice). Status behaviour: DATABASE.md §5.1 (enforced in app.* helpers).';
create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- organization_domains (host -> org, ADR-017)
-- -----------------------------------------------------------------------------
create table public.organization_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  host extensions.citext not null,
  domain_type public.domain_type not null default 'subdomain',
  is_primary boolean not null default false,
  verified_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_domains_host_key unique (host),
  constraint organization_domains_org_id_key unique (organization_id, id),
  constraint organization_domains_host_format check (
    char_length(host::text) <= 253
    and host::text = lower(host::text)
    and host::text ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  )
);
create unique index organization_domains_one_primary on public.organization_domains (organization_id) where is_primary;
create index organization_domains_org_idx on public.organization_domains (organization_id);
comment on table public.organization_domains is 'Host to organization mapping. Only verified hosts resolve (app.resolve_organization_by_host).';
create trigger organization_domains_set_updated_at before update on public.organization_domains
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- organization_branding (1:1). Columns follow the implemented branding schema
-- (src/styles/branding.ts, DESIGN_SYSTEM §7): hex colours, contrast checked in the app.
-- -----------------------------------------------------------------------------
create table public.organization_branding (
  organization_id uuid primary key references public.organizations (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 80),
  brand_color text not null check (brand_color ~ '^#[0-9a-f]{6}$'),
  functional_color text null check (functional_color ~ '^#[0-9a-f]{6}$'),
  secondary_color text null check (secondary_color ~ '^#[0-9a-f]{6}$'),
  accent_color text null check (accent_color ~ '^#[0-9a-f]{6}$'),
  child_mode_enabled boolean not null default true,
  -- FK to file_objects (organization_id, id) is added with the storage workstream.
  logo_file_id uuid null,
  favicon_file_id uuid null,
  portal_welcome_es text null check (char_length(portal_welcome_es) <= 500),
  portal_welcome_en text null check (char_length(portal_welcome_en) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.organization_branding is 'White-label tokens (ADR-010). No free CSS; validated + contrast-checked in the app.';
create trigger organization_branding_set_updated_at before update on public.organization_branding
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- platform_admins (NOT a membership; no clinical access, ADR-014)
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  profile_id uuid primary key references public.profiles (id) on delete restrict,
  granted_by uuid null references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index platform_admins_granted_by_idx on public.platform_admins (granted_by);
comment on table public.platform_admins is 'SyV platform operators. Granted/revoked only by privileged migration/runbook, never via the app.';
create trigger platform_admins_set_updated_at before update on public.platform_admins
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- memberships (staff only)
-- -----------------------------------------------------------------------------
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  status public.membership_status not null default 'active',
  joined_at timestamptz not null default now(),
  removed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_org_profile_key unique (organization_id, profile_id),
  constraint memberships_org_id_key unique (organization_id, id),
  constraint memberships_removed_consistent check ((status = 'removed') = (removed_at is not null))
);
create index memberships_profile_idx on public.memberships (profile_id, organization_id);
comment on table public.memberships is 'Profile <-> organization (staff). Patients/guardians are not members.';
create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- membership_roles (composite tenant FK)
-- -----------------------------------------------------------------------------
create table public.membership_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  membership_id uuid not null,
  role public.membership_role not null,
  granted_by uuid null references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default now(),
  constraint membership_roles_membership_role_key unique (membership_id, role),
  constraint membership_roles_org_id_key unique (organization_id, id),
  constraint membership_roles_membership_fkey foreign key (organization_id, membership_id)
    references public.memberships (organization_id, id) on delete restrict
);
create index membership_roles_org_membership_idx on public.membership_roles (organization_id, membership_id);
create index membership_roles_granted_by_idx on public.membership_roles (granted_by);
comment on table public.membership_roles is 'Roles per membership. Insert/delete only (no updates). Last-owner and psychologist-licence rules enforced by triggers.';

-- -----------------------------------------------------------------------------
-- professional_profiles (1:1 with membership)
-- -----------------------------------------------------------------------------
create table public.professional_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  membership_id uuid not null,
  professional_title text not null check (char_length(professional_title) between 1 and 120),
  license_number text not null check (char_length(license_number) between 1 and 64),
  license_issuer text not null check (char_length(license_issuer) between 1 and 120),
  specialties text[] not null default '{}' check (cardinality(specialties) <= 20),
  -- FK to file_objects added with the storage workstream.
  signature_file_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_profiles_membership_key unique (membership_id),
  constraint professional_profiles_org_license_key unique (organization_id, license_number),
  constraint professional_profiles_org_id_key unique (organization_id, id),
  constraint professional_profiles_membership_fkey foreign key (organization_id, membership_id)
    references public.memberships (organization_id, id) on delete restrict
);
comment on table public.professional_profiles is 'Per-membership professional data (title, licence). Required before the psychologist role can be held.';
create trigger professional_profiles_set_updated_at before update on public.professional_profiles
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- invitations (Phase 1: staff only; token stored as sha256 only, SECURITY.md §3.8)
-- -----------------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  invitation_type public.invitation_type not null default 'staff',
  email extensions.citext not null check (
    char_length(email::text) <= 254 and email::text ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  roles public.membership_role[] null,
  token_hash bytea not null check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  status public.invitation_status not null default 'pending',
  invited_by uuid not null references public.profiles (id) on delete restrict,
  accepted_by_profile_id uuid null references public.profiles (id) on delete restrict,
  accepted_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitations_token_hash_key unique (token_hash),
  constraint invitations_org_id_key unique (organization_id, id),
  -- Phase 1 scope: patient/guardian invitations (with composite FKs to patients/guardians)
  -- are added in Phase 2 by a migration that relaxes this check.
  constraint invitations_phase1_staff_only check (invitation_type = 'staff'),
  constraint invitations_staff_roles check (
    invitation_type <> 'staff' or (roles is not null and cardinality(roles) between 1 and 2)
  ),
  constraint invitations_accepted_consistent check (
    (status = 'accepted') = (accepted_at is not null and accepted_by_profile_id is not null)
  ),
  constraint invitations_revoked_consistent check ((status = 'revoked') = (revoked_at is not null)),
  constraint invitations_expiry_window check (
    expires_at > created_at and expires_at <= created_at + interval '30 days'
  )
);
create index invitations_org_email_status_idx on public.invitations (organization_id, email, status);
create unique index invitations_one_pending_per_email on public.invitations (organization_id, email)
  where status = 'pending';
create index invitations_invited_by_idx on public.invitations (invited_by);
create index invitations_accepted_by_idx on public.invitations (accepted_by_profile_id);
comment on table public.invitations is 'Staff invitations. Raw token never stored; acceptance only via app.accept_staff_invitation (system path).';
comment on column public.invitations.token_hash is 'sha256(raw token). Not selectable by authenticated (column grant).';
create trigger invitations_set_updated_at before update on public.invitations
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- platform_access_grants (ADR-014; approval-gated, DB-activated, read-only by construction)
-- -----------------------------------------------------------------------------
create function app.max_break_glass_duration() returns interval
language sql
immutable
set search_path = ''
as $$ select interval '4 hours' $$;
comment on function app.max_break_glass_duration() is
  'ADR-014: default and maximum grant duration. Lowering is a migration; raising requires a new ADR.';

create table public.platform_access_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  platform_admin_profile_id uuid not null references public.platform_admins (profile_id) on delete restrict,
  scope public.grant_scope not null,
  -- Composite FK (organization_id, patient_id) -> patients is added in Phase 2.
  patient_id uuid null,
  object_scope jsonb null check (object_scope is null or jsonb_typeof(object_scope) = 'object'),
  reason text not null check (char_length(reason) between 20 and 2000),
  ticket_reference text not null check (char_length(ticket_reference) between 1 and 128),
  requested_duration interval not null default app.max_break_glass_duration(),
  status public.grant_status not null default 'pending',
  owner_approved_by_profile_id uuid null references public.profiles (id) on delete restrict,
  owner_approved_at timestamptz null,
  psychologist_approval_required boolean not null default true,
  psychologist_approved_by_membership_id uuid null,
  psychologist_approved_at timestamptz null,
  second_approver_profile_id uuid null references public.platform_admins (profile_id) on delete restrict,
  second_approved_at timestamptz null,
  starts_at timestamptz null,
  expires_at timestamptz null,
  revoked_at timestamptz null,
  revoked_by_profile_id uuid null references public.profiles (id) on delete restrict,
  report_sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_access_grants_org_id_key unique (organization_id, id),
  constraint platform_access_grants_psy_membership_fkey
    foreign key (organization_id, psychologist_approved_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint platform_access_grants_duration check (
    requested_duration > interval '0' and requested_duration <= app.max_break_glass_duration()
  ),
  constraint platform_access_grants_clinical_needs_patient check (
    scope <> 'clinical_read_break_glass' or patient_id is not null
  ),
  constraint platform_access_grants_support_no_patient check (
    scope <> 'org_support_non_clinical' or patient_id is null
  ),
  constraint platform_access_grants_second_distinct check (
    second_approver_profile_id is null or second_approver_profile_id <> platform_admin_profile_id
  ),
  constraint platform_access_grants_owner_distinct check (
    owner_approved_by_profile_id is null or owner_approved_by_profile_id <> platform_admin_profile_id
  ),
  constraint platform_access_grants_approved_complete check (
    status <> 'approved' or (
      owner_approved_by_profile_id is not null and owner_approved_at is not null
      and second_approver_profile_id is not null and second_approved_at is not null
      and (not psychologist_approval_required or psychologist_approved_at is not null)
      and starts_at is not null and expires_at is not null
    )
  ),
  constraint platform_access_grants_window check (
    expires_at is null or (
      starts_at is not null and expires_at > starts_at
      and expires_at <= starts_at + app.max_break_glass_duration()
    )
  ),
  constraint platform_access_grants_revoked_consistent check (
    (revoked_at is null) = (revoked_by_profile_id is null)
  )
);
create index platform_access_grants_admin_status_idx
  on public.platform_access_grants (platform_admin_profile_id, status, expires_at);
create index platform_access_grants_org_status_idx on public.platform_access_grants (organization_id, status);
create index platform_access_grants_psy_idx
  on public.platform_access_grants (organization_id, psychologist_approved_by_membership_id);
create index platform_access_grants_owner_approver_idx on public.platform_access_grants (owner_approved_by_profile_id);
create index platform_access_grants_second_approver_idx on public.platform_access_grants (second_approver_profile_id);
create index platform_access_grants_revoked_by_idx on public.platform_access_grants (revoked_by_profile_id);
comment on table public.platform_access_grants is
  'ADR-014 grants. Requesters insert pending rows only; activation is done by the database when all approvals are present (workflow functions: Phase 2, currently deny).';
create trigger platform_access_grants_set_updated_at before update on public.platform_access_grants
  for each row execute function app.set_updated_at();

-- =============================================================================
-- RLS helpers (schema app). See SECURITY.md §4.3 for the rules they follow.
-- =============================================================================

create function app.current_profile_id() returns uuid
language sql
stable
set search_path = ''
as $$ select auth.uid() $$;
comment on function app.current_profile_id() is 'auth.uid() of the verified request claims (ADR-019).';

create function app.aal() returns text
language sql
stable
set search_path = ''
as $$ select coalesce((select auth.jwt()) ->> 'aal', 'none') $$;
comment on function app.aal() is 'Authenticator assurance level from verified claims: aal1 | aal2 | none.';

create function app.is_aal2() returns boolean
language sql
stable
set search_path = ''
as $$ select (select app.aal()) = 'aal2' $$;

-- Organization status gate (DATABASE.md §5.1). p_access: staff_read | staff_write | portal.
create function app.org_allows(p_org uuid, p_access text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case p_access
             when 'staff_read' then o.status in ('active', 'read_only')
             when 'staff_write' then o.status = 'active'
             when 'portal' then o.status = 'active'
             else false
           end
    from public.organizations o
    where o.id = p_org
  ), false)
$$;
comment on function app.org_allows(uuid, text) is
  'Org status gate: staff_read (active|read_only), staff_write (active), portal (active). Unknown access -> false.';

create function app.my_membership_id(p_org uuid) returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  where (select app.is_aal2())
    and m.organization_id = p_org
    and m.profile_id = (select auth.uid())
    and m.status = 'active'
    and o.status in ('active', 'read_only')
$$;
comment on function app.my_membership_id(uuid) is 'Caller''s active membership id in org (aal2, org readable), else null.';

create function app.is_org_member(p_org uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.is_aal2()) and exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    where m.organization_id = p_org
      and m.profile_id = (select auth.uid())
      and m.status = 'active'
      and o.status in ('active', 'read_only')
  )
$$;
comment on function app.is_org_member(uuid) is 'aal2 AND active membership AND org active|read_only.';

create function app.has_org_role(p_org uuid, p_role public.membership_role) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.is_aal2()) and exists (
    select 1
    from public.memberships m
    join public.organizations o on o.id = m.organization_id
    join public.membership_roles r on r.organization_id = m.organization_id and r.membership_id = m.id
    where m.organization_id = p_org
      and m.profile_id = (select auth.uid())
      and m.status = 'active'
      and o.status in ('active', 'read_only')
      and r.role = p_role
  )
$$;
comment on function app.has_org_role(uuid, public.membership_role) is 'is_org_member AND role held (read operations).';

create function app.can_write_as_role(p_org uuid, p_role public.membership_role) returns boolean
language sql
stable
set search_path = ''
as $$
  select app.has_org_role(p_org, p_role) and app.org_allows(p_org, 'staff_write')
$$;
comment on function app.can_write_as_role(uuid, public.membership_role) is 'has_org_role AND org active (write operations; read_only orgs deny).';

create function app.is_platform_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.is_aal2()) and exists (
    select 1 from public.platform_admins pa
    where pa.profile_id = (select auth.uid()) and pa.revoked_at is null
  )
$$;
comment on function app.is_platform_admin() is
  'aal2 AND unrevoked platform_admins row. Grants NO clinical, patient or portal access; use only for non-clinical platform tables.';

-- Approved, active, unrevoked grant for the calling platform admin (DB-checked approvals).
create function app.has_active_platform_grant(p_org uuid, p_scope public.grant_scope) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select app.is_platform_admin()) and exists (
    select 1 from public.platform_access_grants g
    where g.organization_id = p_org
      and g.scope = p_scope
      and g.platform_admin_profile_id = (select auth.uid())
      and g.status = 'approved'
      and g.owner_approved_at is not null
      and g.second_approver_profile_id is not null
      and g.second_approver_profile_id <> g.platform_admin_profile_id
      and g.revoked_at is null
      and now() >= g.starts_at and now() < g.expires_at
  )
$$;
comment on function app.has_active_platform_grant(uuid, public.grant_scope) is
  'T2/T3 grant check. T3 clinical reads go through app.can_read_clinical (Phase 3), never this helper.';

-- TODO(Phase 2/3, SECURITY.md §4.4 b-e): app.can_read_clinical, app.can_write_clinical,
-- app.is_patient_self, app.guardian_can, app.is_minor, app.can_read_file. They require the
-- patients/care_team/guardians/file_objects tables and are intentionally NOT stubbed here.

-- Caller's own capacities, independent of aal, so the server can answer MFA_REQUIRED
-- instead of "no organization" for aal1 staff. Returns only the caller's own rows.
create function app.my_capacities()
returns table (
  organization_id uuid,
  acting_as text,
  membership_id uuid,
  membership_status public.membership_status,
  org_status public.org_status,
  roles public.membership_role[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id, 'staff'::text, m.id, m.status, o.status,
         coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}')
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  left join public.membership_roles r on r.organization_id = m.organization_id and r.membership_id = m.id
  where m.profile_id = (select auth.uid()) and m.status <> 'removed'
  group by m.organization_id, m.id, m.status, o.status
  union all
  select null::uuid, 'platform_admin'::text, null::uuid, null::public.membership_status,
         null::public.org_status, '{}'::public.membership_role[]
  from public.platform_admins pa
  where pa.profile_id = (select auth.uid()) and pa.revoked_at is null
$$;
comment on function app.my_capacities() is
  'Caller-only capacity list for AuthzContext (API_CONTRACTS §4). Patient/guardian capacities added in Phase 2.';

-- Co-member directory (DATABASE.md §5.2): display names without exposing profiles rows.
create function app.org_member_directory(p_org uuid)
returns table (
  membership_id uuid,
  profile_id uuid,
  display_name text,
  status public.membership_status,
  roles public.membership_role[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.profile_id, p.display_name, m.status,
         coalesce(array_agg(r.role order by r.role) filter (where r.role is not null), '{}')
  from public.memberships m
  join public.profiles p on p.id = m.profile_id
  left join public.membership_roles r on r.organization_id = m.organization_id and r.membership_id = m.id
  where m.organization_id = p_org
    and m.status <> 'removed'
    and (select app.is_org_member(p_org))
  group by m.id, m.profile_id, p.display_name, m.status
$$;

-- Execute grants: only what policies / the DAL need. Never anon, never public.
revoke all on function app.current_profile_id() from public, anon;
revoke all on function app.aal() from public, anon;
revoke all on function app.is_aal2() from public, anon;
revoke all on function app.org_allows(uuid, text) from public, anon;
revoke all on function app.my_membership_id(uuid) from public, anon;
revoke all on function app.is_org_member(uuid) from public, anon;
revoke all on function app.has_org_role(uuid, public.membership_role) from public, anon;
revoke all on function app.can_write_as_role(uuid, public.membership_role) from public, anon;
revoke all on function app.is_platform_admin() from public, anon;
revoke all on function app.has_active_platform_grant(uuid, public.grant_scope) from public, anon;
revoke all on function app.my_capacities() from public, anon;
revoke all on function app.org_member_directory(uuid) from public, anon;
revoke all on function app.max_break_glass_duration() from public, anon;
grant execute on function app.current_profile_id() to authenticated;
grant execute on function app.aal() to authenticated;
grant execute on function app.is_aal2() to authenticated;
grant execute on function app.org_allows(uuid, text) to authenticated;
grant execute on function app.my_membership_id(uuid) to authenticated;
grant execute on function app.is_org_member(uuid) to authenticated;
grant execute on function app.has_org_role(uuid, public.membership_role) to authenticated;
grant execute on function app.can_write_as_role(uuid, public.membership_role) to authenticated;
grant execute on function app.is_platform_admin() to authenticated;
grant execute on function app.has_active_platform_grant(uuid, public.grant_scope) to authenticated;
grant execute on function app.my_capacities() to authenticated;
grant execute on function app.org_member_directory(uuid) to authenticated;
grant execute on function app.max_break_glass_duration() to authenticated;
revoke all on function app.set_updated_at() from public, anon, authenticated, service_role;
revoke all on function app.reject_mutation() from public, anon, authenticated, service_role;

-- =============================================================================
-- Integrity triggers
-- =============================================================================

-- memberships: tenant/subject never move; removed_at follows status; last active owner stays.
create function app.guard_membership_update() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.organization_id := old.organization_id;
  new.profile_id := old.profile_id;
  new.joined_at := old.joined_at;
  if new.status = 'removed' and old.status <> 'removed' then
    new.removed_at := now();
  elsif new.status <> 'removed' then
    new.removed_at := null;
  end if;
  if old.status = 'active' and new.status <> 'active'
     and exists (select 1 from public.membership_roles r
                 where r.membership_id = old.id and r.role = 'organization_owner')
     and not exists (
       select 1 from public.memberships m
       join public.membership_roles r on r.membership_id = m.id and r.role = 'organization_owner'
       where m.organization_id = old.organization_id and m.status = 'active' and m.id <> old.id)
  then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:last_owner';
  end if;
  return new;
end
$$;
revoke all on function app.guard_membership_update() from public, anon, authenticated, service_role;
create trigger memberships_guard before update on public.memberships
  for each row execute function app.guard_membership_update();

-- membership_roles: grantor from auth.uid(); psychologist requires a professional profile
-- (F-06, DB-enforced); the last active owner role cannot be removed; rows are never updated.
create function app.guard_membership_role() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:membership_roles';
  end if;
  if tg_op = 'INSERT' then
    new.granted_by := coalesce((select auth.uid()), new.granted_by);
    new.granted_at := now();
    if new.role = 'psychologist' and not exists (
      select 1 from public.professional_profiles pp
      where pp.organization_id = new.organization_id and pp.membership_id = new.membership_id
    ) then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:professional_profile_required';
    end if;
    return new;
  end if;
  -- DELETE
  if old.role = 'organization_owner'
     and exists (select 1 from public.memberships m where m.id = old.membership_id and m.status = 'active')
     and not exists (
       select 1 from public.memberships m
       join public.membership_roles r on r.membership_id = m.id and r.role = 'organization_owner'
       where m.organization_id = old.organization_id and m.status = 'active' and m.id <> old.membership_id)
  then
    raise exception using errcode = 'P0001', message = 'PRECONDITION:last_owner';
  end if;
  return old;
end
$$;
revoke all on function app.guard_membership_role() from public, anon, authenticated, service_role;
create trigger membership_roles_guard before insert or update or delete on public.membership_roles
  for each row execute function app.guard_membership_role();

-- professional_profiles: tenant/membership never move.
create function app.guard_professional_profile() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.organization_id := old.organization_id;
  new.membership_id := old.membership_id;
  return new;
end
$$;
revoke all on function app.guard_professional_profile() from public, anon, authenticated, service_role;
create trigger professional_profiles_guard before update on public.professional_profiles
  for each row execute function app.guard_professional_profile();

-- invitations: inviter from auth.uid(); immutable identity columns; allowed transitions only.
create function app.guard_invitation() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      new.invited_by := (select auth.uid());
      new.status := 'pending';
      new.accepted_by_profile_id := null;
      new.accepted_at := null;
      new.revoked_at := null;
    end if;
    return new;
  end if;
  new.organization_id := old.organization_id;
  new.invitation_type := old.invitation_type;
  new.email := old.email;
  new.roles := old.roles;
  new.token_hash := old.token_hash;
  new.invited_by := old.invited_by;
  new.expires_at := old.expires_at;
  if new.status is distinct from old.status then
    if old.status <> 'pending' then
      raise exception using errcode = 'P0001', message = 'PRECONDITION:invitation_not_pending';
    end if;
    if new.status = 'revoked' then
      new.revoked_at := now();
    elsif new.status = 'accepted' then
      new.accepted_at := now();
    end if;
  end if;
  return new;
end
$$;
revoke all on function app.guard_invitation() from public, anon, authenticated, service_role;
create trigger invitations_guard before insert or update on public.invitations
  for each row execute function app.guard_invitation();

-- platform_access_grants: user-context inserts are always pending with no approvals;
-- requester is auth.uid(). Clinical break-glass is unavailable until Phase 3 provides
-- app.can_read_clinical and the approval workflow (fail closed).
create function app.guard_platform_access_grant() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      if new.scope = 'clinical_read_break_glass' then
        raise exception using errcode = 'P0001', message = 'PRECONDITION:break_glass_not_available';
      end if;
      new.platform_admin_profile_id := (select auth.uid());
      new.status := 'pending';
      new.owner_approved_by_profile_id := null;
      new.owner_approved_at := null;
      new.psychologist_approval_required := (new.scope = 'clinical_read_break_glass');
      new.psychologist_approved_by_membership_id := null;
      new.psychologist_approved_at := null;
      new.second_approver_profile_id := null;
      new.second_approved_at := null;
      new.starts_at := null;
      new.expires_at := null;
      new.revoked_at := null;
      new.revoked_by_profile_id := null;
      new.report_sent_at := null;
    end if;
    return new;
  end if;
  -- UPDATE: identity of the request never changes.
  new.organization_id := old.organization_id;
  new.platform_admin_profile_id := old.platform_admin_profile_id;
  new.scope := old.scope;
  new.patient_id := old.patient_id;
  new.object_scope := old.object_scope;
  new.reason := old.reason;
  new.ticket_reference := old.ticket_reference;
  new.requested_duration := old.requested_duration;
  if old.status in ('rejected', 'revoked', 'expired') then
    raise exception using errcode = 'P0001', message = 'IMMUTABLE:platform_access_grants';
  end if;
  return new;
end
$$;
revoke all on function app.guard_platform_access_grant() from public, anon, authenticated, service_role;
create trigger platform_access_grants_guard before insert or update on public.platform_access_grants
  for each row execute function app.guard_platform_access_grant();

-- Break-glass approval workflow (ADR-014 steps 2-4, API_CONTRACTS §8.17).
-- STUBS — they always deny. Implemented with Phase 3 (clinical) together with
-- app.can_read_clinical, notifications and the access report. Not executable by any API role.
create function app.approve_grant_as_owner(p_grant_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'NOT_IMPLEMENTED:break_glass_workflow';
end
$$;
create function app.approve_grant_as_psychologist(p_grant_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'NOT_IMPLEMENTED:break_glass_workflow';
end
$$;
create function app.approve_grant_as_second_admin(p_grant_id uuid) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'NOT_IMPLEMENTED:break_glass_workflow';
end
$$;
create function app.revoke_grant(p_grant_id uuid, p_reason text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = 'P0001', message = 'NOT_IMPLEMENTED:break_glass_workflow';
end
$$;
revoke all on function app.approve_grant_as_owner(uuid) from public, anon, authenticated, service_role;
revoke all on function app.approve_grant_as_psychologist(uuid) from public, anon, authenticated, service_role;
revoke all on function app.approve_grant_as_second_admin(uuid) from public, anon, authenticated, service_role;
revoke all on function app.revoke_grant(uuid, text) from public, anon, authenticated, service_role;

-- =============================================================================
-- RLS: enable + force on every table, then policies.
-- =============================================================================
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.organization_domains enable row level security;
alter table public.organization_domains force row level security;
alter table public.organization_branding enable row level security;
alter table public.organization_branding force row level security;
alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
alter table public.memberships enable row level security;
alter table public.memberships force row level security;
alter table public.membership_roles enable row level security;
alter table public.membership_roles force row level security;
alter table public.professional_profiles enable row level security;
alter table public.professional_profiles force row level security;
alter table public.invitations enable row level security;
alter table public.invitations force row level security;
alter table public.platform_access_grants enable row level security;
alter table public.platform_access_grants force row level security;

-- No privileges for anon (or the unused Data API service_role) on any of these tables.
revoke all on public.profiles, public.organizations, public.organization_domains,
  public.organization_branding, public.platform_admins, public.memberships,
  public.membership_roles, public.professional_profiles, public.invitations,
  public.platform_access_grants
  from public, anon, authenticated, service_role;

-- profiles: self only (co-member names via app.org_member_directory).
grant select on public.profiles to authenticated;
grant update (display_name, locale, time_zone) on public.profiles to authenticated;
create policy profiles_select_self on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- organizations: members read own org; platform admins read metadata; owners update
-- non-critical fields (status changes are platform functions).
grant select on public.organizations to authenticated;
grant update (legal_name, display_name, tax_id, default_locale, time_zone) on public.organizations to authenticated;
create policy organizations_select_member on public.organizations for select to authenticated
  using ((select app.is_org_member(id)));
create policy organizations_select_platform on public.organizations for select to authenticated
  using ((select app.is_platform_admin()));
create policy organizations_update_owner on public.organizations for update to authenticated
  using ((select app.can_write_as_role(id, 'organization_owner')))
  with check ((select app.can_write_as_role(id, 'organization_owner')));

-- organization_domains: owners manage (verification is a system step); platform reads.
grant select on public.organization_domains to authenticated;
grant insert (organization_id, host, domain_type, is_primary) on public.organization_domains to authenticated;
grant update (is_primary) on public.organization_domains to authenticated;
grant delete on public.organization_domains to authenticated;
create policy organization_domains_select_owner on public.organization_domains for select to authenticated
  using ((select app.has_org_role(organization_id, 'organization_owner')));
create policy organization_domains_select_platform on public.organization_domains for select to authenticated
  using ((select app.is_platform_admin()));
create policy organization_domains_insert_owner on public.organization_domains for insert to authenticated
  with check ((select app.can_write_as_role(organization_id, 'organization_owner')) and verified_at is null);
create policy organization_domains_update_owner on public.organization_domains for update to authenticated
  using ((select app.can_write_as_role(organization_id, 'organization_owner')))
  with check ((select app.can_write_as_role(organization_id, 'organization_owner')));
create policy organization_domains_delete_owner on public.organization_domains for delete to authenticated
  using ((select app.can_write_as_role(organization_id, 'organization_owner')));

-- organization_branding: members + platform read; owners update. Pre-auth rendering uses
-- app.get_public_branding (system path).
grant select on public.organization_branding to authenticated;
grant update (display_name, brand_color, functional_color, secondary_color, accent_color,
  child_mode_enabled, logo_file_id, favicon_file_id, portal_welcome_es, portal_welcome_en)
  on public.organization_branding to authenticated;
create policy organization_branding_select_member on public.organization_branding for select to authenticated
  using ((select app.is_org_member(organization_id)));
create policy organization_branding_select_platform on public.organization_branding for select to authenticated
  using ((select app.is_platform_admin()));
create policy organization_branding_update_owner on public.organization_branding for update to authenticated
  using ((select app.can_write_as_role(organization_id, 'organization_owner')))
  with check ((select app.can_write_as_role(organization_id, 'organization_owner')));

-- platform_admins: platform admins only; no writes through the app.
grant select on public.platform_admins to authenticated;
create policy platform_admins_select_platform on public.platform_admins for select to authenticated
  using ((select app.is_platform_admin()));

-- memberships: members read their org; owners change status (last-owner trigger);
-- platform admins only with an approved T2 grant. Inserts only via invitation acceptance.
grant select on public.memberships to authenticated;
grant update (status) on public.memberships to authenticated;
create policy memberships_select_member on public.memberships for select to authenticated
  using ((select app.is_org_member(organization_id)));
create policy memberships_select_platform_grant on public.memberships for select to authenticated
  using ((select app.has_active_platform_grant(organization_id, 'org_support_non_clinical')));
create policy memberships_update_owner on public.memberships for update to authenticated
  using ((select app.can_write_as_role(organization_id, 'organization_owner')))
  with check ((select app.can_write_as_role(organization_id, 'organization_owner')));

-- membership_roles: members read; owners grant/remove (triggers enforce F-06 + last owner).
grant select on public.membership_roles to authenticated;
grant insert (organization_id, membership_id, role) on public.membership_roles to authenticated;
grant delete on public.membership_roles to authenticated;
create policy membership_roles_select_member on public.membership_roles for select to authenticated
  using ((select app.is_org_member(organization_id)));
create policy membership_roles_select_platform_grant on public.membership_roles for select to authenticated
  using ((select app.has_active_platform_grant(organization_id, 'org_support_non_clinical')));
create policy membership_roles_insert_owner on public.membership_roles for insert to authenticated
  with check ((select app.can_write_as_role(organization_id, 'organization_owner')));
create policy membership_roles_delete_owner on public.membership_roles for delete to authenticated
  using ((select app.can_write_as_role(organization_id, 'organization_owner')));

-- professional_profiles: members read; self or owners write.
grant select on public.professional_profiles to authenticated;
grant insert (organization_id, membership_id, professional_title, license_number, license_issuer, specialties)
  on public.professional_profiles to authenticated;
grant update (professional_title, license_number, license_issuer, specialties)
  on public.professional_profiles to authenticated;
create policy professional_profiles_select_member on public.professional_profiles for select to authenticated
  using ((select app.is_org_member(organization_id)));
create policy professional_profiles_insert_self_or_owner on public.professional_profiles for insert to authenticated
  with check (
    (select app.org_allows(organization_id, 'staff_write'))
    and (membership_id = (select app.my_membership_id(organization_id))
         or (select app.has_org_role(organization_id, 'organization_owner')))
  );
create policy professional_profiles_update_self_or_owner on public.professional_profiles for update to authenticated
  using (
    (select app.org_allows(organization_id, 'staff_write'))
    and (membership_id = (select app.my_membership_id(organization_id))
         or (select app.has_org_role(organization_id, 'organization_owner')))
  )
  with check (
    (select app.org_allows(organization_id, 'staff_write'))
    and (membership_id = (select app.my_membership_id(organization_id))
         or (select app.has_org_role(organization_id, 'organization_owner')))
  );

-- invitations: owners create/read/revoke staff invitations; token_hash never readable.
grant select (id, organization_id, invitation_type, email, roles, expires_at, status, invited_by,
  accepted_by_profile_id, accepted_at, revoked_at, created_at, updated_at)
  on public.invitations to authenticated;
grant insert (organization_id, invitation_type, email, roles, token_hash, expires_at)
  on public.invitations to authenticated;
grant update (status) on public.invitations to authenticated;
create policy invitations_select_owner on public.invitations for select to authenticated
  using ((select app.has_org_role(organization_id, 'organization_owner')));
create policy invitations_insert_owner on public.invitations for insert to authenticated
  with check (
    (select app.can_write_as_role(organization_id, 'organization_owner'))
    and invitation_type = 'staff' and status = 'pending'
  );
create policy invitations_revoke_owner on public.invitations for update to authenticated
  using ((select app.can_write_as_role(organization_id, 'organization_owner')) and status = 'pending')
  with check ((select app.can_write_as_role(organization_id, 'organization_owner')) and status = 'revoked');

-- platform_access_grants: platform admins request (pending only) and read; org owners read
-- grants for their org. Approvals/revocation via workflow functions (Phase 3).
grant select on public.platform_access_grants to authenticated;
grant insert (organization_id, scope, patient_id, object_scope, reason, ticket_reference, requested_duration)
  on public.platform_access_grants to authenticated;
create policy platform_access_grants_select_platform on public.platform_access_grants for select to authenticated
  using ((select app.is_platform_admin()));
create policy platform_access_grants_select_owner on public.platform_access_grants for select to authenticated
  using ((select app.has_org_role(organization_id, 'organization_owner')));
create policy platform_access_grants_insert_platform on public.platform_access_grants for insert to authenticated
  with check (
    (select app.is_platform_admin())
    and platform_admin_profile_id = (select auth.uid())
    and status = 'pending'
  );
