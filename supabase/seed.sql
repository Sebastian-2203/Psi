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
-- Phase 2 portal identities (no MFA: optional for patients/guardians, Q-07)
select pg_temp.seed_user('a9000000-0000-4000-8000-000000000001', 'ana.paciente@example.test', 'Ana Ficticia (adult patient A)', false);
select pg_temp.seed_user('a9000000-0000-4000-8000-000000000002', 'marta.guardiana@example.test', 'Marta Ficticia (guardian A, active)', false);
select pg_temp.seed_user('b9000000-0000-4000-8000-000000000001', 'beto.paciente@example.test', 'Beto Ficticio (adult patient B)', false);
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

insert into public.organization_branding (organization_id, display_name, brand_color, functional_color, secondary_color, accent_color, portal_welcome_es, portal_welcome_en) values
  -- A: the provisional Daniela Ortega brand (BRAND_GUIDELINES, DESIGN_SYSTEM §2.1).
  ('0a000000-0000-4000-8000-000000000001', 'Psicóloga Daniela Ortega', '#d94a43', '#a73c37', null, null,
   'Bienvenida al portal de Consultorio Demo A (texto ficticio).', 'Welcome to the Consultorio Demo A portal (fictional text).'),
  -- B: a clearly different FICTIONAL brand (violet + amber) so cross-tenant theming is visible.
  ('0b000000-0000-4000-8000-000000000001', 'Centro Demo B (ficticio)', '#5b4b8a', null, '#e8c46b', null, null, null);

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

-- =============================================================================
-- Phase 2 — patients, care teams, guardians, consents (ALL FICTIONAL).
-- Runs without user claims (system path): triggers allow importing status / verified state.
-- Dates of birth are relative to the seed date so minors stay minors and the "at majority"
-- patient stays an adult. Jurisdiction CO, age of majority 18 (provisional, Q-04).
-- Raw fictional invitation tokens (local only, stored as sha256):
--   fictional-invitation-token-patient-demo-a   -> patient Luis Ficticio (org A)
--   fictional-invitation-token-guardian-demo-a  -> guardian Elena Ficticia (org A, relationship pending)
-- =============================================================================

insert into public.patients (id, organization_id, profile_id, first_name, last_name, preferred_name, date_of_birth,
                             document_type, document_number, email, preferred_locale, status, created_by) values
  -- A: adult with a portal login
  ('a3000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000001',
   'Ana', 'Ficticia', null, date '1990-05-14', 'cc', 'FICT-1001', 'ana.paciente@example.test', 'es', 'active',
   'a1000000-0000-4000-8000-000000000003'),
  -- A: 10-year-old minor, guardians below
  ('a3000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001', null,
   'Camilo', 'Ficticio', 'Cami', (current_date - interval '10 years')::date, 'ti', 'FICT-1002', null, 'es', 'active',
   'a1000000-0000-4000-8000-000000000003'),
  -- A: turned 18 recently; the guardian relationship is suspended (age_of_majority)
  ('a3000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000001', null,
   'Sara', 'Ficticia', null, (current_date - interval '18 years' - interval '30 days')::date, null, null, null, 'es', 'active',
   'a1000000-0000-4000-8000-000000000002'),
  -- A: adult in intake, portal invitation pending
  ('a3000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000001', null,
   'Luis', 'Ficticio', null, date '1985-11-02', null, null, 'luis.paciente@example.test', 'es', 'intake',
   'a1000000-0000-4000-8000-000000000003'),
  -- A: 14-year-old minor in intake whose guardian invitation is pending (relationship unverified)
  ('a3000000-0000-4000-8000-000000000005', '0a000000-0000-4000-8000-000000000001', null,
   'Mateo', 'Ficticio', null, (current_date - interval '14 years')::date, null, null, null, 'es', 'intake',
   'a1000000-0000-4000-8000-000000000003'),
  -- B: adult with a portal login, and a minor
  ('b3000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', 'b9000000-0000-4000-8000-000000000001',
   'Beto', 'Ficticio', null, date '1992-03-20', 'cc', 'FICT-2001', 'beto.paciente@example.test', 'es', 'active',
   'b1000000-0000-4000-8000-000000000003'),
  ('b3000000-0000-4000-8000-000000000002', '0b000000-0000-4000-8000-000000000001', null,
   'Bianca', 'Ficticia', null, (current_date - interval '9 years')::date, null, null, null, 'es', 'intake',
   'b1000000-0000-4000-8000-000000000003');

insert into public.care_team_members (organization_id, patient_id, membership_id, care_role, assigned_by) values
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', 'primary', 'a1000000-0000-4000-8000-000000000003'),
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000003', 'primary', 'a1000000-0000-4000-8000-000000000003'),
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'a2000000-0000-4000-8000-000000000002', 'primary', 'a1000000-0000-4000-8000-000000000002'),
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000003', 'primary', 'a1000000-0000-4000-8000-000000000003'),
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000005', 'a2000000-0000-4000-8000-000000000003', 'primary', 'a1000000-0000-4000-8000-000000000003'),
  ('0b000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000003', 'primary', 'b1000000-0000-4000-8000-000000000003'),
  ('0b000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000003', 'primary', 'b1000000-0000-4000-8000-000000000003');

insert into public.patient_preferences (organization_id, patient_id, portal_mode, locale) values
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'adult', 'es'),
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002', 'child', 'es'),
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003', 'adult', 'es'),
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000004', 'adult', 'es'),
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000005', 'adolescent', 'es'),
  ('0b000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001', 'adult', 'es'),
  ('0b000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000002', 'child', 'es');

-- Guardians: Marta (login, active, verified legal representative of Camilo), Jorge (REVOKED),
-- Rosa (relationship suspended at majority), Elena (no login yet, pending), Berta (org B).
insert into public.guardians (id, organization_id, profile_id, first_name, last_name, email, created_by) values
  ('a4000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'a9000000-0000-4000-8000-000000000002', 'Marta', 'Ficticia', 'marta.guardiana@example.test', 'a1000000-0000-4000-8000-000000000003'),
  ('a4000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001', null, 'Jorge', 'Ficticio', 'jorge.guardian@example.test', 'a1000000-0000-4000-8000-000000000003'),
  ('a4000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000001', null, 'Rosa', 'Ficticia', null, 'a1000000-0000-4000-8000-000000000002'),
  ('a4000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000001', null, 'Elena', 'Ficticia', 'elena.guardiana@example.test', 'a1000000-0000-4000-8000-000000000003'),
  ('b4000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', null, 'Berta', 'Ficticia', null, 'b1000000-0000-4000-8000-000000000003');

insert into public.patient_guardians (id, organization_id, patient_id, guardian_id, relationship, is_legal_representative,
    legal_basis, legal_basis_verified_at, legal_basis_verified_by_membership_id, is_primary_contact, status,
    suspension_reason, verified_by, verified_at, verification_note, revoked_by, revoked_at, revoke_reason, created_by) values
  ('a5000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002',
   'a4000000-0000-4000-8000-000000000001', 'mother', true, 'parental_authority', now(), 'a2000000-0000-4000-8000-000000000003',
   true, 'active', null, 'a1000000-0000-4000-8000-000000000003', now(), 'Verificación ficticia', null, null, null,
   'a1000000-0000-4000-8000-000000000003'),
  ('a5000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000002',
   'a4000000-0000-4000-8000-000000000002', 'father', false, null, null, null,
   false, 'revoked', null, 'a1000000-0000-4000-8000-000000000003', now() - interval '20 days', 'Verificación ficticia',
   'a1000000-0000-4000-8000-000000000003', now() - interval '2 days', 'Revocada en la siembra ficticia',
   'a1000000-0000-4000-8000-000000000003'),
  ('a5000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000003',
   'a4000000-0000-4000-8000-000000000003', 'mother', true, 'parental_authority', now() - interval '60 days', 'a2000000-0000-4000-8000-000000000002',
   true, 'suspended', 'age_of_majority', 'a1000000-0000-4000-8000-000000000002', now() - interval '60 days', 'Verificación ficticia',
   null, null, null, 'a1000000-0000-4000-8000-000000000002'),
  ('a5000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000005',
   'a4000000-0000-4000-8000-000000000004', 'legal_guardian', true, 'legal_guardianship', null, null,
   true, 'pending_verification', null, null, null, null, null, null, null, 'a1000000-0000-4000-8000-000000000003'),
  ('b5000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000002',
   'b4000000-0000-4000-8000-000000000001', 'mother', false, null, null, null,
   true, 'pending_verification', null, null, null, null, null, null, null, 'b1000000-0000-4000-8000-000000000003');

insert into public.patient_guardian_permissions (organization_id, patient_guardian_id, permission, granted_by) values
  ('0a000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'sign_consents', 'a1000000-0000-4000-8000-000000000003'),
  ('0a000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'view_assignments', 'a1000000-0000-4000-8000-000000000003'),
  ('0a000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'complete_assignments', 'a1000000-0000-4000-8000-000000000003');

-- Pending portal invitations (patient Luis; guardian Elena)
insert into public.invitations (organization_id, invitation_type, email, token_hash, expires_at, invited_by,
                                patient_id, guardian_id, patient_guardian_id) values
  ('0a000000-0000-4000-8000-000000000001', 'patient', 'luis.paciente@example.test',
   extensions.digest('fictional-invitation-token-patient-demo-a', 'sha256'), now() + interval '7 days',
   'a1000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000004', null, null),
  ('0a000000-0000-4000-8000-000000000001', 'guardian', 'elena.guardiana@example.test',
   extensions.digest('fictional-invitation-token-guardian-demo-a', 'sha256'), now() + interval '7 days',
   'a1000000-0000-4000-8000-000000000003', null, 'a4000000-0000-4000-8000-000000000004', 'a5000000-0000-4000-8000-000000000004');

-- Consent template "tratamiento" (org A) with TWO versions: v1 (retired) and v2 (published).
-- Bodies are PLACEHOLDERS, not legal text [NEEDS LEGAL VERIFICATION].
insert into public.consent_templates (id, organization_id, key, consent_type, title, signer_requirement,
    applies_to_minors, applies_to_adults, required_for_activation, status, created_by) values
  ('a6000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'tratamiento',
   'treatment_informed_consent', 'Consentimiento informado (texto ficticio)', 'patient_and_guardian',
   true, true, true, 'draft', 'a1000000-0000-4000-8000-000000000001');
insert into public.consent_template_versions (id, organization_id, consent_template_id, locale, title, body, status,
    published_by, created_by) values
  ('a7000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001',
   'es', 'Consentimiento informado (texto ficticio) v1',
   '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"[TEXTO FICTICIO, NO LEGAL] Versión 1 del consentimiento de prueba."}]}]}',
   'published', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001');
update public.consent_templates set status = 'published' where id = 'a6000000-0000-4000-8000-000000000001';

-- Records on v1: the guardian of Camilo accepted (later withdrawn); Ana accepted.
insert into public.consent_records (id, organization_id, patient_id, consent_template_id, consent_template_version_id,
    consent_type, signer_type, signer_profile_id, signer_guardian_id, patient_guardian_id, recorded_by_profile_id,
    decision, method, locale, text_hash, accepted_at)
select r.id, '0a000000-0000-4000-8000-000000000001', r.patient, 'a6000000-0000-4000-8000-000000000001',
       'a7000000-0000-4000-8000-000000000001', 'treatment_informed_consent', r.signer::public.signer_type,
       r.profile, r.guardian, r.link, r.profile, 'accepted', 'portal_typed_name', 'es', v.body_hash, now() - interval '5 days'
from (values
  ('a8000000-0000-4000-8000-000000000001'::uuid, 'a3000000-0000-4000-8000-000000000002'::uuid, 'guardian',
   'a9000000-0000-4000-8000-000000000002'::uuid, 'a4000000-0000-4000-8000-000000000001'::uuid, 'a5000000-0000-4000-8000-000000000001'::uuid),
  ('a8000000-0000-4000-8000-000000000002'::uuid, 'a3000000-0000-4000-8000-000000000001'::uuid, 'patient',
   'a9000000-0000-4000-8000-000000000001'::uuid, null::uuid, null::uuid)
) as r(id, patient, signer, profile, guardian, link)
cross join public.consent_template_versions v where v.id = 'a7000000-0000-4000-8000-000000000001';
insert into public.consent_record_evidence (organization_id, consent_record_id, typed_name, checkbox_confirmed, ip_address, user_agent) values
  ('0a000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000001', 'Marta Ficticia', true, '203.0.113.10', 'FictionalBrowser/1.0'),
  ('0a000000-0000-4000-8000-000000000001', 'a8000000-0000-4000-8000-000000000002', 'Ana Ficticia', true, '203.0.113.11', 'FictionalBrowser/1.0');
update public.consent_records set withdrawn_at = now(), withdrawn_by_profile_id = 'a9000000-0000-4000-8000-000000000002',
    withdrawal_reason = 'Retiro ficticio de prueba'
  where id = 'a8000000-0000-4000-8000-000000000001';

-- v1 retired, v2 published (same template).
update public.consent_template_versions set status = 'retired' where id = 'a7000000-0000-4000-8000-000000000001';
insert into public.consent_template_versions (id, organization_id, consent_template_id, locale, title, body, status,
    published_by, created_by) values
  ('a7000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001',
   'es', 'Consentimiento informado (texto ficticio) v2',
   '{"version":1,"blocks":[{"type":"heading","level":2,"children":[{"type":"text","text":"Consentimiento de prueba"}]},{"type":"paragraph","children":[{"type":"text","text":"[TEXTO FICTICIO, NO LEGAL] Versión 2 del consentimiento de prueba."}]}]}',
   'published', 'a1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001');

-- =============================================================================
-- Phase 3 — clinical (ALL FICTIONAL). Configuration rows are GENERIC EXAMPLES only:
-- section list, wording and note formats are [NEEDS PSYCHOLOGIST INPUT] (CLR-02/03, NOTE-01).
-- Clinical rows are written AS the psychologist (a1..03, aal2) so every trigger / RLS rule
-- applies exactly as in production. No clinical content below is real or clinically meaningful.
-- =============================================================================
insert into public.clinical_section_definitions (id, organization_id, key, title, description, audience, is_required, position) values
  ('a6000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'consultation_reason', 'Motivo de consulta', 'Ejemplo genérico [NEEDS PSYCHOLOGIST INPUT]', 'any', true, 10),
  ('a6000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001', 'current_situation', 'Situación actual', 'Ejemplo genérico [NEEDS PSYCHOLOGIST INPUT]', 'any', false, 20),
  ('a6000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000001', 'personal_history', 'Historia personal', 'Ejemplo genérico [NEEDS PSYCHOLOGIST INPUT]', 'any', false, 30),
  ('a6000000-0000-4000-8000-000000000004', '0a000000-0000-4000-8000-000000000001', 'family_history', 'Historia familiar', 'Ejemplo genérico [NEEDS PSYCHOLOGIST INPUT]', 'any', false, 40),
  ('a6000000-0000-4000-8000-000000000005', '0a000000-0000-4000-8000-000000000001', 'developmental_history', 'Historia del desarrollo', 'Solo menores. Ejemplo genérico [NEEDS PSYCHOLOGIST INPUT]', 'minor', false, 50),
  ('a6000000-0000-4000-8000-000000000006', '0a000000-0000-4000-8000-000000000001', 'school_history', 'Historia escolar', 'Solo menores. Ejemplo genérico [NEEDS PSYCHOLOGIST INPUT]', 'minor', false, 60),
  ('b6000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', 'consultation_reason', 'Motivo de consulta', 'Ejemplo genérico [NEEDS PSYCHOLOGIST INPUT]', 'any', true, 10);

insert into public.clinical_note_types (id, organization_id, key, label, description, position) values
  ('a5000000-0000-4000-8000-000000000001', '0a000000-0000-4000-8000-000000000001', 'free_text', 'Texto libre', 'Ejemplo genérico [NEEDS PSYCHOLOGIST INPUT]', 10),
  ('a5000000-0000-4000-8000-000000000002', '0a000000-0000-4000-8000-000000000001', 'soap', 'SOAP', 'Ejemplo genérico [NEEDS PSYCHOLOGIST INPUT]', 20),
  ('a5000000-0000-4000-8000-000000000003', '0a000000-0000-4000-8000-000000000001', 'dap', 'DAP', 'Ejemplo genérico [NEEDS PSYCHOLOGIST INPUT]', 30),
  ('b5000000-0000-4000-8000-000000000001', '0b000000-0000-4000-8000-000000000001', 'free_text', 'Texto libre', 'Ejemplo genérico [NEEDS PSYCHOLOGIST INPUT]', 10);

-- Act as psychologist Pablo (a1..03, membership a2..03) for the clinical rows of Ana (a3..01).
select set_config('request.jwt.claims',
  '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}', false);
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000003', false);
set role authenticated;

insert into public.clinical_records (organization_id, patient_id, opened_by_membership_id) values
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003');

insert into public.clinical_record_sections (organization_id, clinical_record_id, patient_id, section_definition_id, content, last_edited_by_membership_id)
select '0a000000-0000-4000-8000-000000000001', (select id from public.clinical_records where patient_id = 'a3000000-0000-4000-8000-000000000001'), 'a3000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001',
  '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Texto de ejemplo ficticio (motivo de consulta)."}]}]}', 'a2000000-0000-4000-8000-000000000003';

insert into public.therapy_sessions (organization_id, patient_id, psychologist_membership_id, scheduled_start, scheduled_end, status, modality) values
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', date_trunc('hour', now()) - interval '7 days', date_trunc('hour', now()) - interval '7 days' + interval '50 minutes', 'held', 'in_person'),
  ('0a000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000003', date_trunc('hour', now()) + interval '7 days', date_trunc('hour', now()) + interval '7 days' + interval '50 minutes', 'scheduled', 'remote_external');

insert into public.clinical_notes (organization_id, clinical_record_id, patient_id, therapy_session_id, note_type_id, body, author_membership_id)
select '0a000000-0000-4000-8000-000000000001', (select id from public.clinical_records where patient_id = 'a3000000-0000-4000-8000-000000000001'), 'a3000000-0000-4000-8000-000000000001', (select id from public.therapy_sessions where patient_id = 'a3000000-0000-4000-8000-000000000001' and status = 'held'),
  'a5000000-0000-4000-8000-000000000001',
  '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Nota de ejemplo ficticia, finalizada."}]}]}', 'a2000000-0000-4000-8000-000000000003';
select * from app.finalize_clinical_note('0a000000-0000-4000-8000-000000000001', (select id from public.clinical_notes where patient_id = 'a3000000-0000-4000-8000-000000000001'), 'seed');
insert into public.clinical_notes (organization_id, clinical_record_id, patient_id, note_type_id, body, author_membership_id)
select '0a000000-0000-4000-8000-000000000001', (select id from public.clinical_records where patient_id = 'a3000000-0000-4000-8000-000000000001'), 'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000002',
  '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Borrador ficticio."}]}]}', 'a2000000-0000-4000-8000-000000000003';
insert into public.clinical_note_addenda (organization_id, clinical_note_id, patient_id, reason, body, author_membership_id, content_hash)
select '0a000000-0000-4000-8000-000000000001', (select id from public.clinical_notes where patient_id = 'a3000000-0000-4000-8000-000000000001' and status = 'finalized'), 'a3000000-0000-4000-8000-000000000001', 'clarification',
  '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Adenda ficticia de aclaración."}]}]}', 'a2000000-0000-4000-8000-000000000003', '\x00';

insert into public.clinical_diagnoses (organization_id, clinical_record_id, patient_id, code_system, code, label, status, diagnosed_on, recorded_by_membership_id)
select '0a000000-0000-4000-8000-000000000001', (select id from public.clinical_records where patient_id = 'a3000000-0000-4000-8000-000000000001'), 'a3000000-0000-4000-8000-000000000001', 'other', null, 'Impresión de ejemplo ficticia (no es un diagnóstico)', 'provisional', current_date - 7, 'a2000000-0000-4000-8000-000000000003';

insert into public.treatment_plans (organization_id, clinical_record_id, patient_id, version, summary, frequency, start_date, author_membership_id)
select '0a000000-0000-4000-8000-000000000001', (select id from public.clinical_records where patient_id = 'a3000000-0000-4000-8000-000000000001'), 'a3000000-0000-4000-8000-000000000001', 1,
  '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Resumen de plan ficticio."}]}]}', 'Semanal (ejemplo)', current_date - 7, 'a2000000-0000-4000-8000-000000000003';
insert into public.treatment_goals (organization_id, treatment_plan_id, patient_id, position, description)
select '0a000000-0000-4000-8000-000000000001', (select id from public.treatment_plans where patient_id = 'a3000000-0000-4000-8000-000000000001'), 'a3000000-0000-4000-8000-000000000001', 1,
  '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Redacción clínica ficticia del objetivo."}]}]}';
insert into public.treatment_goal_patient_texts (organization_id, treatment_goal_id, patient_id, patient_facing_text, author_membership_id)
select '0a000000-0000-4000-8000-000000000001', (select id from public.treatment_goals where patient_id = 'a3000000-0000-4000-8000-000000000001'), 'a3000000-0000-4000-8000-000000000001',
  '{"version":1,"blocks":[{"type":"paragraph","children":[{"type":"text","text":"Mi objetivo de ejemplo."}]}]}', 'a2000000-0000-4000-8000-000000000003';
update public.treatment_plans set status = 'active' where patient_id = 'a3000000-0000-4000-8000-000000000001';

reset role;
select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claim.sub', '', false);
