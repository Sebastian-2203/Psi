-- =============================================================================
-- FICTIONAL SEED DATA — LOCAL DEVELOPMENT AND TESTS ONLY.
-- Every organization, person, email (@example.test), licence number, password and TOTP
-- secret below is invented. Never put real patient, professional or tenant data here.
-- Mirrors tests/fixtures/personas.ts (ARCHITECTURE §14, Phase 1 personas only).
--
-- Shared fictional credentials (local only):
--   password    : Psi-Local-Fictional-2026
--   TOTP secret : JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP (base32; staff + platform personas)
-- =============================================================================

create function pg_temp.seed_user(p_id uuid, p_email text, p_display_name text, p_with_totp boolean)
returns void
language plpgsql
as $$
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated', p_email,
    extensions.crypt('Psi-Local-Fictional-2026', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('display_name', p_display_name, 'locale', 'es', 'fictional', true),
    now(), now(), '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (
    p_id::text, p_id,
    jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
    'email', now(), now(), now()
  );
  if p_with_totp then
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
    values (gen_random_uuid(), p_id, 'Fictional TOTP', 'totp', 'verified', now(), now(),
            'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- Auth users (profiles are created by the on_auth_user_created trigger)
-- -----------------------------------------------------------------------------
select pg_temp.seed_user('a1000000-0000-4000-8000-000000000001', 'owner.a@example.test', 'Olga Demo (owner A)', true);
select pg_temp.seed_user('a1000000-0000-4000-8000-000000000002', 'owner-psy.a@example.test', 'Paula Demo (owner + psychologist A)', true);
select pg_temp.seed_user('a1000000-0000-4000-8000-000000000003', 'psy.a@example.test', 'Pedro Demo (psychologist A)', true);
select pg_temp.seed_user('a1000000-0000-4000-8000-000000000004', 'psy-nomfa.a@example.test', 'Nora Demo (psychologist A, no MFA yet)', false);
select pg_temp.seed_user('b1000000-0000-4000-8000-000000000001', 'owner.b@example.test', 'Beatriz Demo (owner B)', true);
select pg_temp.seed_user('b1000000-0000-4000-8000-000000000002', 'owner-psy.b@example.test', 'Bruno Demo (owner + psychologist B)', true);
select pg_temp.seed_user('b1000000-0000-4000-8000-000000000003', 'psy.b@example.test', 'Blanca Demo (psychologist B)', true);
select pg_temp.seed_user('f1000000-0000-4000-8000-000000000001', 'platform@example.test', 'Fabio Demo (platform admin)', true);
select pg_temp.seed_user('f1000000-0000-4000-8000-000000000002', 'platform2@example.test', 'Flor Demo (platform admin 2)', true);

-- -----------------------------------------------------------------------------
-- Organizations (fictional practices), verified dev hosts, fictional branding
-- -----------------------------------------------------------------------------
insert into public.organizations (id, slug, legal_name, display_name, tax_id, default_locale, time_zone, status) values
  ('0a000000-0000-4000-8000-000000000001', 'demo-a', 'Consultorio Demo A S.A.S. (FICTIONAL)', 'Consultorio Demo A', '900000001-0', 'es', 'America/Bogota', 'active'),
  ('0b000000-0000-4000-8000-000000000001', 'demo-b', 'Consultorio Demo B S.A.S. (FICTIONAL)', 'Consultorio Demo B', '900000002-0', 'es', 'America/Bogota', 'active');

insert into public.organization_domains (organization_id, host, domain_type, is_primary, verified_at) values
  ('0a000000-0000-4000-8000-000000000001', 'demo-a.localhost', 'subdomain', true, now()),
  ('0b000000-0000-4000-8000-000000000001', 'demo-b.localhost', 'subdomain', true, now()),
  -- Unverified host: must never resolve.
  ('0b000000-0000-4000-8000-000000000001', 'unverified-b.localhost', 'subdomain', false, null);

insert into public.organization_branding (organization_id, display_name, brand_color, functional_color, accent_color, portal_welcome_es, portal_welcome_en) values
  ('0a000000-0000-4000-8000-000000000001', 'Consultorio Demo A', '#2f7d6d', '#1f5c50', '#e0a33b',
   'Bienvenida al portal de Consultorio Demo A (texto ficticio).', 'Welcome to the Consultorio Demo A portal (fictional text).'),
  ('0b000000-0000-4000-8000-000000000001', 'Consultorio Demo B', '#5b4b8a', null, null, null, null);

-- -----------------------------------------------------------------------------
-- Memberships, professional profiles (before the psychologist role), roles
-- -----------------------------------------------------------------------------
insert into public.memberships (id, organization_id, profile_id) values
  ('a2000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001'),
  ('a2000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002'),
  ('a2000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000003'),
  ('a2000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004'),
  ('b2000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001'),
  ('b2000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002'),
  ('b2000000-0000-4000-8000-000000000003', '0b000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000003');

insert into public.professional_profiles (organization_id, membership_id, professional_title, license_number, license_issuer, specialties) values
  ('0a000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'Psicóloga (ficticia)', 'TP-FICT-A-0002', 'Colegio Ficticio de Psicología', '{clinica}'),
  ('0a000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'Psicólogo (ficticio)', 'TP-FICT-A-0003', 'Colegio Ficticio de Psicología', '{infantil}'),
  ('0a000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000004', 'Psicóloga (ficticia)', 'TP-FICT-A-0004', 'Colegio Ficticio de Psicología', '{}'),
  ('0b000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002', 'Psicólogo (ficticio)', 'TP-FICT-B-0002', 'Colegio Ficticio de Psicología', '{clinica}'),
  ('0b000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000003', 'Psicóloga (ficticia)', 'TP-FICT-B-0003', 'Colegio Ficticio de Psicología', '{}');

insert into public.membership_roles (organization_id, membership_id, role, granted_by) values
  ('0a000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001', 'organization_owner', null),
  ('0a000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'organization_owner', null),
  ('0a000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000002', 'psychologist', null),
  ('0a000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'psychologist', 'a1000000-0000-4000-8000-000000000001'),
  ('0a000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000004', 'psychologist', 'a1000000-0000-4000-8000-000000000001'),
  ('0b000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'organization_owner', null),
  ('0b000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002', 'organization_owner', null),
  ('0b000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000002', 'psychologist', null),
  ('0b000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000003', 'psychologist', 'b1000000-0000-4000-8000-000000000001');

-- -----------------------------------------------------------------------------
-- Platform admins (no membership, no clinical access)
-- -----------------------------------------------------------------------------
insert into public.platform_admins (profile_id, granted_by) values
  ('f1000000-0000-4000-8000-000000000001', null),
  ('f1000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001');

-- -----------------------------------------------------------------------------
-- A pending staff invitation in org A. Raw fictional token (local only):
--   fictional-invitation-token-demo-a   -> stored as sha256 only
-- -----------------------------------------------------------------------------
insert into public.invitations (organization_id, invitation_type, email, roles, token_hash, expires_at, invited_by) values
  ('0a000000-0000-4000-8000-000000000001', 'staff', 'new.staff.a@example.test', '{psychologist}',
   extensions.digest('fictional-invitation-token-demo-a', 'sha256'), now() + interval '72 hours',
   'a1000000-0000-4000-8000-000000000001');
