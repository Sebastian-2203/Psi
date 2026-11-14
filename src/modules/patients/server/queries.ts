import 'server-only';
import { recordAudit } from '@/server/audit';
import { requirePermission, type AuthzContext } from '@/server/authz';
import { withUserTransaction } from '@/server/db/server';
import { env } from '@/server/env';
import { failure, ok, type Outcome } from '@/server/errors';

/**
 * Patient reads. DTOs are explicit column lists (never `select *`), camelCase, dates as text.
 * Row scope comes from RLS (care team / the patient herself); the directory is a definer
 * projection (name + status only, Q-03) for staff who are not on the care team.
 */

export type PatientStatus = 'intake' | 'active' | 'paused' | 'discharged' | 'archived';

export type DirectoryEntry = {
  patientId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  status: PatientStatus;
  onMyCareTeam: boolean;
};

/** Escapes LIKE wildcards so a search term is always a literal substring (PAT-04). */
function likePattern(search: string | undefined): string | null {
  const term = search?.trim();
  if (!term) return null;
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * `patient.directory_viewed` is audited with the result count only (never the search term).
 * The optional search matches NAME only: directory-only rows (Q-03) expose no identifiers, so a
 * document number can never reveal that such a patient exists.
 */
export async function listDirectory(
  ctx: AuthzContext,
  filters: { search?: string } = {},
): Promise<Outcome<DirectoryEntry[]>> {
  const permitted = await requirePermission(ctx, 'patient.directory.read');
  if (!permitted.ok) return permitted;
  const pattern = likePattern(filters.search);
  const rows = await withUserTransaction(ctx.claims, async (tx) => {
    const found = await tx<
      {
        patient_id: string;
        first_name: string;
        last_name: string;
        preferred_name: string | null;
        status: PatientStatus;
        on_my_care_team: boolean;
      }[]
    >`select patient_id, first_name, last_name, preferred_name, status::text as status, on_my_care_team
      from app.patient_directory(${ctx.organizationId}::uuid)
      where (${pattern}::text is null
             or (first_name || ' ' || last_name || ' ' || coalesce(preferred_name, '')) ilike ${pattern})
      order by last_name, first_name`;
    await recordAudit(
      tx,
      'patient.directory_viewed',
      { result_count: found.length },
      { organizationId: ctx.organizationId, requestId: ctx.requestId },
    );
    return found;
  });
  return ok(
    rows.map((r) => ({
      patientId: r.patient_id,
      firstName: r.first_name,
      lastName: r.last_name,
      preferredName: r.preferred_name,
      status: r.status,
      onMyCareTeam: r.on_my_care_team,
    })),
  );
}

export type PatientSummary = {
  patientId: string;
  firstName: string;
  lastName: string;
  preferredName: string | null;
  status: PatientStatus;
  isMinor: boolean | null;
  updatedAt: string;
  /** PAT-06: days until the age of majority when inside the notice window, else null. */
  majorityInDays: number | null;
};

/**
 * `search` (PAT-04) matches name, preferred name or document number as a literal substring over
 * the rows RLS lets the caller read (the care team's). The term is never audited or logged.
 */
export async function listMyPatients(
  ctx: AuthzContext,
  filters: { status?: PatientStatus; search?: string; limit?: number; offset?: number } = {},
): Promise<Outcome<PatientSummary[]>> {
  const permitted = await requirePermission(ctx, 'patient.read');
  if (!permitted.ok) return permitted;
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const pattern = likePattern(filters.search);
  const noticeDays = env.MAJORITY_NOTICE_DAYS;
  const rows = await withUserTransaction(ctx.claims, async (tx) => {
    const found = await tx<
      {
        id: string;
        first_name: string;
        last_name: string;
        preferred_name: string | null;
        status: PatientStatus;
        is_minor: boolean | null;
        updated_at: string;
        majority_in_days: number | null;
      }[]
    >`select p.id, p.first_name, p.last_name, p.preferred_name, p.status::text as status,
             app.patient_is_minor(p.organization_id, p.id) as is_minor, p.updated_at::text as updated_at,
             app.majority_in_days(p.date_of_birth, o.country_code, ${noticeDays}::int) as majority_in_days
      from public.patients p join public.organizations o on o.id = p.organization_id
      where p.organization_id = ${ctx.organizationId}
        and (${filters.status ?? null}::public.patient_status is null or p.status = ${filters.status ?? null}::public.patient_status)
        and (${pattern}::text is null
             or (p.first_name || ' ' || p.last_name || ' ' || coalesce(p.preferred_name, '')) ilike ${pattern}
             or p.document_number ilike ${pattern})
      order by p.last_name, p.first_name
      limit ${limit} offset ${offset}`;
    await recordAudit(
      tx,
      'patient.list_viewed',
      { result_count: found.length },
      { organizationId: ctx.organizationId, requestId: ctx.requestId },
    );
    return found;
  });
  return ok(
    rows.map((r) => ({
      patientId: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      preferredName: r.preferred_name,
      status: r.status,
      isMinor: r.is_minor,
      updatedAt: r.updated_at,
      majorityInDays: r.majority_in_days,
    })),
  );
}

/** PAT-04 on the patient list: care-team rows + directory-only rows, both searched server-side. */
export async function searchPatients(
  ctx: AuthzContext,
  input: { search?: string },
): Promise<Outcome<{ mine: PatientSummary[]; directory: DirectoryEntry[] }>> {
  const [mine, directory] = await Promise.all([
    listMyPatients(ctx, { search: input.search, limit: 100 }),
    listDirectory(ctx, { search: input.search }),
  ]);
  // An owner without the psychologist role has no "my patients" (FORBIDDEN) but keeps the directory.
  if (!mine.ok && mine.error.code !== 'FORBIDDEN') return mine;
  if (!directory.ok) return directory;
  return ok({ mine: mine.ok ? mine.data : [], directory: directory.data });
}

export type MajorityNoticeEntry = {
  patientId: string;
  firstName: string;
  lastName: string;
  majorityDate: string;
  daysLeft: number;
};

/**
 * PAT-06: minors of the caller's care team turning 18 inside the notice window
 * (`MAJORITY_NOTICE_DAYS`, default 60). RLS-bound: care team only. A task prompt, not a decision:
 * the psychologist reviews consent and guardian access deliberately [NEEDS LEGAL VERIFICATION].
 */
export async function listUpcomingMajority(
  ctx: AuthzContext,
): Promise<Outcome<{ windowDays: number; entries: MajorityNoticeEntry[] }>> {
  const permitted = await requirePermission(ctx, 'patient.read');
  if (!permitted.ok) return permitted;
  const windowDays = env.MAJORITY_NOTICE_DAYS;
  const rows = await withUserTransaction(ctx.claims, async (tx) => {
    const found = await tx<
      {
        id: string;
        first_name: string;
        last_name: string;
        majority_date: string;
        days_left: number;
      }[]
    >`select p.id, p.first_name, p.last_name,
             app.majority_date(p.date_of_birth, o.country_code)::text as majority_date,
             app.majority_in_days(p.date_of_birth, o.country_code, ${windowDays}::int) as days_left
      from public.patients p join public.organizations o on o.id = p.organization_id
      where p.organization_id = ${ctx.organizationId}
        and p.status in ('intake', 'active', 'paused')
        and app.majority_in_days(p.date_of_birth, o.country_code, ${windowDays}::int) is not null
      order by days_left, p.last_name, p.first_name
      limit 100`;
    await recordAudit(
      tx,
      'patient.list_viewed',
      { result_count: found.length },
      { organizationId: ctx.organizationId as string, requestId: ctx.requestId },
    );
    return found;
  });
  return ok({
    windowDays,
    entries: rows.map((r) => ({
      patientId: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      majorityDate: r.majority_date,
      daysLeft: r.days_left,
    })),
  });
}

export type PatientDetail = PatientSummary & {
  dateOfBirth: string;
  /** Date the patient reaches the age of majority (null = jurisdiction not configured). */
  majorityDate: string | null;
  pronouns: string | null;
  documentType: string | null;
  documentNumber: string | null;
  email: string | null;
  phone: string | null;
  sex: string | null;
  genderIdentity: string | null;
  preferredLocale: 'es' | 'en' | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  hasPortalLogin: boolean;
  preferences: {
    portalMode: 'child' | 'adolescent' | 'adult';
    locale: 'es' | 'en' | null;
    notifyEmail: boolean;
    textSize: number;
    reducedMotion: boolean;
    audioInstructions: boolean;
  } | null;
  careTeam: Array<{
    careTeamMemberId: string;
    membershipId: string;
    /** Staff display name (app.org_member_directory); null when the membership is no longer listed. */
    displayName: string | null;
    careRole: 'primary' | 'secondary' | 'supervisor';
    startsAt: string;
  }>;
  /** Machine keys of what blocks activation (`app.patient_activation_missing`). */
  activationMissing: string[];
};

/** Care-team detail. Audited as `patient.viewed`. Off the care team = NOT_FOUND. */
export async function getPatient(
  ctx: AuthzContext,
  patientId: string,
): Promise<Outcome<PatientDetail>> {
  const permitted = await requirePermission(ctx, 'patient.read');
  if (!permitted.ok) return permitted;
  const result = await withUserTransaction(ctx.claims, async (tx) => {
    const [p] = await tx<
      {
        id: string;
        first_name: string;
        last_name: string;
        preferred_name: string | null;
        pronouns: string | null;
        date_of_birth: string;
        majority_date: string | null;
        document_type: string | null;
        document_number: string | null;
        email: string | null;
        phone: string | null;
        sex: string | null;
        gender_identity: string | null;
        preferred_locale: 'es' | 'en' | null;
        emergency_contact_name: string | null;
        emergency_contact_phone: string | null;
        status: PatientStatus;
        has_login: boolean;
        is_minor: boolean | null;
        updated_at: string;
        majority_in_days: number | null;
      }[]
    >`select p.id, p.first_name, p.last_name, p.preferred_name, p.pronouns, p.date_of_birth::text as date_of_birth,
             app.majority_date(p.date_of_birth, o.country_code)::text as majority_date,
             p.document_type::text as document_type, p.document_number, p.email::text as email, p.phone, p.sex,
             p.gender_identity, p.preferred_locale, p.emergency_contact_name, p.emergency_contact_phone,
             p.status::text as status, (p.profile_id is not null) as has_login,
             app.patient_is_minor(p.organization_id, p.id) as is_minor, p.updated_at::text as updated_at,
             app.majority_in_days(p.date_of_birth, o.country_code, ${env.MAJORITY_NOTICE_DAYS}::int) as majority_in_days
      from public.patients p join public.organizations o on o.id = p.organization_id
      where p.organization_id = ${ctx.organizationId} and p.id = ${patientId}`;
    if (!p) return null;
    const [prefs] = await tx<
      {
        portal_mode: 'child' | 'adolescent' | 'adult';
        locale: 'es' | 'en' | null;
        notify_email: boolean;
        text_size: number;
        reduced_motion: boolean;
        audio_instructions: boolean;
      }[]
    >`select portal_mode::text as portal_mode, locale, notify_email, text_size::int as text_size,
             reduced_motion, audio_instructions
      from public.patient_preferences where organization_id = ${ctx.organizationId} and patient_id = ${patientId}`;
    const team = await tx<
      {
        id: string;
        membership_id: string;
        display_name: string | null;
        care_role: 'primary' | 'secondary' | 'supervisor';
        starts_at: Date;
      }[]
    >`select c.id, c.membership_id, d.display_name, c.care_role::text as care_role, c.starts_at
      from public.care_team_members c
      left join app.org_member_directory(${ctx.organizationId}::uuid) d on d.membership_id = c.membership_id
      where c.organization_id = ${ctx.organizationId} and c.patient_id = ${patientId} and c.ends_at is null
      order by c.starts_at`;
    const [missing] = await tx<{ m: string[] | null }[]>`
      select app.patient_activation_missing(${ctx.organizationId}::uuid, ${patientId}::uuid) as m`;
    await recordAudit(
      tx,
      'patient.viewed',
      { patient_id: patientId },
      {
        organizationId: ctx.organizationId as string,
        resourceType: 'patient',
        resourceId: patientId,
        requestId: ctx.requestId,
      },
    );
    return { p, prefs, team, missing: missing?.m ?? [] };
  });
  if (!result) return failure('NOT_FOUND');
  const { p, prefs, team, missing } = result;
  return ok({
    patientId: p.id,
    firstName: p.first_name,
    lastName: p.last_name,
    preferredName: p.preferred_name,
    status: p.status,
    isMinor: p.is_minor,
    updatedAt: p.updated_at,
    majorityInDays: p.majority_in_days,
    dateOfBirth: p.date_of_birth,
    majorityDate: p.majority_date,
    pronouns: p.pronouns,
    documentType: p.document_type,
    documentNumber: p.document_number,
    email: p.email,
    phone: p.phone,
    sex: p.sex,
    genderIdentity: p.gender_identity,
    preferredLocale: p.preferred_locale,
    emergencyContactName: p.emergency_contact_name,
    emergencyContactPhone: p.emergency_contact_phone,
    hasPortalLogin: p.has_login,
    preferences: prefs
      ? {
          portalMode: prefs.portal_mode,
          locale: prefs.locale,
          notifyEmail: prefs.notify_email,
          textSize: prefs.text_size,
          reducedMotion: prefs.reduced_motion,
          audioInstructions: prefs.audio_instructions,
        }
      : null,
    careTeam: team.map((t) => ({
      careTeamMemberId: t.id,
      membershipId: t.membership_id,
      displayName: t.display_name?.trim() ? t.display_name : null,
      careRole: t.care_role,
      startsAt: t.starts_at.toISOString(),
    })),
    activationMissing: missing,
  });
}

export type PrivacyViewEntry = {
  patientGuardianId: string;
  guardianFirstName: string;
  relationship: string;
  permissions: string[];
};

/** GRD-07: what each ACTIVE guardian can see of the patient (live permissions). Patient only. */
export async function getPrivacyView(ctx: AuthzContext): Promise<Outcome<PrivacyViewEntry[]>> {
  const permitted = await requirePermission(ctx, 'portal.privacy.read');
  if (!permitted.ok) return permitted;
  const patientId = ctx.patientId;
  if (!patientId) return failure('FORBIDDEN');
  const rows = await withUserTransaction(
    ctx.claims,
    (tx) => tx<
      {
        patient_guardian_id: string;
        guardian_first_name: string;
        relationship: string;
        permissions: string[];
      }[]
    >`select patient_guardian_id, guardian_first_name, relationship::text as relationship,
             permissions::text[] as permissions
      from app.patient_privacy_view(${ctx.organizationId}::uuid, ${patientId}::uuid)
      order by guardian_first_name`,
  );
  return ok(
    rows.map((r) => ({
      patientGuardianId: r.patient_guardian_id,
      guardianFirstName: r.guardian_first_name,
      relationship: r.relationship,
      permissions: r.permissions,
    })),
  );
}

export type PortalMode = 'child' | 'adolescent' | 'adult';

/**
 * Portal experience mode of the patient the caller acts for (patient: herself; guardian: the
 * given patient, which must be an ACTIVE relationship). Stored mode, else the age default;
 * enforced by `app.my_portal_mode` (null for anyone else -> NOT_FOUND).
 */
export async function getMyPortalMode(
  ctx: AuthzContext,
  patientId?: string,
): Promise<Outcome<PortalMode>> {
  const permitted = await requirePermission(ctx, 'portal.mode.read');
  if (!permitted.ok) return permitted;
  const target = ctx.actingAs === 'patient' ? ctx.patientId : patientId;
  if (!target || (ctx.actingAs === 'patient' && patientId && patientId !== target)) {
    return failure('NOT_FOUND');
  }
  const [row] = await withUserTransaction(
    ctx.claims,
    (tx) => tx<{ mode: PortalMode | null }[]>`
      select app.my_portal_mode(${ctx.organizationId}::uuid, ${target}::uuid)::text as mode`,
  );
  return row?.mode ? ok(row.mode) : failure('NOT_FOUND');
}
