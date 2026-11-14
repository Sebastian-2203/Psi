import { z } from 'zod';
import { optionalText, uuidField } from '@/lib/validation';

/**
 * Therapy sessions (API_CONTRACTS §8.8): RECORDS only — no scheduling engine, calendar,
 * reminders or video (SES-07, rule 18). `locationOrLink` is free text for an external
 * meeting/location (SES-06), never rendered as an embed.
 */

export const SESSION_STATUSES = [
  'scheduled',
  'held',
  'cancelled_by_patient',
  'cancelled_by_psychologist',
  'no_show',
] as const;
export const SESSION_MODALITIES = ['in_person', 'remote_external', 'phone'] as const;
const CANCELLED = new Set<string>(['cancelled_by_patient', 'cancelled_by_psychologist']);

const datetime = z.iso.datetime({ offset: true, error: 'dateInvalid' });

export const recordSessionSchema = z
  .object({
    patientId: uuidField,
    start: datetime,
    end: datetime,
    status: z.enum(SESSION_STATUSES, 'choiceInvalid').default('held'),
    modality: z.enum(SESSION_MODALITIES, 'choiceInvalid'),
    treatmentPlanId: uuidField.optional(),
    locationOrLink: optionalText(500),
    cancelledReason: optionalText(500),
  })
  .strict()
  .refine((v) => Date.parse(v.end) > Date.parse(v.start), { message: 'dateInvalid', path: ['end'] })
  .refine((v) => v.cancelledReason === undefined || CANCELLED.has(v.status), {
    message: 'choiceInvalid',
    path: ['cancelledReason'],
  });
export type RecordSessionInput = z.input<typeof recordSessionSchema>;

export const updateSessionSchema = z
  .object({
    sessionId: uuidField,
    status: z.enum(SESSION_STATUSES, 'choiceInvalid').optional(),
    start: datetime.optional(),
    end: datetime.optional(),
    modality: z.enum(SESSION_MODALITIES, 'choiceInvalid').optional(),
    treatmentPlanId: uuidField.nullable().optional(),
    locationOrLink: z.string().trim().max(500, 'fieldTooLong').nullable().optional(),
    cancelledReason: z.string().trim().max(500, 'fieldTooLong').nullable().optional(),
  })
  .strict();
export type UpdateSessionInput = z.input<typeof updateSessionSchema>;

export const listSessionsSchema = z
  .object({
    patientId: uuidField.optional(),
    from: datetime.optional(),
    to: datetime.optional(),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();
export type ListSessionsInput = z.input<typeof listSessionsSchema>;

export const portalPatientSchema = z.object({ patientId: uuidField.optional() }).strict();
export type PortalPatientInput = z.input<typeof portalPatientSchema>;
