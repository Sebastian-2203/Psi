import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
import { recordAudit, recordSystemAudit } from '@/server/audit';
import { requirePermission, type AuthzContext } from '@/server/authz';
import { adminCreateInvitedUser, adminDeleteUnacceptedUser } from '@/server/db/service-role';
import {
  systemAcceptPortalInvitation,
  systemAcceptStaffInvitation,
  systemPeekInvitation,
  systemPeekStaffInvitation,
} from '@/server/db/system';
import { withUserTransaction } from '@/server/db/server';
import { AppError, dbFailure, failure, ok, toAppError, type Outcome } from '@/server/errors';
import { verifyAccessToken, type VerifiedClaims } from './claims';
import { sendEmail, type Email } from './mailer';
import { consumePreAuthLimit } from './rate-limit';
import type { RequestMeta } from './request-meta';
import { nextStepAfterPassword, type PostSignInStep } from './sign-in';

/**
 * Staff invitations (AUTH-06, SECURITY.md §3.8). Sign-ups are disabled: the ONLY way a staff
 * account is created is accepting an invitation through the restricted admin path.
 *
 * Token: 32 CSPRNG bytes, base64url; only sha256(token) is stored. The emailed link carries the
 * token in the URL FRAGMENT (never sent to servers, logs or Referer); the page moves it into a
 * POST body immediately. Acceptance is single use, email-bound and roles are fixed at creation
 * (`app.accept_staff_invitation`). All acceptance errors are the same generic error.
 */

/** Product constant (SECURITY.md §3.8 staff 72 h), configurable. */
export const STAFF_INVITATION_TTL_HOURS = 72;

const INVALID = () =>
  failure('PRECONDITION_FAILED', { messageKey: 'auth.errors.invitationInvalid' });

export function generateInvitationToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashInvitationToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function invitationLink(
  origin: string,
  locale: 'es' | 'en',
  token: string,
  kind?: 'patient' | 'guardian',
): string {
  // The fragment is never sent to servers. `kind` is a UI routing hint only, never trusted.
  return `${origin}/${locale}/invitation#token=${token}${kind ? `&kind=${kind}` : ''}`;
}

/** Product constant (SECURITY.md §3.8: patient/guardian 7 days), configurable. */
export const PORTAL_INVITATION_TTL_HOURS = 168;

const PORTAL_INVITE_KEYS = {
  patient_not_invitable: 'patients.errors.notInvitable',
  guardian_not_invitable: 'guardians.errors.notInvitable',
} as const;

export type CreatedInvitation = { invitationId: string; expiresAt: string };

/**
 * Owner action (permission `org.invitations.manage`, aal2). In ONE user transaction: revoke a
 * previous pending invitation for the same email (re-send = new token), insert the new one
 * (RLS: owner of an active org), audit, and deliver the email. A delivery failure rolls the
 * whole transaction back, so no undeliverable pending invitation remains.
 */
export async function createStaffInvitation(
  ctx: AuthzContext,
  input: { email: string; roles: Array<'organization_owner' | 'psychologist'> },
  origin: string,
  renderEmail: (link: string) => Email,
  emailLocale: 'es' | 'en',
): Promise<Outcome<CreatedInvitation>> {
  const permitted = await requirePermission(ctx, 'org.invitations.manage');
  if (!permitted.ok) return permitted;
  const organizationId = ctx.organizationId as string;
  const token = generateInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const expiresAt = new Date(Date.now() + STAFF_INVITATION_TTL_HOURS * 3600 * 1000);
  try {
    const created = await withUserTransaction(ctx.claims, async (tx) => {
      const revoked = await tx<{ id: string }[]>`
        update public.invitations set status = 'revoked'
        where organization_id = ${organizationId} and email = ${input.email} and status = 'pending'
        returning id
      `;
      for (const row of revoked) {
        await recordAudit(
          tx,
          'invitation.revoked',
          {},
          {
            organizationId,
            resourceType: 'invitation',
            resourceId: row.id,
            requestId: ctx.requestId,
          },
        );
      }
      const [row] = await tx<{ id: string; expires_at: Date }[]>`
        insert into public.invitations (organization_id, invitation_type, email, roles, token_hash, expires_at)
        values (${organizationId}, 'staff', ${input.email}, ${input.roles}::public.membership_role[],
                ${tokenHash}, ${expiresAt})
        returning id, expires_at
      `;
      if (!row) throw new Error('invitation insert returned no row');
      await recordAudit(
        tx,
        'invitation.created',
        { roles: input.roles },
        {
          organizationId,
          resourceType: 'invitation',
          resourceId: row.id,
          requestId: ctx.requestId,
        },
      );
      await sendEmail({
        ...renderEmail(invitationLink(origin, emailLocale, token)),
        to: input.email,
      });
      return { invitationId: row.id, expiresAt: row.expires_at.toISOString() };
    });
    return ok(created);
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
}

export type InvitationListItem = {
  id: string;
  email: string;
  roles: Array<'organization_owner' | 'psychologist'>;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
  createdAt: string;
};

/** Owner-only list (RLS: invitations_select_owner). */
export async function listStaffInvitations(
  ctx: AuthzContext,
): Promise<Outcome<InvitationListItem[]>> {
  const permitted = await requirePermission(ctx, 'org.invitations.manage');
  if (!permitted.ok) return permitted;
  const rows = await withUserTransaction(
    ctx.claims,
    (tx) =>
      tx<
        {
          id: string;
          email: string;
          roles: InvitationListItem['roles'];
          status: InvitationListItem['status'];
          expires_at: Date;
          created_at: Date;
        }[]
      >`
      select id, email::text as email, roles, status, expires_at, created_at
      from public.invitations
      where organization_id = ${ctx.organizationId}
      order by created_at desc
      limit 50
    `,
  );
  return ok(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      roles: r.roles,
      status: r.status === 'pending' && r.expires_at.getTime() <= Date.now() ? 'expired' : r.status,
      expiresAt: r.expires_at.toISOString(),
      createdAt: r.created_at.toISOString(),
    })),
  );
}

export type InvitationPreview = {
  organizationName: string;
  email: string;
  roles: Array<'organization_owner' | 'psychologist'>;
  requiresProfessionalProfile: boolean;
  expiresAt: string;
};

async function limitInvitation(token: string, meta: RequestMeta): Promise<boolean> {
  return consumePreAuthLimit({
    action: 'auth.invitation',
    ip: meta.ip,
    subject: hashInvitationToken(token).toString('hex'),
    requestId: meta.requestId,
    userAgent: meta.userAgent,
  });
}

/** Read-only preview for the acceptance form. Never reveals whether the email has an account. */
export async function previewStaffInvitation(
  token: string,
  meta: RequestMeta,
): Promise<Outcome<InvitationPreview>> {
  if (!(await limitInvitation(token, meta))) {
    return failure('RATE_LIMITED', { messageKey: 'auth.errors.rateLimited' });
  }
  const row = await systemPeekStaffInvitation(hashInvitationToken(token));
  if (!row) return INVALID();
  return ok({
    organizationName: row.organizationDisplayName,
    email: row.email,
    roles: row.roles,
    requiresProfessionalProfile: row.roles.includes('psychologist'),
    expiresAt: row.expiresAt,
  });
}

export type AcceptInvitationResult = { claims: VerifiedClaims; step: PostSignInStep };

/**
 * Accept: new email -> the admin path creates a confirmed auth user with the chosen password;
 * existing account -> the password must be that account's current password (no "accept as a
 * different user", no account takeover through an invitation). Then the session is opened
 * with the cookie-bound client and `app.accept_staff_invitation` consumes the token atomically.
 * A user created here is deleted again if acceptance fails.
 */
export async function acceptStaffInvitation(
  client: SupabaseClient,
  input: {
    token: string;
    displayName: string;
    password: string;
    locale: 'es' | 'en';
    professional?: { title: string; licenseNumber: string; licenseIssuer: string };
  },
  meta: RequestMeta,
): Promise<Outcome<AcceptInvitationResult>> {
  if (!(await limitInvitation(input.token, meta))) {
    return failure('RATE_LIMITED', { messageKey: 'auth.errors.rateLimited' });
  }
  const tokenHash = hashInvitationToken(input.token);
  const invitation = await systemPeekStaffInvitation(tokenHash);
  if (!invitation) return INVALID();
  // A new membership never has a professional profile yet (DB: professional_profile_required).
  if (invitation.roles.includes('psychologist') && !input.professional) {
    return failure('VALIDATION_FAILED', {
      messageKey: 'errors.validationFailed',
      fieldErrors: { professional: ['fieldRequired'] },
    });
  }

  let createdUserId: string | null = null;
  if (!invitation.existingProfileId) {
    const created = await adminCreateInvitedUser({
      email: invitation.email,
      password: input.password,
      displayName: input.displayName,
      locale: input.locale,
    });
    if (!created.ok) {
      if (created.reason === 'weak_password') {
        return failure('VALIDATION_FAILED', {
          messageKey: 'auth.errors.weakPassword',
          fieldErrors: { password: ['passwordWeak'] },
        });
      }
      return INVALID();
    }
    createdUserId = created.userId;
  }

  const { data, error } = await client.auth.signInWithPassword({
    email: invitation.email,
    password: input.password,
  });
  const claims = !error && data.session ? await verifyAccessToken(data.session.access_token) : null;
  if (!claims) {
    await recordSystemAudit(
      'auth.sign_in_failed',
      { method: 'password' },
      { requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent },
    ).catch(() => undefined);
    if (createdUserId) await adminDeleteUnacceptedUser(createdUserId).catch(() => undefined);
    return INVALID();
  }

  try {
    await systemAcceptStaffInvitation({
      tokenHash,
      profileId: claims.sub,
      ...(input.professional ? { professional: input.professional } : {}),
      requestId: meta.requestId,
    });
  } catch {
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    if (createdUserId) await adminDeleteUnacceptedUser(createdUserId).catch(() => undefined);
    return INVALID();
  }

  await withUserTransaction(claims, (tx) =>
    recordAudit(tx, 'auth.signed_in', { method: 'password' }, { requestId: meta.requestId }),
  ).catch(() => undefined);
  return ok({ claims, step: await nextStepAfterPassword(client, claims) });
}

// ---------------------------------------------------------------------------
// Portal invitations (patient / guardian) — Phase 2
// ---------------------------------------------------------------------------

export type PortalInvitationTarget =
  { kind: 'patient'; patientId: string } | { kind: 'guardian'; patientGuardianId: string };

/**
 * Care-team action. Patient: permission `patient.portal.invite`; guardian: `guardian.manage`.
 * ONE user transaction: resolve the subject through RLS (a row the caller cannot see is
 * NOT_FOUND), revoke a previous pending invitation for the SAME subject, insert the new one
 * (RLS + `app.guard_portal_invitation` re-check care-team, unlinked subject, relationship state),
 * audit `invitation.created` (ids only, never the email) and deliver the email; a delivery
 * failure rolls everything back. NOTE: the DB allows one pending invitation per (organization,
 * email) across all kinds, so reusing an email that is pending for ANOTHER subject is a CONFLICT.
 */
export async function createPortalInvitation(
  ctx: AuthzContext,
  target: PortalInvitationTarget,
  email: string,
  origin: string,
  renderEmail: (link: string) => Email,
  emailLocale: 'es' | 'en',
): Promise<Outcome<CreatedInvitation>> {
  const permitted = await requirePermission(
    ctx,
    target.kind === 'patient' ? 'patient.portal.invite' : 'guardian.manage',
  );
  if (!permitted.ok) return permitted;
  const organizationId = ctx.organizationId as string;
  const token = generateInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const expiresAt = new Date(Date.now() + PORTAL_INVITATION_TTL_HOURS * 3600 * 1000);
  try {
    const created = await withUserTransaction(ctx.claims, async (tx) => {
      let patientId: string | null = null;
      let guardianId: string | null = null;
      let patientGuardianId: string | null = null;
      let auditPatientId: string | null = null;
      if (target.kind === 'patient') {
        const [p] = await tx<{ id: string }[]>`
          select id from public.patients where organization_id = ${organizationId} and id = ${target.patientId}`;
        if (!p) throw new AppError('NOT_FOUND');
        patientId = p.id;
        auditPatientId = p.id;
      } else {
        const [r] = await tx<{ id: string; guardian_id: string; patient_id: string }[]>`
          select id, guardian_id, patient_id from public.patient_guardians
          where organization_id = ${organizationId} and id = ${target.patientGuardianId}`;
        if (!r) throw new AppError('NOT_FOUND');
        patientGuardianId = r.id;
        guardianId = r.guardian_id;
        auditPatientId = r.patient_id;
      }
      const revoked = await tx<{ id: string }[]>`
        update public.invitations set status = 'revoked'
        where organization_id = ${organizationId} and status = 'pending'
          and invitation_type = ${target.kind}::public.invitation_type
          and (${patientId}::uuid is null or patient_id = ${patientId})
          and (${patientGuardianId}::uuid is null or patient_guardian_id = ${patientGuardianId})
        returning id`;
      for (const row of revoked) {
        await recordAudit(
          tx,
          'invitation.revoked',
          {},
          {
            organizationId,
            resourceType: 'invitation',
            resourceId: row.id,
            requestId: ctx.requestId,
          },
        );
      }
      const [row] = await tx<{ id: string; expires_at: Date }[]>`
        insert into public.invitations (organization_id, invitation_type, email, token_hash, expires_at,
                                        patient_id, guardian_id, patient_guardian_id)
        values (${organizationId}, ${target.kind}::public.invitation_type, ${email}, ${tokenHash},
                ${expiresAt}, ${patientId}, ${guardianId}, ${patientGuardianId})
        returning id, expires_at`;
      if (!row) throw new Error('invitation insert returned no row');
      await recordAudit(
        tx,
        'invitation.created',
        {
          invitation_type: target.kind,
          patient_id: auditPatientId as string,
          ...(guardianId
            ? { guardian_id: guardianId, patient_guardian_id: patientGuardianId as string }
            : {}),
        },
        {
          organizationId,
          resourceType: 'invitation',
          resourceId: row.id,
          requestId: ctx.requestId,
        },
      );
      await sendEmail({
        ...renderEmail(invitationLink(origin, emailLocale, token, target.kind)),
        to: email,
      });
      return { invitationId: row.id, expiresAt: row.expires_at.toISOString() };
    });
    return ok(created);
  } catch (error) {
    return dbFailure(error, PORTAL_INVITE_KEYS);
  }
}

export type PortalInvitationPreview = {
  organizationName: string;
  email: string;
  kind: 'patient' | 'guardian';
  expiresAt: string;
};

/** Read-only preview; staff tokens are INVALID here (and portal tokens are INVALID for staff). */
export async function previewPortalInvitation(
  token: string,
  meta: RequestMeta,
): Promise<Outcome<PortalInvitationPreview>> {
  if (!(await limitInvitation(token, meta))) {
    return failure('RATE_LIMITED', { messageKey: 'auth.errors.rateLimited' });
  }
  const row = await systemPeekInvitation(hashInvitationToken(token));
  if (!row || row.kind === 'staff') return INVALID();
  return ok({
    organizationName: row.organizationDisplayName,
    email: row.email,
    kind: row.kind,
    expiresAt: row.expiresAt,
  });
}

/**
 * Same account rules as staff acceptance (new email -> confirmed user with the chosen password;
 * existing account -> its current password; no "accept as a different user"). The DB links
 * patients/guardians.profile_id, rejects staff of the organization, and a guardian acceptance
 * leaves the relationship pending_verification. No MFA step: portal MFA is optional (Q-07).
 */
export async function acceptPortalInvitation(
  client: SupabaseClient,
  input: { token: string; displayName: string; password: string; locale: 'es' | 'en' },
  meta: RequestMeta,
): Promise<Outcome<{ claims: VerifiedClaims; kind: 'patient' | 'guardian' }>> {
  if (!(await limitInvitation(input.token, meta))) {
    return failure('RATE_LIMITED', { messageKey: 'auth.errors.rateLimited' });
  }
  const tokenHash = hashInvitationToken(input.token);
  const invitation = await systemPeekInvitation(tokenHash);
  if (!invitation || invitation.kind === 'staff') return INVALID();

  let createdUserId: string | null = null;
  if (!invitation.existingProfileId) {
    const created = await adminCreateInvitedUser({
      email: invitation.email,
      password: input.password,
      displayName: input.displayName,
      locale: input.locale,
    });
    if (!created.ok) {
      if (created.reason === 'weak_password') {
        return failure('VALIDATION_FAILED', {
          messageKey: 'auth.errors.weakPassword',
          fieldErrors: { password: ['passwordWeak'] },
        });
      }
      return INVALID();
    }
    createdUserId = created.userId;
  }

  const { data, error } = await client.auth.signInWithPassword({
    email: invitation.email,
    password: input.password,
  });
  const claims = !error && data.session ? await verifyAccessToken(data.session.access_token) : null;
  if (!claims) {
    await recordSystemAudit(
      'auth.sign_in_failed',
      { method: 'password' },
      { requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent },
    ).catch(() => undefined);
    if (createdUserId) await adminDeleteUnacceptedUser(createdUserId).catch(() => undefined);
    return INVALID();
  }

  let accepted: Awaited<ReturnType<typeof systemAcceptPortalInvitation>>;
  try {
    accepted = await systemAcceptPortalInvitation({
      tokenHash,
      profileId: claims.sub,
      requestId: meta.requestId,
    });
  } catch {
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    if (createdUserId) await adminDeleteUnacceptedUser(createdUserId).catch(() => undefined);
    return INVALID();
  }
  await withUserTransaction(claims, (tx) =>
    recordAudit(tx, 'auth.signed_in', { method: 'password' }, { requestId: meta.requestId }),
  ).catch(() => undefined);
  return ok({ claims, kind: accepted.kind });
}
