import 'server-only';
import { z } from 'zod';

/**
 * Audit event catalog (API_CONTRACTS §9, SECURITY.md §7.1) — Phase 1 events.
 * Must match `app.audit_event_types` (supabase/migrations/20261108120300_audit.sql); the
 * integration test tests/integration/audit-catalog.test.ts asserts parity.
 *
 * Metadata rules (SECURITY.md §7.3): ids, enum values, changed field NAMES, status
 * transitions. NEVER names, emails, document numbers, free text, response values, file names.
 * Every schema is `.strict()` with snake_case keys (the DB also rejects risky key names).
 */

const id = z.uuid();
const role = z.enum(['organization_owner', 'psychologist']);
const fieldNames = z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(32);
const empty = z.object({}).strict();

type Writer = 'user' | 'system' | 'both';
type Category =
  | 'auth'
  | 'organization'
  | 'membership'
  | 'invitation'
  | 'branding'
  | 'profile'
  | 'platform'
  | 'security';

type EventSpec = {
  category: Category;
  writer: Writer;
  orgOptional: boolean;
  metadata: z.ZodType<Record<string, unknown>>;
};

function event<M extends z.ZodType<Record<string, unknown>>>(
  category: Category,
  writer: Writer,
  orgOptional: boolean,
  metadata: M,
) {
  return { category, writer, orgOptional, metadata } as const satisfies EventSpec;
}

export const AUDIT_EVENTS = {
  // auth
  'auth.signed_in': event(
    'auth',
    'both',
    true,
    z.object({ method: z.enum(['password', 'magic_link']).optional() }).strict(),
  ),
  'auth.sign_in_failed': event(
    'auth',
    'system',
    true,
    z.object({ method: z.enum(['password', 'magic_link']).optional() }).strict(),
  ),
  'auth.signed_out': event('auth', 'user', true, empty),
  'auth.mfa_enrolled': event('auth', 'user', true, z.object({ factor_id: id }).strict()),
  'auth.mfa_verified': event('auth', 'user', true, z.object({ factor_id: id }).strict()),
  'auth.mfa_failed': event('auth', 'both', true, z.object({ factor_id: id.optional() }).strict()),
  'auth.mfa_reset': event(
    'auth',
    'system',
    true,
    z.object({ via: z.enum(['recovery_code', 'support']) }).strict(),
  ),
  'auth.password_reset': event('auth', 'both', true, empty),
  'auth.rate_limited': event(
    'auth',
    'system',
    true,
    z.object({ action: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/) }).strict(),
  ),
  'auth.org_switched': event(
    'auth',
    'user',
    false,
    z.object({ from_organization_id: id.nullable() }).strict(),
  ),
  'auth.capacity_switched': event(
    'auth',
    'user',
    false,
    z
      .object({
        from_acting_as: z.enum(['staff', 'patient', 'guardian', 'platform_admin']).nullable(),
        to_acting_as: z.enum(['staff', 'patient', 'guardian', 'platform_admin']),
      })
      .strict(),
  ),
  'auth.session_revoked': event(
    'auth',
    'system',
    true,
    z.object({ scope: z.enum(['others', 'global']) }).strict(),
  ),
  'auth.recovery_codes_generated': event('auth', 'user', true, z.object({ batch_id: id }).strict()),
  'auth.recovery_code_used': event('auth', 'system', true, z.object({ batch_id: id }).strict()),
  // organization
  'organization.provisioned': event(
    'organization',
    'system',
    false,
    z.object({ invitation_id: id.optional() }).strict(),
  ),
  'organization.updated': event(
    'organization',
    'user',
    false,
    z.object({ changed_fields: fieldNames }).strict(),
  ),
  'organization.suspended': event(
    'organization',
    'both',
    false,
    z.object({ from_status: z.enum(['active', 'read_only']) }).strict(),
  ),
  'organization_domain.added': event(
    'organization',
    'user',
    false,
    z.object({ domain_id: id, domain_type: z.enum(['subdomain', 'custom']) }).strict(),
  ),
  'organization_domain.verified': event(
    'organization',
    'system',
    false,
    z.object({ domain_id: id }).strict(),
  ),
  'organization_domain.removed': event(
    'organization',
    'user',
    false,
    z.object({ domain_id: id }).strict(),
  ),
  // branding
  'organization_branding.updated': event(
    'branding',
    'user',
    false,
    z.object({ changed_fields: fieldNames }).strict(),
  ),
  // membership
  'membership.created': event(
    'membership',
    'system',
    false,
    z.object({ invitation_id: id }).strict(),
  ),
  'membership.roles_changed': event(
    'membership',
    'user',
    false,
    z.object({ added: z.array(role).max(2), removed: z.array(role).max(2) }).strict(),
  ),
  'membership.role_self_granted': event('membership', 'user', false, z.object({ role }).strict()),
  'membership.suspended': event('membership', 'user', false, empty),
  'membership.removed': event('membership', 'user', false, empty),
  'professional_profile.updated': event(
    'membership',
    'user',
    false,
    z.object({ changed_fields: fieldNames }).strict(),
  ),
  // invitation
  'invitation.created': event(
    'invitation',
    'user',
    false,
    z.object({ roles: z.array(role).min(1).max(2) }).strict(),
  ),
  'invitation.accepted': event(
    'invitation',
    'system',
    false,
    z.object({ membership_id: id }).strict(),
  ),
  'invitation.revoked': event('invitation', 'user', false, empty),
  'invitation.expired': event('invitation', 'system', false, empty),
  // profile
  'profile.updated': event(
    'profile',
    'user',
    true,
    z.object({ changed_fields: fieldNames }).strict(),
  ),
  // platform
  'platform_grant.requested': event(
    'platform',
    'user',
    false,
    z
      .object({
        grant_id: id,
        scope: z.enum(['org_support_non_clinical', 'clinical_read_break_glass']),
      })
      .strict(),
  ),
  // security
  'access.denied': event(
    'security',
    'system',
    true,
    z
      .object({
        permission: z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/),
        code: z.enum(['FORBIDDEN', 'NOT_FOUND']),
        acting_as: z.enum(['staff', 'patient', 'guardian', 'platform_admin']).nullable(),
      })
      .strict(),
  ),
  'access.rate_limited': event(
    'security',
    'system',
    true,
    z.object({ action: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/) }).strict(),
  ),
} as const;

export type AuditEventType = keyof typeof AUDIT_EVENTS;
export type AuditMetadata<E extends AuditEventType> = z.input<(typeof AUDIT_EVENTS)[E]['metadata']>;

export type UserAuditEventType = {
  [E in AuditEventType]: (typeof AUDIT_EVENTS)[E]['writer'] extends 'system' ? never : E;
}[AuditEventType];

export type SystemAuditEventType = {
  [E in AuditEventType]: (typeof AUDIT_EVENTS)[E]['writer'] extends 'user' ? never : E;
}[AuditEventType];

export const AUDIT_EVENT_TYPES = Object.keys(AUDIT_EVENTS) as AuditEventType[];
