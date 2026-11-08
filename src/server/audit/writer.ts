import 'server-only';
import type postgres from 'postgres';
import { systemWriteAudit } from '@/server/db/admin';
import type { UserTransaction } from '@/server/db/server';
import {
  AUDIT_EVENTS,
  type AuditMetadata,
  type SystemAuditEventType,
  type UserAuditEventType,
} from './events';

/**
 * Audit writers (ADR-012). Two paths, one source per event (F-23):
 * - `recordAudit` writes inside the caller's user transaction via `app.write_audit`; the DB
 *   takes the actor from auth.uid() and the roles from memberships — they are never passed.
 * - `recordSystemAudit` writes via the restricted system path (`app.write_system_audit`) for
 *   denied attempts, pre-auth auth events and jobs.
 * Metadata is validated against the event's strict schema before it reaches the DB.
 */

type AuditTarget = {
  organizationId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
};

function parseMetadata(eventType: keyof typeof AUDIT_EVENTS, metadata: unknown): Record<string, postgres.JSONValue> {
  const spec = AUDIT_EVENTS[eventType];
  return spec.metadata.parse(metadata) as Record<string, postgres.JSONValue>;
}

export async function recordAudit<E extends UserAuditEventType>(
  tx: UserTransaction,
  eventType: E,
  metadata: AuditMetadata<E>,
  target: AuditTarget = {},
): Promise<string> {
  const safe = parseMetadata(eventType, metadata);
  const [row] = await tx<{ id: string }[]>`
    select app.write_audit(
      ${eventType},
      ${target.organizationId ?? null}::uuid,
      ${target.resourceType ?? null},
      ${target.resourceId ?? null}::uuid,
      ${tx.json(safe)},
      ${target.requestId ?? null}
    ) as id
  `;
  if (!row) throw new Error('write_audit returned no row');
  return row.id;
}

export async function recordSystemAudit<E extends SystemAuditEventType>(
  eventType: E,
  metadata: AuditMetadata<E>,
  target: AuditTarget & {
    /** The initiating profile, when known (recorded with actor_type = system). */
    actorProfileId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
  } = {},
): Promise<string> {
  const safe = parseMetadata(eventType, metadata);
  return systemWriteAudit({
    eventType,
    actorProfileId: target.actorProfileId ?? null,
    organizationId: target.organizationId ?? null,
    resourceType: target.resourceType ?? null,
    resourceId: target.resourceId ?? null,
    metadata: safe,
    requestId: target.requestId ?? null,
    ip: target.ip ?? null,
    userAgent: target.userAgent ? target.userAgent.slice(0, 512) : null,
  });
}
